import frappe
from frappe.utils import today
from route_sales.api.constants import RoleName


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


def customer_on_salesperson_route(customer, salesperson):
    """Check if customer is on the salesperson's current active assignment."""
    if not salesperson:
        return False

    # Prefer the route stored directly on the open session (1 query)
    route = frappe.db.get_value(
        "Route Session",
        {"salesperson": salesperson, "end_time": ["is", "not set"]},
        "route",
        order_by="creation desc",
    )
    if not route:
        # Fall back to most recent assignment (no open session today)
        route = frappe.db.get_value(
            "Route Assignment",
            {"salesperson": salesperson, "docstatus": ["!=", 2]},
            "route",
            order_by="date desc",
        )
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
