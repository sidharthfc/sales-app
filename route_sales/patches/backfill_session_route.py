"""
Patch: backfill_session_route
Populates the new `route` field on all existing Route Session records.

The field is derived from route_assignment → Route Assignment.route.
New sessions will have this set at creation time; this patch handles historical data.
"""
import frappe


def execute():
    sessions = frappe.db.get_all(
        "Route Session",
        filters={"route": ["is", "not set"]},
        fields=["name", "route_assignment"],
    )
    if not sessions:
        return

    # Batch-fetch all assignments needed
    assignment_names = list({s["route_assignment"] for s in sessions if s.get("route_assignment")})
    route_map = {}
    if assignment_names:
        rows = frappe.db.get_all(
            "Route Assignment",
            filters={"name": ["in", assignment_names]},
            fields=["name", "route"],
        )
        route_map = {r["name"]: r["route"] for r in rows}

    updated = 0
    for session in sessions:
        route = route_map.get(session.get("route_assignment"))
        if route:
            frappe.db.set_value("Route Session", session["name"], "route", route, update_modified=False)
            updated += 1

    frappe.db.commit()
    print(f"Backfilled route on {updated} Route Session records.")
