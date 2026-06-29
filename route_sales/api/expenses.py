"""
route_sales.api.expenses
========================
POST /api/method/route_sales.api.expenses.submit_expense
"""

import frappe
from route_sales.api.security import current_employee, ensure_route_session_access, is_manager


VALID_EXPENSE_TYPES = {"Fuel", "Food", "Toll", "Parking"}


@frappe.whitelist(methods=["POST"])
def submit_expense(
    employee,
    expense_type,
    amount,
    route_session=None,
    receipt=None,
    notes=None,
):
    """
    Submit a field expense incurred by a salesperson during a route session.

    Parameters
    ----------
    employee      : str   – Employee name (e.g. "HR-EMP-00001").
    expense_type  : str   – Fuel | Food | Toll | Parking.
    amount        : float – Expense amount (must be > 0).
    route_session : str, optional – Route Session the expense belongs to.
    receipt       : str, optional – Attached file URL (from File Manager).
    notes         : str, optional – Free-text notes.

    Returns
    -------
    {
      "expense":      str,   ← Salesperson Expense name
      "employee":     str,
      "expense_type": str,
      "amount":       float,
      "route_session": str | null,
      "receipt":      str | null
    }
    """
    amount = float(amount)

    # ── Validations ───────────────────────────────────────────────────────────
    if expense_type not in VALID_EXPENSE_TYPES:
        frappe.throw(
            f"Invalid expense_type '{expense_type}'. "
            f"Must be one of: {', '.join(sorted(VALID_EXPENSE_TYPES))}.",
            frappe.ValidationError,
        )

    if amount <= 0:
        frappe.throw("Amount must be greater than 0.", frappe.ValidationError)

    current = current_employee(required=not is_manager())
    if not is_manager() and employee != current:
        frappe.throw("You cannot submit expenses for another employee.", frappe.PermissionError)

    if not frappe.db.exists("Employee", employee):
        frappe.throw(f"Employee '{employee}' not found.", frappe.DoesNotExistError)

    if route_session:
        session = ensure_route_session_access(route_session)
        session_end = session.get("end_time")
        if session_end:
            frappe.throw(
                "Cannot submit expense: Route Session has already ended.",
                frappe.ValidationError,
            )

    # ── Create expense ────────────────────────────────────────────────────────
    expense = frappe.get_doc({
        "doctype":       "Salesperson Expense",
        "employee":      employee,
        "expense_type":  expense_type,
        "amount":        amount,
        "route_session": route_session,
        "receipt":       receipt,
        "notes":         notes,
    })
    expense.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "expense":       expense.name,
        "employee":      expense.employee,
        "expense_type":  expense.expense_type,
        "amount":        expense.amount,
        "route_session": expense.route_session,
        "receipt":       expense.receipt,
    }


@frappe.whitelist()
def get_expense_list(employee=None, route_session=None, limit=20):
    current = current_employee(required=not is_manager())
    employee = employee or current
    if not is_manager() and employee != current:
        frappe.throw("You cannot view another employee's expenses.", frappe.PermissionError)

    filters = {"employee": employee}
    if route_session:
        ensure_route_session_access(route_session)
        filters["route_session"] = route_session

    rows = frappe.db.get_all(
        "Salesperson Expense",
        filters=filters,
        fields=["name", "expense_type", "amount", "notes", "receipt", "creation"],
        order_by="creation desc",
        limit_page_length=max(1, min(100, int(limit))),
    )
    return [
        {
            "name": row["name"],
            "type": row["expense_type"],
            "amount": row["amount"],
            "notes": row["notes"],
            "receipt": row["receipt"],
            "time": str(row["creation"]),
        }
        for row in rows
    ]
