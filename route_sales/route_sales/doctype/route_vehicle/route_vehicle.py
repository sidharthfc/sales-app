# Copyright (c) 2026, LMNTRIX Pvt Ltd and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class RouteVehicle(Document):
    def validate(self):
        self._validate_capacity()

    def _validate_capacity(self):
        if self.capacity is not None and flt(self.capacity) < 0:
            frappe.throw(
                _("Capacity (Kg) cannot be negative."),
                title=_("Invalid Capacity"),
            )
