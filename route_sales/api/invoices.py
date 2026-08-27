"""
route_sales.api.invoices
========================
POST /api/method/route_sales.api.invoices.create_sales_invoice
GET  /api/method/route_sales.api.invoices.get_customer_invoices
"""

import frappe
from frappe.utils import today, add_days
from route_sales.api.constants import COMPANY, WAREHOUSE, DEBIT_ACCOUNT, DEFAULT_PRICE_LIST, CURRENCY, DocType, ModeOfPayment
from route_sales.api.security import assert_customer_access, ensure_route_session_access
from route_sales.api.utils import round_currency


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

    # ── Resolve customer price list ───────────────────────────────────────────
    price_list = (
        frappe.db.get_value(DocType.CUSTOMER, customer, "default_price_list")
        or DEFAULT_PRICE_LIST
    )

    # ── Build invoice items ───────────────────────────────────────────────────
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
            {"item_code": item_code, "warehouse": WAREHOUSE},
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
            "warehouse":    WAREHOUSE,
            "allow_zero_valuation_rate": 1,
        })

    # ── Build invoice doc ─────────────────────────────────────────────────────
    posting_date = today()
    due_date     = add_days(posting_date, int(due_days))

    invoice_doc = {
        "doctype":            DocType.SALES_INVOICE,
        "company":            COMPANY,
        "customer":           customer,
        "posting_date":       posting_date,
        "due_date":           due_date,
        "selling_price_list": price_list,
        "debit_to":           DEBIT_ACCOUNT,
        "update_stock":       1,
        "items":              invoice_items,
        "set_warehouse":      WAREHOUSE,
    }

    if taxes_and_charges:
        invoice_doc["taxes_and_charges"] = taxes_and_charges
    if remarks:
        invoice_doc["remarks"] = remarks
    if route_session:
        invoice_doc["remarks"] = (
            f"Route Session: {route_session}"
            + (f"\n{remarks}" if remarks else "")
        )

    # ── Insert & submit ───────────────────────────────────────────────────────
    sinv = frappe.get_doc(invoice_doc)
    # set_missing_values() internally checks Customer read permission via ERPNext's
    # party.py — use ignore_permissions flag so it runs without user permission checks.
    frappe.flags.ignore_permissions = True
    try:
        sinv.set_missing_values()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "set_missing_values non-critical (invoices.py)")
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
    if mode_of_payment and str(mode_of_payment).lower() != "credit":
        _record_payment(sinv, mode_of_payment)

    return {
        "invoice":             sinv.name,
        "grand_total":         sinv.grand_total,
        "outstanding_amount":  sinv.outstanding_amount,
        "status":              status,
        "submit_error":        submit_error,
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _record_payment(sinv, mode_of_payment):
    """
    If the invoice is submitted and fully payable via cash/card,
    create a Payment Entry to clear the outstanding amount.
    Only runs when mode_of_payment is provided and invoice is submitted.
    """
    if sinv.docstatus != 1 or not mode_of_payment:
        return
    if not sinv.outstanding_amount or sinv.outstanding_amount <= 0:
        return

    # Guard: don't create a duplicate PE if one already references this invoice
    existing_ref = frappe.db.get_value(
        DocType.PAYMENT_ENTRY_REFERENCE,
        {"reference_doctype": DocType.SALES_INVOICE, "reference_name": sinv.name},
        "parent",
    )
    if existing_ref and frappe.db.get_value(DocType.PAYMENT_ENTRY, existing_ref, "docstatus") == 1:
        return

    try:
        account = frappe.db.get_value(
            DocType.MODE_OF_PAYMENT_ACCOUNT,
            {"parent": mode_of_payment, "company": COMPANY},
            "default_account",
        )
        if not account:
            return  # no account mapped — skip silently

        pe = frappe.get_doc({
            "doctype":              DocType.PAYMENT_ENTRY,
            "payment_type":         "Receive",
            "mode_of_payment":      mode_of_payment,
            "party_type":           DocType.CUSTOMER,
            "party":                sinv.customer,
            "company":              COMPANY,
            "posting_date":         sinv.posting_date,
            "paid_amount":          sinv.outstanding_amount,
            "received_amount":      sinv.outstanding_amount,
            "paid_to":              account,
            "paid_from":            DEBIT_ACCOUNT,
            "paid_from_account_currency": CURRENCY,
            "paid_to_account_currency":   CURRENCY,
            "references": [{
                "reference_doctype": DocType.SALES_INVOICE,
                "reference_name":    sinv.name,
                "allocated_amount":  sinv.outstanding_amount,
            }],
        })
        pe.insert(ignore_permissions=True)
        pe.submit()
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Payment Entry Create Error")


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

    page        = max(1, int(page))
    page_length = min(100, max(1, int(page_length)))
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
