import frappe

COMPANY            = "LMNTRIX Pvt Ltd"
WAREHOUSE          = "LMNTRIX Main Warehouse - LMNTRIX"
DEBIT_ACCOUNT      = "Debtors - LMNTRIX"
DEFAULT_PRICE_LIST = "Standard Selling"
CURRENCY           = "INR"

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
