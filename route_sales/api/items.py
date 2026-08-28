"""
route_sales.api.items
=====================
GET /api/method/route_sales.api.items.get_customer_items
"""

import frappe
from route_sales.api.constants import DocType, get_warehouse, get_default_price_list
from route_sales.api.security import assert_customer_access
from route_sales.api.utils import paginate

PAGE_LENGTH = 500   # default: return all items in one request


@frappe.whitelist()
def get_customer_items(
    customer,
    search=None,
    item_group=None,
    page=1,
    page_length=PAGE_LENGTH,
    route_session=None,
):
    """
    Returns the paginated item catalogue for a customer with real-time
    price and stock availability.

    Price list precedence: customer's default_price_list → Standard Selling.

    Parameters
    ----------
    customer     : str   – Customer name.
    search       : str   – Partial match on item_code or item_name.
    item_group   : str   – Filter by item_group (e.g. "Products").
    page         : int   – 1-based page number (default 1).
    page_length  : int   – Items per page (default 20, max 100).

    Response
    --------
    {
      "price_list": str,
      "total":      int,
      "page":       int,
      "page_length": int,
      "items": [
        {
          "item_code", "item_name", "item_group", "stock_uom", "image",
          "price",          ← from resolved price list
          "actual_qty",     ← from LMNTRIX Main Warehouse
          "in_stock": bool,
          "specs": {        ← custom spec fields (non-null only)
            "material", "pipe_size", "pressure_rating", "voltage", "wattage"
          }
        }
      ]
    }
    """
    assert_customer_access(customer)

    page, page_length = paginate(page, page_length, max_page_length=1000)

    # ── Resolve price list for this customer ──────────────────────────────────
    price_list = (
        frappe.db.get_value(DocType.CUSTOMER, customer, "default_price_list")
        or get_default_price_list()
    )

    # ── Van stock map (only when delivering from a session) ───────────────────
    # Maps item_code → qty_remaining in the van. Only items with qty > 0 are shown.
    van_qty_map = None
    if route_session:
        from route_sales.api.stock import get_session_stock_summary
        van_qty_map = {
            row["item_code"]: row.get("qty_remaining", 0)
            for row in get_session_stock_summary(route_session)
            if (row.get("qty_remaining") or 0) > 0
        }

    # ── Build item filters ────────────────────────────────────────────────────
    filters = {"disabled": 0, "is_stock_item": 1}
    if item_group:
        filters["item_group"] = item_group

    # When session provided, restrict to van stock items only
    if van_qty_map is not None:
        if not van_qty_map:
            return {"total": 0, "items": [], "van_mode": True}
        filters["item_code"] = ["in", list(van_qty_map.keys())]

    or_filters = None
    if search:
        or_filters = {
            "item_code": ["like", f"%{search}%"],
            "item_name": ["like", f"%{search}%"],
        }

    # ── Total count for pagination ────────────────────────────────────────────
    total = frappe.db.get_all(
        DocType.ITEM,
        filters=filters,
        or_filters=or_filters,
        fields=["name"],
        limit_page_length=0,
    )
    total = len(total)

    # ── Fetch items page ──────────────────────────────────────────────────────
    item_rows = frappe.db.get_all(
        DocType.ITEM,
        filters=filters,
        or_filters=or_filters,
        fields=[
            "item_code", "item_name", "item_group", "stock_uom", "image",
            "material", "pipe_size", "pressure_rating", "voltage", "wattage",
        ],
        order_by="item_code asc",
        limit_start=(page - 1) * page_length,
        limit_page_length=page_length,
    )

    if not item_rows:
        return {
            "total":    total,
            "items":    [],
            "van_mode": van_qty_map is not None,
        }

    item_codes = [r["item_code"] for r in item_rows]

    # ── Batch-fetch prices ────────────────────────────────────────────────────
    price_rows = frappe.db.get_all(
        "Item Price",
        filters={"price_list": price_list, "item_code": ["in", item_codes]},
        fields=["item_code", "price_list_rate"],
    )
    price_map = {r["item_code"]: r["price_list_rate"] for r in price_rows}

    # ── Batch-fetch warehouse stock ───────────────────────────────────────────
    bin_rows = frappe.db.get_all(
        "Bin",
        filters={"warehouse": get_warehouse(), "item_code": ["in", item_codes]},
        fields=["item_code", "actual_qty"],
    )
    stock_map = {r["item_code"]: r["actual_qty"] for r in bin_rows}

    # ── Assemble response ─────────────────────────────────────────────────────
    items = []
    for r in item_rows:
        code       = r["item_code"]
        actual_qty = stock_map.get(code) or 0

        specs = {
            k: r[k]
            for k in ("material", "pipe_size", "pressure_rating", "voltage", "wattage")
            if r.get(k)
        }

        item = {
            "item_code":  code,
            "item_name":  r["item_name"],
            "item_group": r["item_group"],
            "stock_uom":  r["stock_uom"],
            "image":      r["image"],
            "price":      price_map.get(code),
            "actual_qty": actual_qty,
            "in_stock":   actual_qty > 0,
            "specs":      specs,
        }
        if van_qty_map is not None:
            item["van_qty"] = van_qty_map.get(code, 0)
        items.append(item)

    return {
        "total":    total,
        "items":    items,
        "van_mode": van_qty_map is not None,
    }


@frappe.whitelist()
def search_items_for_van(search=None, limit=30):
    """
    Quick item search for van stock loading at session start.
    Does not require a customer — returns item_code, item_name, stock_uom only.

    Parameters
    ----------
    search : str, optional – Partial match on item_code or item_name.
    limit  : int, optional – Max results (default 30, max 100).

    Returns
    -------
    [{ "item_code", "item_name", "stock_uom" }]
    """
    from route_sales.api.security import require_login
    require_login()

    filters    = {"disabled": 0, "is_stock_item": 1}
    or_filters = None
    if search:
        or_filters = {
            "item_code": ["like", f"%{search}%"],
            "item_name": ["like", f"%{search}%"],
        }

    _, limit = paginate(1, limit)
    return frappe.db.get_all(
        DocType.ITEM,
        filters=filters,
        or_filters=or_filters,
        fields=["item_code", "item_name", "stock_uom"],
        order_by="item_name asc",
        limit_page_length=limit,
    )
