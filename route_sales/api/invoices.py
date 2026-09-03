"""
route_sales.api.invoices
========================
POST /api/method/route_sales.api.invoices.create_sales_invoice
GET  /api/method/route_sales.api.invoices.get_customer_invoices
"""

import frappe
from frappe.utils import today, add_days
from route_sales.api.constants import DocType, ModeOfPayment, SESSION_REMARK_PREFIX, get_company, get_warehouse, get_debit_account, get_default_price_list
from route_sales.api.security import assert_customer_access, ensure_route_session_access
from route_sales.api.utils import round_currency, paginate
from route_sales.api.payments import record_payment_for_invoice
from route_sales.api.route_utils import try_set_missing_values


@frappe.whitelist(methods=["POST"])
def create_sales_invoice(
    customer,
    items,
    route_session=None,
    mode_of_payment=ModeOfPayment.CASH,
    due_days=0,
    taxes_and_charges=None,
    remarks=None,
):
    """
    Create and submit a Sales Invoice for a customer during a route visit.

    Parameters
    ----------
    customer          : str   – Customer name.
    items             : list  – [{ "item_code": str, "qty": float,
                                    "rate": float (optional) }, ...]
                                Pass as JSON string when calling via HTTP.
    route_session     : str, optional  – Links the invoice to a Route Session.
    mode_of_payment   : str, optional  – Default "Cash".
    due_days          : int, optional  – Days until payment due (0 = due today).
    taxes_and_charges : str, optional  – Sales Taxes and Charges Template name.
    remarks           : str, optional  – Free-text remarks on the invoice.

    Returns
    -------
    {
      "invoice":  str,          ← invoice name  e.g. "ACC-SINV-2026-00001"
      "grand_total":    float,
      "outstanding_amount": float,
      "status":   str,          ← "Submitted" | "Draft" on fallback
      "items": [{ "item_code", "item_name", "qty", "rate", "amount" }]
    }
    """
    if route_session:
        ensure_route_session_access(route_session)
        assert_customer_access(customer)
    else:
        assert_customer_access(customer)

    # ── Deserialise items if sent as a JSON string (HTTP call) ────────────────
    if isinstance(items, str):
        import json
        items = json.loads(items) if items.strip() else []

    if not items:
        frappe.throw("At least one item is required.", frappe.ValidationError)

    # Idempotency guard -- this creates AND submits a Sales Invoice (with
    # update_stock=1, moving real van stock) and records a real payment as
    # its very first write, with no earlier draft/parent-doc stage for a
    # network-timeout-then-client-retry to dedupe against the way
    # confirm_order/complete_payment do for the full-pipeline flow. Without
    # this, a retried call double-deducts stock and records payment twice.
    dedupe_filters = {"customer": customer, "posting_date": today(), "docstatus": ["in", [0, 1]]}
    if route_session:
        dedupe_filters["remarks"] = ["like", f"%{SESSION_REMARK_PREFIX}{route_session}%"]
    existing_inv = frappe.db.get_value(DocType.SALES_INVOICE, dedupe_filters, "name")
    if existing_inv:
        frappe.throw(
            f"A Sales Invoice ({existing_inv}) was already created for '{customer}' today.",
            frappe.ValidationError,
        )

    # ── Resolve customer price list ───────────────────────────────────────────
    price_list = (
        frappe.db.get_value(DocType.CUSTOMER, customer, "default_price_list")
        or get_default_price_list()
    )

    # ── Build invoice items ───────────────────────────────────────────────────
    warehouse = get_warehouse()
    invoice_items = []
    for row in items:
        item_code = row.get("item_code")
        qty       = float(row.get("qty", 1))

        if not item_code:
            frappe.throw("Each item must have an 'item_code'.", frappe.ValidationError)
        if qty <= 0:
            frappe.throw(f"Quantity must be > 0 for item '{item_code}'.", frappe.ValidationError)

        # Validate stock availability
        actual_qty = frappe.db.get_value(
            "Bin",
            {"item_code": item_code, "warehouse": warehouse},
            "actual_qty",
        ) or 0
        if actual_qty < qty:
            frappe.throw(
                f"Insufficient stock for '{item_code}': "
                f"available {actual_qty}, requested {qty}.",
                frappe.ValidationError,
            )

        # Rate: caller-supplied → price list → 0
        rate = row.get("rate")
        if rate is None:
            rate = frappe.db.get_value(
                "Item Price",
                {"item_code": item_code, "price_list": price_list},
                "price_list_rate",
            ) or 0

        invoice_items.append({
            "item_code":    item_code,
            "qty":          qty,
            "rate":         float(rate),
            "warehouse":    warehouse,
            "allow_zero_valuation_rate": 1,
        })

    # ── Build invoice doc ─────────────────────────────────────────────────────
    posting_date = today()
    due_date     = add_days(posting_date, int(due_days))

    invoice_doc = {
        "doctype":            DocType.SALES_INVOICE,
        "company":            get_company(),
        "customer":           customer,
        "posting_date":       posting_date,
        "due_date":           due_date,
        "selling_price_list": price_list,
        "debit_to":           get_debit_account(),
        "update_stock":       1,
        "items":              invoice_items,
        "set_warehouse":      get_warehouse(),
    }

    if taxes_and_charges:
        invoice_doc["taxes_and_charges"] = taxes_and_charges
    if remarks:
        invoice_doc["remarks"] = remarks
    if route_session:
        invoice_doc["remarks"] = (
            f"{SESSION_REMARK_PREFIX}{route_session}"
            + (f"\n{remarks}" if remarks else "")
        )

    # ── Insert & submit ───────────────────────────────────────────────────────
    sinv = frappe.get_doc(invoice_doc)
    # set_missing_values() internally checks Customer read permission via ERPNext's
    # party.py — use ignore_permissions flag so it runs without user permission checks.
    frappe.flags.ignore_permissions = True
    try:
        try_set_missing_values(sinv, "invoices.py")
    finally:
        frappe.flags.ignore_permissions = False
    sinv.insert(ignore_permissions=True)

    submit_error = None
    try:
        sinv.submit()
        status = "Submitted"
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Sales Invoice Submit Error")
        status = "Draft"
        submit_error = str(e)

    frappe.db.commit()

    # ── Link mode of payment (payment entry on POS) ───────────────────────────
    # payment_recorded was previously computed but never returned -- callers
    # (Sales.jsx's success screen, once the Sales Invoice pipeline tier wired
    # this endpoint up for real) had no way to tell a paid invoice from an
    # unpaid one and always showed "payment pending", even when the payment
    # had genuinely gone through. Confirmed live: SINV-26-00029 was status
    # "Paid" with a real linked Payment Entry, but the UI said pending.
    payment_recorded = False
    if sinv.docstatus == 1 and mode_of_payment and str(mode_of_payment).lower() != "credit":
        payment_recorded = record_payment_for_invoice(sinv, mode_of_payment)
        if payment_recorded:
            # Same staleness issue fixed in selling.py's complete_payment --
            # the Payment Entry submit above updates outstanding_amount in
            # the DB via ERPNext's own hooks, not on this in-memory sinv.
            sinv.reload()

    return {
        "invoice":             sinv.name,
        "grand_total":         sinv.grand_total,
        "outstanding_amount":  sinv.outstanding_amount,
        "status":              status,
        "submit_error":        submit_error,
        "payment_recorded":    payment_recorded,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
            }
            for d in sinv.items
        ],
    }


@frappe.whitelist()
def get_customer_invoices(
    customer,
    status=None,
    from_date=None,
    to_date=None,
    page=1,
    page_length=20,
):
    """
    Returns paginated Sales Invoices for a customer with full payment details.

    Parameters
    ----------
    customer     : str  – Customer name.
    status       : str, optional  – Paid | Unpaid | Overdue | Partly Paid |
                                    Return | Cancelled.
    from_date    : str, optional  – YYYY-MM-DD (default: 30 days ago).
    to_date      : str, optional  – YYYY-MM-DD (default: today).
    page         : int, optional  – 1-based (default 1).
    page_length  : int, optional  – Max 100 (default 20).

    Response
    --------
    {
      "customer", "from_date", "to_date",
      "total", "page", "page_length",
      "summary": {
        "total_invoices", "total_billed",
        "total_paid", "total_outstanding"
      },
      "invoices": [
        {
          "name", "posting_date", "due_date", "status",
          "grand_total", "total_taxes_and_charges", "discount_amount",
          "outstanding_amount", "paid_amount",
          "currency", "is_return", "return_against", "remarks",
          "items":    [{ "item_code", "item_name", "qty", "uom", "rate", "amount" }],
          "payments": [{ "payment_entry", "posting_date", "paid_amount",
                         "mode_of_payment" }]
        }
      ]
    }
    """
    assert_customer_access(customer)

    page, page_length = paginate(page, page_length)
    to_date     = to_date   or today()
    from_date   = from_date or add_days(to_date, -30)

    filters = {
        "customer":     customer,
        "docstatus":    ["!=", 2],          # exclude cancelled
        "posting_date": ["between", [from_date, to_date]],
    }
    if status:
        filters["status"] = status

    total = frappe.db.count(DocType.SALES_INVOICE, filters=filters)

    rows = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters=filters,
        fields=[
            "name", "posting_date", "due_date", "status",
            "grand_total", "outstanding_amount", "currency",
            "total_taxes_and_charges", "discount_amount",
            "is_return", "return_against", "remarks",
        ],
        order_by="posting_date desc, name desc",
        limit_start=(page - 1) * page_length,
        limit_page_length=page_length,
    )

    # ── Summary across full filtered set ──────────────────────────────────────
    all_rows = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters=filters,
        fields=["grand_total", "outstanding_amount"],
    )
    total_billed      = sum(r["grand_total"] or 0        for r in all_rows)
    total_outstanding = sum(r["outstanding_amount"] or 0 for r in all_rows)

    # ── Enrich each invoice with items + payments ─────────────────────────────
    inv_names = [r["name"] for r in rows]

    # Batch-fetch all line items for this page
    all_items = frappe.db.get_all(
        "Sales Invoice Item",
        filters={"parent": ["in", inv_names]},
        fields=["parent", "item_code", "item_name", "qty", "uom", "rate", "amount"],
        order_by="parent, idx asc",
    )
    items_map = {}
    for it in all_items:
        items_map.setdefault(it["parent"], []).append({
            "item_code": it["item_code"],
            "item_name": it["item_name"],
            "qty":       it["qty"],
            "uom":       it["uom"],
            "rate":      it["rate"],
            "amount":    it["amount"],
        })

    # Batch-fetch all payment entries for this page
    pay_refs = frappe.db.get_all(
        DocType.PAYMENT_ENTRY_REFERENCE,
        filters={"reference_doctype": DocType.SALES_INVOICE, "reference_name": ["in", inv_names]},
        fields=["reference_name", "parent", "allocated_amount"],
    )
    pe_names = list({r["parent"] for r in pay_refs})
    pe_map   = {}
    if pe_names:
        pe_rows = frappe.db.get_all(
            DocType.PAYMENT_ENTRY,
            filters={"name": ["in", pe_names], "docstatus": 1},
            fields=["name", "posting_date", "mode_of_payment", "paid_amount"],
        )
        pe_map = {r["name"]: r for r in pe_rows}

    payments_map = {}
    for ref in pay_refs:
        pe = pe_map.get(ref["parent"])
        if not pe:
            continue
        payments_map.setdefault(ref["reference_name"], []).append({
            "payment_entry":    pe["name"],
            "posting_date":     str(pe["posting_date"]),
            "paid_amount":      ref["allocated_amount"],
            "mode_of_payment":  pe["mode_of_payment"],
        })

    invoices = []
    for inv in rows:
        paid = (inv["grand_total"] or 0) - (inv["outstanding_amount"] or 0)
        invoices.append({
            "name":                   inv["name"],
            "posting_date":           str(inv["posting_date"]),
            "due_date":               str(inv["due_date"]) if inv.get("due_date") else None,
            "status":                 inv["status"],
            "grand_total":            inv["grand_total"],
            "total_taxes_and_charges": inv["total_taxes_and_charges"],
            "discount_amount":        inv["discount_amount"],
            "outstanding_amount":     inv["outstanding_amount"],
            "paid_amount":            round_currency(paid),
            "currency":               inv["currency"],
            "is_return":              inv["is_return"],
            "return_against":         inv["return_against"],
            "remarks":                inv["remarks"],
            "items":                  items_map.get(inv["name"], []),
            "payments":               payments_map.get(inv["name"], []),
        })

    return {
        "total":   total,
        "summary": {
            "total_invoices":    total,
            "total_billed":      round_currency(total_billed),
            "total_outstanding": round_currency(total_outstanding),
            "total_paid":        round_currency(total_billed - total_outstanding),
        },
        "invoices": invoices,
    }
