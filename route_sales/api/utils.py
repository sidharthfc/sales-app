"""
route_sales.api.utils
=====================
Shared utility functions used across API modules.
"""

import frappe
from route_sales.api.constants import DocType


def round_currency(value):
    """Round a monetary value to 2 decimal places."""
    return round(float(value or 0), 2)


def get_active_session(salesperson, fields=None):
    """
    Return the open Route Session for a salesperson, or None.

    Parameters
    ----------
    salesperson : str
    fields      : list, optional – Fields to fetch. Defaults to
                  ["name", "start_time", "route_assignment"].
    """
    _fields = fields or ["name", "start_time", "route_assignment", "route"]
    return frappe.db.get_value(
        "Route Session",
        {"salesperson": salesperson, "end_time": ["is", "not set"]},
        _fields,
        as_dict=True,
        order_by="creation desc",
    )


def count_visits_by_status(visits):
    """
    Aggregate visit status counts from a list of visit dicts.

    Parameters
    ----------
    visits : list of dicts with a "visit_status" key

    Returns
    -------
    {"visited": int, "skipped": int, "closed": int, "total": int}
    """
    from route_sales.api.constants import VisitStatus
    counts = {"visited": 0, "skipped": 0, "closed": 0, "total": len(visits)}
    for v in visits:
        s = v.get("visit_status")
        if s == VisitStatus.VISITED:
            counts["visited"] += 1
        elif s == VisitStatus.SKIPPED:
            counts["skipped"] += 1
        elif s == VisitStatus.CLOSED:
            counts["closed"] += 1
    return counts


def get_customer_invoice_summary(customer_ids):
    """
    Batch-fetch outstanding invoice totals for a list of customers.

    Returns
    -------
    { customer_id: {"total_outstanding": float, "invoice_count": int} }
    """
    if not customer_ids:
        return {}
    rows = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters={
            "customer": ["in", customer_ids],
            "docstatus": 1,
            "outstanding_amount": [">", 0],
        },
        fields=["customer", "outstanding_amount"],
    )
    result = {}
    for r in rows:
        c = r["customer"]
        if c not in result:
            result[c] = {"total_outstanding": 0.0, "invoice_count": 0}
        result[c]["total_outstanding"] = round_currency(
            result[c]["total_outstanding"] + (r["outstanding_amount"] or 0)
        )
        result[c]["invoice_count"] += 1
    return result


def batch_fetch_customers(customer_ids, fields=None):
    """
    Batch-fetch Customer records by ID list.

    Parameters
    ----------
    customer_ids : list of str
    fields       : list, optional – Default ["name", "customer_name", "mobile_no"].

    Returns
    -------
    { customer_id: dict }
    """
    if not customer_ids:
        return {}
    _fields = fields or ["name", "customer_name", "mobile_no"]
    rows = frappe.db.get_all(
        DocType.CUSTOMER,
        filters={"name": ["in", customer_ids]},
        fields=_fields,
    )
    return {r["name"]: r for r in rows}
