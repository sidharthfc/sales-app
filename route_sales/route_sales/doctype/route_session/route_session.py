# Copyright (c) 2026, LMNTRIX Pvt Ltd and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class RouteSession(Document):
    def validate(self):
        self._validate_time_order()

    def _validate_time_order(self):
        if self.start_time and self.end_time and self.end_time < self.start_time:
            frappe.throw(
                _("End Time cannot be before Start Time."),
                title=_("Invalid Session Times"),
            )

    def assert_open(self):
        """Raise if this session has already ended.

        Single source of truth for the "session must still be open" guard
        used by route_sales.api.visits (checkin_customer, checkout_customer,
        skip_customer) so each caller doesn't reimplement the same
        `end_time` check independently.
        """
        if self.end_time:
            frappe.throw(
                _("This Route Session has already ended. No further check-ins, "
                  "check-outs, or activity can be recorded against it."),
                title=_("Session Closed"),
            )
