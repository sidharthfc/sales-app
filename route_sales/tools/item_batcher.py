import frappe
import json
import os

def create_items(**kwargs):
    try:
        def to_int(v, default):
            if isinstance(v, list): v = v[0]
            try: return int(v)
            except: return default
            
        limit = to_int(kwargs.get("limit"), 500)
        offset = to_int(kwargs.get("offset"), 0)
        
        app_path = frappe.get_app_path("route_sales")
        json_path = os.path.join(app_path, "tools", "gen_items.json")
        
        if not os.path.exists(json_path):
            return {"status": "error", "message": "gen_items.json not found"}
            
        with open(json_path, "r") as f:
            all_items = json.load(f)
            
        chunk = all_items[offset : offset + limit]
        
        # Ensure Item Group
        if not frappe.db.exists("Item Group", "Products"):
            frappe.get_doc({"doctype": "Item Group", "item_group_name": "Products", "parent_item_group": "All Item Groups"}).insert(ignore_permissions=True)
        
        created, skipped = 0, 0
        for item_data in chunk:
            code = item_data.get("item_code")
            
            # Ensure UOM
            uom = item_data.get("stock_uom")
            if uom and not frappe.db.exists("UOM", uom):
                frappe.get_doc({"doctype": "UOM", "uom_name": uom}).insert(ignore_permissions=True)
            
            # Ensure Brand
            brand = item_data.get("brand")
            if brand and not frappe.db.exists("Brand", brand):
                frappe.get_doc({"doctype": "Brand", "brand": brand}).insert(ignore_permissions=True)
            
            if not frappe.db.exists("Item", code):
                try:
                    # Map all provided fields directly
                    item_doc = {
                        "doctype": "Item",
                        "is_stock_item": 1,
                        "is_sales_item": 1,
                        "is_purchase_item": 1
                    }
                    item_doc.update(item_data)
                    
                    frappe.get_doc(item_doc).insert(ignore_permissions=True)
                    created += 1
                except Exception as e:
                    frappe.log_error(f"Item Create Error {code}: {str(e)}", "Item Batcher")
            else:
                skipped += 1
        
        frappe.db.commit()
        return f"Processed {len(chunk)}: Created {created}, Skipped {skipped}"
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), f"Batcher Fatal Error")
        return {"status": "error", "message": str(e)}

def fetch_images(**kwargs):
    from route_sales.tools.item_image_fetcher import fetch_images_for_all_items
    limit = int(kwargs.get("limit") or 500)
    result = fetch_images_for_all_items(limit=limit)
    return f"Images processed: Success={len(result['success'])}, Failed={len(result['failed'])}"
