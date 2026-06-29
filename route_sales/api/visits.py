"""
route_sales.api.visits
======================
POST /api/method/route_sales.api.visits.checkin_customer
POST /api/method/route_sales.api.visits.checkout_customer
POST /api/method/route_sales.api.visits.skip_customer
"""

import frappe
from frappe.utils import now_datetime
from route_sales.api.security import assert_customer_in_session, ensure_route_session_access
from route_sales.api.constants import VisitStatus


@frappe.whitelist(methods=["POST"])
def checkin_customer(route_session, customer, gps_lat=None, gps_lng=None):
    """
    Check in a salesperson at a customer location during an active session.

    Creates a Route Visit with visit_status = "Visited" and checkin_time = now.
    If a visit already exists for this session + customer (e.g. a duplicate tap),
    the existing record is returned unchanged.

    Parameters
    ----------
    route_session : str
        Name of the active Route Session.
    customer : str
        Customer name to check in at.
    gps_lat : float, optional
    gps_lng : float, optional

    Returns
    -------
    {
      "visit": { name, customer, visit_status, checkin_time, gps_lat, gps_lng },
      "created": bool   ← False if the visit already existed
    }
    """
    # ── Validate session exists and is open ───────────────────────────────────
    session = ensure_route_session_access(route_session)
    if session.get("end_time"):
        frappe.throw("Cannot check in: this session has already ended.")

    # ── Validate customer is on this route ────────────────────────────────────
    assert_customer_in_session(customer, route_session)

    # ── Idempotency: return existing visit if already checked in ──────────────
    existing = frappe.db.get_value(
        "Route Visit",
        {"route_session": route_session, "customer": customer},
        ["name", "customer", "visit_status", "checkin_time", "checkout_time",
         "gps_lat", "gps_lng"],
        as_dict=True,
    )
    if existing:
        return {"visit": _format_visit(existing), "created": False}

    # ── Create the visit ──────────────────────────────────────────────────────
    visit = frappe.get_doc({
        "doctype":      "Route Visit",
        "route_session": route_session,
        "customer":     customer,
        "visit_status": VisitStatus.VISITED,
        "checkin_time": now_datetime(),
        "gps_lat":      gps_lat,
        "gps_lng":      gps_lng,
    })
    visit.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"visit": _format_visit(visit.as_dict()), "created": True}


@frappe.whitelist(methods=["POST"])
def checkout_customer(route_session, customer, visit_status="Visited"):
    """
    Check out a salesperson from a customer visit, marking it complete.

    Sets checkout_time = now on the existing Route Visit.
    visit_status can be overridden to "Skipped" or "Closed" if needed.

    Parameters
    ----------
    route_session : str
        Name of the active Route Session.
    customer : str
        Customer name to check out from.
    visit_status : str, optional
        Final status for the visit. One of: Visited | Skipped | Closed.
        Defaults to "Visited".

    Returns
    -------
    {
      "visit": { name, customer, visit_status, checkin_time, checkout_time,
                 gps_lat, gps_lng },
      "duration_minutes": float | null
    }
    """
    _VALID_STATUSES = {VisitStatus.VISITED, VisitStatus.SKIPPED, VisitStatus.CLOSED}
    if visit_status not in _VALID_STATUSES:
        frappe.throw(
            f"Invalid visit_status '{visit_status}'. Must be one of: {', '.join(_VALID_STATUSES)}.",
            frappe.ValidationError,
        )

    # ── Validate session is open ──────────────────────────────────────────────
    session = ensure_route_session_access(route_session)
    session_end = session.get("end_time")
    if session_end:
        frappe.throw("Cannot check out: this session has already ended.")

    # ── Find the open visit ───────────────────────────────────────────────────
    visit_name = frappe.db.get_value(
        "Route Visit",
        {"route_session": route_session, "customer": customer},
        "name",
    )
    if not visit_name:
        frappe.throw(
            f"No check-in found for customer '{customer}' in session '{route_session}'. "
            "Please check in first.",
            frappe.DoesNotExistError,
        )

    visit = frappe.get_doc("Route Visit", visit_name)

    if visit.checkout_time:
        # Already checked out — return as-is (idempotent)
        return {
            "visit":             _format_visit(visit.as_dict()),
            "duration_minutes":  _duration(visit.checkin_time, visit.checkout_time),
        }

    # ── Apply checkout ────────────────────────────────────────────────────────
    now = now_datetime()
    visit.checkout_time = now
    visit.visit_status  = visit_status
    visit.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "visit":            _format_visit(visit.as_dict()),
        "duration_minutes": _duration(visit.checkin_time, now),
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _format_visit(v):
    return {
        "name":          v.get("name"),
        "customer":      v.get("customer"),
        "visit_status":  v.get("visit_status"),
        "checkin_time":  str(v["checkin_time"]) if v.get("checkin_time") else None,
        "checkout_time": str(v["checkout_time"]) if v.get("checkout_time") else None,
        "gps_lat":       v.get("gps_lat"),
        "gps_lng":       v.get("gps_lng"),
    }


@frappe.whitelist(methods=["POST"])
def skip_customer(route_session, customer, reason=None):
    """
    Mark a customer as Skipped without requiring a prior check-in.

    Creates a Route Visit with visit_status = "Skipped" and only
    checkin_time set (= now), leaving checkout_time null.
    If a visit already exists for this session + customer, its status
    is updated to "Skipped" instead of creating a duplicate.

    Parameters
    ----------
    route_session : str  – Active Route Session name.
    customer      : str  – Customer to skip.
    reason        : str, optional – Reason for skipping (stored in a note
                                    on the visit via frappe comments).

    Returns
    -------
    {
      "visit":   { name, customer, visit_status, checkin_time },
      "created": bool   ← False if visit already existed and was updated
    }
    """
    # ── Validate session is open ──────────────────────────────────────────────
    session = ensure_route_session_access(route_session)
    session_end = session.get("end_time")
    if session_end:
        frappe.throw(
            "Cannot skip customer: Route Session has already ended.",
            frappe.ValidationError,
        )

    # ── Validate customer is on this route ────────────────────────────────────
    assert_customer_in_session(customer, route_session)

    created = False
    existing_name = frappe.db.get_value(
        "Route Visit",
        {"route_session": route_session, "customer": customer},
        "name",
    )

    if existing_name:
        # Update existing visit to Skipped
        frappe.db.set_value("Route Visit", existing_name, "visit_status", VisitStatus.SKIPPED)
        visit_doc = frappe.get_doc("Route Visit", existing_name)
    else:
        # Create new skip record
        visit_doc = frappe.get_doc({
            "doctype":       "Route Visit",
            "route_session": route_session,
            "customer":      customer,
            "visit_status":  VisitStatus.SKIPPED,
            "checkin_time":  now_datetime(),
        })
        visit_doc.insert(ignore_permissions=True)
        created = True

    if reason:
        frappe.get_doc({
            "doctype":       "Comment",
            "comment_type":  "Comment",
            "reference_doctype": "Route Visit",
            "reference_name":    visit_doc.name,
            "content":       f"Skip reason: {reason}",
        }).insert(ignore_permissions=True)

    frappe.db.commit()

    return {
        "visit": {
            "name":         visit_doc.name,
            "customer":     visit_doc.customer,
            "visit_status": visit_doc.visit_status,
            "checkin_time": str(visit_doc.checkin_time) if visit_doc.checkin_time else None,
        },
        "created": created,
    }


def _duration(checkin, checkout):
    """Return visit duration in minutes, or None if either time is missing."""
    if not checkin or not checkout:
        return None
    try:
        delta = checkout - checkin
        return round(delta.total_seconds() / 60, 1)
    except TypeError:
        return None
