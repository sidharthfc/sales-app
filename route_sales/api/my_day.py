"""
route_sales.api.my_day
======================
GET /api/method/route_sales.api.my_day.get_my_day

Returns a full day-in-view for the logged-in salesperson:
  - Today's route progress (visited / skipped / remaining)
  - Today's sales & invoiced amounts
  - Today's collections broken down by payment mode
  - Pending items (deliveries, overdue invoices, skipped customers)
  - Month-to-date summary
"""

import frappe
from frappe.utils import today, get_first_day, get_last_day
from route_sales.api.security import current_salesperson, is_manager
from route_sales.api.constants import VisitStatus, PENDING_DELIVERY_STATUSES
from route_sales.api.utils import round_currency


@frappe.whitelist()
def get_my_day():
    _today = today()
    salesperson = current_salesperson(required=not is_manager())

    # ── Today's assignment + session ──────────────────────────────────────────
    assignment = frappe.db.get_value(
        "Route Assignment",
        {"salesperson": salesperson, "docstatus": ["!=", 2]},
        ["name", "route"],
        as_dict=True,
        order_by="date desc",
    ) if salesperson else None

    session = None
    if assignment:
        session = frappe.db.get_value(
            "Route Session",
            {"route_assignment": assignment["name"]},
            ["name", "start_time", "end_time"],
            as_dict=True,
            order_by="creation desc",
        )

    # ── Route customers ───────────────────────────────────────────────────────
    route_customer_ids = []
    if assignment and assignment.get("route"):
        rows = frappe.db.get_all(
            "Route Customer",
            filters={"parent": assignment["route"]},
            fields=["customer"],
        )
        route_customer_ids = [r["customer"] for r in rows]

    total_customers = len(route_customer_ids)

    # ── Visit progress ────────────────────────────────────────────────────────
    visited = skipped = 0
    skipped_customers = []

    if session:
        visits = frappe.db.get_all(
            "Route Visit",
            filters={"route_session": session["name"]},
            fields=["customer", "visit_status"],
        )
        for v in visits:
            if v["visit_status"] == VisitStatus.VISITED:
                visited += 1
            elif v["visit_status"] == VisitStatus.SKIPPED:
                skipped += 1
                cname = frappe.db.get_value("Customer", v["customer"], "customer_name") or v["customer"]
                skipped_customers.append({"customer": v["customer"], "customer_name": cname})

    remaining = max(0, total_customers - visited - skipped)

    # ── Today's Sales Orders ──────────────────────────────────────────────────
    so_filters = {"transaction_date": _today, "docstatus": 1}
    if route_customer_ids:
        so_filters["customer"] = ["in", route_customer_ids]
    elif salesperson:
        so_filters["sales_team.sales_person"] = salesperson

    so_rows = frappe.db.get_all("Sales Order", filters=so_filters, fields=["grand_total"])
    sales_amount = round_currency(sum(r["grand_total"] or 0 for r in so_rows))

    # ── Today's Invoices ──────────────────────────────────────────────────────
    inv_filters = {"posting_date": _today, "docstatus": 1}
    if route_customer_ids:
        inv_filters["customer"] = ["in", route_customer_ids]
    elif salesperson:
        inv_filters["sales_team.sales_person"] = salesperson

    inv_rows = frappe.db.get_all("Sales Invoice", filters=inv_filters, fields=["grand_total"])
    invoiced_amount = round_currency(sum(r["grand_total"] or 0 for r in inv_rows))

    # ── Salesperson's customer scope (fallback when no route assigned today) ────
    # Used for payment queries to prevent fetching all customers in the system.
    fallback_customer_ids = []
    if salesperson and not route_customer_ids:
        route_names = [
            a["route"]
            for a in frappe.db.get_all(
                "Route Assignment",
                filters={"salesperson": salesperson, "docstatus": ["!=", 2]},
                fields=["route"],
                distinct=True,
            )
            if a.get("route")
        ]
        if route_names:
            fallback_customer_ids = [
                r["customer"]
                for r in frappe.db.get_all(
                    "Route Customer",
                    filters={"parent": ["in", route_names]},
                    fields=["customer"],
                    distinct=True,
                )
            ]

    # ── Today's Collections (Payment Entries) ─────────────────────────────────
    customer_scope = route_customer_ids or fallback_customer_ids
    pe_filters = {
        "payment_type": "Receive",
        "party_type": "Customer",
        "docstatus": 1,
        "posting_date": _today,
    }
    if customer_scope:
        pe_filters["party"] = ["in", customer_scope]
    elif salesperson:
        # Salesperson exists but has no customers on any route — skip query
        pe_rows = []
    if "party" in pe_filters or not salesperson:
        pe_rows = frappe.db.get_all("Payment Entry", filters=pe_filters, fields=["paid_amount", "mode_of_payment"])
    total_collections = round_currency(sum(r["paid_amount"] or 0 for r in pe_rows))
    by_mode = {}
    for r in pe_rows:
        m = r["mode_of_payment"] or "Other"
        by_mode[m] = round_currency(by_mode.get(m, 0) + (r["paid_amount"] or 0))

    # ── Pending Deliveries ────────────────────────────────────────────────────
    pending_deliveries = 0
    if route_customer_ids:
        pending_deliveries = frappe.db.count(
            "Sales Order",
            {
                "customer": ["in", route_customer_ids],
                "docstatus": 1,
                "status": ["in", PENDING_DELIVERY_STATUSES],
            },
        )

    # ── Overdue Invoices (all customers in today's route, regardless of check-in) ─
    overdue_count = 0
    if route_customer_ids:
        overdue_count = frappe.db.count(
            "Sales Invoice",
            {
                "customer": ["in", route_customer_ids],
                "docstatus": 1,
                "outstanding_amount": [">", 0],
                "due_date": ["<", _today],
            },
        )

    # ── Month-to-date ─────────────────────────────────────────────────────────
    month_start = get_first_day(_today)
    month_end   = get_last_day(_today)

    mso_filters = {
        "transaction_date": ["between", [month_start, month_end]],
        "docstatus": 1,
    }
    if salesperson:
        mso_filters["sales_team.sales_person"] = salesperson

    mso_rows = frappe.db.get_all("Sales Order", filters=mso_filters, fields=["grand_total"])
    month_sales = round_currency(sum(r["grand_total"] or 0 for r in mso_rows))

    mpe_filters = {
        "payment_type": "Receive",
        "party_type": "Customer",
        "docstatus": 1,
        "posting_date": ["between", [month_start, month_end]],
    }
    if customer_scope:
        mpe_filters["party"] = ["in", customer_scope]
    elif salesperson:
        mpe_rows = []
    if "party" in mpe_filters or not salesperson:
        mpe_rows = frappe.db.get_all("Payment Entry", filters=mpe_filters, fields=["paid_amount"])
    month_collections = round_currency(sum(r["paid_amount"] or 0 for r in mpe_rows))

    return {
        "date": _today,
        "route": assignment.get("route") if assignment else None,
        "session_active": bool(session and not session.get("end_time")),
        "progress": {
            "total_customers": total_customers,
            "visited":         visited,
            "skipped":         skipped,
            "remaining":       remaining,
        },
        "sales_today": {
            "orders_count":    len(so_rows),
            "total_amount":    sales_amount,
            "invoiced_amount": invoiced_amount,
        },
        "collections_today": {
            "total":   total_collections,
            "by_mode": by_mode,
        },
        "pending": {
            "deliveries":         pending_deliveries,
            "overdue_invoices":   overdue_count,
            "skipped_customers":  skipped_customers,
        },
        "month": {
            "sales_orders":       len(mso_rows),
            "sales_amount":       month_sales,
            "collections_amount": month_collections,
        },
    }
