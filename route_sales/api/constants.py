import frappe

CURRENCY = "INR"

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
    "enable_more_tab":               True,
    "enable_lead_crm":               False,
    "take_order_bills_immediately":  False,
    "enable_cash":                   True,
    "enable_upi":                    True,
    "enable_bank_transfer":          True,
    "enable_credit":                 True,
}

# Route Sales Settings.business_type presets -- applied wholesale by
# RouteSalesSettings.validate() (route_sales_settings.py) whenever
# business_type is anything other than "Custom", so the individual feature
# checkboxes can never drift out of sync with the chosen business type.
# Deliberately excludes flags that aren't identity-defining (Expenses,
# payment modes, take_order_bills_immediately) -- those stay independently
# editable regardless of business type.
BUSINESS_TYPE_PRESETS = {
    "Route Sales": {
        "enable_deliver_bill":   True,
        "enable_take_order":     True,
        "enable_leads":          True,
        "enable_returns":        True,
        "enable_admin_tracking": True,
        "enable_routes_tile":    True,
        "enable_payment_tile":   True,
        "enable_invoice_tile":   True,
        "enable_orders_tile":    True,
        "enable_more_tab":       True,
        "enable_lead_crm":       False,
    },
    "Lead & Quotation": {
        "enable_deliver_bill":   False,
        "enable_take_order":     False,
        "enable_leads":          False,
        "enable_returns":        False,
        "enable_admin_tracking": False,
        "enable_routes_tile":    False,
        "enable_payment_tile":   False,
        "enable_invoice_tile":   False,
        "enable_orders_tile":    False,
        "enable_more_tab":       False,
        "enable_lead_crm":       True,
    },
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

# ── Core-first getters ───────────────────────────────────────────────────────
# company/warehouse/debit_account/default_price_list on Route Sales Settings
# are all OPTIONAL overrides, not a second source of truth: if route sales
# genuinely needs a different company/price list/receivable account than the
# rest of this site's desk sales use, set it here. Leave it blank and these
# read the real ERPNext core config instead (Global Defaults, the Company
# record, Selling Settings) -- so there's exactly one place that actually
# owns each fact, and route_sales can never silently drift out of sync with
# it the way a hardcoded/duplicated copy would if the core value ever
# changes (e.g. an accountant updates the company's receivable account).
# No hardcoded fallback constants -- if core has genuinely nothing configured
# either, these correctly return None rather than a guessed default.

def get_company():
    # frappe.defaults.get_global_default() reads a per-request defaults
    # cache that isn't reliably populated outside a full web request (e.g.
    # under `bench execute`) -- read the Global Defaults singleton directly
    # instead, same pattern as the other three getters below. No Route Sales
    # Settings override here (unlike warehouse/debit_account/price_list) --
    # every real deployment observed is one-company-per-site, so there's no
    # legitimate case for route sales needing a different company than the
    # rest of this same site.
    return frappe.db.get_single_value("Global Defaults", "default_company")


def get_warehouse():
    company = get_company()
    return (
        frappe.db.get_single_value("Route Sales Settings", "warehouse")
        or (frappe.get_cached_value("Company", company, "default_warehouse") if company else None)
        or frappe.db.get_single_value("Stock Settings", "default_warehouse")
    )


def get_debit_account():
    company = get_company()
    return (
        frappe.db.get_single_value("Route Sales Settings", "debit_account")
        or (frappe.get_cached_value("Company", company, "default_receivable_account") if company else None)
    )


def get_default_price_list():
    return (
        frappe.db.get_single_value("Route Sales Settings", "default_price_list")
        or frappe.db.get_single_value("Selling Settings", "selling_price_list")
    )


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
        ["display_name", "logo", "primary_color", "accent_color"],
        as_dict=True,
    ) or {}

    display_name = settings.get("display_name")
    if not display_name:
        company = get_company()
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
