"""
route_sales.api.orders
======================
GET /api/method/route_sales.api.orders.get_customer_orders
"""

import frappe
from frappe.utils import today, add_days
from route_sales.api.security import assert_customer_readonly_access
from route_sales.api.constants import PENDING_DELIVERY_STATUSES, COMPLETED_ORDER_STATUSES, DocType
from route_sales.api.utils import round_currency


def _normalize_order_status(status):
    value = (status or "").strip().lower()
    if value in {"pending", "pending_delivery", "pending delivery"}:
        return "pending_delivery"
    if value in {"completed", "completed_order", "completed order"}:
        return "completed_order"
    return None


@frappe.whitelist()
def get_customer_orders(
    customer,
    status=None,
    from_date=None,
    to_date=None,
    page=1,
    page_length=50,
):
    """
    Returns customer Sales Order history with delivery-focused filtering.

    Response
    --------
    {
      "customer", "from_date", "to_date",
      "total", "page", "page_length",
      "summary": {
        "total_orders", "pending_delivery", "completed_orders",
        "total_value", "pending_value", "completed_value"
      },
      "orders": [
        {
          "sales_order", "customer", "customer_name",
          "date", "delivery_date", "status", "grand_total",
          "rounded_total", "advance_paid", "delivered", "pending_delivery",
          "items": [{
            "item_code", "item_name", "qty", "delivered_qty",
            "pending_qty", "rate", "uom", "amount"
          }]
        }
      ]
    }
    """
    assert_customer_readonly_access(customer)

    page = max(1, int(page))
    page_length = min(100, max(1, int(page_length)))
    to_date = to_date or today()
    from_date = from_date or add_days(to_date, -60)

    filters = {
        "customer": customer,
        "docstatus": 1,
        "transaction_date": ["between", [from_date, to_date]],
    }

    normalized_status = _normalize_order_status(status)
    if normalized_status == "pending_delivery":
        filters["status"] = ["in", list(PENDING_DELIVERY_STATUSES)]
    elif normalized_status == "completed_order":
        filters["status"] = ["in", list(COMPLETED_ORDER_STATUSES)]

    rows = frappe.db.get_all(
        DocType.SALES_ORDER,
        filters=filters,
        fields=[
            "name",
            "customer",
            "customer_name",
            "transaction_date",
            "delivery_date",
            "status",
            "grand_total",
            "rounded_total",
            "advance_paid",
        ],
        order_by="transaction_date desc, name desc",
        limit_start=(page - 1) * page_length,
        limit_page_length=page_length,
    )
    total = frappe.db.count(DocType.SALES_ORDER, filters=filters)

    order_names = [row["name"] for row in rows]
    line_items = []
    if order_names:
        line_items = frappe.db.get_all(
            "Sales Order Item",
            filters={"parent": ["in", order_names]},
            fields=[
                "parent",
                "item_code",
                "item_name",
                "qty",
                "delivered_qty",
                "rate",
                "uom",
                "amount",
            ],
            order_by="parent asc, idx asc",
        )

    items_map = {}
    pending_value_map = {}
    delivered_value_map = {}
    for row in line_items:
        qty = float(row.get("qty") or 0)
        delivered_qty = float(row.get("delivered_qty") or 0)
        pending_qty = max(qty - delivered_qty, 0)
        rate = float(row.get("rate") or 0)
        items_map.setdefault(row["parent"], []).append({
            "item_code": row["item_code"],
            "item_name": row["item_name"],
            "qty": qty,
            "delivered_qty": delivered_qty,
            "pending_qty": pending_qty,
            "rate": rate,
            "uom": row["uom"],
            "amount": float(row.get("amount") or 0),
        })
        pending_value_map[row["parent"]] = pending_value_map.get(row["parent"], 0) + (pending_qty * rate)
        delivered_value_map[row["parent"]] = delivered_value_map.get(row["parent"], 0) + (min(delivered_qty, qty) * rate)

    all_orders = frappe.db.get_all(
        DocType.SALES_ORDER,
        filters={
            "customer": customer,
            "docstatus": 1,
            "transaction_date": ["between", [from_date, to_date]],
        },
        fields=["name", "status", "grand_total"],
    )
    summary = {
        "total_orders": len(all_orders),
        "pending_delivery": sum(1 for row in all_orders if row["status"] in PENDING_DELIVERY_STATUSES),
        "completed_orders": sum(1 for row in all_orders if row["status"] in COMPLETED_ORDER_STATUSES),
        "total_value": round_currency(sum(float(row.get("grand_total") or 0) for row in all_orders)),
        "pending_value": 0,
        "completed_value": 0,
    }

    if all_orders:
        summary_items = frappe.db.get_all(
            "Sales Order Item",
            filters={"parent": ["in", [row["name"] for row in all_orders]]},
            fields=["parent", "qty", "delivered_qty", "rate"],
        )
        for row in summary_items:
            qty = float(row.get("qty") or 0)
            delivered_qty = float(row.get("delivered_qty") or 0)
            pending_qty = max(qty - delivered_qty, 0)
            rate = float(row.get("rate") or 0)
            summary["pending_value"] += pending_qty * rate
            summary["completed_value"] += min(delivered_qty, qty) * rate
        summary["pending_value"] = round_currency(summary["pending_value"])
        summary["completed_value"] = round_currency(summary["completed_value"])

    orders = []
    for row in rows:
        pending_value = round_currency(pending_value_map.get(row["name"], 0))
        delivered_value = round_currency(delivered_value_map.get(row["name"], 0))
        orders.append({
            "sales_order": row["name"],
            "customer": row["customer"],
            "customer_name": row.get("customer_name"),
            "date": str(row["transaction_date"]),
            "delivery_date": str(row["delivery_date"]) if row.get("delivery_date") else None,
            "status": row["status"],
            "grand_total": float(row.get("grand_total") or 0),
            "rounded_total": float(row.get("rounded_total") or 0),
            "advance_paid": float(row.get("advance_paid") or 0),
            "delivered_value": delivered_value,
            "pending_delivery_value": pending_value,
            "is_completed": row["status"] in COMPLETED_ORDER_STATUSES,
            "has_pending_delivery": pending_value > 0,
            "items": items_map.get(row["name"], []),
        })

    return {
        "total":   total,
        "summary": summary,
        "orders":  orders,
    }
