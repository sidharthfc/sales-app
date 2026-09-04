"""
route_sales.api.selling
=======================
Standard ERPNext selling flow:
  Quotation (draft) → Sales Order (submitted) → Sales Invoice (submitted) → Payment Entry

POST /api/method/route_sales.api.selling.start_sale
POST /api/method/route_sales.api.selling.create_quotation
POST /api/method/route_sales.api.selling.create_sales_order
POST /api/method/route_sales.api.selling.confirm_order
POST /api/method/route_sales.api.selling.complete_payment
GET  /api/method/route_sales.api.selling.get_quotation

Both sale modes (Deliver & Bill, Take Order) run create_quotation → confirm_order.
Take Order stops there (billed later via route_sales.api.delivery, on the actual
delivery visit); Deliver & Bill continues on to complete_payment immediately.

`Route Sales Settings.sales_pipeline_start` decides how deep a cart goes on its
own before any of that: `start_sale` is the one entry point the frontend calls
for "turn this cart into something" and it dispatches to create_quotation (the
default, unchanged pipeline above), create_sales_order (skips the Quotation
stage entirely -- not a throwaway auto-quotation, a real standalone Sales
Order, so Quotation-stage reports stay accurate for shops that don't want
one), or invoices.create_sales_invoice (skips both earlier stages, bills on
the spot). This whole module is Route Sales's own cart flow only -- the
Lead & Quotation CRM pipeline has entirely separate endpoints in crm.py and
is untouched by sales_pipeline_start.
"""

import frappe
import json
from frappe.utils import today, add_days
from route_sales.api.constants import DocType, ModeOfPayment, SESSION_REMARK_PREFIX, get_company, get_warehouse, get_debit_account, get_default_price_list, get_sales_pipeline_start, get_default_taxes_and_charges_template
from route_sales.api.security import assert_customer_access, ensure_route_session_access
from route_sales.api.payments import record_payment_for_invoice
from route_sales.api.route_utils import try_set_missing_values


def _ensure_route_session_custom_fields():
    """
    Custom `route_session` Link field on Quotation and Sales Order.

    Neither doctype has anywhere to carry a Route Session link in ERPNext
    core -- confirmed live (not just from doctype JSON) that assigning
    `doc.remarks` on either one is silently dropped on insert/reload, since
    it isn't a real column. That broke van-stock delivered-qty tracking
    (stock.py's _get_delivered_qty_map_for_session) and the session summary
    totals (sessions.py's end_session/get_session_summary) for the default
    Quotation -> Sales Order -> Sales Invoice flow -- both always read 0
    billed/collected for that path even with real, fully-paid invoices,
    since they filter Sales Invoice.remarks and nothing upstream ever
    delivered a populated remarks field onto the resulting invoice. Sales
    Invoice's own `remarks` field IS real (used directly by
    invoices.create_sales_invoice, and by complete_payment once this field
    lets it read a real route_session off the Sales Order to build that
    marker from) -- this field's only job is getting a route_session value
    to survive as far as the Sales Order, so complete_payment has something
    real to read.

    Same idempotent create-or-sync pattern as
    route_sales.api.leads._ensure_lead_custom_fields (hooked the same way,
    see hooks.py's after_install/after_migrate).
    """
    fields = [
        {
            "dt": DocType.QUOTATION,
            "fieldname": "route_session",
            "label": "Route Session",
            "fieldtype": "Link",
            "options": "Route Session",
            "insert_after": "company",
            "read_only": 1,
        },
        {
            "dt": DocType.SALES_ORDER,
            "fieldname": "route_session",
            "label": "Route Session",
            "fieldtype": "Link",
            "options": "Route Session",
            "insert_after": "company",
            "read_only": 1,
        },
    ]
    changed = False
    for f in fields:
        existing_name = frappe.db.get_value("Custom Field", {"dt": f["dt"], "fieldname": f["fieldname"]}, "name")
        if not existing_name:
            doc = frappe.get_doc({"doctype": "Custom Field", **f})
            doc.insert(ignore_permissions=True)
            changed = True
        else:
            doc = frappe.get_doc("Custom Field", existing_name)
            dirty = False
            for key, value in f.items():
                if key in ("dt", "fieldname"):
                    continue
                if doc.get(key) != value:
                    doc.set(key, value)
                    dirty = True
            if dirty:
                doc.save(ignore_permissions=True)
                changed = True
    if changed:
        frappe.db.commit()


def _ignore_perms():
    """Context manager: suppress all Frappe permission checks for the duration."""
    import contextlib

    @contextlib.contextmanager
    def _ctx():
        frappe.flags.ignore_permissions = True
        try:
            yield
        finally:
            frappe.flags.ignore_permissions = False

    return _ctx()


@frappe.whitelist(methods=["POST"])
def create_quotation(customer, items, route_session=None, remarks=None, taxes_and_charges=None):
    """
    Step 1 — Create a draft Quotation from cart items.

    Parameters
    ----------
    customer           : str  – Customer name.
    items              : list – [{ "item_code": str, "qty": float, "rate": float? }]
                                Pass as JSON string via HTTP.
    route_session      : str, optional – Links the quotation to a Route Session.
    remarks            : str, optional – Free-text remarks.
    taxes_and_charges  : str, optional – Sales Taxes and Charges Template name;
                         left to set_missing_values()'s own default if omitted.

    Returns
    -------
    {
      "quotation":   str,
      "customer":    str,
      "grand_total": float,
      "items":       [{ "item_code", "item_name", "qty", "rate", "amount", "uom" }]
    }
    """
    if route_session:
        ensure_route_session_access(route_session)
    assert_customer_access(customer)

    if isinstance(items, str):
        items = json.loads(items) if items.strip() else []

    if not items:
        frappe.throw("At least one item is required.", frappe.ValidationError)

    price_list = (
        frappe.db.get_value(DocType.CUSTOMER, customer, "default_price_list")
        or get_default_price_list()
    )

    quotation_items = []
    warehouse = get_warehouse()
    for row in items:
        item_code = row.get("item_code")
        qty       = float(row.get("qty", 1))

        if not item_code:
            frappe.throw("Each item must have an 'item_code'.", frappe.ValidationError)
        if qty <= 0:
            frappe.throw(f"Quantity must be > 0 for item '{item_code}'.", frappe.ValidationError)

        rate = row.get("rate")
        if rate is None:
            rate = frappe.db.get_value(
                "Item Price",
                {"item_code": item_code, "price_list": price_list},
                "price_list_rate",
            ) or 0

        quotation_items.append({
            "item_code": item_code,
            "qty":       qty,
            "rate":      float(rate),
            "warehouse": warehouse,
        })

    # NOTE: Quotation has no `remarks` field in ERPNext core -- confirmed
    # live that assigning it here is silently dropped on insert. Kept as a
    # harmless no-op rather than removed (a caller-supplied `remarks` may
    # still be a meaningful signal to log/inspect even though it never
    # persists) -- the real, working session link is the `route_session`
    # custom field below (see _ensure_route_session_custom_fields), which
    # confirm_order reads back off this same Quotation to carry forward.
    note = remarks or ""
    if route_session:
        note = f"Route Session: {route_session}" + (f"\n{remarks}" if remarks else "")

    qt = frappe.get_doc({
        "doctype":             DocType.QUOTATION,
        "quotation_to":        DocType.CUSTOMER,
        "party_name":          customer,
        "company":             get_company(),
        "transaction_date":    today(),
        "valid_till":          add_days(today(), 7),
        "selling_price_list":  price_list,
        "items":               quotation_items,
        "remarks":             note or None,
        "taxes_and_charges":   taxes_and_charges or None,
        "route_session":       route_session or None,
    })

    # Keep ignore_permissions set through the full insert + commit so that
    # every ERPNext controller hook (validate, before_insert, after_insert …)
    # runs without raising PermissionError for the Route Sales User role.
    with _ignore_perms():
        try_set_missing_values(qt, "selling.py quotation")
        qt.insert(ignore_permissions=True)
        frappe.db.commit()

    return {
        "quotation":   qt.name,
        "customer":    customer,
        "grand_total": qt.grand_total,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
                "uom":       d.uom,
            }
            for d in qt.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def confirm_order(quotation):
    """
    Step 2 — Submit the Quotation and create a submitted Sales Order from it.

    Parameters
    ----------
    quotation : str – Quotation name (SAL-QTN-XXXX-XXXXX).

    Returns
    -------
    {
      "sales_order": str,
      "quotation":   str,
      "customer":    str,
      "grand_total": float,
      "items":       [{ "item_code", "item_name", "qty", "rate", "amount", "uom" }]
    }
    """
    with _ignore_perms():
        qt = frappe.get_doc(DocType.QUOTATION, quotation)
        assert_customer_access(qt.party_name)

        if qt.docstatus == 2:
            frappe.throw(f"Quotation '{quotation}' is cancelled.", frappe.ValidationError)

        if qt.docstatus == 0:
            # Submit the draft quotation
            try_set_missing_values(qt, "selling.py confirm quotation")
            qt.flags.ignore_permissions = True
            qt.submit()
            frappe.db.commit()

        # Guard: prevent duplicate Sales Orders for the same Quotation --
        # same defense as complete_payment's duplicate-invoice guard, for
        # a retried call after a network timeout on an already-successful
        # request (a plain double-tap is separately blocked client-side).
        so_item_rows = frappe.db.get_all(
            "Sales Order Item",
            filters={"prevdoc_docname": quotation},
            fields=["parent"],
            limit=10,
        )
        if so_item_rows:
            so_parents = list({r["parent"] for r in so_item_rows})
            existing_so = frappe.db.get_value(
                DocType.SALES_ORDER,
                {"name": ["in", so_parents], "docstatus": ["in", [0, 1]]},
                "name",
            )
            if existing_so:
                frappe.throw(
                    f"A Sales Order ({existing_so}) already exists for Quotation '{quotation}'.",
                    frappe.ValidationError,
                )

        # Make Sales Order from the submitted quotation
        # Use _make_sales_order directly so we can pass ignore_permissions=True,
        # which sets target.flags.ignore_permissions on the new SO doc.
        from erpnext.selling.doctype.quotation.quotation import _make_sales_order
        so = _make_sales_order(quotation, ignore_permissions=True)
        so.flags.ignore_permissions = True
        so.delivery_date  = today()
        so.set_warehouse  = get_warehouse()
        # Carry the route_session link forward from the Quotation (a real
        # custom field on both -- see _ensure_route_session_custom_fields)
        # so complete_payment has something real to read later, unlike the
        # old remarks-based attempt which never persisted on either doctype.
        so.route_session = qt.get("route_session")

        try_set_missing_values(so, "selling.py confirm SO")

        frappe.flags.ignore_permissions = True
        so.insert(ignore_permissions=True)
        so.flags.ignore_permissions = True
        frappe.flags.ignore_permissions = True
        so.submit()
        frappe.db.commit()

    return {
        "sales_order": so.name,
        "quotation":   quotation,
        "customer":    so.customer,
        "grand_total": so.grand_total,
        "rounded_total": so.rounded_total,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
                "uom":       d.uom,
            }
            for d in so.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def create_sales_order(customer, items, route_session=None, remarks=None, taxes_and_charges=None):
    """
    sales_pipeline_start == "Sales Order" tier -- a real, standalone Sales
    Order built directly from cart items, deliberately NOT a throwaway
    auto-quotation-then-confirm_order: `confirm_order` requires a source
    Quotation only because it uses ERPNext's `_make_sales_order` mapper,
    which is that specific function's constraint, not the Sales Order
    doctype's. Building one directly from raw items is the ordinary case in
    ERPNext (create_sales_invoice in invoices.py already proves the pattern
    in this codebase) and avoids polluting Quotation List / Quotation Trends
    / Sales Funnel with documents that were never a real quotation -- the
    whole point of a shop choosing this tier is not having those documents.

    No Bin/actual_qty stock check here, unlike create_sales_invoice: a bare
    Sales Order doesn't move stock (only a Delivery Note, Stock Entry, or an
    SI with update_stock=1 do), and confirm_order's own SO creation has no
    such check either -- this stays consistent with that.

    Parameters
    ----------
    customer           : str  – Customer name.
    items              : list – [{ "item_code": str, "qty": float, "rate": float? }]
                                Pass as JSON string via HTTP.
    route_session      : str, optional – Access-checked and persisted onto
                         the Sales Order's `route_session` custom field (see
                         _ensure_route_session_custom_fields) -- Sales Order
                         has no real `remarks` field in ERPNext core, which
                         is why this is a dedicated field rather than reusing
                         the (broken, on this doctype) remarks-tagging
                         convention create_sales_invoice uses.
    remarks            : str, optional – Accepted for signature symmetry with
                         create_quotation/create_sales_invoice; not persisted
                         -- same reason (no real field to hold free text on
                         this doctype), unlike route_session above which now
                         has one purpose-built for it.
    taxes_and_charges  : str, optional – Sales Taxes and Charges Template name;
                         left to set_missing_values()'s own default if omitted.

    Returns
    -------
    {
      "sales_order": str,
      "customer":    str,
      "grand_total": float,
      "items":       [{ "item_code", "item_name", "qty", "rate", "amount", "uom" }]
    }
    """
    if route_session:
        ensure_route_session_access(route_session)
    assert_customer_access(customer)

    if isinstance(items, str):
        items = json.loads(items) if items.strip() else []

    if not items:
        frappe.throw("At least one item is required.", frappe.ValidationError)

    # Idempotency guard -- a submitted Sales Order is the FIRST write in this
    # tier (no earlier draft-Quotation stage to dedupe against the way
    # confirm_order does), so a network-timeout-then-client-retry has nothing
    # else stopping it from creating a second order. Dedupes on customer +
    # today rather than narrowing to this specific route_session -- a
    # coarser check, deliberately: it's still enough to block the retry case
    # that matters, and doesn't depend on route_session being passed at all
    # (a legitimate second same-day order for the same customer is a real
    # but rare edge case worth trading off for that).
    existing_so = frappe.db.get_value(
        DocType.SALES_ORDER,
        {"customer": customer, "transaction_date": today(), "docstatus": ["in", [0, 1]]},
        "name",
    )
    if existing_so:
        frappe.throw(
            f"A Sales Order ({existing_so}) was already created for '{customer}' today.",
            frappe.ValidationError,
        )

    price_list = (
        frappe.db.get_value(DocType.CUSTOMER, customer, "default_price_list")
        or get_default_price_list()
    )

    warehouse = get_warehouse()
    so_items = []
    for row in items:
        item_code = row.get("item_code")
        qty       = float(row.get("qty", 1))

        if not item_code:
            frappe.throw("Each item must have an 'item_code'.", frappe.ValidationError)
        if qty <= 0:
            frappe.throw(f"Quantity must be > 0 for item '{item_code}'.", frappe.ValidationError)

        rate = row.get("rate")
        if rate is None:
            rate = frappe.db.get_value(
                "Item Price",
                {"item_code": item_code, "price_list": price_list},
                "price_list_rate",
            ) or 0

        so_items.append({
            "item_code":   item_code,
            "qty":         qty,
            "rate":        float(rate),
            "warehouse":   warehouse,
            "delivery_date": today(),
        })

    with _ignore_perms():
        so = frappe.get_doc({
            "doctype":            DocType.SALES_ORDER,
            "customer":           customer,
            "company":            get_company(),
            "transaction_date":   today(),
            "delivery_date":      today(),
            "selling_price_list": price_list,
            "set_warehouse":      warehouse,
            "items":              so_items,
            "taxes_and_charges":  taxes_and_charges or None,
            "route_session":      route_session or None,
        })
        try_set_missing_values(so, "selling.py create_sales_order")
        so.insert(ignore_permissions=True)
        so.flags.ignore_permissions = True
        so.submit()
        frappe.db.commit()

    return {
        "sales_order": so.name,
        "customer":    customer,
        "grand_total": so.grand_total,
        "rounded_total": so.rounded_total,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
                "uom":       d.uom,
            }
            for d in so.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def complete_payment(sales_order, mode_of_payment=ModeOfPayment.CASH, due_days=0):
    """
    Step 3 — Create a Sales Invoice from the Sales Order and record payment.

    For Cash/UPI/Bank Transfer: creates a Payment Entry immediately.
    For Credit: invoice is submitted with outstanding amount (no payment entry).

    Parameters
    ----------
    sales_order       : str  – Sales Order name.
    mode_of_payment   : str  – Cash | UPI | Bank Transfer | Credit.
    due_days          : int  – Payment due days (only relevant for Credit).

    Returns
    -------
    {
      "invoice":            str,
      "sales_order":        str,
      "grand_total":        float,
      "rounded_total":      float,
      "outstanding_amount": float,
      "status":             "Submitted" | "Draft",
      "payment_recorded":   bool
    }
    """
    with _ignore_perms():
        so = frappe.get_doc(DocType.SALES_ORDER, sales_order)
        assert_customer_access(so.customer)

        if so.docstatus != 1:
            frappe.throw(f"Sales Order '{sales_order}' is not submitted.", frappe.ValidationError)

        # Guard: prevent duplicate invoices for the same Sales Order
        inv_item_rows = frappe.db.get_all(
            "Sales Invoice Item",
            filters={"sales_order": sales_order},
            fields=["parent"],
            limit=10,
        )
        if inv_item_rows:
            inv_parents = list({r["parent"] for r in inv_item_rows})
            existing_inv = frappe.db.get_value(
                DocType.SALES_INVOICE,
                {"name": ["in", inv_parents], "docstatus": ["in", [0, 1]]},
                "name",
            )
            if existing_inv:
                frappe.throw(
                    f"A Sales Invoice ({existing_inv}) already exists for Sales Order '{sales_order}'.",
                    frappe.ValidationError,
                )

        # ── Make Sales Invoice from Sales Order ───────────────────────────────
        from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice
        sinv = make_sales_invoice(sales_order)

        sinv.debit_to      = get_debit_account()
        sinv.due_date      = add_days(today(), int(due_days))
        sinv.set_warehouse = get_warehouse()
        sinv.update_stock  = 1

        try_set_missing_values(sinv, "selling.py invoice")

        # Carry the route_session marker from the Sales Order to the
        # invoice, for van stock delivered-qty tracking (stock.py's
        # _get_delivered_qty_map_for_session, which greps Sales Invoice
        # .remarks) and for the session summary totals (sessions.py's
        # end_session/get_session_summary, which filter the same way).
        # `so.route_session` is a real custom field (see
        # _ensure_route_session_custom_fields) -- this used to read
        # `so.remarks`, which isn't a real field on Sales Order at all and
        # crashed this entire step with an AttributeError (confirmed live
        # against the LMNTRIX tenant) before an earlier fix this session
        # made it a silent no-op instead. This is the actual fix: a real
        # field with a real value to carry forward, not just "don't crash".
        so_route_session = getattr(so, "route_session", None)
        if not sinv.remarks and so_route_session:
            sinv.remarks = f"{SESSION_REMARK_PREFIX}{so_route_session}"

        # Allow zero valuation so invoice submission doesn't fail for items
        # that have no stock valuation entry yet.
        for item in sinv.items:
            item.allow_zero_valuation_rate = 1

        sinv.flags.ignore_permissions = True
        sinv.insert(ignore_permissions=True)

        status       = "Draft"
        submit_error = None
        try:
            sinv.flags.ignore_permissions = True
            frappe.flags.ignore_permissions = True
            sinv.submit()
            status = "Submitted"
        except Exception as e:
            frappe.log_error(frappe.get_traceback(), "Sales Invoice Submit Error (selling.py)")
            submit_error = str(e)

        frappe.db.commit()

    # ── Record payment (skip for Credit) ──────────────────────────────────────
    payment_recorded = False
    if sinv.docstatus == 1 and mode_of_payment and mode_of_payment.lower() != "credit":
        payment_recorded = record_payment_for_invoice(sinv, mode_of_payment)
        if payment_recorded:
            # The Payment Entry submit above updates outstanding_amount in the
            # DB via ERPNext's own hooks -- sinv is still the pre-payment copy.
            sinv.reload()

    return {
        "invoice":            sinv.name,
        "sales_order":        sales_order,
        "grand_total":        sinv.grand_total,
        "rounded_total":      sinv.rounded_total,
        "outstanding_amount": sinv.outstanding_amount,
        "status":             status,
        "submit_error":       submit_error,
        "payment_recorded":   payment_recorded,
    }


@frappe.whitelist()
def get_quotation(quotation):
    """
    Fetch Quotation details.

    Returns
    -------
    { "quotation", "customer", "status", "docstatus", "grand_total", "items" }
    """
    qt = frappe.get_doc(DocType.QUOTATION, quotation)
    assert_customer_access(qt.party_name)

    return {
        "quotation":   qt.name,
        "customer":    qt.party_name,
        "status":      qt.status,
        "docstatus":   qt.docstatus,
        "grand_total": qt.grand_total,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
                "uom":       d.uom,
            }
            for d in qt.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def start_sale(customer, items, route_session=None, remarks=None, mode_of_payment=None, due_days=0):
    """
    The one entry point Route Sales's cart screen calls to turn a cart into
    something -- dispatches on Route Sales Settings.sales_pipeline_start so
    the tier decision lives entirely server-side, not scattered across
    frontend if-branches. See the module docstring for the three tiers.

    Resolves the default Sales Taxes and Charges Template once here and
    passes it explicitly into whichever tier function runs, so the same
    cart gets the same tax treatment regardless of which tier a tenant is
    on -- each of create_quotation/create_sales_order/create_sales_invoice
    otherwise has its own slightly different default-tax behavior, which
    would mean this feature added drift by accident rather than by design.

    Parameters
    ----------
    customer         : str  – Customer name.
    items            : list – [{ "item_code": str, "qty": float, "rate": float? }]
                              Pass as JSON string via HTTP.
    route_session    : str, optional – Links the created document to a Route
                       Session where the tier's underlying doctype supports
                       it (Quotation, Sales Invoice); the Sales Order tier
                       can't carry this (see create_sales_order's docstring).
    remarks          : str, optional – Free-text remarks.
    mode_of_payment  : str, optional – Only used by the Sales Invoice tier
                       (billed immediately); ignored otherwise.
    due_days         : int, optional – Only used by the Sales Invoice tier.

    Returns
    -------
    The underlying tier function's own return dict, plus a "stage" key:
    "quotation" | "sales_order" | "sales_invoice" -- the frontend uses this
    to decide which screen to land on next.
    """
    pipeline_start = get_sales_pipeline_start()
    taxes_and_charges = get_default_taxes_and_charges_template()

    if pipeline_start == "Sales Order":
        result = create_sales_order(
            customer=customer, items=items, route_session=route_session,
            remarks=remarks, taxes_and_charges=taxes_and_charges,
        )
        return {"stage": "sales_order", **result}

    if pipeline_start == "Sales Invoice":
        from route_sales.api.invoices import create_sales_invoice
        result = create_sales_invoice(
            customer=customer, items=items, route_session=route_session,
            mode_of_payment=mode_of_payment or ModeOfPayment.CASH, due_days=due_days,
            taxes_and_charges=taxes_and_charges, remarks=remarks,
        )
        return {"stage": "sales_invoice", **result}

    # Default / "Quotation" -- today's unchanged behavior.
    result = create_quotation(
        customer=customer, items=items, route_session=route_session,
        remarks=remarks, taxes_and_charges=taxes_and_charges,
    )
    return {"stage": "quotation", **result}
