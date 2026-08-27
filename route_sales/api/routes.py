"""
route_sales.api.routes
======================
GET  /api/method/route_sales.api.routes.get_today_route
"""

import frappe
from frappe.utils import today
from route_sales.api.security import get_current_route_for_salesperson, is_manager, resolve_salesperson
from route_sales.api.constants import DocType


@frappe.whitelist()
def get_today_route(salesperson=None):
    """
    Returns today's route assignment for the given salesperson,
    including the ordered customer list and per-customer visit status.

    Parameters
    ----------
    salesperson : str, optional
        Sales Person name.  Falls back to the Sales Person linked to
        the currently logged-in Employee if omitted.

    Response shape
    --------------
    {
      "assignment": { name, date, vehicle, travel_mode },
      "route":      { name, route_name, territory },
      "session":    { name, start_time, end_time } | null,
      "customers": [
        {
          "sequence": int,
          "customer": str,
          "customer_name": str,
          "mobile_no": str,
          "primary_address": str,
          "visit_status": str | null,
          "checkin_time":  str | null,
          "checkout_time": str | null
        },
        ...
      ]
    }
    """
    salesperson = resolve_salesperson(salesperson)
    if not salesperson:
        if is_manager():
            return {
                "assignment": None,
                "route": None,
                "session": None,
                "customers": [],
                "admin_view": True,
            }
        frappe.throw("Salesperson not found for the current user.", frappe.DoesNotExistError)

    # ── 1. Current assignment ─────────────────────────────────────────────────
    # Assignment persists until the salesperson ends their session or the admin
    # manually unassigns — not tied to date. Check for an open session first,
    # then fall back to the latest non-cancelled assignment.
    assignment = get_current_route_for_salesperson(salesperson)["assignment"]
    if not assignment:
        return {
            "assignment": None,
            "route":      None,
            "session":    None,
            "customers":  [],
        }

    # ── 2. Route details ──────────────────────────────────────────────────────
    route = frappe.db.get_value(
        "Sales Route",
        assignment["route"],
        ["name", "route_name", "territory"],
        as_dict=True,
    ) if assignment.get("route") else None

    # ── 3. Active / latest session for this assignment ────────────────────────
    session = frappe.db.get_value(
        "Route Session",
        {"route_assignment": assignment["name"]},
        ["name", "start_time", "end_time", "travel_mode", "vehicle"],
        as_dict=True,
        order_by="creation desc",
    )

    # ── 4. Customers on the route (ordered by sequence) ───────────────────────
    customers = []
    if assignment.get("route"):
        route_customers = frappe.db.get_all(
            "Route Customer",
            filters={"parent": assignment["route"]},
            fields=["customer", "sequence"],
            order_by="sequence asc",
        )

        # Fetch visit records for this session (if any) in one query
        visit_map = {}
        if session:
            visits = frappe.db.get_all(
                "Route Visit",
                filters={"route_session": session["name"]},
                fields=["customer", "visit_status", "checkin_time", "checkout_time"],
            )
            visit_map = {v["customer"]: v for v in visits}

        # Batch-fetch all customer CRM fields in one query
        customer_ids = [rc["customer"] for rc in route_customers]
        cust_rows = frappe.db.get_all(
            DocType.CUSTOMER,
            filters={"name": ["in", customer_ids]},
            fields=["name", "customer_name", "mobile_no", "address_line1", "city",
                    "district", "state", "pincode", "latitude", "longitude"],
        )
        cust_map = {c["name"]: c for c in cust_rows}

        for rc in route_customers:
            cust = cust_map.get(rc["customer"]) or {}

            parts = [cust.get("address_line1"), cust.get("city"), cust.get("district"), cust.get("state")]
            address_text = ", ".join(p for p in parts if p) or None

            visit = visit_map.get(rc["customer"], {})
            customers.append({
                "sequence":      rc["sequence"],
                "customer":      rc["customer"],
                "customer_name": cust.get("customer_name"),
                "mobile_no":     cust.get("mobile_no"),
                "address":       address_text,
                "lat":           float(cust["latitude"])  if cust.get("latitude")  else None,
                "lng":           float(cust["longitude"]) if cust.get("longitude") else None,
                "visit_status":  visit.get("visit_status"),
                "checkin_time":  str(visit["checkin_time"]) if visit.get("checkin_time") else None,
                "checkout_time": str(visit["checkout_time"]) if visit.get("checkout_time") else None,
            })

    return {
        "assignment": assignment,
        "route":      route,
        "session":    session,
        "customers":  customers,
        "admin_view": False,
    }
