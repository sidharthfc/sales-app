"""
route_sales.api.dashboard
=========================
GET  /api/method/route_sales.api.dashboard.get_dashboard_stats
"""

import frappe
from frappe.utils import today, now_datetime, get_first_day, get_last_day
from route_sales.api.security import current_salesperson, is_manager
from route_sales.api.constants import WAREHOUSE, DocType, VisitStatus
from route_sales.api.utils import round_currency


@frappe.whitelist()
def get_dashboard_stats(route_session=None):
    """
    Returns a single payload with all KPIs needed by the dashboard.

    When route_session is provided, today/session stats are scoped to that
    session only — ensuring each salesperson sees only their own live counts.
    """
    _today = today()
    month_start = get_first_day(_today)
    month_end   = get_last_day(_today)

    salesperson = None if is_manager() else current_salesperson(required=True)

    return {
        "routes":    _route_stats(),
        "vehicles":  _vehicle_stats(),
        "today":     _today_stats(_today, salesperson, route_session),
        "month":     _month_stats(month_start, month_end, salesperson, route_session),
        "stock":     _stock_stats(),
        "customers": _customer_stats(),
    }


# ── Sections ──────────────────────────────────────────────────────────────────

def _route_stats():
    total  = frappe.db.count("Sales Route")
    active = frappe.db.count("Sales Route", {"is_active": 1})
    return {
        "total":    total,
        "active":   active,
        "inactive": total - active,
    }


def _vehicle_stats():
    rows = frappe.db.get_all(
        "Route Vehicle",
        fields=["status"],
    )
    breakdown = {}
    for r in rows:
        s = r["status"] or "Unknown"
        breakdown[s] = breakdown.get(s, 0) + 1
    return {
        "total":     len(rows),
        "breakdown": breakdown,
    }


def _today_stats(date, salesperson=None, route_session=None):
    if route_session:
        # Session-scoped real-time stats
        visit_rows = frappe.db.get_all(
            "Route Visit",
            filters={"route_session": route_session},
            fields=["visit_status"],
        )
        visit_breakdown = {}
        for r in visit_rows:
            s = r["visit_status"] or "Unknown"
            visit_breakdown[s] = visit_breakdown.get(s, 0) + 1

        checkins = frappe.db.count("Route Visit", {
            "route_session": route_session,
            "checkin_time": ["is", "set"],
        })
        orders = frappe.db.count(
            DocType.SALES_INVOICE,
            {"remarks": ["like", f"%{route_session}%"], "docstatus": 1},
        )
        return {
            "sessions":        1,
            "visits":          len(visit_rows),
            "visited":         visit_breakdown.get(VisitStatus.VISITED, 0),
            "visit_breakdown": visit_breakdown,
            "assignments":     1,
            "checkins":        checkins,
            "orders":          orders,
        }

    # Date-based fallback (manager view / no active session)
    day_start = f"{date} 00:00:00"
    day_end   = f"{date} 23:59:59"

    session_filters = {"start_time": ["between", [day_start, day_end]]}
    if salesperson:
        session_filters["salesperson"] = salesperson

    sessions = frappe.db.get_all("Route Session", filters=session_filters, fields=["name"])
    session_names = [s["name"] for s in sessions]

    visit_filters = {"checkin_time": ["between", [day_start, day_end]]}
    if session_names:
        visit_filters["route_session"] = ["in", session_names]
    visit_rows = frappe.db.get_all("Route Visit", filters=visit_filters, fields=["visit_status"]) if session_names or not salesperson else []
    visit_breakdown = {}
    for r in visit_rows:
        s = r["visit_status"] or "Unknown"
        visit_breakdown[s] = visit_breakdown.get(s, 0) + 1

    assignment_filters = {"date": date}
    if salesperson:
        assignment_filters["salesperson"] = salesperson
    assignments = frappe.db.count("Route Assignment", assignment_filters)

    return {
        "sessions":        len(sessions),
        "visits":          len(visit_rows),
        "visited":         visit_breakdown.get(VisitStatus.VISITED, 0),
        "visit_breakdown": visit_breakdown,
        "assignments":     assignments,
        "checkins":        len(visit_rows),
        "orders":          0,
    }


def _month_stats(start, end, salesperson=None, _route_session=None):
    so_filters = {
        "transaction_date": ["between", [start, end]],
        "docstatus": 1,
    }
    inv_filters = {
        "posting_date": ["between", [start, end]],
        "docstatus": 1,
    }
    if salesperson:
        so_filters["sales_team.sales_person"] = salesperson
        inv_filters["sales_team.sales_person"] = salesperson

    so_rows = frappe.db.get_all(DocType.SALES_ORDER, filters=so_filters, fields=["grand_total"])
    inv_rows = frappe.db.get_all(DocType.SALES_INVOICE, filters=inv_filters, fields=["grand_total", "outstanding_amount"])

    so_revenue  = sum(r["grand_total"] or 0 for r in so_rows)
    inv_revenue = sum(r["grand_total"] or 0 for r in inv_rows)
    outstanding = sum(r["outstanding_amount"] or 0 for r in inv_rows)

    return {
        "sales_orders":       len(so_rows),
        "sales_order_amount": so_revenue,
        "invoices":           len(inv_rows),
        "invoice_amount":     inv_revenue,
        "outstanding":        outstanding,
    }


def _stock_stats():
    warehouse = WAREHOUSE

    bin_rows = frappe.db.get_all(
        "Bin",
        filters={"warehouse": warehouse, "actual_qty": [">", 0]},
        fields=["item_code", "actual_qty", "valuation_rate"],
    )

    total_qty   = sum(r["actual_qty"] or 0 for r in bin_rows)
    total_value = sum(
        (r["actual_qty"] or 0) * (r["valuation_rate"] or 0)
        for r in bin_rows
    )

    # Items with zero stock
    zero_stock = frappe.db.count(
        "Bin",
        {"warehouse": warehouse, "actual_qty": ["<=", 0]},
    )

    return {
        "warehouse":      warehouse,
        "items_in_stock": len(bin_rows),
        "items_zero_stock": zero_stock,
        "total_qty":      total_qty,
        "total_value":    round_currency(total_value),
    }


def _customer_stats():
    total    = frappe.db.count(DocType.CUSTOMER)
    disabled = frappe.db.count(DocType.CUSTOMER, {"disabled": 1})
    return {
        "total":  total,
        "active": total - disabled,
    }
