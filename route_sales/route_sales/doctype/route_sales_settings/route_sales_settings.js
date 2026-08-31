// Copyright (c) 2026, LMNTRIX Pvt Ltd and contributors
// For license information, please see license.txt

// Business Type drives every feature toggle below it (see
// RouteSalesSettings.apply_business_type_preset in the Python controller) --
// switching to a real preset overwrites those toggles on save. Warn before
// that happens rather than silently clobbering whatever was set in Custom
// mode; switching *to* Custom never needs a warning since it doesn't change
// anything by itself.
frappe.ui.form.on("Route Sales Settings", {
	refresh(frm) {
		frm.__last_business_type = frm.doc.business_type;
	},

	business_type(frm) {
		if (frm.__reverting_business_type) {
			frm.__reverting_business_type = false;
			return;
		}

		const next = frm.doc.business_type;
		const previous = frm.__last_business_type;

		if (next === previous || next === "Custom" || !next) {
			frm.__last_business_type = next;
			return;
		}

		frappe.confirm(
			__(
				'Switching Business Type to "{0}" will overwrite the individual feature toggles below with that type\'s defaults once you save. Continue?',
				[next]
			),
			() => {
				frm.__last_business_type = next;
			},
			() => {
				frm.__reverting_business_type = true;
				frm.set_value("business_type", previous);
			}
		);
	},
});
