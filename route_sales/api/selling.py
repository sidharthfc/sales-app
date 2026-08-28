"""
route_sales.api.selling
=======================
Standard ERPNext selling flow:
  Quotation (draft) → Sales Order (submitted) → Sales Invoice (submitted) → Payment Entry

POST /api/method/route_sales.api.selling.create_quotation
POST /api/method/route_sales.api.selling.confirm_order
POST /api/method/route_sales.api.selling.complete_payment
GET  /api/method/route_sales.api.selling.get_quotation
"""

import frappe
import json
from frappe.utils import today, add_days
from route_sales.api.constants import COMPANY, WAREHOUSE, DEBIT_ACCOUNT, DEFAULT_PRICE_LIST, DocType, ModeOfPayment
from route_sales.api.security import assert_customer_access, ensure_route_session_access
from route_sales.api.payments import record_payment_for_invoice
from route_sales.api.route_utils import try_set_missing_values


def _ignore_perms():
    """Context manager: suppress all Frappe permission checks for the duration."""
    import contextlib

    @contextlib.contextmanager
    def _ctx():
        frappe.flags.ignore_permissions = True
        try:
            yield
        finally:
            frappe.flags.ignore_permissions = False

    return _ctx()


@frappe.whitelist(methods=["POST"])
def create_quotation(customer, items, route_session=None, remarks=None):
    """
    Step 1 — Create a draft Quotation from cart items.

    Parameters
    ----------
    customer      : str  – Customer name.
    items         : list – [{ "item_code": str, "qty": float, "rate": float? }]
                           Pass as JSON string via HTTP.
    route_session : str, optional – Links the quotation to a Route Session.
    remarks       : str, optional – Free-text remarks.

    Returns
    -------
    {
      "quotation":   str,
      "customer":    str,
      "grand_total": float,
      "items":       [{ "item_code", "item_name", "qty", "rate", "amount", "uom" }]
    }
    """
    if route_session:
        ensure_route_session_access(route_session)
    assert_customer_access(customer)

    if isinstance(items, str):
        items = json.loads(items) if items.strip() else []

    if not items:
        frappe.throw("At least one item is required.", frappe.ValidationError)

    price_list = (
        frappe.db.get_value(DocType.CUSTOMER, customer, "default_price_list")
        or DEFAULT_PRICE_LIST
    )

    quotation_items = []
    for row in items:
        item_code = row.get("item_code")
        qty       = float(row.get("qty", 1))

        if not item_code:
            frappe.throw("Each item must have an 'item_code'.", frappe.ValidationError)
        if qty <= 0:
            frappe.throw(f"Quantity must be > 0 for item '{item_code}'.", frappe.ValidationError)

        rate = row.get("rate")
        if rate is None:
            rate = frappe.db.get_value(
                "Item Price",
                {"item_code": item_code, "price_list": price_list},
                "price_list_rate",
            ) or 0

        quotation_items.append({
            "item_code": item_code,
            "qty":       qty,
            "rate":      float(rate),
            "warehouse": WAREHOUSE,
        })

    note = remarks or ""
    if route_session:
        note = f"Route Session: {route_session}" + (f"\n{remarks}" if remarks else "")

    qt = frappe.get_doc({
        "doctype":             DocType.QUOTATION,
        "quotation_to":        DocType.CUSTOMER,
        "party_name":          customer,
        "company":             COMPANY,
        "transaction_date":    today(),
        "valid_till":          add_days(today(), 7),
        "selling_price_list":  price_list,
        "items":               quotation_items,
        "remarks":             note or None,
    })

    # Keep ignore_permissions set through the full insert + commit so that
    # every ERPNext controller hook (validate, before_insert, after_insert …)
    # runs without raising PermissionError for the Route Sales User role.
    with _ignore_perms():
        try_set_missing_values(qt, "selling.py quotation")
        qt.insert(ignore_permissions=True)
        frappe.db.commit()

    return {
        "quotation":   qt.name,
        "customer":    customer,
        "grand_total": qt.grand_total,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
                "uom":       d.uom,
            }
            for d in qt.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def confirm_order(quotation):
    """
    Step 2 — Submit the Quotation and create a submitted Sales Order from it.

    Parameters
    ----------
    quotation : str – Quotation name (SAL-QTN-XXXX-XXXXX).

    Returns
    -------
    {
      "sales_order": str,
      "quotation":   str,
      "customer":    str,
      "grand_total": float,
      "items":       [{ "item_code", "item_name", "qty", "rate", "amount", "uom" }]
    }
    """
    with _ignore_perms():
        qt = frappe.get_doc(DocType.QUOTATION, quotation)
        assert_customer_access(qt.party_name)

        if qt.docstatus == 2:
            frappe.throw(f"Quotation '{quotation}' is cancelled.", frappe.ValidationError)

        if qt.docstatus == 0:
            # Submit the draft quotation
            try_set_missing_values(qt, "selling.py confirm quotation")
            qt.flags.ignore_permissions = True
            qt.submit()
            frappe.db.commit()

        # Make Sales Order from the submitted quotation
        # Use _make_sales_order directly so we can pass ignore_permissions=True,
        # which sets target.flags.ignore_permissions on the new SO doc.
        from erpnext.selling.doctype.quotation.quotation import _make_sales_order
        so = _make_sales_order(quotation, ignore_permissions=True)
        so.flags.ignore_permissions = True
        so.delivery_date  = today()
        so.set_warehouse  = WAREHOUSE

        try_set_missing_values(so, "selling.py confirm SO")

        frappe.flags.ignore_permissions = True
        so.insert(ignore_permissions=True)
        so.flags.ignore_permissions = True
        frappe.flags.ignore_permissions = True
        so.submit()
        frappe.db.commit()

    return {
        "sales_order": so.name,
        "quotation":   quotation,
        "customer":    so.customer,
        "grand_total": so.grand_total,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
                "uom":       d.uom,
            }
            for d in so.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def complete_payment(sales_order, mode_of_payment=ModeOfPayment.CASH, due_days=0):
    """
    Step 3 — Create a Sales Invoice from the Sales Order and record payment.

    For Cash/UPI/Bank Transfer: creates a Payment Entry immediately.
    For Credit: invoice is submitted with outstanding amount (no payment entry).

    Parameters
    ----------
    sales_order       : str  – Sales Order name.
    mode_of_payment   : str  – Cash | UPI | Bank Transfer | Credit.
    due_days          : int  – Payment due days (only relevant for Credit).

    Returns
    -------
    {
      "invoice":            str,
      "sales_order":        str,
      "grand_total":        float,
      "outstanding_amount": float,
      "status":             "Submitted" | "Draft",
      "payment_recorded":   bool
    }
    """
    with _ignore_perms():
        so = frappe.get_doc(DocType.SALES_ORDER, sales_order)
        assert_customer_access(so.customer)

        if so.docstatus != 1:
            frappe.throw(f"Sales Order '{sales_order}' is not submitted.", frappe.ValidationError)

        # Guard: prevent duplicate invoices for the same Sales Order
        inv_item_rows = frappe.db.get_all(
            "Sales Invoice Item",
            filters={"sales_order": sales_order},
            fields=["parent"],
            limit=10,
        )
        if inv_item_rows:
            inv_parents = list({r["parent"] for r in inv_item_rows})
            existing_inv = frappe.db.get_value(
                DocType.SALES_INVOICE,
                {"name": ["in", inv_parents], "docstatus": ["in", [0, 1]]},
                "name",
            )
            if existing_inv:
                frappe.throw(
                    f"A Sales Invoice ({existing_inv}) already exists for Sales Order '{sales_order}'.",
                    frappe.ValidationError,
                )

        # ── Make Sales Invoice from Sales Order ───────────────────────────────
        from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice
        sinv = make_sales_invoice(sales_order)

        sinv.debit_to      = DEBIT_ACCOUNT
        sinv.due_date      = add_days(today(), int(due_days))
        sinv.set_warehouse = WAREHOUSE
        sinv.update_stock  = 1

        try_set_missing_values(sinv, "selling.py invoice")

        # Carry SO remarks (contains "Route Session: xxx") to invoice so that
        # van stock delivered-qty tracking can count this sale.
        if not sinv.remarks and so.remarks:
            sinv.remarks = so.remarks

        # Allow zero valuation so invoice submission doesn't fail for items
        # that have no stock valuation entry yet.
        for item in sinv.items:
            item.allow_zero_valuation_rate = 1

        sinv.flags.ignore_permissions = True
        sinv.insert(ignore_permissions=True)

        status       = "Draft"
        submit_error = None
        try:
            sinv.flags.ignore_permissions = True
            frappe.flags.ignore_permissions = True
            sinv.submit()
            status = "Submitted"
        except Exception as e:
            frappe.log_error(frappe.get_traceback(), "Sales Invoice Submit Error (selling.py)")
            submit_error = str(e)

        frappe.db.commit()

    # ── Record payment (skip for Credit) ──────────────────────────────────────
    payment_recorded = False
    if sinv.docstatus == 1 and mode_of_payment and mode_of_payment.lower() != "credit":
        payment_recorded = record_payment_for_invoice(sinv, mode_of_payment)

    return {
        "invoice":            sinv.name,
        "sales_order":        sales_order,
        "grand_total":        sinv.grand_total,
        "outstanding_amount": sinv.outstanding_amount,
        "status":             status,
        "submit_error":       submit_error,
        "payment_recorded":   payment_recorded,
    }


@frappe.whitelist()
def get_quotation(quotation):
    """
    Fetch Quotation details.

    Returns
    -------
    { "quotation", "customer", "status", "docstatus", "grand_total", "items" }
    """
    qt = frappe.get_doc(DocType.QUOTATION, quotation)
    assert_customer_access(qt.party_name)

    return {
        "quotation":   qt.name,
        "customer":    qt.party_name,
        "status":      qt.status,
        "docstatus":   qt.docstatus,
        "grand_total": qt.grand_total,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
                "uom":       d.uom,
            }
            for d in qt.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def create_sales_order_only(customer, items, route_session=None, remarks=None):
    """
    Order-only flow: creates Quotation + Sales Order without invoicing.
    Use when the customer places an order for future delivery.

    Parameters
    ----------
    customer      : str  – Customer name.
    items         : list – [{ "item_code": str, "qty": float, "rate": float? }]
    route_session : str, optional
    remarks       : str, optional

    Returns
    -------
    { "sales_order", "quotation", "customer", "grand_total", "items", "message" }
    """
    qt_result = create_quotation(customer, items, route_session, remarks)
    so_result = confirm_order(qt_result["quotation"])

    return {
        "sales_order": so_result["sales_order"],
        "quotation":   qt_result["quotation"],
        "customer":    customer,
        "grand_total": so_result["grand_total"],
        "items":       so_result["items"],
        "message":     "Order placed. Delivery will be arranged on the next visit.",
    }
