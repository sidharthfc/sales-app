import frappe

COMPANY            = "LMNTRIX Pvt Ltd"
WAREHOUSE          = "LMNTRIX Main Warehouse - LMNTRIX"
DEBIT_ACCOUNT      = "Debtors - LMNTRIX"
DEFAULT_PRICE_LIST = "Standard Selling"
CURRENCY           = "INR"

# Defaults for every Features / Flow / Payment Modes checkbox on Route Sales
# Settings, keyed by fieldname. Every one of these ships enabled (or, for the
# one flow toggle, matching today's LMNTRIX behavior) so an unmigrated or
# freshly-installed site behaves exactly like the original single-tenant app
# — a client is only ever narrowed down from "everything on", never the
# other way around by omission.
_FEATURE_FLAG_DEFAULTS = {
    "enable_deliver_bill":           True,
    "enable_take_order":             True,
    "enable_leads":                  True,
    "enable_returns":                True,
    "enable_expenses":               True,
    "enable_admin_tracking":         True,
    "enable_routes_tile":            True,
    "enable_payment_tile":           True,
    "enable_invoice_tile":           True,
    "enable_orders_tile":            True,
    "enable_lead_crm":               False,
    "take_order_bills_immediately":  False,
    "enable_cash":                   True,
    "enable_upi":                    True,
    "enable_bank_transfer":          True,
    "enable_credit":                 True,
}

BRAND_PRIMARY_COLOR = "#E8972A"
BRAND_ACCENT_COLOR  = "#D4780A"

# Sales page category tabs, used whenever Route Sales Settings.item_categories
# is empty. Matches today's real LMNTRIX data: every item's Item Group is
# uniformly "Products" (not usefully categorized), so item_code prefix is the
# only real category signal this client has -- confirmed against the live
# item table, not assumed. Real Item Group-based categorization is
# available (see get_item_categories) for a client whose master data is
# properly grouped; a client with neither should add category rows however
# fits their own item-coding convention.
DEFAULT_ITEM_CATEGORIES = [
    {"label": "Electrical", "item_group": None, "item_code_prefix": "ELE"},
    {"label": "Plumbing",   "item_group": None, "item_code_prefix": "PLM"},
    {"label": "CPVC",       "item_group": None, "item_code_prefix": "PLU"},
]

# ── Fallback-safe getters ──────────────────────────────────────────────────
# Route Sales Settings (Single) lets a site override the tenant-specific
# constants above without editing source. Each getter reads the Settings
# singleton and falls back to the hardcoded constant when the Settings
# doctype is missing, unconfigured, or a field is empty — so an unmigrated
# or misconfigured site behaves exactly as it does today. Consumers should
# call these getters instead of importing the module-level constants
# directly; the constants themselves are kept as the fallback defaults.

def get_company():
    return frappe.db.get_single_value("Route Sales Settings", "company") or COMPANY


def get_warehouse():
    return frappe.db.get_single_value("Route Sales Settings", "warehouse") or WAREHOUSE


def get_debit_account():
    return frappe.db.get_single_value("Route Sales Settings", "debit_account") or DEBIT_ACCOUNT


def get_default_price_list():
    return frappe.db.get_single_value("Route Sales Settings", "default_price_list") or DEFAULT_PRICE_LIST


def get_feature_flags():
    """
    All Features/Flow/Payment-Mode checkboxes from Route Sales Settings, as a
    single dict keyed exactly by their fieldnames. A missing/unmigrated
    Settings doctype falls back to _FEATURE_FLAG_DEFAULTS wholesale; an
    existing one falls back per-field only for values that are genuinely
    NULL (not just falsy — an explicit 0/unchecked box must stay off).
    """
    doc = None
    if frappe.db.exists("Route Sales Settings", "Route Sales Settings"):
        doc = frappe.db.get_value(
            "Route Sales Settings", "Route Sales Settings",
            list(_FEATURE_FLAG_DEFAULTS.keys()), as_dict=True,
        )

    return {
        flag: bool(doc[flag]) if doc and doc.get(flag) is not None else default
        for flag, default in _FEATURE_FLAG_DEFAULTS.items()
    }


def get_branding():
    settings = frappe.db.get_value(
        "Route Sales Settings", "Route Sales Settings",
        ["display_name", "logo", "primary_color", "accent_color", "company"],
        as_dict=True,
    ) or {}

    display_name = settings.get("display_name")
    if not display_name:
        company = settings.get("company") or get_company()
        display_name = frappe.db.get_value("Company", company, "company_name") or company

    return {
        "display_name":   display_name,
        "logo":           settings.get("logo") or None,
        "primary_color":  settings.get("primary_color") or BRAND_PRIMARY_COLOR,
        "accent_color":   settings.get("accent_color") or BRAND_ACCENT_COLOR,
    }


def get_item_categories():
    """
    [{ "label", "item_group", "item_code_prefix" }] -- falls back to
    DEFAULT_ITEM_CATEGORIES wholesale when no rows are configured.
    """
    rows = frappe.get_all(
        "Route Sales Item Category",
        filters={"parenttype": "Route Sales Settings", "parent": "Route Sales Settings"},
        fields=["label", "item_group", "item_code_prefix"],
        order_by="idx",
    )
    return rows or DEFAULT_ITEM_CATEGORIES

# Redis TTL (seconds) for a salesperson's live-location cache entry.
LIVE_LOCATION_TTL = 300

# Prefix written into a text field (remarks/instructions) to link a
# document back to the Route Session it was created during.
SESSION_REMARK_PREFIX = "Route Session: "


class VisitStatus:
    VISITED = "Visited"
    SKIPPED = "Skipped"
    CLOSED  = "Closed"
    PENDING = "Pending"


class OrderStatus:
    TO_DELIVER_AND_BILL = "To Deliver and Bill"
    TO_DELIVER          = "To Deliver"
    PARTLY_DELIVERED    = "Partly Delivered"
    COMPLETED           = "Completed"
    CLOSED              = "Closed"


class SessionStatus:
    OPEN   = "Open"
    CLOSED = "Closed"


class TravelMode:
    COMPANY_VAN = "Company Van"
    OWN_VEHICLE = "Own Vehicle"


class RoleName:
    SYSTEM_MANAGER      = "System Manager"
    ROUTE_SALES_MANAGER = "Route Sales Manager"
    ROUTE_SALES_USER    = "Route Sales User"


class ModeOfPayment:
    CASH   = "Cash"
    CREDIT = "Credit"


class DocType:
    """Core Frappe/ERPNext doctype names referenced across route_sales.api."""
    SALES_ORDER             = "Sales Order"
    SALES_INVOICE           = "Sales Invoice"
    CUSTOMER                = "Customer"
    PAYMENT_ENTRY           = "Payment Entry"
    PAYMENT_ENTRY_REFERENCE = "Payment Entry Reference"
    DELIVERY_NOTE           = "Delivery Note"
    QUOTATION               = "Quotation"
    ITEM                    = "Item"
    MODE_OF_PAYMENT_ACCOUNT = "Mode of Payment Account"


# Convenience lists for Sales Order status filtering
PENDING_DELIVERY_STATUSES = [
    OrderStatus.TO_DELIVER_AND_BILL,
    OrderStatus.TO_DELIVER,
    OrderStatus.PARTLY_DELIVERED,
]

COMPLETED_ORDER_STATUSES = (
    OrderStatus.COMPLETED,
    OrderStatus.CLOSED,
)
