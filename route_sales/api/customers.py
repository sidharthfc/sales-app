"""
route_sales.api.customers
=========================
GET /api/method/route_sales.api.customers.get_customer_details
"""

import frappe
from frappe.utils import today
from route_sales.api.security import assert_customer_access, assert_customer_readonly_access, current_salesperson, get_current_route_for_salesperson, is_manager
from route_sales.api.constants import COMPANY, DocType, VisitStatus
from route_sales.api.utils import round_currency


@frappe.whitelist()
def get_customer_details(customer):
    """
    Returns a full customer profile for the salesperson visit screen,
    including contact info, outstanding balance, last visit, and
    recent invoice history.

    Parameters
    ----------
    customer : str – Customer name.

    Returns
    -------
    {
      "name", "customer_name", "customer_group", "territory",
      "mobile_no", "email_id", "primary_address",
      "default_price_list", "payment_terms",
      "financials": {
        "total_billed", "total_outstanding", "total_paid",
        "overdue_amount", "credit_limit"
      },
      "last_visit": {
        "date", "visit_status", "session"
      } | null,
      "recent_invoices": [
        { "name", "posting_date", "grand_total",
          "outstanding_amount", "status" }
      ]
    }
    """
    assert_customer_readonly_access(customer)

    cust = frappe.db.get_value(
        DocType.CUSTOMER,
        customer,
        [
            "name", "customer_name", "customer_group", "territory",
            "mobile_no", "email_id", "primary_address",
            "default_price_list", "payment_terms",
        ],
        as_dict=True,
    )
    if not cust:
        frappe.throw(f"Customer '{customer}' not found.", frappe.DoesNotExistError)

    # ── Financials ────────────────────────────────────────────────────────────
    inv_rows = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters={"customer": customer, "docstatus": 1},
        fields=["grand_total", "outstanding_amount", "due_date", "status"],
    )
    total_billed      = sum(r["grand_total"] or 0        for r in inv_rows)
    total_outstanding = sum(r["outstanding_amount"] or 0 for r in inv_rows)
    overdue_amount    = sum(
        r["outstanding_amount"] or 0
        for r in inv_rows
        if r.get("due_date") and str(r["due_date"]) < today()
        and (r["outstanding_amount"] or 0) > 0
    )

    credit_limit = frappe.db.get_value(
        "Customer Credit Limit",
        {"parent": customer, "company": COMPANY},
        "credit_limit",
    ) or 0

    # ── Visit history ─────────────────────────────────────────────────────────
    from frappe.utils import add_days
    visit_rows = frappe.db.get_all(
        "Route Visit",
        filters={"customer": customer},
        fields=["checkin_time", "checkout_time", "visit_status", "route_session"],
        order_by="checkin_time desc",
        limit_page_length=30,
    )
    last_visit = None
    if visit_rows:
        r = visit_rows[0]
        last_visit = {
            "date":          str(r["checkin_time"])[:10] if r.get("checkin_time") else None,
            "checkin_time":  str(r["checkin_time"])      if r.get("checkin_time") else None,
            "checkout_time": str(r["checkout_time"])     if r.get("checkout_time") else None,
            "visit_status":  r["visit_status"],
            "session":       r["route_session"],
        }
    total_visits  = len([v for v in visit_rows if v["visit_status"] == VisitStatus.VISITED])
    total_skipped = len([v for v in visit_rows if v["visit_status"] == VisitStatus.SKIPPED])

    # ── Recent invoices (last 5) ──────────────────────────────────────────────
    recent_invoices = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters={"customer": customer, "docstatus": 1},
        fields=["name", "posting_date", "grand_total", "outstanding_amount", "status"],
        order_by="posting_date desc",
        limit_page_length=5,
    )

    return {
        "name":               cust["name"],
        "customer_name":      cust["customer_name"],
        "customer_group":     cust["customer_group"],
        "territory":          cust["territory"],
        "mobile_no":          cust["mobile_no"],
        "email_id":           cust["email_id"],
        "primary_address":    cust["primary_address"],
        "default_price_list": cust["default_price_list"],
        "payment_terms":      cust["payment_terms"],
        "financials": {
            "total_billed":      round_currency(total_billed),
            "total_outstanding": round_currency(total_outstanding),
            "total_paid":        round_currency(total_billed - total_outstanding),
            "overdue_amount":    round_currency(overdue_amount),
            "credit_limit":      credit_limit,
        },
        "total_visits":   total_visits,
        "total_skipped":  total_skipped,
        "last_visit":     last_visit,
        "recent_invoices": [
            {
                "name":               r["name"],
                "posting_date":       str(r["posting_date"]),
                "grand_total":        r["grand_total"],
                "outstanding_amount": r["outstanding_amount"],
                "status":             r["status"],
            }
            for r in recent_invoices
        ],
    }


@frappe.whitelist()
def get_customer_outstanding(customer):
    """
    Returns all submitted Sales Invoices with a positive outstanding amount
    for a customer. Used in the Routes page "Outstanding" tab.

    Parameters
    ----------
    customer : str – Customer name.

    Returns
    -------
    {
      "customer":           str,
      "total_outstanding":  float,
      "invoices": [{
        "invoice", "date", "due_date",
        "grand_total", "outstanding_amount", "status", "overdue"
      }]
    }
    """
    from frappe.utils import getdate, today
    assert_customer_readonly_access(customer)

    invoices = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters={
            "customer":           customer,
            "docstatus":          1,
            "outstanding_amount": [">", 0],
        },
        fields=["name", "posting_date", "due_date",
                "grand_total", "outstanding_amount", "status"],
        order_by="posting_date asc",
    )

    today_date = getdate(today())
    result = []
    for inv in invoices:
        due = getdate(inv["due_date"]) if inv.get("due_date") else None
        result.append({
            "invoice":            inv["name"],
            "date":               str(inv["posting_date"]),
            "due_date":           str(inv["due_date"]) if inv.get("due_date") else None,
            "grand_total":        inv["grand_total"],
            "outstanding_amount": inv["outstanding_amount"],
            "status":             inv["status"],
            "overdue":            bool(due and due < today_date),
        })

    return {
        "customer":          customer,
        "total_outstanding": round_currency(sum(r["outstanding_amount"] or 0 for r in result)),
        "invoices":          result,
    }


@frappe.whitelist()
def get_my_customers():
    """
    Returns customers on the currently active route, independent of which
    salesperson is assigned. Route customers are not tied to a salesperson —
    they belong to the route itself.

    Returns
    -------
    {
      "total": int,
      "route": str | null,
      "customers": [{
        "customer", "customer_name", "mobile_no", "territory",
        "total_outstanding", "overdue_amount", "last_visit"
      }]
    }
    """
    from route_sales.api.security import require_login
    require_login()
    salesperson = current_salesperson(required=not is_manager())

    # Find the current active route — open session first, then latest assignment
    route = get_current_route_for_salesperson(salesperson, with_assignment=False)["route"]

    if not route:
        return {"total": 0, "route": None, "customers": []}

    route_names = [route]

    if not route_names:
        return {"total": 0, "customers": []}

    rc_rows = frappe.db.get_all(
        "Route Customer",
        filters={"parent": ["in", route_names]},
        fields=["customer"],
        distinct=True,
    )
    customer_ids = list({r["customer"] for r in rc_rows})

    if not customer_ids:
        return {"total": 0, "customers": []}

    # Fetch customer master fields
    cust_rows = frappe.db.get_all(
        DocType.CUSTOMER,
        filters={"name": ["in", customer_ids], "disabled": 0},
        fields=["name", "customer_name", "mobile_no", "territory"],
    )

    # Outstanding per customer
    inv_rows = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters={
            "customer": ["in", customer_ids],
            "docstatus": 1,
            "outstanding_amount": [">", 0],
        },
        fields=["customer", "outstanding_amount", "due_date"],
    )
    outstanding_map = {}
    overdue_map = {}
    _today = today()
    for r in inv_rows:
        c = r["customer"]
        outstanding_map[c] = outstanding_map.get(c, 0) + (r["outstanding_amount"] or 0)
        if r.get("due_date") and str(r["due_date"]) < _today:
            overdue_map[c] = overdue_map.get(c, 0) + (r["outstanding_amount"] or 0)

    # Last visit per customer
    visit_rows = frappe.db.get_all(
        "Route Visit",
        filters={"customer": ["in", customer_ids]},
        fields=["customer", "checkin_time", "visit_status"],
        order_by="checkin_time desc",
    )
    last_visit_map = {}
    for v in visit_rows:
        c = v["customer"]
        if c not in last_visit_map:
            last_visit_map[c] = str(v["checkin_time"])[:10] if v.get("checkin_time") else None

    customers = []
    for c in cust_rows:
        cid = c["name"]
        customers.append({
            "customer":          cid,
            "customer_name":     c["customer_name"],
            "mobile_no":         c["mobile_no"],
            "territory":         c["territory"],
            "total_outstanding": round_currency(outstanding_map.get(cid, 0)),
            "overdue_amount":    round_currency(overdue_map.get(cid, 0)),
            "last_visit":        last_visit_map.get(cid),
        })

    customers.sort(key=lambda x: x["customer_name"] or "")

    route_name = frappe.db.get_value("Sales Route", route, "route_name") if route else None
    return {
        "total":     len(customers),
        "route":     route_name or route,
        "customers": customers,
    }
