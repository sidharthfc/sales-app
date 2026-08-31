"""
route_sales.tools.pricing
=========================
Item pricing engine — algorithmic (code-based) and random initialisation.

POST /api/method/route_sales.tools.pricing.set_random_prices
bench execute: route_sales.tools.pricing.run
"""

import re
import math
import random
import frappe
from route_sales.api.constants import get_default_price_list


# ── Math helpers ──────────────────────────────────────────────────────────────

def lerp(a, b, t):
    return a + (b - a) * max(0.0, min(1.0, t))


def parse_inch(s):
    """'2inch' | '1-1/2inch' | '3/4inch' → float"""
    s = s.replace("inch", "").strip()
    if "-" in s and "/" in s:
        whole, frac = s.split("-", 1)
        num, den = frac.split("/")
        return float(whole) + float(num) / float(den)
    elif "/" in s:
        num, den = s.split("/")
        return float(num) / float(den)
    return float(s)


def inch_t(inch, lo=0.5, hi=4.0):
    return (inch - lo) / (hi - lo)


# ── ELE pricing  (₹60 – ₹4 000) ──────────────────────────────────────────────

def price_ele_led(code):
    m = re.search(r"(\d+)W", code)
    w = int(m.group(1)) if m else 12
    return round(lerp(75, 620, (w - 3) / (50 - 3)))


def price_ele_mcb(code):
    am = re.search(r"(\d+)A", code)
    a  = int(am.group(1)) if am else 16
    base = lerp(90, 780, (a - 6) / (63 - 6))
    pf   = {"SP": 1.0, "DP": 1.8, "TP": 2.7, "FP": 3.8}
    return round(base * next((v for k, v in pf.items() if code.endswith(k)), 1.0))


def price_ele_tube(code):
    wm = re.search(r"(\d+)W", code)
    fm = re.search(r"(\d+)ft", code)
    w, f = int(wm.group(1)) if wm else 20, int(fm.group(1)) if fm else 2
    return round(lerp(130, 460, (w - 10) / (40 - 10)) * lerp(0.9, 1.55, (f - 1) / (4 - 1)))


def price_ele_wir(code):
    m  = re.search(r"([\d.]+)mm", code)
    mm = float(m.group(1)) if m else 2.5
    return round(lerp(85, 2800, math.log(mm + 0.25) / math.log(10.25)))


# ── PLM pricing  (₹50 – ₹12 000) ─────────────────────────────────────────────

def price_plm_pip(code):
    m    = re.search(r"-([\d.]+)inch-", code)
    inch = float(m.group(1)) if m else 2.0
    base = lerp(260, 9200, inch_t(inch, 0.5, 4.0) ** 0.75)
    return round(base * (1.28 if "S80" in code else 1.0))


def price_plm_fit(code):
    m    = re.search(r"-([\d.]+)inch-", code)
    inch = float(m.group(1)) if m else 1.0
    mat  = {"B": 3.2, "C": 1.6, "P": 1.0}.get(code[-1], 1.0)
    typ  = {"COU": 1.0, "ELB": 1.2, "TEE": 1.45, "UNI": 1.65}.get(code.split("-")[2], 1.0)
    return round(lerp(65, 580, inch_t(inch, 0.5, 2.0)) * mat * typ)


def price_plm_misc(code):
    m   = re.search(r"(\d+)$", code)
    num = int(m.group(1)) if m else 200
    return round(lerp(50, 680, (num - 165) / (249 - 165)))


def price_plm_pmp(code):
    m  = re.search(r"([\d.]+)HP", code)
    hp = float(m.group(1)) if m else 1.0
    return round(lerp(4800, 12000, (hp - 0.5) / (3 - 0.5)))


# ── PLU pricing ───────────────────────────────────────────────────────────────

def _extract_size(parts, from_idx):
    return parse_inch("-".join(parts[from_idx:]))


def price_plu_fit(code):
    parts = code.split("-")
    mat   = {"C": 1.45, "P": 1.0, "U": 1.2}.get(parts[2], 1.0)
    typ   = {"CO": 1.0, "EL": 1.2, "EN": 0.8, "RE": 1.1, "TE": 1.45, "UN": 1.65}.get(
                parts[3] if len(parts) > 3 else "CO", 1.0)
    try:
        inch = _extract_size(parts, 4)
    except Exception:
        inch = 1.0
    return round(lerp(55, 380, inch_t(inch, 0.5, 2.0)) * mat * typ)


def price_plu_pipe(code):
    parts  = code.split("-")
    mat_f  = {"GI": 1.4, "CPVC": 1.2, "UPVC": 1.0, "PVC": 0.85}.get(parts[2], 1.0)
    try:
        inch = _extract_size(parts, 3)
    except Exception:
        inch = 2.0
    return round(lerp(250, 7800, inch_t(inch, 0.5, 4.0) ** 0.8) * mat_f)


def price_plu_pump(code):
    m  = re.search(r"([\d.]+)HP", code)
    hp = float(m.group(1)) if m else 1.0
    return round(lerp(3800, 10500, (hp - 0.5) / (3 - 0.5)))


def price_plu_valve(code):
    parts = code.split("-")
    typ   = {"AN": 1.25, "BA": 1.6, "CH": 1.9, "GA": 1.0}.get(parts[2], 1.0)
    try:
        inch = _extract_size(parts, 3)
    except Exception:
        inch = 1.0
    return round(lerp(110, 1250, inch_t(inch, 0.75, 2.0)) * typ)


# ── Dispatch ──────────────────────────────────────────────────────────────────

def compute_price(code):
    if   code.startswith("ELE-LED"):    p = price_ele_led(code)
    elif code.startswith("ELE-MCB"):    p = price_ele_mcb(code)
    elif code.startswith("ELE-TUBE"):   p = price_ele_tube(code)
    elif code.startswith("ELE-WIR"):    p = price_ele_wir(code)
    elif code.startswith("PLM-PIP"):    p = price_plm_pip(code)
    elif code.startswith("PLM-FIT"):    p = price_plm_fit(code)
    elif code.startswith("PLM-MISC"):   p = price_plm_misc(code)
    elif code.startswith("PLM-PMP"):    p = price_plm_pmp(code)
    elif code.startswith("PLU-FIT"):    p = price_plu_fit(code)
    elif code.startswith("PLU-PIPE"):   p = price_plu_pipe(code)
    elif code.startswith("PLU-PUMP"):   p = price_plu_pump(code)
    elif code.startswith("PLU-VALVE"):  p = price_plu_valve(code)
    else:                               p = 500

    return max(60, min(4000, p)) if code.startswith("ELE") else max(50, min(12000, p))


# ── Shared upsert helper ──────────────────────────────────────────────────────

def upsert_item_price(item_code, price, price_list=None):
    price_list = price_list or get_default_price_list()
    existing = frappe.db.exists("Item Price", {"item_code": item_code, "price_list": price_list})
    if existing:
        frappe.db.set_value("Item Price", existing, "price_list_rate", price)
    else:
        frappe.get_doc({
            "doctype":         "Item Price",
            "item_code":       item_code,
            "price_list":      price_list,
            "price_list_rate": price,
            "currency":        "INR",
        }).insert(ignore_permissions=True)


# ── Algorithmic pricing  (bench execute) ──────────────────────────────────────

def run():
    """Update all item prices using the code-based algorithm."""
    price_list = get_default_price_list()
    items = frappe.db.get_all(
        "Item",
        filters={"disabled": 0, "is_stock_item": 1},
        fields=["item_code"],
        order_by="item_code asc",
    )
    created = updated = 0
    for item in items:
        code  = item["item_code"]
        price = compute_price(code)
        existing = frappe.db.get_value(
            "Item Price", {"item_code": code, "price_list": price_list}, "name"
        )
        if existing:
            frappe.db.set_value("Item Price", existing, "price_list_rate", price)
            updated += 1
        else:
            upsert_item_price(code, price)
            created += 1

    frappe.db.commit()
    print(f"Done — created: {created}, updated: {updated}, total: {created + updated}")


# ── Random price initialisation  (whitelisted) ────────────────────────────────

@frappe.whitelist()
def set_random_prices():
    """Set randomised prices for items using keyword-based category detection."""
    price_list = get_default_price_list()
    if price_list and not frappe.db.exists("Price List", price_list):
        frappe.get_doc({
            "doctype":          "Price List",
            "price_list_name":  price_list,
            "enabled":          1,
            "selling":          1,
            "currency":         "INR",
        }).insert(ignore_permissions=True)

    categories = {
        "electrical": {
            "keywords": ["LED", "Bulb", "Switch", "Fan", "Cable", "Wire", "Socket",
                         "Plug", "Light", "Ceiling", "Batten", "MCB", "Distribution Board"],
            "range": (60, 4000),
        },
        "plumbing": {
            "keywords": ["Pipe", "Union", "Valve", "CPVC", "UPVC", "SWR", "ASTM",
                         "Fitting", "Pump", "Monoblock", "Submersible", "Tank", "Tap", "Faucet"],
            "range": (50, 12000),
        },
    }

    items   = frappe.get_all("Item", filters={"disabled": 0}, fields=["name", "item_name", "item_code"])
    results = {"electrical": 0, "plumbing": 0, "errors": []}

    for item in items:
        text = ((item.item_name or "") + (item.item_code or "")).lower()
        found = None
        for cat, cfg in categories.items():
            if any(k.lower() in text for k in cfg["keywords"]):
                found = cat
                break
        if not found:
            continue
        price = random.randint(*categories[found]["range"])
        try:
            upsert_item_price(item.name, price)
            results[found] += 1
        except Exception as e:
            results["errors"].append(f"{item.name}: {str(e)}")

    frappe.db.commit()
    return results
