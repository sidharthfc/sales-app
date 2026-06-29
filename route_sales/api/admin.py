"""
route_sales.api.admin
=====================
Admin endpoints for managing route assignments and monitoring.

GET  /api/method/route_sales.api.admin.get_salespersons
GET  /api/method/route_sales.api.admin.get_routes
GET  /api/method/route_sales.api.admin.get_assignments
POST /api/method/route_sales.api.admin.assign_route
POST /api/method/route_sales.api.admin.unassign_route
GET  /api/method/route_sales.api.admin.get_route_customers
GET  /api/method/route_sales.api.admin.check_admin_role
GET  /api/method/route_sales.api.admin.admin_get_overview
GET  /api/method/route_sales.api.admin.admin_get_all_locations
GET  /api/method/route_sales.api.admin.admin_get_route_orders
GET  /api/method/route_sales.api.admin.admin_get_returns
GET  /api/method/route_sales.api.admin.admin_get_van_stock
GET  /api/method/route_sales.api.admin.admin_get_expenses
"""

import frappe
from frappe.utils import today, add_days
from route_sales.api.security import get_user_context, only_manager
from route_sales.api.constants import VisitStatus, PENDING_DELIVERY_STATUSES
from route_sales.api.utils import round_currency


@frappe.whitelist()
def check_admin_role():
    """Returns whether the current user has manager access."""
    context = get_user_context()
    return {"is_admin": context["is_admin"], "roles": context["roles"]}


@frappe.whitelist()
def get_salespersons():
    """List all active Sales Persons."""
    only_manager()
    return frappe.db.get_all(
        "Sales Person",
        filters={"enabled": 1},
        fields=["name", "sales_person_name", "employee"],
        order_by="sales_person_name asc",
    )


@frappe.whitelist()
def get_routes():
    """List all active Sales Routes with their customer count."""
    only_manager()
    routes = frappe.db.get_all(
        "Sales Route",
        fields=["name", "route_name", "territory"],
        order_by="route_name asc",
    )
    for r in routes:
        r["customer_count"] = frappe.db.count("Route Customer", {"parent": r["name"]})
    return routes


@frappe.whitelist()
def get_assignments():
    """
    Returns all salespersons with their current active assignment.
    Assignment persists until the salesperson ends their session or admin
    manually unassigns — not tied to date.
    """
    only_manager()

    salespersons = frappe.db.get_all(
        "Sales Person",
        filters={"enabled": 1},
        fields=["name", "sales_person_name"],
        order_by="sales_person_name asc",
    )

    # Latest non-cancelled assignment per salesperson
    all_assignments = frappe.db.get_all(
        "Route Assignment",
        filters={"docstatus": ["!=", 2]},
        fields=["name", "salesperson", "route", "vehicle", "travel_mode", "date"],
        order_by="date desc",
    )
    assign_map = {}
    for a in all_assignments:
        if a["salesperson"] not in assign_map:
            assign_map[a["salesperson"]] = a

    routes = frappe.db.get_all("Sales Route", fields=["name", "route_name"])
    route_map = {r["name"]: r["route_name"] for r in routes}

    # Open sessions per salesperson
    open_sessions = frappe.db.get_all(
        "Route Session",
        filters={"end_time": ["is", "not set"]},
        fields=["name", "salesperson", "start_time"],
    )
    open_session_map = {s["salesperson"]: s for s in open_sessions}

    result = []
    for sp in salespersons:
        assignment = assign_map.get(sp["name"])
        session = open_session_map.get(sp["name"])
        result.append({
            "salesperson":      sp["name"],
            "salesperson_name": sp["sales_person_name"],
            "assignment":       assignment["name"] if assignment else None,
            "route":            assignment["route"] if assignment else None,
            "route_name":       route_map.get(assignment["route"]) if assignment else None,
            "vehicle":          assignment.get("vehicle") if assignment else None,
            "travel_mode":      assignment.get("travel_mode") if assignment else None,
            "session_active":   bool(session),
            "session_started":  bool(session),
        })

    return {"date": today(), "assignments": result}


@frappe.whitelist()
def assign_route(salesperson, route, date=None, vehicle=None, travel_mode="Company Van"):
    """Create or update a Route Assignment.

    Blocked if the salesperson has an open session — they must end it (or be
    unassigned by admin) before a new route can be assigned.
    """
    only_manager()
    date = date or today()

    # Block if an open session exists for this salesperson
    open_session = frappe.db.get_value(
        "Route Session",
        {"salesperson": salesperson, "end_time": ["is", "not set"]},
        "name",
    )
    if open_session:
        frappe.throw(
            f"Cannot assign a new route while Route Session '{open_session}' is still active. "
            "Ask the salesperson to end their session first, or unassign them manually.",
            frappe.ValidationError,
        )

    existing = frappe.db.get_value(
        "Route Assignment",
        {"salesperson": salesperson, "docstatus": ["!=", 2]},
        "name",
        order_by="date desc",
    )

    if existing:
        # If the existing assignment already has a completed session, create a fresh
        # assignment so the salesperson can start a new session without being blocked.
        closed_session = frappe.db.get_value(
            "Route Session",
            {"route_assignment": existing, "end_time": ["is", "set"]},
            "name",
        )
        if closed_session:
            frappe.delete_doc("Route Assignment", existing, ignore_permissions=True, force=True)
            doc = frappe.new_doc("Route Assignment")
            doc.salesperson = salesperson
            doc.route       = route
            doc.date        = date
            doc.vehicle     = vehicle or ""
            doc.travel_mode = travel_mode or "Company Van"
            doc.insert(ignore_permissions=True)
        else:
            doc = frappe.get_doc("Route Assignment", existing)
            doc.route = route
            doc.date  = date
            if vehicle:
                doc.vehicle = vehicle
            doc.travel_mode = travel_mode or "Company Van"
            doc.save(ignore_permissions=True)
        status = "updated"
    else:
        doc = frappe.new_doc("Route Assignment")
        doc.salesperson = salesperson
        doc.route       = route
        doc.date        = date
        doc.vehicle     = vehicle or ""
        doc.travel_mode = travel_mode or "Company Van"
        doc.insert(ignore_permissions=True)
        status = "created"

    frappe.db.commit()
    return {"name": doc.name, "status": status}


@frappe.whitelist()
def unassign_route(salesperson):
    """Remove the current route assignment for a salesperson.

    Admin can always unassign regardless of session state. If an open session
    exists it is force-ended so the salesperson is fully released.
    """
    only_manager()

    existing = frappe.db.get_value(
        "Route Assignment",
        {"salesperson": salesperson, "docstatus": ["!=", 2]},
        "name",
        order_by="date desc",
    )

    if not existing:
        return {"status": "not_found"}

    # Force-end any open session for this salesperson (search by salesperson for robustness)
    open_sessions = frappe.db.get_all(
        "Route Session",
        filters={"salesperson": salesperson, "end_time": ["is", "not set"]},
        fields=["name"],
    )
    for s in open_sessions:
        frappe.db.set_value("Route Session", s["name"], "end_time", frappe.utils.now())

    frappe.delete_doc("Route Assignment", existing, ignore_permissions=True, force=True)
    frappe.db.commit()
    return {"status": "removed"}


@frappe.whitelist()
def admin_get_employee_day(salesperson, date=None):
    """
    Admin endpoint: full day summary for a specific salesperson on a given date.
    """
    only_manager()
    _date = date or today()

    # ── Assignment ────────────────────────────────────────────────────────────
    assignment = frappe.db.get_value(
        "Route Assignment",
        {"salesperson": salesperson, "docstatus": ["!=", 2]},
        ["name", "route", "vehicle", "travel_mode"],
        as_dict=True,
        order_by="date desc",
    )

    # ── Session ───────────────────────────────────────────────────────────────
    session = None
    if assignment:
        session = frappe.db.get_value(
            "Route Session",
            {"route_assignment": assignment["name"]},
            ["name", "start_time", "end_time", "salesperson"],
            as_dict=True,
            order_by="creation desc",
        )

    # ── Route name ────────────────────────────────────────────────────────────
    route_name = None
    if assignment and assignment.get("route"):
        route_name = frappe.db.get_value("Sales Route", assignment["route"], "route_name")

    # ── Route customers ───────────────────────────────────────────────────────
    route_customers = []
    if assignment and assignment.get("route"):
        rc_rows = frappe.db.get_all(
            "Route Customer",
            filters={"parent": assignment["route"]},
            fields=["customer", "sequence"],
            order_by="sequence asc",
        )
        if rc_rows:
            cust_map = {
                r["name"]: r
                for r in frappe.db.get_all(
                    "Customer",
                    filters={"name": ["in", [rc["customer"] for rc in rc_rows]]},
                    fields=["name", "customer_name", "mobile_no"],
                )
            }
            for rc in rc_rows:
                cust = cust_map.get(rc["customer"], {})
                route_customers.append({
                    "customer":      rc["customer"],
                    "customer_name": cust.get("customer_name"),
                    "mobile_no":     cust.get("mobile_no"),
                    "sequence":      rc["sequence"],
                    "status":        "Pending",
                    "checkin_time":  None,
                    "checkout_time": None,
                })

    # ── Visit progress ────────────────────────────────────────────────────────
    visited = skipped = 0
    if session:
        visits = frappe.db.get_all(
            "Route Visit",
            filters={"route_session": session["name"]},
            fields=["customer", "visit_status", "checkin_time", "checkout_time"],
        )
        visit_map = {v["customer"]: v for v in visits}
        for rc in route_customers:
            v = visit_map.get(rc["customer"])
            if v:
                rc["status"]        = v["visit_status"]
                rc["checkin_time"]  = str(v["checkin_time"])  if v.get("checkin_time")  else None
                rc["checkout_time"] = str(v["checkout_time"]) if v.get("checkout_time") else None
                if v["visit_status"] == VisitStatus.VISITED:
                    visited += 1
                elif v["visit_status"] == VisitStatus.SKIPPED:
                    skipped += 1

    total_customers = len(route_customers)
    remaining = max(0, total_customers - visited - skipped)

    # ── Sales ─────────────────────────────────────────────────────────────────
    route_customer_ids = [rc["customer"] for rc in route_customers]
    so_rows = inv_rows = []
    if route_customer_ids:
        so_rows = frappe.db.get_all(
            "Sales Order",
            filters={"customer": ["in", route_customer_ids], "transaction_date": _date, "docstatus": 1},
            fields=["grand_total"],
        )
        inv_rows = frappe.db.get_all(
            "Sales Invoice",
            filters={"customer": ["in", route_customer_ids], "posting_date": _date, "docstatus": 1},
            fields=["grand_total"],
        )

    # ── Collections ───────────────────────────────────────────────────────────
    pe_rows = []
    by_mode = {}
    if route_customer_ids:
        pe_rows = frappe.db.get_all(
            "Payment Entry",
            filters={
                "party":        ["in", route_customer_ids],
                "payment_type": "Receive",
                "party_type":   "Customer",
                "docstatus":    1,
                "posting_date": _date,
            },
            fields=["paid_amount", "mode_of_payment"],
        )
        for r in pe_rows:
            m = r["mode_of_payment"] or "Other"
            by_mode[m] = round_currency(by_mode.get(m, 0) + (r["paid_amount"] or 0))

    # ── Expenses ──────────────────────────────────────────────────────────────
    expenses = []
    if session:
        exp_rows = frappe.db.get_all(
            "Salesperson Expense",
            filters={"route_session": session["name"]},
            fields=["expense_type", "amount", "notes", "creation"],
            order_by="creation asc",
        )
        expenses = [
            {
                "type":   r["expense_type"],
                "amount": r["amount"],
                "notes":  r["notes"],
                "time":   str(r["creation"]),
            }
            for r in exp_rows
        ]

    # ── Live location ─────────────────────────────────────────────────────────
    loc = frappe.cache().get_value(f"live_loc:{salesperson}")

    sp_name = frappe.db.get_value("Sales Person", salesperson, "sales_person_name") or salesperson

    return {
        "salesperson":      salesperson,
        "salesperson_name": sp_name,
        "date":             _date,
        "assignment": {
            "name":        assignment["name"],
            "route":       assignment["route"],
            "route_name":  route_name,
            "vehicle":     assignment.get("vehicle"),
            "travel_mode": assignment.get("travel_mode"),
        } if assignment else None,
        "session": {
            "name":       session["name"],
            "start_time": str(session["start_time"]) if session.get("start_time") else None,
            "end_time":   str(session["end_time"])   if session.get("end_time")   else None,
            "is_active":  not bool(session.get("end_time")),
        } if session else None,
        "progress": {
            "total_customers": total_customers,
            "visited":         visited,
            "skipped":         skipped,
            "remaining":       remaining,
        },
        "customers":    route_customers,
        "sales": {
            "orders_count":    len(so_rows),
            "total_amount":    round_currency(sum(r["grand_total"] or 0 for r in so_rows)),
            "invoiced_amount": round_currency(sum(r["grand_total"] or 0 for r in inv_rows)),
        },
        "collections": {
            "total":   round_currency(sum(r["paid_amount"] or 0 for r in pe_rows)),
            "by_mode": by_mode,
        },
        "expenses": expenses,
        "location": {
            "lat":       loc["lat"],
            "lng":       loc["lng"],
            "accuracy":  loc.get("accuracy"),
            "timestamp": loc["timestamp"],
        } if loc else None,
    }


@frappe.whitelist()
def get_route_customers(route):
    """Get ordered customer list for a route."""
    only_manager()
    customers = frappe.db.get_all(
        "Route Customer",
        filters={"parent": route},
        fields=["customer", "sequence"],
        order_by="sequence asc",
    )

    cust_map = {}
    if customers:
        cust_map = {
            r["name"]: r
            for r in frappe.db.get_all(
                "Customer",
                filters={"name": ["in", [rc["customer"] for rc in customers]]},
                fields=["name", "customer_name", "mobile_no", "address_line1",
                        "city", "district", "state", "pincode", "latitude", "longitude"],
            )
        }

    result = []
    for rc in customers:
        cust = cust_map.get(rc["customer"], {})
        parts = [cust.get("address_line1"), cust.get("city"), cust.get("district"), cust.get("state")]
        address_text = ", ".join(p for p in parts if p) or None
        result.append({
            "customer":      rc["customer"],
            "customer_name": cust.get("customer_name"),
            "mobile_no":     cust.get("mobile_no"),
            "address":       address_text,
            "lat":           float(cust["latitude"])  if cust.get("latitude")  else None,
            "lng":           float(cust["longitude"]) if cust.get("longitude") else None,
            "sequence":      rc["sequence"],
        })

    return result


# ── New admin monitoring endpoints ────────────────────────────────────────────

@frappe.whitelist()
def admin_get_overview():
    """Today's KPI summary + salesperson attendance status."""
    only_manager()
    _today = today()

    all_sp = frappe.db.get_all(
        "Sales Person", filters={"enabled": 1},
        fields=["name", "sales_person_name"], order_by="sales_person_name asc",
    )

    today_sessions = frappe.db.get_all(
        "Route Session",
        filters={"start_time": [">=", _today + " 00:00:00"]},
        fields=["name", "salesperson", "start_time", "end_time", "route_assignment"],
    )
    session_by_sp = {s["salesperson"]: s for s in today_sessions}

    all_assign = frappe.db.get_all(
        "Route Assignment", filters={"docstatus": ["!=", 2]},
        fields=["name", "salesperson", "route"], order_by="date desc",
    )
    assign_map = {}
    for a in all_assign:
        if a["salesperson"] not in assign_map:
            assign_map[a["salesperson"]] = a

    routes = frappe.db.get_all("Sales Route", fields=["name", "route_name"])
    route_map = {r["name"]: r["route_name"] for r in routes}

    active_session_names = [s["name"] for s in today_sessions if not s.get("end_time")]
    visit_counts = {}
    if active_session_names:
        visits = frappe.db.get_all(
            "Route Visit",
            filters={"route_session": ["in", active_session_names]},
            fields=["route_session", "visit_status"],
        )
        for v in visits:
            k = v["route_session"]
            if k not in visit_counts:
                visit_counts[k] = {"visited": 0, "skipped": 0}
            if v["visit_status"] == VisitStatus.VISITED:
                visit_counts[k]["visited"] += 1
            elif v["visit_status"] == VisitStatus.SKIPPED:
                visit_counts[k]["skipped"] += 1

    orders_today = frappe.db.get_all(
        "Sales Order",
        filters={"transaction_date": _today, "docstatus": 1},
        fields=["name", "customer", "customer_name", "grand_total", "status", "transaction_date"],
        order_by="modified desc",
    )
    inv_today = frappe.db.get_all(
        "Sales Invoice",
        filters={"posting_date": _today, "docstatus": 1, "is_return": 0},
        fields=["name", "customer", "customer_name", "grand_total", "outstanding_amount", "status", "posting_date"],
        order_by="modified desc",
    )
    pe_today = frappe.db.get_all(
        "Payment Entry",
        filters={"posting_date": _today, "docstatus": 1, "payment_type": "Receive", "party_type": "Customer"},
        fields=["name", "party", "paid_amount", "mode_of_payment", "posting_date", "remarks"],
        order_by="modified desc",
    )
    exp_rows = frappe.db.get_all(
        "Salesperson Expense",
        filters={"creation": [">=", _today + " 00:00:00"]},
        fields=["name", "employee", "route_session", "expense_type", "amount", "notes", "creation"],
        order_by="creation desc",
    )

    pending_deliveries = frappe.db.count("Sales Order", {"status": ["in", PENDING_DELIVERY_STATUSES], "docstatus": 1})
    returns_today      = frappe.db.count("Sales Invoice", {"posting_date": _today, "docstatus": 1, "is_return": 1})
    overdue_count      = frappe.db.count("Sales Invoice", {"status": "Overdue", "docstatus": 1})
    pending_delivery_rows = frappe.db.get_all(
        "Sales Order",
        filters={"status": ["in", PENDING_DELIVERY_STATUSES], "docstatus": 1},
        fields=["name", "customer", "customer_name", "grand_total", "status", "delivery_date", "transaction_date"],
        order_by="delivery_date asc, modified desc",
        limit=12,
    )
    returns_today_rows = frappe.db.get_all(
        "Sales Invoice",
        filters={"posting_date": _today, "docstatus": 1, "is_return": 1},
        fields=["name", "customer", "customer_name", "grand_total", "return_against", "posting_date"],
        order_by="modified desc",
        limit=12,
    )
    overdue_rows = frappe.db.get_all(
        "Sales Invoice",
        filters={"status": "Overdue", "docstatus": 1},
        fields=["name", "customer", "customer_name", "grand_total", "outstanding_amount", "due_date", "posting_date"],
        order_by="due_date asc, modified desc",
        limit=12,
    )

    by_mode = {}
    for r in pe_today:
        m = r["mode_of_payment"] or "Other"
        by_mode[m] = round_currency(by_mode.get(m, 0) + (r["paid_amount"] or 0))

    sp_list = []
    for sp in all_sp:
        session    = session_by_sp.get(sp["name"])
        assignment = assign_map.get(sp["name"])
        vc = visit_counts.get(session["name"], {}) if session else {}
        sp_list.append({
            "salesperson":      sp["name"],
            "salesperson_name": sp["sales_person_name"],
            "route_name":       route_map.get(assignment["route"]) if assignment and assignment.get("route") else None,
            "assigned":         bool(assignment),
            "session_active":   bool(session and not session.get("end_time")),
            "session_done":     bool(session and session.get("end_time")),
            "start_time":       str(session["start_time"]) if session and session.get("start_time") else None,
            "end_time":         str(session["end_time"])   if session and session.get("end_time")   else None,
            "visits_done":      vc.get("visited", 0),
            "visits_skipped":   vc.get("skipped", 0),
        })

    payment_customer_names = {}
    payment_customer_ids = [row["party"] for row in pe_today if row.get("party")]
    if payment_customer_ids:
        payment_customer_names = {
            r["name"]: r["customer_name"]
            for r in frappe.db.get_all(
                "Customer",
                filters={"name": ["in", list(set(payment_customer_ids))]},
                fields=["name", "customer_name"],
            )
        }

    expense_session_map = {}
    expense_session_names = [row["route_session"] for row in exp_rows if row.get("route_session")]
    if expense_session_names:
        expense_session_map = {
            r["name"]: r["salesperson"]
            for r in frappe.db.get_all(
                "Route Session",
                filters={"name": ["in", list(set(expense_session_names))]},
                fields=["name", "salesperson"],
            )
        }
    salesperson_name_map = {row["salesperson"]: row["salesperson_name"] for row in sp_list}

    quick_views = {
        "total_salespersons": sp_list[:12],
        "assigned": [row for row in sp_list if row["assigned"]][:12],
        "active_now": [row for row in sp_list if row["session_active"]][:12],
        "started_today": [row for row in sp_list if row["session_active"] or row["session_done"]][:12],
        "orders_today": [
            {
                "name": row["name"],
                "customer": row["customer_name"] or row["customer"],
                "amount": row["grand_total"] or 0,
                "status": row["status"],
                "date": str(row["transaction_date"]) if row.get("transaction_date") else None,
            }
            for row in orders_today[:12]
        ],
        "invoiced_today": [
            {
                "name": row["name"],
                "customer": row["customer_name"] or row["customer"],
                "amount": row["grand_total"] or 0,
                "outstanding_amount": row["outstanding_amount"] or 0,
                "status": row["status"],
                "date": str(row["posting_date"]) if row.get("posting_date") else None,
            }
            for row in inv_today[:12]
        ],
        "collected_today": [
            {
                "name": row["name"],
                "customer": payment_customer_names.get(row["party"], row["party"]),
                "amount": row["paid_amount"] or 0,
                "mode": row["mode_of_payment"] or "Other",
                "date": str(row["posting_date"]) if row.get("posting_date") else None,
                "remarks": row.get("remarks"),
            }
            for row in pe_today[:12]
        ],
        "pending_deliveries": [
            {
                "name": row["name"],
                "customer": row["customer_name"] or row["customer"],
                "amount": row["grand_total"] or 0,
                "status": row["status"],
                "date": str(row["delivery_date"] or row["transaction_date"]) if row.get("delivery_date") or row.get("transaction_date") else None,
            }
            for row in pending_delivery_rows
        ],
        "returns_today": [
            {
                "name": row["name"],
                "customer": row["customer_name"] or row["customer"],
                "amount": abs(row["grand_total"] or 0),
                "date": str(row["posting_date"]) if row.get("posting_date") else None,
                "return_against": row.get("return_against"),
            }
            for row in returns_today_rows
        ],
        "expenses_today": [
            {
                "name": row["name"],
                "employee": salesperson_name_map.get(expense_session_map.get(row.get("route_session"))) or row.get("employee"),
                "type": row.get("expense_type"),
                "amount": row["amount"] or 0,
                "date": str(row["creation"]) if row.get("creation") else None,
                "notes": row.get("notes"),
            }
            for row in exp_rows[:12]
        ],
        "overdue_invoices": [
            {
                "name": row["name"],
                "customer": row["customer_name"] or row["customer"],
                "amount": row["grand_total"] or 0,
                "outstanding_amount": row["outstanding_amount"] or 0,
                "date": str(row["due_date"] or row["posting_date"]) if row.get("due_date") or row.get("posting_date") else None,
            }
            for row in overdue_rows
        ],
    }

    return {
        "date": _today,
        "kpis": {
            "total_salespersons":  len(all_sp),
            "assigned":            len([s for s in sp_list if s["assigned"]]),
            "active_now":          len([s for s in sp_list if s["session_active"]]),
            "started_today":       len([s for s in sp_list if s["session_active"] or s["session_done"]]),
            "orders_count":        len(orders_today),
            "orders_total":        round_currency(sum(r["grand_total"] or 0 for r in orders_today)),
            "invoiced_total":      round_currency(sum(r["grand_total"] or 0 for r in inv_today)),
            "collections_total":   round_currency(sum(r["paid_amount"] or 0 for r in pe_today)),
            "collections_by_mode": by_mode,
            "pending_deliveries":  pending_deliveries,
            "returns_today":       returns_today,
            "expenses_total":      round_currency(sum(r["amount"] or 0 for r in exp_rows)),
            "overdue_invoices":    overdue_count,
        },
        "salespersons": sp_list,
        "quick_views": quick_views,
    }


@frappe.whitelist()
def admin_get_all_locations():
    """Live location for all salespersons with open sessions."""
    only_manager()
    open_sessions = frappe.db.get_all(
        "Route Session",
        filters={"end_time": ["is", "not set"]},
        fields=["name", "salesperson"],
    )
    if not open_sessions:
        return []

    sp_ids      = list({s["salesperson"] for s in open_sessions})
    session_ids = [s["name"] for s in open_sessions]

    # Batch: salesperson names
    sp_name_map = {
        r["name"]: r["sales_person_name"]
        for r in frappe.db.get_all(
            "Sales Person",
            filters={"name": ["in", sp_ids]},
            fields=["name", "sales_person_name"],
        )
    }

    # Batch: latest assignment per salesperson
    all_assignments = frappe.db.get_all(
        "Route Assignment",
        filters={"salesperson": ["in", sp_ids], "docstatus": ["!=", 2]},
        fields=["name", "salesperson", "route"],
        order_by="date desc",
    )
    assign_map = {}
    for a in all_assignments:
        if a["salesperson"] not in assign_map:
            assign_map[a["salesperson"]] = a

    # Batch: route names
    route_ids = list({a["route"] for a in assign_map.values() if a.get("route")})
    route_name_map = {}
    if route_ids:
        route_name_map = {
            r["name"]: r["route_name"]
            for r in frappe.db.get_all(
                "Sales Route",
                filters={"name": ["in", route_ids]},
                fields=["name", "route_name"],
            )
        }

    # Batch: visit counts for all open sessions
    visit_rows = frappe.db.get_all(
        "Route Visit",
        filters={"route_session": ["in", session_ids]},
        fields=["route_session", "visit_status"],
    )
    vc_visited_map = {}
    vc_total_map   = {}
    for v in visit_rows:
        k = v["route_session"]
        vc_total_map[k] = vc_total_map.get(k, 0) + 1
        if v["visit_status"] == VisitStatus.VISITED:
            vc_visited_map[k] = vc_visited_map.get(k, 0) + 1

    result = []
    for s in open_sessions:
        loc        = frappe.cache().get_value(f"live_loc:{s['salesperson']}")
        sp_name    = sp_name_map.get(s["salesperson"]) or s["salesperson"]
        assignment = assign_map.get(s["salesperson"])
        route_name = route_name_map.get(assignment["route"]) if assignment and assignment.get("route") else None
        result.append({
            "salesperson":      s["salesperson"],
            "salesperson_name": sp_name,
            "session":          s["name"],
            "route_name":       route_name,
            "visits_done":      vc_visited_map.get(s["name"], 0),
            "visits_total":     vc_total_map.get(s["name"], 0),
            "location": {
                "lat":       loc["lat"],
                "lng":       loc["lng"],
                "accuracy":  loc.get("accuracy"),
                "timestamp": loc["timestamp"],
            } if loc else None,
        })
    return result


@frappe.whitelist()
def admin_get_route_orders(route=None, salesperson=None):
    """Route-wise customer → all pending orders and outstanding invoices (date-agnostic)."""
    only_manager()

    customer_ids = []
    seq_map = {}

    if route:
        rc_rows = frappe.db.get_all("Route Customer", filters={"parent": route}, fields=["customer", "sequence"], order_by="sequence asc")
        customer_ids = [r["customer"] for r in rc_rows]
        seq_map = {r["customer"]: r["sequence"] for r in rc_rows}
    elif salesperson:
        assignment = frappe.db.get_value(
            "Route Assignment", {"salesperson": salesperson, "docstatus": ["!=", 2]},
            ["route"], as_dict=True, order_by="date desc",
        )
        if assignment and assignment.get("route"):
            rc_rows = frappe.db.get_all("Route Customer", filters={"parent": assignment["route"]}, fields=["customer", "sequence"], order_by="sequence asc")
            customer_ids = [r["customer"] for r in rc_rows]
            seq_map = {r["customer"]: r["sequence"] for r in rc_rows}
    else:
        customer_ids = frappe.get_all("Customer", pluck="name")

    if not customer_ids:
        return []

    cust_rows = frappe.db.get_all("Customer", filters={"name": ["in", customer_ids]}, fields=["name", "customer_name", "mobile_no"])
    cust_map  = {c["name"]: c for c in cust_rows}

    # All pending SOs regardless of date
    so_rows = frappe.db.get_all(
        "Sales Order",
        filters={"customer": ["in", customer_ids], "docstatus": 1,
                 "status": ["in", PENDING_DELIVERY_STATUSES]},
        fields=["name", "customer", "grand_total", "status", "transaction_date"],
    )
    # All outstanding invoices regardless of date
    inv_rows = frappe.db.get_all(
        "Sales Invoice",
        filters={"customer": ["in", customer_ids], "docstatus": 1,
                 "is_return": 0, "outstanding_amount": [">", 0]},
        fields=["name", "customer", "grand_total", "outstanding_amount", "status", "posting_date"],
    )

    so_map  = {}
    inv_map = {}
    for r in so_rows:  so_map.setdefault(r["customer"], []).append(r)
    for r in inv_rows: inv_map.setdefault(r["customer"], []).append(r)

    result = []
    for cid in customer_ids:
        cust     = cust_map.get(cid, {})
        orders   = so_map.get(cid, [])
        invoices = inv_map.get(cid, [])
        result.append({
            "customer":          cid,
            "customer_name":     cust.get("customer_name", cid),
            "mobile_no":         cust.get("mobile_no"),
            "sequence":          seq_map.get(cid),
            "orders_count":      len(orders),
            "invoices_count":    len(invoices),
            "total_ordered":     round_currency(sum(o["grand_total"] or 0 for o in orders)),
            "total_outstanding": round_currency(sum(i["outstanding_amount"] or 0 for i in invoices)),
            "orders":   [{"name": o["name"], "grand_total": o["grand_total"], "status": o["status"], "date": str(o["transaction_date"])} for o in orders],
            "invoices": [{"name": i["name"], "grand_total": i["grand_total"], "outstanding_amount": i["outstanding_amount"], "status": i["status"], "date": str(i["posting_date"])} for i in invoices],
        })
    return result


@frappe.whitelist()
def admin_get_returns(salesperson=None, from_date=None, to_date=None):
    """Return invoices (credit notes) with line items."""
    only_manager()
    _today = today()
    _from = from_date or _today
    _to   = to_date   or _today

    filters = {"is_return": 1, "docstatus": 1, "posting_date": ["between", [_from, _to]]}

    if salesperson:
        assignment = frappe.db.get_value(
            "Route Assignment", {"salesperson": salesperson, "docstatus": ["!=", 2]},
            ["route"], as_dict=True, order_by="date desc",
        )
        if assignment and assignment.get("route"):
            cids = [r["customer"] for r in frappe.db.get_all("Route Customer", filters={"parent": assignment["route"]}, fields=["customer"])]
            if cids:
                filters["customer"] = ["in", cids]
            else:
                return []
        else:
            return []

    returns = frappe.db.get_all(
        "Sales Invoice", filters=filters,
        fields=["name", "customer", "customer_name", "posting_date", "grand_total", "return_against"],
        order_by="posting_date desc",
    )
    if not returns:
        return []

    ret_names = [r["name"] for r in returns]
    items = frappe.db.get_all(
        "Sales Invoice Item", filters={"parent": ["in", ret_names]},
        fields=["parent", "item_code", "item_name", "qty", "rate", "amount"],
    )
    items_map = {}
    for item in items:
        items_map.setdefault(item["parent"], []).append(item)

    return [
        {
            "name":           r["name"],
            "customer":       r["customer"],
            "customer_name":  r["customer_name"],
            "posting_date":   str(r["posting_date"]),
            "grand_total":    abs(r["grand_total"] or 0),
            "return_against": r.get("return_against"),
            "items": [
                {"item_code": i["item_code"], "item_name": i["item_name"],
                 "qty": abs(i["qty"] or 0), "rate": i["rate"], "amount": abs(i["amount"] or 0)}
                for i in items_map.get(r["name"], [])
            ],
        }
        for r in returns
    ]


@frappe.whitelist()
def admin_get_van_stock(date=None):
    """Sessions for the given date with loaded/delivered/returned stock per item."""
    only_manager()
    _date = date or today()
    _next = add_days(_date, 1)

    sessions = frappe.db.get_all(
        "Route Session",
        filters={"start_time": ["between", [_date + " 00:00:00", _next + " 00:00:00"]]},
        fields=["name", "salesperson", "route_assignment", "route", "vehicle", "start_time", "end_time"],
        order_by="start_time desc",
    )
    if not sessions:
        return []

    # Batch-fetch route names to avoid N+1
    route_ids = list({s["route"] for s in sessions if s.get("route")})
    route_name_map = {}
    if route_ids:
        route_name_map = {
            r["name"]: r["route_name"]
            for r in frappe.db.get_all("Sales Route", filters={"name": ["in", route_ids]}, fields=["name", "route_name"])
        }

    result = []
    for s in sessions:
        sp_name = frappe.db.get_value("Sales Person", s["salesperson"], "sales_person_name") or s["salesperson"]
        vehicle = s.get("vehicle")
        route_name = route_name_map.get(s.get("route"))

        loaded_rows = frappe.db.get_all(
            "Route Session Loaded Item", filters={"parent": s["name"]},
            fields=["item_code", "item_name", "qty_loaded", "qty_delivered", "qty_returned"],
        )
        total_loaded    = sum(r.get("qty_loaded")    or 0 for r in loaded_rows)
        total_delivered = sum(r.get("qty_delivered") or 0 for r in loaded_rows)
        total_returned  = sum(r.get("qty_returned")  or 0 for r in loaded_rows)

        result.append({
            "session":          s["name"],
            "salesperson":      s["salesperson"],
            "salesperson_name": sp_name,
            "vehicle":          vehicle,
            "route_name":       route_name,
            "start_time":       str(s["start_time"]) if s.get("start_time") else None,
            "end_time":         str(s["end_time"])   if s.get("end_time")   else None,
            "is_active":        not bool(s.get("end_time")),
            "summary": {
                "total_loaded":    total_loaded,
                "total_delivered": total_delivered,
                "total_returned":  total_returned,
                "remaining":       max(0, total_loaded - total_delivered - total_returned),
            },
            "items": [
                {
                    "item_code":     r["item_code"],
                    "item_name":     r["item_name"],
                    "qty_loaded":    r.get("qty_loaded")    or 0,
                    "qty_delivered": r.get("qty_delivered") or 0,
                    "qty_returned":  r.get("qty_returned")  or 0,
                    "qty_remaining": max(0, (r.get("qty_loaded") or 0) - (r.get("qty_delivered") or 0) - (r.get("qty_returned") or 0)),
                }
                for r in loaded_rows
            ],
        })
    return result


@frappe.whitelist()
def admin_get_expenses(salesperson=None, from_date=None, to_date=None):
    """All employee expenses, filterable by salesperson and date range."""
    only_manager()
    _today = today()
    _from = from_date or _today
    _to   = to_date   or _today

    filters = {"creation": ["between", [_from + " 00:00:00", _to + " 23:59:59"]]}

    if salesperson:
        sessions = frappe.db.get_all(
            "Route Session",
            filters={"salesperson": salesperson, "start_time": [">=", _from + " 00:00:00"]},
            fields=["name"],
        )
        if not sessions:
            return {"expenses": [], "summary": {"total": 0, "by_employee": {}, "by_type": {}}}
        filters["route_session"] = ["in", [s["name"] for s in sessions]]
        del filters["creation"]

    exp_rows = frappe.db.get_all(
        "Salesperson Expense", filters=filters,
        fields=["name", "route_session", "expense_type", "amount", "notes", "receipt", "creation"],
        order_by="creation desc",
    )
    if not exp_rows:
        return {"expenses": [], "summary": {"total": 0, "by_employee": {}, "by_type": {}}}

    session_names = list({r["route_session"] for r in exp_rows if r.get("route_session")})
    sess_rows = frappe.db.get_all("Route Session", filters={"name": ["in", session_names]}, fields=["name", "salesperson"]) if session_names else []
    session_sp_map = {sr["name"]: sr["salesperson"] for sr in sess_rows}

    sp_ids = list(set(session_sp_map.values()))
    sp_name_map = {}
    if sp_ids:
        sp_rows = frappe.db.get_all("Sales Person", filters={"name": ["in", sp_ids]}, fields=["name", "sales_person_name"])
        sp_name_map = {r["name"]: r["sales_person_name"] for r in sp_rows}

    result = []
    by_employee = {}
    by_type = {}
    for r in exp_rows:
        sp_id   = session_sp_map.get(r["route_session"]) if r.get("route_session") else None
        sp_name = sp_name_map.get(sp_id, sp_id or "Unknown")
        amount  = r["amount"] or 0
        etype   = r["expense_type"] or "Other"
        by_employee[sp_name] = round_currency(by_employee.get(sp_name, 0) + amount)
        by_type[etype]       = round_currency(by_type.get(etype, 0) + amount)
        result.append({
            "name":             r["name"],
            "salesperson":      sp_id,
            "salesperson_name": sp_name,
            "session":          r["route_session"],
            "expense_type":     etype,
            "amount":           amount,
            "notes":            r["notes"],
            "receipt":          r.get("receipt"),
            "time":             str(r["creation"]),
        })

    return {
        "expenses": result,
        "summary": {
            "total":       round_currency(sum(r["amount"] for r in result)),
            "by_employee": by_employee,
            "by_type":     by_type,
        },
    }


@frappe.whitelist()
def admin_get_attendance(date=None):
    """Per-employee session attendance for the given date."""
    only_manager()
    _date = date or today()
    _next = add_days(_date, 1)

    all_sp = frappe.db.get_all(
        "Sales Person", filters={"enabled": 1},
        fields=["name", "sales_person_name"], order_by="sales_person_name asc",
    )

    sessions = frappe.db.get_all(
        "Route Session",
        filters={"start_time": ["between", [_date + " 00:00:00", _next + " 00:00:00"]]},
        fields=["name", "salesperson", "start_time", "end_time", "route_assignment"],
    )
    session_map = {s["salesperson"]: s for s in sessions}

    all_assign = frappe.db.get_all(
        "Route Assignment", filters={"docstatus": ["!=", 2]},
        fields=["name", "salesperson", "route"], order_by="date desc",
    )
    assign_map = {}
    for a in all_assign:
        if a["salesperson"] not in assign_map:
            assign_map[a["salesperson"]] = a

    routes = frappe.db.get_all("Sales Route", fields=["name", "route_name"])
    route_map = {r["name"]: r["route_name"] for r in routes}

    # Visit counts per session
    session_names = [s["name"] for s in sessions]
    visit_map = {}
    if session_names:
        visits = frappe.db.get_all(
            "Route Visit",
            filters={"route_session": ["in", session_names]},
            fields=["route_session", "visit_status"],
        )
        for v in visits:
            k = v["route_session"]
            if k not in visit_map:
                visit_map[k] = {"visited": 0, "skipped": 0, "total": 0}
            visit_map[k]["total"] += 1
            if v["visit_status"] == VisitStatus.VISITED:
                visit_map[k]["visited"] += 1
            elif v["visit_status"] == VisitStatus.SKIPPED:
                visit_map[k]["skipped"] += 1

    # Expenses per session
    exp_map = {}
    if session_names:
        exp_rows = frappe.db.get_all(
            "Salesperson Expense",
            filters={"route_session": ["in", session_names]},
            fields=["route_session", "amount"],
        )
        for e in exp_rows:
            exp_map[e["route_session"]] = exp_map.get(e["route_session"], 0) + (e["amount"] or 0)

    # Pre-compute customer count per route to avoid N+1 inside the loop
    att_route_ids = list({a["route"] for a in assign_map.values() if a.get("route")})
    route_cust_count = {}
    if att_route_ids:
        for rc in frappe.db.get_all(
            "Route Customer",
            filters={"parent": ["in", att_route_ids]},
            fields=["parent"],
        ):
            route_cust_count[rc["parent"]] = route_cust_count.get(rc["parent"], 0) + 1

    result = []
    for sp in all_sp:
        session    = session_map.get(sp["name"])
        assignment = assign_map.get(sp["name"])
        route_name = route_map.get(assignment["route"]) if assignment and assignment.get("route") else None

        total_customers = route_cust_count.get(assignment["route"], 0) if assignment and assignment.get("route") else 0

        if session:
            vc = visit_map.get(session["name"], {"visited": 0, "skipped": 0, "total": 0})
            expenses = round_currency(exp_map.get(session["name"], 0))
            duration_hours = None
            if session.get("start_time") and session.get("end_time"):
                delta = session["end_time"] - session["start_time"]
                duration_hours = round(delta.total_seconds() / 3600, 1)
            status = "done" if session.get("end_time") else "active"
        else:
            vc = {"visited": 0, "skipped": 0, "total": 0}
            expenses = 0
            duration_hours = None
            status = "not_started"

        result.append({
            "salesperson":      sp["name"],
            "salesperson_name": sp["sales_person_name"],
            "route_name":       route_name,
            "assigned":         bool(assignment),
            "status":           status,
            "start_time":       str(session["start_time"]) if session and session.get("start_time") else None,
            "end_time":         str(session["end_time"])   if session and session.get("end_time")   else None,
            "duration_hours":   duration_hours,
            "visits_done":      vc["visited"],
            "visits_skipped":   vc["skipped"],
            "visits_total":     vc["total"],
            "total_customers":  total_customers,
            "expenses":         expenses,
        })

    return {
        "date": _date,
        "summary": {
            "total":       len(result),
            "active":      len([r for r in result if r["status"] == "active"]),
            "done":        len([r for r in result if r["status"] == "done"]),
            "not_started": len([r for r in result if r["status"] == "not_started"]),
        },
        "employees": result,
    }
