# Copyright (c) 2026, LMNTRIX and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class RouteSessionStock(Document):
    def validate(self):
        self._validate_quantities()

    def _validate_quantities(self):
        if flt(self.qty_loaded) < 0:
            frappe.throw(
                _("Qty Loaded cannot be negative."),
                title=_("Invalid Stock Quantity"),
            )
        if flt(self.qty_returned) < 0:
            frappe.throw(
                _("Qty Returned cannot be negative."),
                title=_("Invalid Stock Quantity"),
            )
        if flt(self.qty_returned) > flt(self.qty_loaded):
            frappe.throw(
                _("Qty Returned ({0}) cannot exceed Qty Loaded ({1}) for item {2}.").format(
                    self.qty_returned, self.qty_loaded, self.item_code
                ),
                title=_("Invalid Stock Quantity"),
            )
