"""
route_utils.py — utility hooks for Customer doctype events
Registered via hooks.py > doc_events > Customer > validate
"""

import frappe
from frappe.utils import getdate, add_days, nowdate


# Day name → weekday number (Python: Monday=0, Sunday=6).
#
# NOTE: this looks like a candidate for `calendar.day_name` (its default
# English-locale values are identical: Monday=0 .. Sunday=6). Deliberately
# NOT replaced: `calendar.day_name` reads the process's LC_TIME and returns
# localized day names on a non-English locale, while `doc.visit_day` is a
# Select field whose options are hardcoded English literals in the DocType/
# Custom Field JSON (see route_customer.json and customer_custom_fields.json)
# and therefore always "Monday".."Sunday" regardless of server locale. A
# stdlib-derived map would silently stop matching on such a server. Kept
# hand-maintained to stay locale-invariant like the field it looks up.
WEEKDAY_MAP = {
    "Monday": 0,
    "Tuesday": 1,
    "Wednesday": 2,
    "Thursday": 3,
    "Friday": 4,
    "Saturday": 5,
    "Sunday": 6
}


def try_set_missing_values(doc, context_label):
    """
    Call doc.set_missing_values(), swallowing and logging any exception as
    non-critical instead of failing the whole request.
    """
    try:
        doc.set_missing_values()
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"set_missing_values non-critical ({context_label})")


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
