"""
Patch: clean_route_doctype
Deletes the mistakenly created `Route` doctype and cleans up its module folder.
"""
import frappe
import shutil
import os

def execute():
    # 1. Delete the Doctype record if it exists
    if frappe.db.exists("DocType", "Route"):
        frappe.delete_doc("DocType", "Route", ignore_permissions=True, force=True)
        print("Deleted Route doctype record.")

    # 2. Delete the module folder if it exists
    module_path = frappe.get_app_path("route_sales", "route_sales", "doctype", "route")
    if os.path.exists(module_path):
        shutil.rmtree(module_path)
        print(f"Deleted folder {module_path}.")

    frappe.db.commit()
