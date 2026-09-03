"""
route_sales.api.stock
=====================
Van stock count capture — records quantities loaded and returned per session.
No ERPNext Stock Entries are created here; this data is for count tracking only.
The warehouse team reconciles actual ERPNext stock from these records separately.

POST /api/method/route_sales.api.stock.save_session_stock
POST /api/method/route_sales.api.stock.save_return_stock
GET  /api/method/route_sales.api.stock.get_session_stock
"""

import frappe
import json
from route_sales.api.security import ensure_route_session_access
from route_sales.api.constants import DocType, SESSION_REMARK_PREFIX


@frappe.whitelist(methods=["POST"])
def save_session_stock(route_session, items):
    """
    Save the items loaded into the van at session start.
    Replaces any previously saved stock for this session.

    Parameters
    ----------
    route_session : str  – Route Session name.
    items         : list – [{ "item_code": str, "item_name": str, "qty_loaded": float }]
                           Pass as JSON string via HTTP.

    Returns
    -------
    { "route_session": str, "items_saved": int }
    """
    ensure_route_session_access(route_session)

    if isinstance(items, str):
        items = json.loads(items) if items.strip() else []

    if not items:
        frappe.throw("No items provided.", frappe.ValidationError)

    session = frappe.get_doc("Route Session", route_session)

    # Clear any previously saved stock and rebuild fresh
    session.loaded_items = []
    for item in items:
        qty = float(item.get("qty_loaded", 0))
        if qty <= 0:
            continue
        item_name = (
            item.get("item_name")
            or frappe.db.get_value(DocType.ITEM, item["item_code"], "item_name")
            or item["item_code"]
        )
        session.append("loaded_items", {
            "item_code":    item["item_code"],
            "item_name":    item_name,
            "qty_loaded":   qty,
            "qty_returned": 0,
        })

    session.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "route_session": route_session,
        "items_saved":   len(session.loaded_items),
    }


@frappe.whitelist(methods=["POST"])
def save_return_stock(route_session, items):
    """
    Update the returned quantities before ending the session.
    Called from EndSessionModal before end_session is called.

    Parameters
    ----------
    route_session : str  – Route Session name.
    items         : list – [{ "item_code": str, "qty_returned": float }]
                           Pass as JSON string via HTTP.

    Returns
    -------
    {
      "route_session": str,
      "items": [{ "item_code", "item_name", "qty_loaded", "qty_returned", "qty_sold" }]
    }
    """
    ensure_route_session_access(route_session)

    if isinstance(items, str):
        items = json.loads(items) if items.strip() else []

    returns_map = {
        i.get("item_code"): float(i.get("qty_returned", 0))
        for i in items
        if i.get("item_code")
    }

    session = frappe.get_doc("Route Session", route_session)
    delivered_qty_map = _get_delivered_qty_map_for_session(route_session)
    for row in session.loaded_items:
        if row.item_code in returns_map:
            # qty_returned can't exceed what's actually still on the van --
            # i.e. what was loaded minus what's already been delivered/sold
            # this session, not the full qty_loaded (see _stock_summary).
            still_on_van = max(0, (row.qty_loaded or 0) - delivered_qty_map.get(row.item_code, 0))
            row.qty_returned = min(returns_map[row.item_code], still_on_van)

    session.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "route_session": route_session,
        "items": _stock_summary(session, delivered_qty_map),
    }


@frappe.whitelist()
def get_session_stock(route_session):
    """
    Get loaded/delivered/returned stock summary for a route session.
    qty_delivered is calculated live from Delivery Notes created during
    the session. qty_remaining = qty_loaded - qty_delivered.

    Returns
    -------
    {
      "route_session": str,
      "has_stock":     bool,
      "items": [{
        "item_code", "item_name",
        "qty_loaded", "qty_delivered", "qty_returned", "qty_remaining"
      }]
    }
    """
    ensure_route_session_access(route_session)
    items = get_session_stock_summary(route_session)

    return {
        "route_session": route_session,
        "has_stock":     len(items) > 0,
        "items":         items,
    }


@frappe.whitelist()
def get_route_stock_suggestion(route_assignment):
    """
    Suggest van stock quantities based on pending Sales Orders for all
    customers on the route for this assignment.

    Returns
    -------
    {
      "route_assignment": str,
      "total_orders": int,
      "items": [{
        "item_code", "item_name", "stock_uom",
        "suggested_qty", "order_count"
      }]
    }
    """
    from route_sales.api.security import ensure_route_assignment_access

    assignment = ensure_route_assignment_access(route_assignment)
    route = assignment.get("route")
    if not route:
        return {"route_assignment": route_assignment, "total_orders": 0, "items": []}

    # Customers on this route
    rc_rows = frappe.db.get_all(
        "Route Customer",
        filters={"parent": route},
        fields=["customer"],
    )
    customer_ids = [r["customer"] for r in rc_rows]
    if not customer_ids:
        return {"route_assignment": route_assignment, "total_orders": 0, "items": []}

    # Pending Sales Orders for those customers
    pending_orders = frappe.db.get_all(
        DocType.SALES_ORDER,
        filters={
            "customer": ["in", customer_ids],
            "docstatus": 1,
            "status": ["in", ["To Deliver and Bill", "To Deliver", "Partly Delivered"]],
        },
        fields=["name"],
    )
    if not pending_orders:
        return {"route_assignment": route_assignment, "total_orders": 0, "items": []}

    order_names = [o["name"] for o in pending_orders]

    # Aggregate pending item quantities across all orders
    so_items = frappe.db.get_all(
        "Sales Order Item",
        filters={"parent": ["in", order_names]},
        fields=["item_code", "item_name", "qty", "delivered_qty", "uom"],
    )

    item_map = {}
    for row in so_items:
        pending_qty = max(0, (row["qty"] or 0) - (row["delivered_qty"] or 0))
        if pending_qty <= 0:
            continue
        ic = row["item_code"]
        if ic not in item_map:
            item_map[ic] = {
                "item_code":     ic,
                "item_name":     row["item_name"],
                "stock_uom":     row["uom"],
                "suggested_qty": 0,
                "order_count":   0,
            }
        item_map[ic]["suggested_qty"] += pending_qty
        item_map[ic]["order_count"]   += 1

    # Round up to whole numbers then add 5-unit buffer per item
    BUFFER = 5
    items = []
    for item in item_map.values():
        rounded = int(item["suggested_qty"]) + (1 if item["suggested_qty"] % 1 > 0 else 0)
        item["suggested_qty"] = rounded + BUFFER
        items.append(item)

    items.sort(key=lambda x: x["item_name"] or "")

    return {
        "route_assignment": route_assignment,
        "total_orders":     len(pending_orders),
        "items":            items,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_session_stock_summary(route_session):
    session = frappe.get_doc("Route Session", route_session)
    delivered_qty_map = _get_delivered_qty_map_for_session(route_session)
    return _stock_summary(session, delivered_qty_map)


def _get_delivered_qty_map_for_session(route_session):
    """
    Return a map of {item_code: total_qty_delivered} for the session.
    Counts both:
      - Items delivered via Delivery Notes (pre-order flow)
      - Items sold via direct Sales Invoices (cash sale flow)
    """
    delivered_qty_map = {}

    # ── Delivery Notes linked to this session ─────────────────────────────────
    dn_rows = frappe.db.get_all(
        DocType.DELIVERY_NOTE,
        filters={
            "docstatus": 1,
            "instructions": ["like", f"%{SESSION_REMARK_PREFIX}{route_session}%"],
        },
        fields=["name"],
        limit_page_length=0,
    )
    if dn_rows:
        dn_items = frappe.db.get_all(
            "Delivery Note Item",
            filters={"parent": ["in", [row["name"] for row in dn_rows]]},
            fields=["item_code", "qty"],
            limit_page_length=0,
        )
        for item in dn_items:
            ic = item["item_code"]
            delivered_qty_map[ic] = delivered_qty_map.get(ic, 0) + (item["qty"] or 0)

    # ── Direct Sales Invoices linked to this session ───────────────────────────
    # Cash sales go through create_sales_invoice (no DN), linked via remarks.
    # These also consume van stock and must be counted as delivered.
    sinv_rows = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters={
            "docstatus": 1,
            "is_return":  0,
            "remarks":    ["like", f"%{SESSION_REMARK_PREFIX}{route_session}%"],
        },
        fields=["name"],
        limit_page_length=0,
    )
    if sinv_rows:
        sinv_items = frappe.db.get_all(
            "Sales Invoice Item",
            filters={"parent": ["in", [row["name"] for row in sinv_rows]]},
            fields=["item_code", "qty"],
            limit_page_length=0,
        )
        for item in sinv_items:
            ic = item["item_code"]
            delivered_qty_map[ic] = delivered_qty_map.get(ic, 0) + (item["qty"] or 0)

    return delivered_qty_map

def _stock_summary(session, delivered_qty_map=None):
    if delivered_qty_map is None:
        delivered_qty_map = {}
    result = []
    for row in session.loaded_items:
        qty_loaded    = row.qty_loaded or 0
        qty_delivered = delivered_qty_map.get(row.item_code, 0)
        qty_returned  = row.qty_returned or 0
        qty_remaining = max(0, qty_loaded - qty_delivered - qty_returned)
        result.append({
            "item_code":    row.item_code,
            "item_name":    row.item_name,
            "qty_loaded":   qty_loaded,
            "qty_delivered": round(qty_delivered, 2),
            "qty_returned": qty_returned,
            "qty_remaining": round(qty_remaining, 2),
        })
    return result
