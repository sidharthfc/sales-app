# Copyright (c) 2026, LMNTRIX Pvt Ltd and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class SalespersonExpense(Document):
    def validate(self):
        self._validate_amount()

    def _validate_amount(self):
        if flt(self.amount) <= 0:
            frappe.throw(
                _("Amount must be greater than 0."),
                title=_("Invalid Amount"),
            )
