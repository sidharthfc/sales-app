__version__ = "0.0.1"


def _exempt_route_sales_api_from_csrf():
    """
    route_sales's whole REST surface is designed to be stateless
    (Authorization: token <api_key>:<api_secret> on every call — see
    api/auth.py.mobile_login's docstring: "the app never needs session
    cookies"). In practice a browser client still picks up an incidental
    Guest `sid` cookie the moment it loads the login page, and if that
    Guest session happens to already carry a csrf_token (e.g. on a repeat
    visit), Frappe's CSRF check fires on the very first POST — including
    mobile_login itself, before any token exists to authenticate with.

    There's no hook early enough to hook into (`before_request` runs after
    HTTPRequest.__init__'s CSRF check, see frappe/app.py:200-203), so this
    patches the check directly: skip it only for this app's own
    /api/method/route_sales.* endpoints, leaving CSRF fully intact for the
    desk and every other whitelisted method.
    """
    import frappe.auth

    original_validate = frappe.auth.HTTPRequest.validate_csrf_token

    def validate_csrf_token(self):
        request = getattr(frappe.local, "request", None)
        if request and request.path.startswith("/api/method/route_sales."):
            return
        return original_validate(self)

    frappe.auth.HTTPRequest.validate_csrf_token = validate_csrf_token


_exempt_route_sales_api_from_csrf()
