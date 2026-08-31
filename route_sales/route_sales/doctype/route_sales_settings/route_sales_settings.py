# Copyright (c) 2026, LMNTRIX Pvt Ltd and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from route_sales.api.constants import BUSINESS_TYPE_PRESETS


class RouteSalesSettings(Document):
    def validate(self):
        self.apply_business_type_preset()

    def apply_business_type_preset(self):
        """
        Business Type != Custom is a promise, not just a label: every
        identity-defining feature flag always matches BUSINESS_TYPE_PRESETS
        for the selected type, on every save -- not just when Business Type
        itself changes. That's what lets the desk form safely mark those
        fields read-only whenever a preset is active (see
        route_sales_settings.js) without the two ever drifting apart, even
        if a flag were ever changed directly via the API/console.
        """
        preset = BUSINESS_TYPE_PRESETS.get(self.business_type)
        if not preset:
            return  # "Custom" (or unset) -- leave every flag exactly as set
        for fieldname, value in preset.items():
            self.set(fieldname, value)
