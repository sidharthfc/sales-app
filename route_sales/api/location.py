"""
route_sales.api.location
========================
POST /api/method/route_sales.api.location.update_location
GET  /api/method/route_sales.api.location.get_live_locations
"""

import frappe
from frappe.utils import now_datetime, today
from route_sales.api.security import (
    ensure_route_session_access,
    get_salesperson_display_name,
    get_user_context,
    only_manager,
)
from route_sales.api.constants import LIVE_LOCATION_TTL
from route_sales.api.utils import live_location_cache_key


@frappe.whitelist()
def update_location(lat, lng, session_name=None, accuracy=None):
    """
    Called by the salesperson app every ~30 seconds to report GPS position.
    Stores in Frappe Redis cache keyed by salesperson (5 min TTL).
    """
    context = get_user_context()
    salesperson = context.get("salesperson")
    if not salesperson:
        frappe.throw("No salesperson linked to this user.")

    if session_name:
        session = ensure_route_session_access(session_name)
        if session.get("salesperson") != salesperson:
            frappe.throw("Location updates are only allowed for your active session.")
        if session.get("end_time"):
            frappe.throw("Cannot update location for a closed session.")

    sp_name = get_salesperson_display_name(salesperson)

    data = {
        "salesperson":      salesperson,
        "salesperson_name": sp_name,
        "lat":              float(lat),
        "lng":              float(lng),
        "accuracy":         float(accuracy) if accuracy else None,
        "session":          session_name,
        "timestamp":        str(now_datetime()),
    }
    frappe.cache().set_value(live_location_cache_key(salesperson), data, expires_in_sec=LIVE_LOCATION_TTL)
    return {"status": "ok"}


@frappe.whitelist()
def get_live_locations():
    """
    Admin endpoint — returns latest GPS position for all salespersons
    who have an active session today (no end_time).
    """
    only_manager()

    active_sessions = frappe.db.get_all(
        "Route Session",
        filters={
            "start_time": ["between", [f"{today()} 00:00:00", f"{today()} 23:59:59"]],
            "end_time": ["is", "not set"],
        },
        fields=["name", "salesperson"],
    )

    sp_rows = frappe.db.get_all("Sales Person", fields=["name", "sales_person_name"])
    sp_map  = {s["name"]: s["sales_person_name"] for s in sp_rows}

    result = []
    for sess in active_sessions:
        sp  = sess["salesperson"]
        loc = frappe.cache().get_value(live_location_cache_key(sp))
        result.append({
            "salesperson":      sp,
            "salesperson_name": sp_map.get(sp, sp),
            "session":          sess["name"],
            "lat":              loc["lat"]       if loc else None,
            "lng":              loc["lng"]       if loc else None,
            "accuracy":         loc.get("accuracy") if loc else None,
            "timestamp":        loc["timestamp"] if loc else None,
            "has_location":     bool(loc),
        })

    return result
