"""
Automatic Product Image Fetcher for ERPNext Items.

Usage:
    # Fetch images for all items missing one:
    bench --site lmntrix.co execute route_sales.item_image_fetcher.fetch_images_for_all_items

    # Fetch image for a single item:
    bench --site lmntrix.co execute route_sales.item_image_fetcher.fetch_image_for_item --kwargs '{"item_code": "ITEM-001"}'

This module uses DuckDuckGo image search (no API key required) to find product
images by item name/description, then saves them into Frappe's file system.
"""

import frappe
import requests
import os
import re
from urllib.parse import quote
from io import BytesIO
import time
from concurrent.futures import ThreadPoolExecutor


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@frappe.whitelist()
def upload_base64_image(item_code, base64_data, filename):
    """
    Upload an image from a base64 string.
    """
    import base64
    try:
        if "," in base64_data:
            base64_data = base64_data.split(",")[1]
            
        image_data = base64.b64decode(base64_data)
        
        file_doc = frappe.get_doc({
            "doctype": "File",
            "file_name": filename,
            "attached_to_doctype": "Item",
            "attached_to_name": item_code,
            "is_private": 0,
            "content": image_data,
        })
        file_doc.save(ignore_permissions=True)
        
        frappe.db.set_value("Item", item_code, "image", file_doc.file_url)
        frappe.db.commit()
        
        return {"status": "success", "file_url": file_doc.file_url}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def bulk_upload_base64(items_data):
    """
    items_data: list of dicts [{"item_code": "...", "base64_data": "...", "filename": "..."}]
    """
    import json
    import base64
    if isinstance(items_data, str):
        try:
            items_data = json.loads(items_data)
        except Exception:
            # Try to handle cases where it might be double-encoded or partially invalid
            return {"status": "error", "message": "Invalid JSON input"}
        
    if not isinstance(items_data, list):
        # Fallback for single object or dict-wrapped list
        if isinstance(items_data, dict):
            if "items" in items_data: items_data = items_data["items"]
            else: items_data = [items_data]
        else:
            return {"status": "error", "message": "items_data must be a list"}

    results = {"success": [], "failed": []}
    count = 0
    for entry in items_data:
        item_code = "Unknown"
        try:
            if not isinstance(entry, dict):
                continue
                
            item_code = entry.get("item_code") or entry.get("name") or entry.get("item")
            base64_data = entry.get("base64_data") or entry.get("image") or entry.get("image_base64")
            filename = entry.get("filename") or f"{item_code}.webp"
            
            if not item_code or not base64_data:
                results["failed"].append({"item": item_code, "error": "Missing item_code or base64_data"})
                continue
                
            if "," in base64_data:
                base64_data = base64_data.split(",")[1]
            
            image_data = base64.b64decode(base64_data)
            
            file_doc = frappe.get_doc({
                "doctype": "File",
                "file_name": filename,
                "attached_to_doctype": "Item",
                "attached_to_name": item_code,
                "is_private": 0,
                "content": image_data,
            })
            file_doc.save(ignore_permissions=True)
            
            frappe.db.set_value("Item", item_code, "image", file_doc.file_url)
            results["success"].append(item_code)
            
            count += 1
            if count % 10 == 0:
                frappe.db.commit()
                
        except Exception as e:
            results["failed"].append({"item": str(item_code), "error": str(e)})
            
    frappe.db.commit()
    return results

@frappe.whitelist()
def bulk_attach_images(items_data):
    """
    items_data: dict of {item_code: image_url}
    """
    if isinstance(items_data, str):
        import json
        items_data = json.loads(items_data)
        
    results = {"success": [], "failed": []}
    
    def process_item(item_code, image_url):
        try:
            query = item_code # Use item_code as filename base
            file_url = _save_image_to_frappe(item_code, query, image_url)
            if file_url:
                frappe.db.set_value("Item", item_code, "image", file_url)
                return True, item_code
            return False, item_code
        except Exception:
            return False, item_code

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(process_item, k, v) for k, v in items_data.items()]
        for future in futures:
            success, item = future.result()
            if success:
                results["success"].append(item)
            else:
                results["failed"].append(item)
            
    frappe.db.commit()
    return results

@frappe.whitelist()
def fetch_images_for_all_items(limit=50, offset=0):
    """
    Fetch and attach images for all Items that currently have no image.
    Returns a summary dict.
    """
    items = frappe.get_all(
        "Item",
        filters={"image": ["in", ["", None]], "disabled": 0},
        fields=["name", "item_name", "item_code", "description"],
        limit_start=int(offset),
        limit_page_length=int(limit)
    )

    results = {"success": [], "failed": [], "skipped": []}

    for item in items:
        query = item.get("item_name") or item.get("item_code")
        try:
            image_url = _search_image(query)
            if not image_url:
                results["skipped"].append(item["name"])
                continue

            file_url = _save_image_to_frappe(item["name"], query, image_url)
            if file_url:
                frappe.db.set_value("Item", item["name"], "image", file_url)
                results["success"].append(item["name"])
            else:
                results["failed"].append(item["name"])
        except Exception as e:
            frappe.log_error(f"Image fetch failed for {item['name']}: {e}", "Item Image Fetcher")
            results["failed"].append(item["name"])
        
        # Small delay to prevent rate-limiting
        time.sleep(1)

    frappe.db.commit()
    frappe.msgprint(
        f"Done! Success: {len(results['success'])}, Failed: {len(results['failed'])}, Skipped: {len(results['skipped'])}",
        alert=True
    )
    return results


@frappe.whitelist()
def fetch_image_for_item(item_code):
    """Fetch and attach image for a single Item by item_code."""
    if not frappe.db.exists("Item", item_code):
        frappe.throw(f"Item {item_code} not found")

    item = frappe.get_doc("Item", item_code)
    query = item.item_name or item_code

    image_url = _search_image(query)
    if not image_url:
        frappe.msgprint(f"No image found for: {query}", alert=True)
        return None

    file_url = _save_image_to_frappe(item_code, query, image_url)
    if file_url:
        item.image = file_url
        item.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.msgprint(f"Image attached to {item_code}", alert=True)
        return file_url

    frappe.msgprint(f"Failed to save image for {item_code}", alert=True)
    return None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

import random

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.1 Mobile/15E148 Safari/604.1"
]

def _search_image(query):
    """
    Search DuckDuckGo for an image matching the query.
    Returns a direct image URL or None.
    """
    try:
        # Step 1: Get a vqd token from DuckDuckGo
        headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        search_query = quote(f"{query} product clear background")
        page = requests.get(
            f"https://duckduckgo.com/?q={search_query}&iax=images&ia=images",
            headers=headers, timeout=10
        )
        
        if "Blocked" in page.text or page.status_code == 403:
            frappe.log_error(f"Search blocked for query: {query}", "Item Image Fetcher")
            return None

        vqd_match = re.search(r'vqd=([^&"\']+)', page.text)
        if not vqd_match:
            # Fallback for simpler queries
            search_query = quote(query)
            page = requests.get(
                f"https://duckduckgo.com/?q={search_query}&iax=images&ia=images",
                headers=headers, timeout=10
            )
            vqd_match = re.search(r'vqd=([^&"\']+)', page.text)
            if not vqd_match: return None
            
        vqd = vqd_match.group(1)

        # Step 2: Query the image search API
        api_url = (
            f"https://duckduckgo.com/i.js"
            f"?q={search_query}&o=json&vqd={vqd}&f=,,,,,&l=us-en"
        )
        resp = requests.get(api_url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return None

        data = resp.json()
        results = data.get("results", [])
        if not results:
            return None

        # Try to pick a result that looks like a direct image link and isn't too small
        for res in results:
            img_url = res.get("image")
            if img_url and any(ext in img_url.lower() for ext in [".jpg", ".jpeg", ".png", ".webp"]):
                return img_url
        
        return results[0].get("image")
    except Exception as e:
        frappe.log_error(f"Search logic error for {query}: {e}", "Item Image Fetcher")
        return None


def _save_image_to_frappe(item_code, query, image_url):
    """
    Download image from URL and save to Frappe's file system attached to Item.
    Returns the Frappe file URL or None on failure.
    """
    try:
        headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.google.com/"
        }
        resp = requests.get(image_url, headers=headers, timeout=20, stream=True)
        if resp.status_code != 200:
            frappe.log_error(f"Download failed for {item_code}: {resp.status_code}", "Item Image Fetcher")
            return None

        # Determine file extension from content-type or URL
        content_type = resp.headers.get("Content-Type", "image/jpeg")
        ext = _ext_from_content_type(content_type) or _ext_from_url(image_url) or "jpg"

        # Sanitize filename
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', query)[:40]
        filename = f"{safe_name}.{ext}"

        image_data = resp.content
        if not image_data:
            return None

        # Save via Frappe's file API
        file_doc = frappe.get_doc({
            "doctype": "File",
            "file_name": filename,
            "attached_to_doctype": "Item",
            "attached_to_name": item_code,
            "is_private": 0,
            "content": image_data,
        })
        file_doc.save(ignore_permissions=True)
        frappe.log_error(f"Image saved for {item_code}: {file_doc.file_url}", "Item Image Fetcher")
        return file_doc.file_url

    except Exception as e:
        frappe.log_error(f"Image save failed for {item_code}: {str(e)}", "Item Image Fetcher")
        return None


def _ext_from_content_type(ct):
    mapping = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
    }
    return mapping.get(ct.split(";")[0].strip().lower())


def _ext_from_url(url):
    path = url.split("?")[0]
    if "." in path:
        ext = path.rsplit(".", 1)[-1].lower()
        if ext in ("jpg", "jpeg", "png", "gif", "webp"):
            return ext
    return None
