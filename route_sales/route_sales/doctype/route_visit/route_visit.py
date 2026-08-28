# Copyright (c) 2026, LMNTRIX Pvt Ltd and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class RouteVisit(Document):
    def validate(self):
        self._validate_time_order()

    def _validate_time_order(self):
        if self.checkin_time and self.checkout_time and self.checkout_time < self.checkin_time:
            frappe.throw(
                _("Check-out Time cannot be before Check-in Time."),
                title=_("Invalid Visit Times"),
            )
