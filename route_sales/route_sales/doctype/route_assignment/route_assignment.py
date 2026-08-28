# Copyright (c) 2026, LMNTRIX Pvt Ltd and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class RouteAssignment(Document):
    def validate(self):
        self._validate_no_conflicting_open_session()

    def _validate_no_conflicting_open_session(self):
        """Mirror the guard already enforced in route_sales.api.admin.assign_route:
        a NEW Route Assignment cannot be created for a salesperson who currently
        has an open Route Session. Restricted to inserts only, so admins can
        still freely edit past/existing assignment records.
        """
        if not self.is_new() or not self.salesperson:
            return

        open_session = frappe.db.get_value(
            "Route Session",
            {"salesperson": self.salesperson, "end_time": ["is", "not set"]},
            "name",
        )
        if open_session:
            frappe.throw(
                _("Cannot create a new Route Assignment for Sales Person {0}: "
                  "Route Session {1} is still open. End the session first, or "
                  "unassign the salesperson.").format(self.salesperson, open_session),
                title=_("Open Session Exists"),
            )
