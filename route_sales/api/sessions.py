"""
route_sales.api.sessions
========================
POST /api/method/route_sales.api.sessions.start_session
POST /api/method/route_sales.api.sessions.end_session
GET  /api/method/route_sales.api.sessions.get_session_summary
"""

import frappe
from frappe.utils import add_days, now_datetime, today
from route_sales.api.constants import VisitStatus, SessionStatus, DocType
from route_sales.api.utils import round_currency, count_visits_by_status, paginate
from route_sales.api.security import (
    current_salesperson,
    ensure_route_assignment_access,
    ensure_route_session_access,
    is_manager,
    resolve_salesperson,
)


@frappe.whitelist(methods=["POST"])
def start_session(
    salesperson,
    route_assignment,
    travel_mode=None,
    vehicle=None,
    start_lat=None,
    start_lng=None,
    odometer_start=None,
    odometer_start_photo=None,
):
    """
    Start a Route Session for a salesperson at the beginning of their day.

    Parameters
    ----------
    salesperson           : str   – Sales Person name.
    route_assignment      : str   – Route Assignment for today.
    travel_mode           : str, optional – Company Van | Own Vehicle.
    vehicle               : str, optional – Route Vehicle name.
    start_lat             : float, optional – GPS latitude at session start.
    start_lng             : float, optional – GPS longitude at session start.
    odometer_start        : int,   optional – Odometer reading at start (km).
    odometer_start_photo  : str,   optional – File URL of odometer photo.

    Returns
    -------
    {
      "session":          str,
      "salesperson":      str,
      "route_assignment": str,
      "route":            str | null,
      "travel_mode":      str | null,
      "vehicle":          str | null,
      "start_time":       str,
      "total_customers":  int
    }
    """
    # ── Validate assignment belongs to salesperson and is today's ────────────
    salesperson = resolve_salesperson(salesperson)
    assignment = ensure_route_assignment_access(route_assignment)
    if assignment["salesperson"] != salesperson:
        frappe.throw(
            "Route Assignment does not belong to the requested salesperson.",
            frappe.PermissionError,
        )
    # ── Prevent duplicate or re-started session ──────────────────────────────
    existing_open = frappe.db.get_value(
        "Route Session",
        {"route_assignment": route_assignment, "end_time": ["is", "not set"]},
        "name",
    )
    if existing_open:
        # Idempotent: return the already-open session instead of throwing.
        # This handles network retries where the client never received the
        # original response but the session was already created.
        existing_session = frappe.get_doc("Route Session", existing_open)
        total_customers = 0
        if assignment.get("route"):
            total_customers = frappe.db.count("Route Customer", {"parent": assignment["route"]})
        return {
            "session":          existing_session.name,
            "salesperson":      existing_session.salesperson,
            "route_assignment": existing_session.route_assignment,
            "route":            assignment.get("route"),
            "travel_mode":      existing_session.travel_mode,
            "vehicle":          existing_session.vehicle,
            "start_time":       str(existing_session.start_time),
            "total_customers":  total_customers,
        }
    # ── Validate vehicle ──────────────────────────────────────────────────────
    vehicle = vehicle or assignment.get("vehicle")
    if vehicle and not frappe.db.exists("Route Vehicle", vehicle):
        frappe.throw(f"Vehicle '{vehicle}' not found.", frappe.DoesNotExistError)

    # ── Create session ────────────────────────────────────────────────────────
    session = frappe.get_doc({
        "doctype":               "Route Session",
        "salesperson":           salesperson,
        "route_assignment":      route_assignment,
        "route":                 assignment.get("route"),
        "start_time":            now_datetime(),
        "travel_mode":           travel_mode or assignment.get("travel_mode"),
        "vehicle":               vehicle,
        "start_lat":             start_lat,
        "start_lng":             start_lng,
        "odometer_start":        int(odometer_start) if odometer_start else None,
        "odometer_start_photo":  odometer_start_photo or None,
    })
    session.insert(ignore_permissions=True)
    frappe.db.commit()

    # ── Count customers on this route ─────────────────────────────────────────
    total_customers = 0
    if assignment.get("route"):
        total_customers = frappe.db.count(
            "Route Customer", {"parent": assignment["route"]}
        )

    return {
        "session":          session.name,
        "salesperson":      session.salesperson,
        "route_assignment": session.route_assignment,
        "route":            assignment.get("route"),
        "travel_mode":      session.travel_mode,
        "vehicle":          session.vehicle,
        "start_time":       str(session.start_time),
        "total_customers":  total_customers,
    }


@frappe.whitelist(methods=["POST"])
def end_session(
    route_session,
    end_lat=None,
    end_lng=None,
    odometer_end=None,
    odometer_end_photo=None,
):
    """
    End an active Route Session and return a day summary.

    Parameters
    ----------
    route_session       : str   – Route Session name.
    end_lat             : float, optional – GPS latitude at session end.
    end_lng             : float, optional – GPS longitude at session end.
    odometer_end        : int,   optional – Odometer reading at end (km).
    odometer_end_photo  : str,   optional – File URL of odometer photo.

    Returns
    -------
    {
      "session":       str,
      "salesperson":   str,
      "start_time":    str,
      "end_time":      str,
      "duration_hours": float,
      "summary": { ... }
    }
    """
    session = ensure_route_session_access(route_session)
    if session["end_time"]:
        # Already ended — return the existing summary instead of throwing
        return get_session_summary(route_session)

    end_time = now_datetime()

    # ── Stamp end_time + GPS + odometer if provided ───────────────────────────
    doc = frappe.get_doc("Route Session", route_session)
    doc.end_time = end_time
    if end_lat is not None:
        doc.end_lat = end_lat
    if end_lng is not None:
        doc.end_lng = end_lng
    if odometer_end is not None:
        doc.odometer_end = int(odometer_end)
    if odometer_end_photo:
        doc.odometer_end_photo = odometer_end_photo
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    # ── Build summary ─────────────────────────────────────────────────────────
    visits = frappe.db.get_all(
        "Route Visit",
        filters={"route_session": route_session},
        fields=["visit_status"],
    )
    vc = count_visits_by_status(visits)

    # Total customers on route
    route = session.get("route")
    total_customers = frappe.db.count("Route Customer", {"parent": route}) if route else 0

    # Invoices created during this session (via remarks link)
    inv_rows = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters={"remarks": ["like", f"%{route_session}%"], "docstatus": 1},
        fields=["grand_total", "outstanding_amount"],
    )
    total_billed    = sum(r["grand_total"] or 0 for r in inv_rows)
    total_collected = sum(
        (r["grand_total"] or 0) - (r["outstanding_amount"] or 0) for r in inv_rows
    )

    # Expenses
    exp_rows = frappe.db.get_all(
        "Salesperson Expense",
        filters={"route_session": route_session},
        fields=["amount"],
    )
    total_expenses = sum(r["amount"] or 0 for r in exp_rows)

    # Duration
    duration_hours = 0.0
    if session.get("start_time"):
        delta = end_time - session["start_time"]
        duration_hours = round(delta.total_seconds() / 3600, 2)

    return {
        "session":        route_session,
        "salesperson":    session["salesperson"],
        "start_time":     str(session["start_time"]),
        "end_time":       str(end_time),
        "duration_hours": duration_hours,
        "summary": {
            "total_customers":  total_customers,
            "visited":          vc["visited"],
            "skipped":          vc["skipped"],
            "closed":           vc["closed"],
            "pending":          max(0, total_customers - len(visits)),
            "invoices_created": len(inv_rows),
            "total_billed":     round_currency(total_billed),
            "total_collected":  round_currency(total_collected),
            "total_expenses":   round_currency(total_expenses),
        },
    }


@frappe.whitelist()
def get_session_summary(route_session):
    """
    Returns the full summary for any Route Session — open or closed.
    Useful for managers reviewing past sessions or salespersons
    checking their own day history.

    Parameters
    ----------
    route_session : str – Route Session name.

    Returns
    -------
    {
      "session", "salesperson", "route", "date",
      "start_time", "end_time", "duration_hours",
      "status": "Open" | "Closed",
      "travel_mode", "vehicle",
      "summary": {
        "total_customers", "visited", "skipped", "closed", "pending",
        "invoices_created", "total_billed", "total_collected",
        "total_expenses"
      },
      "visits": [
        { "customer", "customer_name", "visit_status",
          "checkin_time", "checkout_time", "duration_minutes" }
      ],
      "expenses": [
        { "name", "expense_type", "amount", "receipt", "notes" }
      ]
    }
    """
    session = ensure_route_session_access(route_session)

    # ── Route & date ──────────────────────────────────────────────────────────
    route = None
    date  = None
    if session.get("route_assignment"):
        ra = frappe.db.get_value(
            "Route Assignment",
            session["route_assignment"],
            ["route", "date"],
            as_dict=True,
        )
        if ra:
            route = ra["route"]
            date  = str(ra["date"])

    total_customers = frappe.db.count("Route Customer", {"parent": route}) if route else 0

    # ── Visit breakdown ───────────────────────────────────────────────────────
    visit_rows = frappe.db.get_all(
        "Route Visit",
        filters={"route_session": route_session},
        fields=["customer", "visit_status", "checkin_time", "checkout_time"],
        order_by="checkin_time asc",
    )
    vc = count_visits_by_status(visit_rows)

    # Enrich visits with customer name and duration
    cust_names = {
        r["customer"]: r["customer_name"]
        for r in frappe.db.get_all(
            DocType.CUSTOMER,
            filters={"name": ["in", [v["customer"] for v in visit_rows]]},
            fields=["name as customer", "customer_name"],
        )
    } if visit_rows else {}

    visits = []
    for v in visit_rows:
        duration = None
        if v.get("checkin_time") and v.get("checkout_time"):
            delta = v["checkout_time"] - v["checkin_time"]
            duration = round(delta.total_seconds() / 60, 1)
        visits.append({
            "customer":        v["customer"],
            "customer_name":   cust_names.get(v["customer"]),
            "visit_status":    v["visit_status"],
            "checkin_time":    str(v["checkin_time"])  if v.get("checkin_time")  else None,
            "checkout_time":   str(v["checkout_time"]) if v.get("checkout_time") else None,
            "duration_minutes": duration,
        })

    # ── Invoices ──────────────────────────────────────────────────────────────
    inv_rows = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters={"remarks": ["like", f"%{route_session}%"], "docstatus": 1},
        fields=["grand_total", "outstanding_amount"],
    )
    total_billed    = sum(r["grand_total"] or 0 for r in inv_rows)
    total_collected = sum(
        (r["grand_total"] or 0) - (r["outstanding_amount"] or 0) for r in inv_rows
    )

    # ── Expenses ──────────────────────────────────────────────────────────────
    exp_rows = frappe.db.get_all(
        "Salesperson Expense",
        filters={"route_session": route_session},
        fields=["name", "expense_type", "amount", "receipt", "notes"],
        order_by="creation asc",
    )
    total_expenses = sum(r["amount"] or 0 for r in exp_rows)

    # ── Duration ──────────────────────────────────────────────────────────────
    duration_hours = None
    if session["start_time"] and session["end_time"]:
        delta = session["end_time"] - session["start_time"]
        duration_hours = round(delta.total_seconds() / 3600, 2)

    return {
        "session":        route_session,
        "salesperson":    session["salesperson"],
        "route":          route,
        "date":           date,
        "start_time":     str(session["start_time"]) if session.get("start_time") else None,
        "end_time":       str(session["end_time"])   if session.get("end_time")   else None,
        "duration_hours": duration_hours,
        "status":         SessionStatus.CLOSED if session.get("end_time") else SessionStatus.OPEN,
        "travel_mode":    session["travel_mode"],
        "vehicle":        session["vehicle"],
        "summary": {
            "total_customers":  total_customers,
            "visited":          vc["visited"],
            "skipped":          vc["skipped"],
            "closed":           vc["closed"],
            "pending":          max(0, total_customers - len(visit_rows)),
            "invoices_created": len(inv_rows),
            "total_billed":     round_currency(total_billed),
            "total_collected":  round_currency(total_collected),
            "total_expenses":   round_currency(total_expenses),
        },
        "visits":   visits,
        "expenses": [
            {
                "name":         r["name"],
                "expense_type": r["expense_type"],
                "amount":       r["amount"],
                "receipt":      r["receipt"],
                "notes":        r["notes"],
            }
            for r in exp_rows
        ],
    }


@frappe.whitelist()
def get_recent_sessions(salesperson=None, limit=5):
    salesperson = resolve_salesperson(salesperson)
    filters = {"docstatus": ["!=", 2]}
    if salesperson:
        filters["salesperson"] = salesperson
    elif not is_manager():
        salesperson = current_salesperson(required=True)
        filters["salesperson"] = salesperson

    rows = frappe.db.get_all(
        "Route Session",
        filters=filters,
        fields=["name", "salesperson", "route_assignment", "start_time", "end_time"],
        order_by="start_time desc, creation desc",
        limit_page_length=paginate(1, limit, max_page_length=20)[1],
    )

    # Batch-fetch assignments and route names to avoid N+1
    assignment_ids = list({row["route_assignment"] for row in rows if row.get("route_assignment")})
    assignment_route_map = {}
    if assignment_ids:
        assignment_route_map = {
            r["name"]: r["route"]
            for r in frappe.db.get_all(
                "Route Assignment",
                filters={"name": ["in", assignment_ids]},
                fields=["name", "route"],
            )
        }

    route_ids = list({r for r in assignment_route_map.values() if r})
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

    sessions = []
    for row in rows:
        route      = assignment_route_map.get(row.get("route_assignment"))
        route_name = route_name_map.get(route) or route if route else None
        sessions.append({
            "name":        row["name"],
            "salesperson": row["salesperson"],
            "route":       route,
            "route_name":  route_name,
            "start_time":  str(row["start_time"]) if row.get("start_time") else None,
            "end_time":    str(row["end_time"])    if row.get("end_time")    else None,
        })

    return sessions


@frappe.whitelist(methods=["POST"])
def upload_odometer_photo():
    """
    Upload an odometer photo file. Expects a multipart/form-data request
    with a 'file' field. Returns the public file URL.
    """
    from route_sales.api.security import require_login
    require_login()

    if "file" not in frappe.request.files:
        frappe.throw("No file provided.", frappe.ValidationError)

    uploaded = frappe.request.files["file"]
    file_doc = frappe.get_doc({
        "doctype":    "File",
        "file_name":  uploaded.filename,
        "content":    uploaded.read(),
        "is_private": 0,
    })
    file_doc.save(ignore_permissions=True)
    frappe.db.commit()
    return {"file_url": file_doc.file_url}


@frappe.whitelist()
def get_vehicles():
    """Return Route Vehicles not currently assigned to an active session."""
    from route_sales.api.security import require_login
    require_login()
    in_use_rows = frappe.db.get_all(
        "Route Session",
        filters={"end_time": ["is", "not set"], "vehicle": ["not in", ["", None]]},
        fields=["vehicle"],
        distinct=True,
    )
    in_use_names = {r["vehicle"] for r in in_use_rows}
    all_vehicles = frappe.db.get_all("Route Vehicle", fields=["name"], order_by="name asc")
    return [v for v in all_vehicles if v["name"] not in in_use_names]
