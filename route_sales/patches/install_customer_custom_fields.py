"""
Patch: install_customer_custom_fields
Installs all custom fields for the Customer doctype from 
fixtures/customer_custom_fields.json.

Run with:
    bench --site <site> execute route_sales.patches.install_customer_custom_fields.execute
"""

import frappe
import json
import os


def execute():
    fixture_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        "fixtures",
        "customer_custom_fields.json"
    )

    with open(fixture_path, "r") as f:
        fields = json.load(f)

    created = 0
    skipped = 0

    for field_def in fields:
        fieldname = field_def.get("fieldname")
        dt = field_def.get("dt") or field_def.get("doctype") and "Customer"

        # Use "Customer-<fieldname>" as the Custom Field name convention
        cf_name = f"Customer-{fieldname}"

        if frappe.db.exists("Custom Field", cf_name):
            skipped += 1
            continue

        # Build the Custom Field doc
        cf_data = {
            "doctype": "Custom Field",
            "name": cf_name,
            "dt": "Customer",
            "fieldname": field_def.get("fieldname"),
            "fieldtype": field_def.get("fieldtype"),
            "label": field_def.get("label"),
            "options": field_def.get("options"),
            "insert_after": field_def.get("insert_after"),
            "reqd": field_def.get("reqd", 0),
            "in_list_view": field_def.get("in_list_view", 0),
            "mandatory_depends_on": field_def.get("mandatory_depends_on"),
            "collapsible": field_def.get("collapsible", 0),
            "read_only": field_def.get("read_only", 0),
        }

        cf = frappe.get_doc(cf_data)
        cf.insert(ignore_permissions=True)
        created += 1

    frappe.db.commit()
    print(f"✅ Custom Fields created: {created}, skipped (already exist): {skipped}")
