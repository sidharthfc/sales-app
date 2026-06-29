"""
route_sales.api.auth
====================
POST /api/method/route_sales.api.auth.mobile_login

Stateless login for the mobile app.
Returns API key + secret so the app never needs session cookies.
"""

import frappe
from frappe.utils.password import check_password
from route_sales.api.security import get_user_context, get_user_context_for_user, require_login
from route_sales.api.utils import get_active_session


@frappe.whitelist(allow_guest=True, methods=["POST"])
def mobile_login(usr, pwd):
    """
    Authenticate with username/password and return a permanent API token.
    The mobile app stores this as:
        Authorization: token <api_key>:<api_secret>
    """
    if not usr or not pwd:
        frappe.throw("Username and password are required.", frappe.AuthenticationError)

    # Resolve to email (supports both email and username login)
    email = (
        frappe.db.get_value("User", {"name": usr}, "name") or
        frappe.db.get_value("User", {"username": usr}, "name")
    )
    if not email:
        frappe.throw("Invalid credentials.", frappe.AuthenticationError)

    # Verify password
    try:
        check_password(email, pwd)
    except frappe.AuthenticationError:
        frappe.throw("Invalid credentials.", frappe.AuthenticationError)

    # Check user is enabled
    if not frappe.db.get_value("User", email, "enabled"):
        frappe.throw("User account is disabled.", frappe.AuthenticationError)

    # Generate API key + secret directly (bypass System Manager check)
    api_key    = frappe.generate_hash(length=15)
    api_secret = frappe.generate_hash(length=15)

    user_doc = frappe.get_doc("User", email)
    user_doc.api_key    = api_key
    user_doc.api_secret = api_secret   # Frappe Password field — encrypted on save
    user_doc.save(ignore_permissions=True)
    frappe.db.commit()

    context = get_user_context_for_user(email)

    return {
        "api_key":    api_key,
        "api_secret": api_secret,
        "full_name":  user_doc.full_name,
        "email":      email,
        "employee":   context["employee"],
        "code":       context["code"],
        "salesperson": context["salesperson"],
        "territory":  context["territory"],
        "roles":      context["roles"],
        "is_admin":   context["is_admin"],
    }


@frappe.whitelist()
def get_bootstrap():
    require_login()
    context = get_user_context()

    # Include the active route session so the app can restore state on startup
    # without requiring the user to visit the Routes page first.
    active_session = None
    salesperson = context.get("salesperson")
    if salesperson:
        session_row = get_active_session(salesperson)
        if session_row:
            route = session_row.get("route")
            total_customers = frappe.db.count("Route Customer", {"parent": route}) if route else 0
            active_session = {
                "name":            session_row["name"],
                "start_time":      str(session_row["start_time"]),
                "route":           route,
                "total_customers": total_customers,
            }

    return {**context, "active_session": active_session}


@frappe.whitelist(methods=["POST"])
def revoke_api_credentials():
    require_login()

    user = frappe.get_doc("User", frappe.session.user)
    user.api_key = None
    user.api_secret = None
    user.save(ignore_permissions=True)
    frappe.db.commit()

    return {"status": "revoked"}
