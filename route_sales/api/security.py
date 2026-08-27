import frappe
from frappe.utils import today
from route_sales.api.constants import RoleName
from route_sales.api.utils import get_active_session


MANAGER_ROLES = {RoleName.SYSTEM_MANAGER, RoleName.ROUTE_SALES_MANAGER}


def require_login():
    if frappe.session.user == "Guest":
        frappe.throw("Authentication required.", frappe.AuthenticationError)


def _build_user_context(user):
    roles = frappe.get_roles(user)
    employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
    salesperson = (
        frappe.db.get_value("Sales Person", {"employee": employee}, "name")
        if employee else None
    )

    territory = None
    if salesperson:
        territory = frappe.db.get_value(
            "Route Assignment",
            {"salesperson": salesperson, "docstatus": ["!=", 2]},
            "route",
            order_by="date desc",
        )
        if territory:
            territory = frappe.db.get_value("Sales Route", territory, "territory")

    return {
        "email": user,
        "full_name": frappe.db.get_value("User", user, "full_name") or user,
        "employee": employee,
        "code": employee,
        "salesperson": salesperson,
        "territory": territory,
        "roles": roles,
        "is_admin": any(role in MANAGER_ROLES for role in roles) or user == "Administrator",
    }


def get_user_context():
    require_login()
    return _build_user_context(frappe.session.user)


def get_user_context_for_user(user):
    return _build_user_context(user)


def is_manager(user=None):
    user = user or frappe.session.user
    if user == "Administrator":
        return True
    return any(role in MANAGER_ROLES for role in frappe.get_roles(user))


def only_manager():
    """Raise PermissionError if the current user is not a manager."""
    require_login()
    if not is_manager():
        frappe.throw("Manager access required.", frappe.PermissionError)


def _get_salesperson_for_user(user):
    """Return the Sales Person name linked to a user (via Employee), or None."""
    employee = frappe.db.get_value("Employee", {"user_id": user}, "name")
    if not employee:
        return None
    return frappe.db.get_value("Sales Person", {"employee": employee}, "name")


def current_salesperson(required=False):
    """
    Return the Sales Person name for the logged-in user.
    Uses a lightweight 2-query lookup instead of the full user context.
    """
    require_login()
    salesperson = _get_salesperson_for_user(frappe.session.user)
    if required and not salesperson and not is_manager():
        frappe.throw("Salesperson not found for current user.", frappe.DoesNotExistError)
    return salesperson


def current_employee(required=False):
    """Return the Employee name for the logged-in user, or None."""
    require_login()
    employee = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
    if required and not employee and not is_manager():
        frappe.throw("Employee not found for current user.", frappe.DoesNotExistError)
    return employee


def resolve_salesperson(salesperson=None, allow_manager_override=True):
    """
    Resolve which salesperson to use for the current request.
    Managers may pass any salesperson (or omit to use their own).
    Non-managers may only access their own salesperson record.
    """
    current = current_salesperson(required=not is_manager())
    if is_manager() and allow_manager_override:
        return salesperson or current
    if salesperson and salesperson != current:
        frappe.throw("You cannot access another salesperson's data.", frappe.PermissionError)
    return current


def ensure_salesperson_match(salesperson):
    """Resolve and validate the salesperson, raising if none can be determined."""
    resolved = resolve_salesperson(salesperson)
    if not resolved:
        frappe.throw("Salesperson not found for current user.", frappe.DoesNotExistError)
    return resolved


def get_route_assignment(route_assignment):
    assignment = frappe.db.get_value(
        "Route Assignment",
        route_assignment,
        ["name", "salesperson", "date", "route", "vehicle", "travel_mode"],
        as_dict=True,
    )
    if not assignment:
        frappe.throw(
            f"Route Assignment '{route_assignment}' not found.",
            frappe.DoesNotExistError,
        )
    return assignment


def ensure_route_assignment_access(route_assignment):
    assignment = get_route_assignment(route_assignment)
    ensure_salesperson_match(assignment["salesperson"])
    return assignment


def get_route_session(route_session):
    session = frappe.db.get_value(
        "Route Session",
        route_session,
        [
            "name",
            "salesperson",
            "route_assignment",
            "route",
            "start_time",
            "end_time",
            "start_lat",
            "start_lng",
            "end_lat",
            "end_lng",
            "travel_mode",
            "vehicle",
        ],
        as_dict=True,
    )
    if not session:
        frappe.throw(f"Route Session '{route_session}' not found.", frappe.DoesNotExistError)
    return session


def ensure_route_session_access(route_session):
    session = get_route_session(route_session)
    ensure_salesperson_match(session["salesperson"])
    return session


def get_current_route_for_salesperson(salesperson, with_assignment=True):
    """
    Resolve the currently active route for a salesperson.

    Preference order (mirrors the app's "assignment persists until the
    session ends or admin unassigns" model):
      1. The Route Assignment linked to the salesperson's open Route Session.
      2. The salesperson's latest non-cancelled Route Assignment.

    Parameters
    ----------
    salesperson     : str
    with_assignment : bool, optional – When False (default True), skip
                      fetching the full Route Assignment doc if an open
                      session already gives us the route directly (1 query
                      instead of 2). Use this when only the route name is
                      needed. "assignment" will be None in that fast path
                      even though a Route Assignment does exist.

    Returns
    -------
    dict with keys:
      "route"      : str  | None  – Sales Route name.
      "assignment" : dict | None  – {name, salesperson, date, route, vehicle, travel_mode}
                                     (None on the with_assignment=False fast path
                                     when an open session already resolved the route).
      "session"    : dict | None  – the open Route Session, if any
                                     ({name, start_time, route_assignment, route}).
    """
    if not salesperson:
        return {"route": None, "assignment": None, "session": None}

    session = get_active_session(salesperson)

    # Fast path: an open session already carries the route (1 query total).
    if session and session.get("route") and not with_assignment:
        return {"route": session["route"], "assignment": None, "session": session}

    assignment = None
    if session and session.get("route_assignment"):
        assignment = frappe.db.get_value(
            "Route Assignment",
            session["route_assignment"],
            ["name", "salesperson", "date", "route", "vehicle", "travel_mode"],
            as_dict=True,
        )

    if not assignment:
        # No open session (or its assignment link is missing) — fall back to
        # the most recent non-cancelled assignment for this salesperson.
        assignment = frappe.db.get_value(
            "Route Assignment",
            {"salesperson": salesperson, "docstatus": ["!=", 2]},
            ["name", "salesperson", "date", "route", "vehicle", "travel_mode"],
            as_dict=True,
            order_by="date desc",
        )

    route = assignment["route"] if assignment else (session["route"] if session else None)

    return {"route": route, "assignment": assignment, "session": session}


def customer_on_salesperson_route(customer, salesperson):
    """Check if customer is on the salesperson's current active assignment."""
    if not salesperson:
        return False

    # Prefer the route stored directly on the open session (1 query).
    route = get_current_route_for_salesperson(salesperson, with_assignment=False)["route"]
    if not route:
        return False

    return bool(frappe.db.exists("Route Customer", {"parent": route, "customer": customer}))


def customer_ever_on_salesperson_route(customer, salesperson):
    """Check if customer is on ANY route ever assigned to this salesperson (used for read-only operations)."""
    if not salesperson:
        return False

    assignments = frappe.db.get_all(
        "Route Assignment",
        filters={"salesperson": salesperson, "docstatus": ["!=", 2]},
        fields=["route"],
        distinct=True,
    )
    route_names = [a["route"] for a in assignments if a.get("route")]
    if not route_names:
        return False

    return bool(frappe.db.exists("Route Customer", {"parent": ["in", route_names], "customer": customer}))


def assert_customer_access(customer, salesperson=None):
    """Strict access check: customer must be on the salesperson's current active route. Use for write operations."""
    require_login()
    if is_manager():
        return customer

    resolved = resolve_salesperson(salesperson)
    if not customer_on_salesperson_route(customer, resolved):
        frappe.throw(
            f"Customer '{customer}' is not on your assigned route for today.",
            frappe.PermissionError,
        )
    return customer


def assert_customer_readonly_access(customer, salesperson=None):
    """Relaxed check — customer must be on ANY route ever assigned to this salesperson. Use for read-only operations."""
    require_login()
    if is_manager():
        return customer

    resolved = resolve_salesperson(salesperson)
    if not customer_ever_on_salesperson_route(customer, resolved):
        frappe.throw(
            f"Customer '{customer}' is not assigned to your routes.",
            frappe.PermissionError,
        )
    return customer


def assert_customer_in_session(customer, route_session):
    session = ensure_route_session_access(route_session)
    route = session.get("route")
    if route and not frappe.db.exists("Route Customer", {"parent": route, "customer": customer}):
        frappe.throw(
            f"Customer '{customer}' is not on route '{route}'.",
            frappe.PermissionError,
        )
    return session
