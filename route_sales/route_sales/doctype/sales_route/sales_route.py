# Copyright (c) 2026, LMNTRIX Pvt Ltd and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

class SalesRoute(Document):
    def validate(self):
        self._validate_no_duplicate_customers()
        self._validate_unique_sequence()
        self._autofetch_sales_executive()

    def _validate_no_duplicate_customers(self):
        seen = set()
        for idx, row in enumerate(self.get("customers") or [], start=1):
            if not row.customer:
                continue
            if row.customer in seen:
                frappe.throw(
                    _("Row {0}: Customer <b>{1}</b> is already added to this route. "
                      "Each customer can appear only once.").format(idx, row.customer),
                    title=_("Duplicate Customer")
                )
            seen.add(row.customer)

    def _validate_unique_sequence(self):
        seen_seq = {}
        for idx, row in enumerate(self.get("customers") or [], start=1):
            if row.sequence is None:
                continue
            if row.sequence in seen_seq:
                frappe.throw(
                    _("Row {0}: Sequence <b>{1}</b> is already used by customer "
                      "<b>{2}</b>. Sequence numbers must be unique within a route.").format(
                          idx, row.sequence, seen_seq[row.sequence]
                      ),
                    title=_("Duplicate Sequence")
                )
            seen_seq[row.sequence] = row.customer

    def _autofetch_sales_executive(self):
        if not self.salesperson:
            return
        for row in self.get("customers") or []:
            if not row.customer:
                continue
            cust_doc = frappe.get_doc("Customer", row.customer)
            if not cust_doc.get("primary_sales_executive"):
                frappe.db.set_value(
                    "Customer",
                    row.customer,
                    "primary_sales_executive",
                    self.salesperson
                )

    def on_update(self):
        self._sync_customer_route_fields()

    def _sync_customer_route_fields(self):
        for row in self.get("customers") or []:
            if not row.customer:
                continue
            update_values = {
                "is_route_customer": 1,
                "route": self.name
            }
            if row.visit_day:
                update_values["visit_day"] = row.visit_day
            if row.sequence:
                update_values["visit_sequence"] = row.sequence
            frappe.db.set_value("Customer", row.customer, update_values)
