COMPANY            = "LMNTRIX Pvt Ltd"
WAREHOUSE          = "LMNTRIX Main Warehouse - LMNTRIX"
DEBIT_ACCOUNT      = "Debtors - LMNTRIX"
DEFAULT_PRICE_LIST = "Standard Selling"
CURRENCY           = "INR"

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
