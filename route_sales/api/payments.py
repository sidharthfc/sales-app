"""
route_sales.api.payments
========================
GET  /api/method/route_sales.api.payments.get_payment_list
POST /api/method/route_sales.api.payments.collect_payment
"""

import frappe
from frappe.utils import today, add_days
from route_sales.api.constants import COMPANY, DEBIT_ACCOUNT
from route_sales.api.utils import round_currency
from route_sales.api.security import (
    assert_customer_access,
    ensure_route_session_access,
    only_manager,
    resolve_salesperson,
)


@frappe.whitelist()
def get_payment_list(
    customer=None,
    salesperson=None,
    mode_of_payment=None,
    from_date=None,
    to_date=None,
    page=1,
    page_length=20,
):
    """
    Returns paginated Payment Entries for a customer or salesperson.
    At least one of customer or salesperson must be provided.

    Parameters
    ----------
    customer        : str, optional – Filter by Customer.
    salesperson     : str, optional – Filter by Sales Person (via linked invoices).
    mode_of_payment : str, optional – Cash | Cheque | Credit Card | Wire Transfer …
    from_date       : str, optional – YYYY-MM-DD (default: 30 days ago).
    to_date         : str, optional – YYYY-MM-DD (default: today).
    page            : int, optional – 1-based (default 1).
    page_length     : int, optional – Max 100 (default 20).

    Response
    --------
    {
      "from_date", "to_date", "total", "page", "page_length",
      "summary": {
        "total_payments": int,
        "total_received":  float,
        "total_modes": { "Cash": float, "Cheque": float, ... }
      },
      "payments": [
        {
          "name", "posting_date", "mode_of_payment",
          "customer", "customer_name",
          "paid_amount", "unallocated_amount", "status",
          "reference_no", "reference_date", "remarks",
          "invoices": [
            { "invoice", "allocated_amount", "outstanding_amount" }
          ]
        }
      ]
    }
    """
    page        = max(1, int(page))
    page_length = min(100, max(1, int(page_length)))
    to_date     = to_date   or today()
    from_date   = from_date or add_days(to_date, -30)

    if not customer and not salesperson:
        frappe.throw(
            "Provide at least one of: customer, salesperson.",
            frappe.ValidationError,
        )

    if customer:
        assert_customer_access(customer, salesperson=salesperson)
    elif salesperson:
        salesperson = resolve_salesperson(salesperson)

    # ── Build filters ─────────────────────────────────────────────────────────
    filters = {
        "payment_type": "Receive",
        "party_type":   "Customer",
        "docstatus":    1,
        "posting_date": ["between", [from_date, to_date]],
    }
    if customer:
        filters["party"] = customer
    if mode_of_payment:
        filters["mode_of_payment"] = mode_of_payment

    # Salesperson filter: find customers whose invoices reference this salesperson
    if salesperson and not customer:
        payment_entries = _payment_entries_for_salesperson(salesperson, from_date, to_date)
        if not payment_entries:
            return _empty_response()
        filters["name"] = ["in", payment_entries]

    # ── Total & summary counts ────────────────────────────────────────────────
    all_rows = frappe.db.get_all(
        "Payment Entry",
        filters=filters,
        fields=["paid_amount", "mode_of_payment"],
    )
    total = len(all_rows)
    total_received = sum(r["paid_amount"] or 0 for r in all_rows)
    total_modes    = {}
    for r in all_rows:
        m = r["mode_of_payment"] or "Unknown"
        total_modes[m] = total_modes.get(m, 0) + (r["paid_amount"] or 0)

    # ── Fetch page ────────────────────────────────────────────────────────────
    rows = frappe.db.get_all(
        "Payment Entry",
        filters=filters,
        fields=[
            "name", "posting_date", "mode_of_payment",
            "party as customer", "party_name as customer_name",
            "paid_amount", "unallocated_amount", "status",
            "reference_no", "reference_date", "remarks",
        ],
        order_by="posting_date desc, name desc",
        limit_start=(page - 1) * page_length,
        limit_page_length=page_length,
    )

    if not rows:
        return _empty_response(total, total_received, total_modes)

    # ── Batch-fetch invoice references for this page ──────────────────────────
    pe_names = [r["name"] for r in rows]
    ref_rows = frappe.db.get_all(
        "Payment Entry Reference",
        filters={
            "parent":             ["in", pe_names],
            "reference_doctype":  "Sales Invoice",
        },
        fields=["parent", "reference_name", "allocated_amount", "outstanding_amount"],
        order_by="parent, idx asc",
    )
    refs_map = {}
    for ref in ref_rows:
        refs_map.setdefault(ref["parent"], []).append({
            "invoice":            ref["reference_name"],
            "allocated_amount":   ref["allocated_amount"],
            "outstanding_amount": ref["outstanding_amount"],
        })

    # ── Assemble ──────────────────────────────────────────────────────────────
    customer_names = list({r["customer"] for r in rows if r.get("customer")})
    outstanding_rows = frappe.db.get_all(
        "Sales Invoice",
        filters={
            "customer": ["in", customer_names],
            "docstatus": 1,
            "outstanding_amount": [">", 0],
        },
        fields=["customer", "outstanding_amount"],
        limit_page_length=0,
    ) if customer_names else []
    outstanding_map = {}
    for row in outstanding_rows:
        outstanding_map[row["customer"]] = outstanding_map.get(row["customer"], 0) + (row["outstanding_amount"] or 0)

    payments = []
    for r in rows:
        payments.append({
            "name":               r["name"],
            "posting_date":       str(r["posting_date"]),
            "mode_of_payment":    r["mode_of_payment"],
            "customer":           r["customer"],
            "customer_name":      r["customer_name"],
            "paid_amount":        r["paid_amount"],
            "unallocated_amount": r["unallocated_amount"],
            "status":             r["status"],
            "outstanding_amount": round_currency(outstanding_map.get(r["customer"], 0)),
            "reference_no":       r["reference_no"],
            "reference_date":     str(r["reference_date"]) if r.get("reference_date") else None,
            "remarks":            r["remarks"],
            "invoices":           refs_map.get(r["name"], []),
        })

    return {
        "total":   total,
        "summary": {
            "total_payments": total,
            "total_received": round_currency(total_received),
            "total_modes":    {k: round_currency(v) for k, v in total_modes.items()},
        },
        "payments": payments,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

@frappe.whitelist(methods=["POST"])
def collect_payment(
    customer,
    amount,
    mode_of_payment="Cash",
    invoice=None,
    route_session=None,
    reference_no=None,
    reference_date=None,
):
    """
    Collect a payment from a customer during a route visit.

    If an invoice is provided, the payment is allocated against it.
    If no invoice is provided, the payment is applied to the oldest
    unpaid invoice first; any remainder is kept as an advance.

    Parameters
    ----------
    customer        : str   – Customer name.
    amount          : float – Amount collected (must be > 0).
    mode_of_payment : str   – Cash | Cheque | Credit Card | Wire Transfer.
                              Default "Cash".
    invoice         : str, optional – Specific Sales Invoice to settle.
    route_session   : str, optional – Route Session during which collected.
    reference_no    : str, optional – Cheque / transaction reference number.
    reference_date  : str, optional – YYYY-MM-DD reference date.

    Returns
    -------
    {
      "payment_entry":    str,
      "customer":         str,
      "customer_name":    str,
      "paid_amount":      float,
      "mode_of_payment":  str,
      "allocated_to":     [ { "invoice", "allocated_amount" } ],
      "unallocated_amount": float
    }
    """
    amount = float(amount)
    if amount <= 0:
        frappe.throw("Amount must be greater than 0.", frappe.ValidationError)

    assert_customer_access(customer)

    if not frappe.db.exists("Customer", customer):
        frappe.throw(f"Customer '{customer}' not found.", frappe.DoesNotExistError)

    if route_session:
        ensure_route_session_access(route_session)

    # ── Resolve paid-to account ───────────────────────────────────────────────
    paid_to = frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": mode_of_payment, "company": COMPANY},
        "default_account",
    )
    if not paid_to:
        frappe.throw(
            f"No account mapped for Mode of Payment '{mode_of_payment}'. "
            "Please configure it in ERPNext.",
            frappe.ValidationError,
        )

    customer_name = frappe.db.get_value("Customer", customer, "customer_name")

    # ── Resolve invoice(s) to allocate against ────────────────────────────────
    references = []
    remaining  = amount

    if invoice:
        inv_data = frappe.db.get_value(
            "Sales Invoice", invoice, ["customer", "outstanding_amount"], as_dict=True
        )
        if not inv_data:
            frappe.throw(f"Invoice '{invoice}' not found.", frappe.DoesNotExistError)
        if inv_data["customer"] != customer:
            frappe.throw(
                f"Invoice '{invoice}' does not belong to customer '{customer}'.",
                frappe.ValidationError,
            )
        outstanding = inv_data["outstanding_amount"] or 0
        if outstanding <= 0:
            frappe.throw(
                f"Invoice '{invoice}' has no outstanding amount.",
                frappe.ValidationError,
            )
        allocated = min(remaining, outstanding)
        references.append({
            "reference_doctype": "Sales Invoice",
            "reference_name":    invoice,
            "allocated_amount":  allocated,
        })
        remaining -= allocated
    else:
        # Auto-allocate oldest unpaid invoices first
        unpaid = frappe.db.get_all(
            "Sales Invoice",
            filters={
                "customer":          customer,
                "docstatus":         1,
                "outstanding_amount": [">", 0],
            },
            fields=["name", "outstanding_amount"],
            order_by="posting_date asc, name asc",
        )
        for inv in unpaid:
            if remaining <= 0:
                break
            allocated = min(remaining, inv["outstanding_amount"])
            references.append({
                "reference_doctype": "Sales Invoice",
                "reference_name":    inv["name"],
                "allocated_amount":  allocated,
            })
            remaining -= allocated

    # ── Build remarks ─────────────────────────────────────────────────────────
    remarks_parts = [f"Payment collected from {customer_name}"]
    if route_session:
        remarks_parts.append(f"Route Session: {route_session}")

    # ── Create Payment Entry ──────────────────────────────────────────────────
    pe_doc = {
        "doctype":            "Payment Entry",
        "payment_type":       "Receive",
        "posting_date":       today(),
        "company":            COMPANY,
        "mode_of_payment":    mode_of_payment,
        "party_type":         "Customer",
        "party":              customer,
        "paid_from":          DEBIT_ACCOUNT,
        "paid_to":            paid_to,
        "paid_amount":        amount,
        "received_amount":    amount,
        "paid_from_account_currency": "INR",
        "paid_to_account_currency":   "INR",
        "remarks":            "\n".join(remarks_parts),
        "references":         references,
    }
    if reference_no:
        pe_doc["reference_no"]   = reference_no
    if reference_date:
        pe_doc["reference_date"] = reference_date

    pe = frappe.get_doc(pe_doc)
    pe.insert(ignore_permissions=True)
    pe.submit()
    frappe.db.commit()

    allocated_total = round_currency(sum((r.get("allocated_amount") or 0) for r in references))
    invoice_outstanding_after = None
    if invoice:
        invoice_outstanding_after = frappe.db.get_value(
            "Sales Invoice", invoice, "outstanding_amount"
        ) or 0

    return {
        "payment_entry":      pe.name,
        "customer":           customer,
        "customer_name":      customer_name,
        "paid_amount":        amount,
        "allocated_amount":   allocated_total,
        "mode_of_payment":    mode_of_payment,
        "allocated_to":       [
            {"invoice": r["reference_name"], "allocated_amount": r["allocated_amount"]}
            for r in references
        ],
        "invoice_outstanding_after": round_currency(invoice_outstanding_after) if invoice_outstanding_after is not None else None,
        "unallocated_amount": round_currency(remaining),
    }


def create_dummy_payment(
    customer=None,
    amount=None,
    mode_of_payment="Cash",
    invoice=None,
):
    """
    Creates a dummy Payment Entry for development and demo purposes.

    If no customer is supplied, a random customer is picked.
    If no invoice is supplied, the oldest unpaid invoice for the customer
    is used; if none exists, the payment is created as an unallocated advance.
    If no amount is supplied, it defaults to the invoice outstanding amount
    or 500 for an advance.

    Parameters
    ----------
    customer        : str, optional – Customer name.
    amount          : float, optional – Amount to pay.
    mode_of_payment : str, optional – Default "Cash".
    invoice         : str, optional – Sales Invoice to settle.

    Returns
    -------
    {
      "payment_entry": str,
      "customer": str,
      "customer_name": str,
      "paid_amount": float,
      "mode_of_payment": str,
      "invoice": str | null,
      "status": str
    }
    """
    only_manager()
    # ── Resolve customer ──────────────────────────────────────────────────────
    if not customer:
        rows = frappe.db.get_all(
            "Customer",
            filters={"disabled": 0},
            fields=["name"],
            order_by="RAND()",
            limit=1,
        )
        customer = rows[0]["name"] if rows else None
    if not customer:
        frappe.throw("No customers found in the system.", frappe.DoesNotExistError)

    customer_name = frappe.db.get_value("Customer", customer, "customer_name")

    # ── Resolve invoice ───────────────────────────────────────────────────────
    if invoice:
        outstanding = frappe.db.get_value(
            "Sales Invoice", invoice, "outstanding_amount"
        ) or 0
        if outstanding <= 0:
            frappe.throw(
                f"Invoice '{invoice}' has no outstanding amount.",
                frappe.ValidationError,
            )
    else:
        inv_row = frappe.db.get_value(
            "Sales Invoice",
            filters={
                "customer":  customer,
                "docstatus": 1,
                "outstanding_amount": [">", 0],
            },
            fieldname=["name", "outstanding_amount"],
            as_dict=True,
            order_by="posting_date asc",
        )
        if inv_row:
            invoice     = inv_row["name"]
            outstanding = inv_row["outstanding_amount"]
        else:
            invoice     = None
            outstanding = 0

    paid_amount = float(amount) if amount else (outstanding or 500.0)

    # ── Resolve paid-to account ───────────────────────────────────────────────
    paid_to = frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": mode_of_payment, "company": COMPANY},
        "default_account",
    )
    if not paid_to:
        paid_to = frappe.db.get_value(
            "Account",
            {"account_type": "Cash", "company": COMPANY},
            "name",
        )
    if not paid_to:
        frappe.throw(
            f"No account mapped for Mode of Payment '{mode_of_payment}'.",
            frappe.ValidationError,
        )

    # ── Build Payment Entry ───────────────────────────────────────────────────
    pe_doc = {
        "doctype":            "Payment Entry",
        "payment_type":       "Receive",
        "posting_date":       today(),
        "company":            COMPANY,
        "mode_of_payment":    mode_of_payment,
        "party_type":         "Customer",
        "party":              customer,
        "paid_from":          DEBIT_ACCOUNT,
        "paid_to":            paid_to,
        "paid_amount":        paid_amount,
        "received_amount":    paid_amount,
        "paid_from_account_currency": "INR",
        "paid_to_account_currency":   "INR",
    }

    if invoice:
        pe_doc["references"] = [{
            "reference_doctype": "Sales Invoice",
            "reference_name":    invoice,
            "allocated_amount":  min(paid_amount, outstanding),
        }]

    pe = frappe.get_doc(pe_doc)
    pe.insert(ignore_permissions=True)
    pe.submit()
    frappe.db.commit()

    return {
        "payment_entry":  pe.name,
        "customer":       customer,
        "customer_name":  customer_name,
        "paid_amount":    paid_amount,
        "mode_of_payment": mode_of_payment,
        "invoice":        invoice,
        "status":         "Submitted",
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _payment_entries_for_salesperson(salesperson, from_date, to_date):
    """Return payment entries allocated against invoices owned by this salesperson."""
    invoices = frappe.db.get_all(
        "Sales Invoice",
        filters={
            "sales_team.sales_person": salesperson,
            "docstatus":    1,
            "posting_date": ["between", [from_date, to_date]],
        },
        fields=["name"],
        distinct=True,
    )
    invoice_names = [r["name"] for r in invoices]
    if not invoice_names:
        return []

    refs = frappe.db.get_all(
        "Payment Entry Reference",
        filters={
            "reference_doctype": "Sales Invoice",
            "reference_name": ["in", invoice_names],
        },
        fields=["parent"],
        distinct=True,
    )
    return [r["parent"] for r in refs]


def _empty_response(total=0, total_received=0, total_modes=None):
    return {
        "total":   total,
        "summary": {
            "total_payments": total,
            "total_received": total_received,
            "total_modes":    total_modes or {},
        },
        "payments": [],
    }
