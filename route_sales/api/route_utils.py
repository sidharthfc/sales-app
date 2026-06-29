"""
route_utils.py — utility hooks for Customer doctype events
Registered via hooks.py > doc_events > Customer > validate
"""

import frappe
from frappe.utils import getdate, add_days, nowdate


# Day name → weekday number (Python: Monday=0, Sunday=6)
WEEKDAY_MAP = {
    "Monday": 0,
    "Tuesday": 1,
    "Wednesday": 2,
    "Thursday": 3,
    "Friday": 4,
    "Saturday": 5,
    "Sunday": 6
}


def customer_validate(doc, method=None):
    """
    Called on Customer.validate via doc_events hook.
    1. Auto-computes next_scheduled_visit from visit_day.
    2. If is_route_customer is unchecked, clears route-specific fields.
    """
    if doc.is_route_customer:
        _compute_next_scheduled_visit(doc)
    else:
        # Clear route-linked fields when opt-out
        doc.route = None
        doc.primary_sales_executive = None
        doc.next_scheduled_visit = None


def _compute_next_scheduled_visit(doc):
    """
    Sets next_scheduled_visit to the upcoming occurrence of doc.visit_day.
    If already set and still in the future, leaves it unchanged.
    """
    if not doc.visit_day:
        return

    target_weekday = WEEKDAY_MAP.get(doc.visit_day)
    if target_weekday is None:
        return

    today = getdate(nowdate())
    today_weekday = today.weekday()  # Monday=0

    diff = (target_weekday - today_weekday) % 7
    if diff == 0:
        diff = 7  # always schedule forward, never today

    next_visit = add_days(today, diff)

    # Only overwrite if not already set or if it's in the past
    if not doc.next_scheduled_visit or getdate(doc.next_scheduled_visit) <= today:
        doc.next_scheduled_visit = next_visit
