"""
route_sales.api.crm
====================
Lead-to-quotation CRM pipeline, gated by Route Sales Settings.enable_lead_crm.

Distinct from route_sales.api.leads (that module is route-sales' own
lead-capture flow, access-controlled by `owner` = whoever captured the
lead while out on a route). This module is for the admin-assigns-a-lead-
to-a-salesperson model instead, access-controlled by Lead.lead_owner.

GET  /api/method/route_sales.api.crm.get_my_leads
GET  /api/method/route_sales.api.crm.list_districts
POST /api/method/route_sales.api.crm.create_lead
GET  /api/method/route_sales.api.crm.get_lead_detail
POST /api/method/route_sales.api.crm.log_followup
POST /api/method/route_sales.api.crm.update_lead_status
POST /api/method/route_sales.api.crm.create_quotation_for_lead
POST /api/method/route_sales.api.crm.renegotiate_quotation
GET  /api/method/route_sales.api.crm.get_quotation_history
GET  /api/method/route_sales.api.crm.get_my_quotations
GET  /api/method/route_sales.api.crm.get_my_day_summary
GET  /api/method/route_sales.api.crm.list_salespeople
POST /api/method/route_sales.api.crm.assign_leads
POST /api/method/route_sales.api.crm.unassign_leads
GET  /api/method/route_sales.api.crm.salesperson_conversion_stats
GET  /api/method/route_sales.api.crm.list_payment_terms_templates
GET  /api/method/route_sales.api.crm.list_items
"""

import contextlib
import json

import frappe
from frappe.utils import add_days, now_datetime, today

from route_sales.api.constants import DocType, RoleName, get_company, get_default_price_list, get_default_taxes_and_charges_template
from route_sales.api.route_utils import try_set_missing_values
from route_sales.api.security import is_manager, only_manager, require_login
from route_sales.api.utils import paginate


@contextlib.contextmanager
def _ignore_perms():
    frappe.flags.ignore_permissions = True
    try:
        yield
    finally:
        frappe.flags.ignore_permissions = False


def _assert_lead_access(lead_doc):
    """A salesperson may only act on leads assigned (lead_owner) to them; managers may act on any lead."""
    require_login()
    if is_manager():
        return
    if lead_doc.lead_owner != frappe.session.user:
        frappe.throw(f"Lead '{lead_doc.name}' is not assigned to you.", frappe.PermissionError)


@frappe.whitelist()
def get_my_leads(
    status=None, lead_owner=None, district=None, territory=None,
    created_today=None, follow_up_due=None, quotation_today=None,
    page=1, page_length=50,
):
    """
    Leads assigned to the current user (Lead.lead_owner). Managers may omit
    lead_owner filtering to see every lead in the pipeline, or pass it
    explicitly -- a specific salesperson's user id, or the sentinel
    "__unassigned__" -- to power the admin Leads page's filters. Non-managers
    can never see anyone else's leads; lead_owner is ignored for them.
    district/territory both filter on the exact value, meant to be
    populated from list_districts()/list_territories() rather than typed,
    so they always match.

    created_today/follow_up_due/quotation_today back the My Day / admin
    overview KPI cards' drill-down links -- each mirrors the exact
    definition get_my_day_summary uses for the matching count, so the
    number shown on a card always matches what the drill-down lists.
    follow_up_due is "today", "overdue", or "due" (today + overdue, what
    the "Follow-ups Due" card sums).
    """
    require_login()
    page, page_length = paginate(page, page_length)

    # List-of-conditions form (not a dict) so next_follow_up_date can carry
    # two conditions at once (is-set + before/on today) -- a dict would let
    # the second overwrite the first, and without the is-set guard MariaDB's
    # "<=" against a null/empty date column matches every unset lead too.
    if is_manager():
        # lead_pipeline scopes out leads captured by the older route-sales
        # lead-capture flow (leads.py) -- it never sets lead_owner, so
        # without this a manager's unfiltered/__unassigned__ view would mix
        # those in with genuine CRM leads (see _ensure_lead_custom_fields).
        filters = [["lead_pipeline", "=", "Lead & Quotation"]]
        if lead_owner == "__unassigned__":
            filters.append(["lead_owner", "is", "not set"])
        elif lead_owner:
            filters.append(["lead_owner", "=", lead_owner])
    else:
        filters = [["lead_owner", "=", frappe.session.user]]
    if status:
        filters.append(["status", "=", status])
    if district:
        filters.append(["district", "=", district])
    if territory:
        filters.append(["territory", "=", territory])
    if created_today:
        filters.append(["creation", "like", f"{today()}%"])
    if follow_up_due == "today":
        filters.append(["next_follow_up_date", "=", today()])
    elif follow_up_due == "overdue":
        filters.append(["next_follow_up_date", "is", "set"])
        filters.append(["next_follow_up_date", "<", today()])
    elif follow_up_due == "due":
        filters.append(["next_follow_up_date", "is", "set"])
        filters.append(["next_follow_up_date", "<=", today()])
    if quotation_today:
        candidate_names = frappe.get_all("Lead", filters=filters, pluck="name")
        quoted_today = set()
        if candidate_names:
            quotations = frappe.get_all(
                DocType.QUOTATION,
                filters={
                    "party_name": ["in", candidate_names],
                    "quotation_to": "Lead",
                    "docstatus": 1,
                },
                fields=["party_name", "creation"],
            )
            today_str = today()
            quoted_today = {q["party_name"] for q in quotations if str(q["creation"])[:10] == today_str}
        filters.append(["name", "in", list(quoted_today) or [""]])

    rows = frappe.get_all(
        "Lead",
        filters=filters,
        fields=[
            "name", "lead_name", "company_name", "mobile_no", "status",
            "lead_owner", "territory", "district", "next_follow_up_date", "modified",
        ],
        order_by="modified desc",
        limit_start=(page - 1) * page_length,
        limit_page_length=page_length,
    )
    total = frappe.db.count("Lead", filters=filters)
    return {"total": total, "leads": rows}


@frappe.whitelist()
def list_districts():
    """
    Distinct district values already in use across all leads -- backs the
    admin Leads page's district filter and doubles as a sanity list for the
    create-lead form. district itself stays free text (matches
    route_sales.api.leads' own established convention for this same field)
    rather than a fixed enum, since this app isn't tied to one region.
    """
    require_login()
    values = frappe.get_all(
        "Lead",
        filters={"district": ["is", "set"], "lead_pipeline": "Lead & Quotation"},
        pluck="district",
    )
    return sorted({v.strip() for v in values if v and v.strip()})


@frappe.whitelist()
def list_territories():
    """Distinct Territory values already in use across leads -- same
    already-in-use philosophy as list_districts(), so the filter never
    offers an option with zero matching leads."""
    require_login()
    values = frappe.get_all(
        "Lead",
        filters={"territory": ["is", "set"], "lead_pipeline": "Lead & Quotation"},
        pluck="territory",
    )
    return sorted({v.strip() for v in values if v and v.strip()})


@frappe.whitelist()
def list_all_territories():
    """
    Every Territory doctype record, not just ones already in use by a lead
    -- backs the create-lead form's Territory picker, where a brand-new
    territory has to be selectable even before any lead uses it. Distinct
    from list_territories(), which intentionally stays scoped to in-use
    values for the admin filter (so that filter never offers a dead option).
    """
    require_login()
    return frappe.get_all("Territory", pluck="name", order_by="name")


@frappe.whitelist()
def list_countries():
    """Every Country doctype record -- backs the create-lead form's Country picker."""
    require_login()
    return frappe.get_all("Country", pluck="name", order_by="name")


@frappe.whitelist()
def list_states():
    """Distinct Lead.state values already in use -- state is plain Data
    (not a Link, no fixed doctype behind it), so this follows the same
    in-use/free-text philosophy as list_districts() rather than
    list_all_territories()'s full-doctype-listing approach."""
    require_login()
    values = frappe.get_all(
        "Lead",
        filters={"state": ["is", "set"], "lead_pipeline": "Lead & Quotation"},
        pluck="state",
    )
    return sorted({v.strip() for v in values if v and v.strip()})


@frappe.whitelist(methods=["POST"])
def create_lead(lead_name, territory=None, district=None, company_name=None, mobile_no=None, state=None, country=None):
    """
    Self-service lead creation for a salesperson working the pipeline --
    auto-assigned to whoever creates it (lead_owner = session user), the
    walk-up/cold-call equivalent of the admin assigning one instead.
    territory is the only mandatory field -- enforced here so every CRM
    lead can be filtered/bulk-assigned by territory from the admin side.
    district/state/country are optional context (district's own reqd=1
    was dropped -- see leads.py's _ensure_lead_custom_fields -- so this
    endpoint accepting it unset no longer hits a MandatoryError on insert).
    """
    require_login()
    if not (lead_name or "").strip():
        frappe.throw("Lead name is required.", frappe.ValidationError)
    if not (territory or "").strip():
        frappe.throw("Territory is required.", frappe.ValidationError)

    with _ignore_perms():
        doc = frappe.get_doc({
            "doctype": "Lead",
            "lead_name": lead_name.strip(),
            "company_name": (company_name or "").strip() or None,
            "mobile_no": (mobile_no or "").strip() or None,
            "district": (district or "").strip() or None,
            "territory": territory.strip(),
            "state": (state or "").strip() or None,
            "country": (country or "").strip() or None,
            "lead_owner": frappe.session.user,
            "status": "Lead",
            "lead_pipeline": "Lead & Quotation",
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

    return {"name": doc.name, "lead_name": doc.lead_name}


def _quotations_for_lead(lead, with_items=False):
    """
    All Quotations for a Lead, oldest first (matches version order: index 0
    is the original, later entries are its amended_from chain). Item detail
    is included only when with_items=True (used to pre-fill the renegotiate
    modal) -- get_quotation_history doesn't need it, just the summary list.
    """
    rows = frappe.get_all(
        DocType.QUOTATION,
        filters={"party_name": lead, "quotation_to": "Lead"},
        fields=[
            "name", "status", "docstatus", "grand_total", "net_total",
            "total_taxes_and_charges", "amended_from",
            "transaction_date", "creation", "payment_terms_template",
        ],
        order_by="creation asc",
    )
    if not with_items or not rows:
        return rows

    item_rows = frappe.get_all(
        "Quotation Item",
        filters={"parent": ["in", [r["name"] for r in rows]]},
        fields=["parent", "item_code", "item_name", "qty", "rate", "amount", "uom"],
    )
    items_by_parent = {}
    for item in item_rows:
        items_by_parent.setdefault(item["parent"], []).append({
            "item_code": item["item_code"], "item_name": item["item_name"],
            "qty": item["qty"], "rate": item["rate"], "amount": item["amount"], "uom": item["uom"],
        })
    for row in rows:
        row["items"] = items_by_parent.get(row["name"], [])
    return rows


@frappe.whitelist()
def get_lead_detail(lead):
    require_login()
    doc = frappe.get_doc("Lead", lead)
    _assert_lead_access(doc)

    notes = [
        {
            "note": n.note,
            "added_by": n.added_by,
            "added_on": str(n.added_on) if n.added_on else None,
        }
        for n in reversed(doc.notes or [])
    ]
    quotations = _quotations_for_lead(lead, with_items=True)

    return {
        "name": doc.name,
        "lead_name": doc.lead_name,
        "company_name": doc.company_name,
        "mobile_no": doc.mobile_no,
        "status": doc.status,
        "lead_owner": doc.lead_owner,
        "territory": doc.territory,
        "next_follow_up_date": doc.get("next_follow_up_date"),
        "notes": notes,
        "quotations": quotations,
    }


@frappe.whitelist(methods=["POST"])
def log_followup(lead, type, notes, next_follow_up_date=None):
    """
    Log a call or visit against a lead. Tagged into the note text itself
    ("[Call] ..." / "[Visit] ...") rather than a schema change -- Lead's
    notes child table (CRM Note) only has note/added_by/added_on, and this
    app already uses the same text-prefix convention elsewhere (see
    SESSION_REMARK_PREFIX in constants.py) instead of customizing core
    child doctypes.

    type : "Call" | "Visit"
    """
    require_login()
    if type not in ("Call", "Visit"):
        frappe.throw("type must be 'Call' or 'Visit'.", frappe.ValidationError)
    if not (notes or "").strip():
        frappe.throw("Notes are required.", frappe.ValidationError)

    doc = frappe.get_doc("Lead", lead)
    _assert_lead_access(doc)

    doc.append("notes", {
        "note": f"[{type}] {notes.strip()}",
        "added_by": frappe.session.user,
        "added_on": now_datetime(),
    })
    if next_follow_up_date:
        doc.next_follow_up_date = next_follow_up_date

    doc.flags.ignore_permissions = True
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"lead": doc.name, "next_follow_up_date": doc.get("next_follow_up_date")}


@frappe.whitelist(methods=["POST"])
def update_lead_status(lead, status):
    require_login()
    doc = frappe.get_doc("Lead", lead)
    _assert_lead_access(doc)

    # Read the doctype's own Select options rather than hardcoding the
    # list, so this can't drift out of sync if it's ever changed -- same
    # reasoning as _reset_stale_no_copy_fields reading no_copy off meta
    # instead of a fixed field list. Without this, an invalid value would
    # still get rejected (Frappe's own Select-field validation), just with
    # a raw, unfriendly error instead of a clear one naming the actual
    # allowed values.
    valid_statuses = [o for o in (doc.meta.get_field("status").options or "").split("\n") if o]
    if status not in valid_statuses:
        frappe.throw(
            f"Invalid status '{status}'. Must be one of: {', '.join(valid_statuses)}.",
            frappe.ValidationError,
        )

    doc.status = status
    doc.flags.ignore_permissions = True
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"lead": doc.name, "status": doc.status}


def _item_validity_map(item_codes):
    """
    Batch existence/disabled check for a set of item codes, one query
    instead of one per row. Covers the gap where an item already sitting
    on a draft or submitted Quotation gets deleted or disabled from the
    Item master afterward: Frappe's own Link-field validation on
    Quotation Item.item_code only catches an outright-deleted item, and
    only as a raw, unfriendly error deep inside insert()/save() -- a
    disabled item passes that check silently, since Link validation just
    confirms the row exists, it doesn't enforce disabled=0. Used both to
    reject a bad item_code up front (_build_quotation_items) and to flag
    an already-saved row as stale for display (_quotation_summary).
    """
    item_codes = {c for c in item_codes if c}
    if not item_codes:
        return {}
    existing = frappe.get_all(
        "Item", filters={"item_code": ["in", list(item_codes)]}, fields=["item_code", "disabled"],
    )
    found = {d.item_code: bool(d.disabled) for d in existing}
    return {code: {"exists": code in found, "disabled": found.get(code, False)} for code in item_codes}


def _build_quotation_items(items, price_list):
    """Shared item-row validation/building for both create and renegotiate --
    mirrors selling.py's create_quotation validation exactly."""
    if isinstance(items, str):
        items = json.loads(items) if items.strip() else []
    if not items:
        frappe.throw("At least one item is required.", frappe.ValidationError)

    validity = _item_validity_map(row.get("item_code") for row in items)

    rows = []
    for row in items:
        item_code = row.get("item_code")
        qty = float(row.get("qty", 1))
        if not item_code:
            frappe.throw("Each item must have an 'item_code'.", frappe.ValidationError)
        if qty <= 0:
            frappe.throw(f"Quantity must be > 0 for item '{item_code}'.", frappe.ValidationError)
        info = validity.get(item_code, {})
        if not info.get("exists"):
            frappe.throw(
                f"'{item_code}' no longer exists in the item catalog -- remove it from this quotation before saving.",
                frappe.ValidationError,
            )
        if info.get("disabled"):
            frappe.throw(
                f"'{item_code}' has been disabled and can no longer be quoted -- remove it from this quotation before saving.",
                frappe.ValidationError,
            )

        rate = row.get("rate")
        if rate is None:
            rate = frappe.db.get_value(
                "Item Price", {"item_code": item_code, "price_list": price_list}, "price_list_rate"
            ) or 0
        rows.append({"item_code": item_code, "qty": qty, "rate": float(rate)})
    return rows


def _apply_default_taxes(doc):
    """
    Append this company's default Sales Taxes and Charges Template rows onto
    a new Quotation. Explicit, not left to core's own auto-apply (Accounts
    Settings.add_taxes_from_taxes_and_charges_template is off on this site,
    same as most fresh installs), so route_sales controls this rather than
    depending on a global setting nobody here has turned on. A no-op when no
    default template is configured (e.g. genuinely GST-unregistered) --
    never guesses a rate.
    """
    template = get_default_taxes_and_charges_template()
    if not template:
        return
    from erpnext.controllers.accounts_controller import get_taxes_and_charges
    doc.taxes_and_charges = template
    for row in get_taxes_and_charges("Sales Taxes and Charges Template", template):
        doc.append("taxes", row)


# ERPNext core's Lead.set_status() (called unconditionally by Quotation's
# own on_submit/on_cancel) recomputes status from just 4 conditions
# (has_lost_quotation/has_opportunity/has_quotation/has_customer) and
# writes it straight to the DB -- with zero awareness of this app's own
# extra vocabulary. Any lead sitting in one of these five when a quotation
# submit/cancel fires gets silently clobbered back into core's 4-value set,
# even though core has no informed opinion about them at all -- e.g. "Do
# Not Contact" reverting to "Quotation" the moment that lead's quotation is
# renegotiated (renegotiate cancels the original as its first step, which
# alone triggers this).
_CUSTOM_ONLY_LEAD_STATUSES = {"Open", "Replied", "Interested", "Lost Quotation", "Do Not Contact"}


def _preserve_custom_lead_status(lead_name, fn):
    """Run fn() (a Quotation submit()/cancel() call), then restore the
    Lead's status if core's own on_submit/on_cancel just overwrote one of
    this app's custom-only values -- see _CUSTOM_ONLY_LEAD_STATUSES above."""
    before = frappe.db.get_value("Lead", lead_name, "status")
    result = fn()
    if before in _CUSTOM_ONLY_LEAD_STATUSES:
        frappe.db.set_value("Lead", lead_name, "status", before, update_modified=False)
    return result


def _reset_stale_no_copy_fields(doc, skip=()):
    """
    frappe.copy_doc()'s ignore_no_copy=True default carries every no_copy
    field on the source doc into the copy verbatim, not just the ones a
    caller explicitly overwrites afterward -- payment_schedule's stale due
    dates (fixed directly, in renegotiate_quotation below) were one
    symptom; order_lost_reason/lost_reasons carrying a Lost quotation's
    stale reason into a fresh renegotiated draft is another. Rather than
    patch each field as its own bug turns up, reset every no_copy field
    the doctype actually declares (skipping whatever the caller is about
    to set itself) back to its natural "unset" value, so a fresh copy
    starts genuinely fresh regardless of which fields get added later.
    """
    skip = set(skip)
    for df in frappe.get_meta(doc.doctype).fields:
        if not df.no_copy or df.fieldname in skip:
            continue
        if df.fieldtype == "Table":
            doc.set(df.fieldname, [])
        elif df.fieldtype == "Check":
            doc.set(df.fieldname, 0)
        elif df.fieldtype in ("Int", "Float", "Currency", "Percent"):
            doc.set(df.fieldname, 0)
        else:
            doc.set(df.fieldname, None)


def _check_quotation_approval_authority(doc):
    """
    ERPNext core's Quotation.on_submit() unconditionally calls this same
    Authorization Control check -- a no-op today since no Authorization
    Rule is configured on this site (the check itself early-returns when
    none exist), but a client could add one later via the Desk with zero
    code change, and a raw Frappe validation error ("Can be approved by
    ...") would have no path forward in the mobile app. Calling the
    identical check proactively, before submit(), lets us surface a clean,
    actionable message instead -- and still costs nothing in the common
    no-rule case.
    """
    try:
        frappe.get_cached_doc("Authorization Control").validate_approving_authority(
            doc.doctype, doc.company, doc.base_grand_total, doc
        )
    except frappe.ValidationError:
        frappe.throw(
            "This quotation's value requires manager approval before it can be submitted. "
            "Contact your manager or admin to approve it.",
            frappe.ValidationError,
        )


def _quotation_summary(doc):
    # Flags a row whose Item master has since been deleted or disabled --
    # the child table's own item_name/rate/uom are a snapshot from when the
    # row was added, so a stale item still displays fine; what it can't do
    # any more is be saved as-is (see _build_quotation_items). Surfacing
    # that here, on plain read, means the frontend can warn about it (and
    # let the user remove it) before they even touch Save, not just after
    # a save-time error round-trip.
    validity = _item_validity_map(d.item_code for d in doc.items)
    return {
        "quotation": doc.name,
        "amended_from": doc.amended_from,
        "docstatus": doc.docstatus,
        "grand_total": doc.grand_total,
        "net_total": doc.net_total,
        "total_taxes_and_charges": doc.total_taxes_and_charges,
        "status": doc.status,
        "payment_terms_template": doc.payment_terms_template,
        "items": [
            {
                "item_code": d.item_code, "item_name": d.item_name,
                "qty": d.qty, "rate": d.rate, "amount": d.amount, "uom": d.uom,
                "item_unavailable": not validity.get(d.item_code, {}).get("exists")
                    or validity.get(d.item_code, {}).get("disabled", False),
            }
            for d in doc.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def create_quotation_for_lead(lead, items, payment_terms_template=None):
    """
    Step 1 of the negotiation chain -- creates a draft Quotation against the
    Lead directly (quotation_to="Lead"), representing the first price
    offered. Left as a draft (docstatus 0); the caller submits it separately
    via submit_quotation once reviewed. Every later price change goes
    through renegotiate_quotation instead of editing this in place, so the
    full offer history stays a real, auditable document chain.
    """
    require_login()

    lead_doc = frappe.get_doc("Lead", lead)
    _assert_lead_access(lead_doc)

    # Guard: the frontend (LeadDetail.jsx) already only offers "Create
    # Quotation" when the lead has no active one, but that's a UI
    # convention, not an enforced invariant -- nothing stops a second,
    # independent call from starting a parallel quotation chain
    # disconnected from the amended_from audit trail this docstring
    # promises. A genuine price revision belongs in renegotiate_quotation.
    existing_active = frappe.db.get_value(
        DocType.QUOTATION,
        {"party_name": lead, "quotation_to": "Lead", "docstatus": ["in", [0, 1]]},
        "name",
    )
    if existing_active:
        frappe.throw(
            f"Lead '{lead}' already has an active quotation ({existing_active}). "
            "Use renegotiate to revise it instead of creating a new one.",
            frappe.ValidationError,
        )

    price_list = get_default_price_list()
    quotation_items = _build_quotation_items(items, price_list)

    with _ignore_perms():
        qt = frappe.get_doc({
            "doctype": DocType.QUOTATION,
            "quotation_to": "Lead",
            "party_name": lead,
            "company": get_company(),
            "transaction_date": today(),
            "valid_till": add_days(today(), 7),
            "selling_price_list": price_list,
            "items": quotation_items,
            "payment_terms_template": payment_terms_template or None,
        })
        _apply_default_taxes(qt)
        try_set_missing_values(qt, "crm.py create_quotation_for_lead")
        qt.insert(ignore_permissions=True)
        frappe.db.commit()

    return _quotation_summary(qt)


@frappe.whitelist(methods=["POST"])
def save_quotation_draft(quotation, items, payment_terms_template=None):
    """Re-save a draft Quotation's items/terms in place before it's submitted."""
    require_login()

    doc = frappe.get_doc(DocType.QUOTATION, quotation)
    if doc.quotation_to != "Lead":
        frappe.throw("Only Lead quotations can be edited through this endpoint.", frappe.ValidationError)
    lead_doc = frappe.get_doc("Lead", doc.party_name)
    _assert_lead_access(lead_doc)

    if doc.docstatus != 0:
        frappe.throw(f"Quotation '{quotation}' is not a draft.", frappe.ValidationError)

    price_list = doc.selling_price_list or get_default_price_list()
    quotation_items = _build_quotation_items(items, price_list)

    with _ignore_perms():
        doc.items = []
        for row in quotation_items:
            doc.append("items", row)
        if payment_terms_template is not None:
            doc.payment_terms_template = payment_terms_template or None
        doc.flags.ignore_permissions = True
        try_set_missing_values(doc, "crm.py save_quotation_draft")
        doc.save(ignore_permissions=True)
        frappe.db.commit()

    return _quotation_summary(doc)


@frappe.whitelist(methods=["POST"])
def submit_quotation(quotation):
    """Submit a draft Quotation -- the explicit follow-up step after create
    or amend, matching Frappe's own Save-then-Submit document lifecycle."""
    require_login()

    doc = frappe.get_doc(DocType.QUOTATION, quotation)
    if doc.quotation_to != "Lead":
        frappe.throw("Only Lead quotations can be submitted through this endpoint.", frappe.ValidationError)
    lead_doc = frappe.get_doc("Lead", doc.party_name)
    _assert_lead_access(lead_doc)

    if doc.docstatus != 0:
        frappe.throw(f"Quotation '{quotation}' is not a draft.", frappe.ValidationError)

    with _ignore_perms():
        doc.flags.ignore_permissions = True
        _check_quotation_approval_authority(doc)
        _preserve_custom_lead_status(doc.party_name, doc.submit)
        frappe.db.commit()

    return _quotation_summary(doc)


@frappe.whitelist(methods=["POST"])
def discard_quotation_draft(quotation):
    """Delete a draft Quotation the salesperson decided not to keep."""
    require_login()

    # Idempotent: a network-timeout-then-retry after an already-successful
    # discard would otherwise hit DoesNotExistError on the second attempt,
    # even though the first call already reached the desired end state.
    if not frappe.db.exists(DocType.QUOTATION, quotation):
        return {"discarded": quotation}

    doc = frappe.get_doc(DocType.QUOTATION, quotation)
    if doc.quotation_to != "Lead":
        frappe.throw("Only Lead quotations can be discarded through this endpoint.", frappe.ValidationError)
    lead_doc = frappe.get_doc("Lead", doc.party_name)
    _assert_lead_access(lead_doc)

    if doc.docstatus != 0:
        frappe.throw(f"Quotation '{quotation}' is not a draft.", frappe.ValidationError)

    with _ignore_perms():
        frappe.delete_doc(DocType.QUOTATION, quotation, ignore_permissions=True)
        frappe.db.commit()

    return {"discarded": quotation}


@frappe.whitelist(methods=["POST"])
def cancel_quotation(quotation):
    """Cancel a submitted Quotation outright, with no replacement created --
    distinct from renegotiate_quotation, which cancels and immediately
    starts an amended draft. This is for when the offer is simply off."""
    require_login()

    doc = frappe.get_doc(DocType.QUOTATION, quotation)
    if doc.quotation_to != "Lead":
        frappe.throw("Only Lead quotations can be cancelled through this endpoint.", frappe.ValidationError)
    lead_doc = frappe.get_doc("Lead", doc.party_name)
    _assert_lead_access(lead_doc)

    if doc.docstatus != 1:
        frappe.throw(f"Quotation '{quotation}' is not active.", frappe.ValidationError)

    with _ignore_perms():
        doc.flags.ignore_permissions = True
        _preserve_custom_lead_status(doc.party_name, doc.cancel)
        frappe.db.commit()

    return _quotation_summary(doc)


@frappe.whitelist(methods=["POST"])
def renegotiate_quotation(quotation, items, payment_terms_template=None):
    """
    Cancels the current submitted Quotation and creates a new amended draft
    with the renegotiated items/rates -- matching Frappe's own native
    Cancel + Amend document lifecycle exactly: the amended copy is left as
    an untouched draft (docstatus 0), submitting it is a separate later
    submit_quotation call, not bundled into this one. So the price history
    for this lead is a real Frappe document chain
    (QTN-0001 -> QTN-0001-1 -> QTN-0001-2 ...) via the standard cancel +
    amended_from pattern (frappe/model/document.py's own validate_amended_from
    requires the referenced doc to be docstatus=2, i.e. already cancelled;
    frappe.copy_doc strips amended_from during the copy, so it's set again
    afterward -- same sequence the desk's own "Amend" button performs).
    """
    require_login()

    original = frappe.get_doc(DocType.QUOTATION, quotation)
    if original.quotation_to != "Lead":
        frappe.throw("Only Lead quotations can be renegotiated through this endpoint.", frappe.ValidationError)

    lead_doc = frappe.get_doc("Lead", original.party_name)
    _assert_lead_access(lead_doc)

    # docstatus 1 (submitted): normal case, cancel then amend below.
    # docstatus 2 (already cancelled): either genuinely already renegotiated
    # (existing_amendment set -- tell the caller which one to use instead),
    # or a resumed retry after a crash between the cancel and the amend
    # (existing_amendment None -- skip re-cancelling, create the amended doc
    # now). docstatus 0 (draft): edit it directly instead of amending.
    existing_amendment = frappe.db.get_value(DocType.QUOTATION, {"amended_from": original.name}, "name")
    if original.docstatus == 2 and existing_amendment:
        frappe.throw(
            f"Quotation '{quotation}' has already been renegotiated as '{existing_amendment}'.",
            frappe.ValidationError,
        )
    if original.docstatus == 0:
        frappe.throw(f"Quotation '{quotation}' is still a draft -- edit it directly instead of renegotiating.", frappe.ValidationError)

    price_list = original.selling_price_list or get_default_price_list()
    quotation_items = _build_quotation_items(items, price_list)

    with _ignore_perms():
        if original.docstatus == 1:
            original.flags.ignore_permissions = True
            _preserve_custom_lead_status(original.party_name, original.cancel)
            frappe.db.commit()

        amended = frappe.copy_doc(original)
        # Reset every no_copy field on the doctype except the ones set
        # explicitly below (or via items/payment_terms_template further
        # down) -- see _reset_stale_no_copy_fields for why this needs to
        # be generic rather than a field fixed to whatever's caused a bug
        # so far.
        _reset_stale_no_copy_fields(amended, skip={
            "naming_series", "amended_from", "transaction_date", "valid_till",
            "items", "payment_terms_template", "payment_schedule",
        })
        amended.amended_from = original.name
        amended.docstatus = 0
        amended.transaction_date = today()
        amended.valid_till = add_days(today(), 7)
        amended.items = []
        for row in quotation_items:
            amended.append("items", row)
        if payment_terms_template:
            amended.payment_terms_template = payment_terms_template
        # copy_doc carries over the original's payment_schedule rows verbatim
        # -- due dates computed against ITS transaction_date, not the new one
        # set above. ERPNext's own set_payment_schedule() only regenerates
        # the schedule when it's empty (accounts_controller.py), so a stale
        # copied due date earlier than the new transaction_date survives and
        # fails the "Due Date cannot be before Posting Date" check on
        # insert/submit. Clearing it here forces a fresh regeneration against
        # today's date (or the newly-set template, if one was passed).
        amended.payment_schedule = []

        amended.flags.ignore_permissions = True
        try_set_missing_values(amended, "crm.py renegotiate_quotation")
        amended.insert(ignore_permissions=True)
        frappe.db.commit()

    return _quotation_summary(amended)


@frappe.whitelist()
def get_quotation_history(lead):
    require_login()
    lead_doc = frappe.get_doc("Lead", lead)
    _assert_lead_access(lead_doc)

    return _quotations_for_lead(lead)


@frappe.whitelist()
def get_quotation_detail(quotation):
    """
    Full detail for one Quotation -- items, totals, docstatus -- the one
    canonical shape QuotationViewModal reads from regardless of whether the
    caller already has a lighter-weight summary (e.g. get_my_quotations'
    per-lead head row) or full detail (get_lead_detail's quotations list).
    """
    require_login()
    doc = frappe.get_doc(DocType.QUOTATION, quotation)
    if doc.quotation_to != "Lead":
        frappe.throw("Only Lead quotations can be viewed through this endpoint.", frappe.ValidationError)
    lead_doc = frappe.get_doc("Lead", doc.party_name)
    _assert_lead_access(lead_doc)

    # What superseded this one, if it was cancelled and renegotiated --
    # same lookup renegotiate_quotation already does internally. Returned
    # directly so QuotationViewModal doesn't need a second API call
    # (fetching this lead's entire quotation history) just to find it.
    successor = frappe.db.get_value(DocType.QUOTATION, {"amended_from": doc.name}, "name")

    return {**_quotation_summary(doc), "lead": doc.party_name, "successor": successor}


@frappe.whitelist()
def get_my_quotations(page=1, page_length=50, sent_today=None):
    """
    One row per lead (that has at least one quotation), showing its current
    "head" quotation -- the submitted one if there is one, otherwise the
    most recent draft/cancelled -- for the dashboard's Quotations tile.
    Full version history is still available via get_quotation_history /
    get_lead_detail once the salesperson drills into that lead.

    sent_today backs the Dashboard "Sent Today" stat card's drill-down --
    filters to heads that are themselves submitted and created today,
    mirroring get_my_day_summary's quotations_sent_today definition as
    closely as this one-row-per-lead list's own granularity allows (a lead
    amended more than once today still contributes only its current head).
    """
    require_login()
    page, page_length = paginate(page, page_length)

    # lead_pipeline excludes leads captured by the older route-sales
    # lead-capture flow -- see get_my_leads / _ensure_lead_custom_fields.
    lead_filters = (
        {"lead_pipeline": "Lead & Quotation"} if is_manager()
        else {"lead_owner": frappe.session.user}
    )
    leads = frappe.get_all("Lead", filters=lead_filters, fields=["name", "lead_name", "company_name"])
    if not leads:
        return {"total": 0, "quotations": []}
    lead_map = {l["name"]: l for l in leads}

    all_rows = frappe.get_all(
        DocType.QUOTATION,
        filters={"party_name": ["in", list(lead_map.keys())], "quotation_to": "Lead"},
        fields=["name", "party_name", "status", "docstatus", "grand_total", "creation"],
        order_by="creation asc",
    )
    by_lead = {}
    for row in all_rows:
        by_lead.setdefault(row["party_name"], []).append(row)

    heads = []
    for lead, rows in by_lead.items():
        head = next((r for r in reversed(rows) if r["docstatus"] == 1), rows[-1])
        info = lead_map.get(lead, {})
        heads.append({
            "lead": lead,
            "lead_name": info.get("lead_name"),
            "company_name": info.get("company_name"),
            "quotation": head["name"],
            "grand_total": head["grand_total"],
            "status": head["status"],
            "docstatus": head["docstatus"],
            "creation": str(head["creation"]),
            "version_count": len(rows),
        })

    if sent_today:
        today_str = today()
        heads = [h for h in heads if h["docstatus"] == 1 and h["creation"][:10] == today_str]

    heads.sort(key=lambda h: h["creation"], reverse=True)
    total = len(heads)
    start = (page - 1) * page_length
    return {"total": total, "quotations": heads[start:start + page_length]}


@frappe.whitelist()
def get_my_day_summary():
    """
    Quick "how's my day going" overview for the Lead CRM dashboard tile --
    pipeline counts + today's follow-up/quotation activity. Deliberately
    separate from route_sales.api.my_day.get_my_day, which is entirely
    route/customer/invoice shaped and doesn't apply to a lead-only
    salesperson (no route, no checked-in customer, no deliveries).
    """
    require_login()
    # lead_pipeline excludes leads captured by the older route-sales
    # lead-capture flow -- see get_my_leads / _ensure_lead_custom_fields.
    lead_filters = (
        {"lead_pipeline": "Lead & Quotation"} if is_manager()
        else {"lead_owner": frappe.session.user}
    )

    leads = frappe.get_all(
        "Lead", filters=lead_filters,
        fields=["name", "status", "next_follow_up_date", "creation"],
    )
    today_str = today()

    status_counts = {}
    follow_ups_today = 0
    follow_ups_overdue = 0
    leads_created_today = 0
    for lead in leads:
        status_counts[lead["status"]] = status_counts.get(lead["status"], 0) + 1
        due = lead.get("next_follow_up_date")
        if due:
            due_str = str(due)
            if due_str == today_str:
                follow_ups_today += 1
            elif due_str < today_str:
                follow_ups_overdue += 1
        if str(lead["creation"])[:10] == today_str:
            leads_created_today += 1

    lead_names = [l["name"] for l in leads]
    quotations = []
    if lead_names:
        quotations = frappe.get_all(
            DocType.QUOTATION,
            filters={"party_name": ["in", lead_names], "quotation_to": "Lead"},
            fields=["name", "docstatus", "grand_total", "creation"],
        )

    quotations_sent_today = 0
    value_sent_today = 0.0
    active_pipeline_value = 0.0
    for q in quotations:
        if q["docstatus"] == 1:
            active_pipeline_value += q["grand_total"] or 0
            if str(q["creation"])[:10] == today_str:
                quotations_sent_today += 1
                value_sent_today += q["grand_total"] or 0

    return {
        "date": today_str,
        "total_leads": len(leads),
        "leads_by_status": status_counts,
        "leads_created_today": leads_created_today,
        "follow_ups_today": follow_ups_today,
        "follow_ups_overdue": follow_ups_overdue,
        "quotations_sent_today": quotations_sent_today,
        "value_sent_today": value_sent_today,
        "active_pipeline_value": active_pipeline_value,
    }


@frappe.whitelist()
def list_salespeople():
    """
    Users who can be assigned leads -- holders of the Route Sales User role.
    Manager-only, backs the admin Leads page's assignment dropdown.
    """
    only_manager()
    user_names = frappe.get_all(
        "Has Role", filters={"role": RoleName.ROUTE_SALES_USER, "parenttype": "User"}, pluck="parent",
    )
    if not user_names:
        return []
    return frappe.get_all(
        "User", filters={"name": ["in", user_names], "enabled": 1},
        fields=["name", "full_name"], order_by="full_name asc",
    )


def _assert_all_lead_and_quotation_pipeline(leads):
    """
    assign_leads/unassign_leads set lead_owner, the Lead & Quotation CRM's
    own assignment field -- leads.py's separate Route Capture flow has no
    concept of assignment at all and never reads lead_owner. Without this,
    nothing stops a direct API call from setting lead_owner on a Route
    Capture lead, which wouldn't do anything useful (leads.py doesn't
    filter by it) but would leave stray, meaningless CRM-assignment state
    on a lead outside this pipeline. The admin UI already only ever
    surfaces Lead & Quotation leads to pick from (fed by get_my_leads'
    own lead_pipeline filter), so this is defense-in-depth, not a fix for
    something reachable through the app's own screens today.
    """
    bad = frappe.db.get_all(
        "Lead",
        filters={"name": ["in", leads], "lead_pipeline": ["!=", "Lead & Quotation"]},
        pluck="name",
    )
    if bad:
        frappe.throw(
            f"Not Lead & Quotation pipeline leads: {', '.join(bad)}.",
            frappe.ValidationError,
        )


@frappe.whitelist(methods=["POST"])
def assign_leads(leads, salesperson):
    """
    Admin bulk-assign: set lead_owner on every given lead to one salesperson.
    Manager-only. Overwrites any existing assignment (re-assignment is a
    valid use case, e.g. a rep leaving the pipeline).
    """
    only_manager()
    if isinstance(leads, str):
        leads = json.loads(leads) if leads.strip() else []
    if not leads:
        frappe.throw("At least one lead is required.", frappe.ValidationError)
    if not frappe.db.exists("User", salesperson):
        frappe.throw(f"User '{salesperson}' does not exist.", frappe.ValidationError)

    _assert_all_lead_and_quotation_pipeline(leads)

    with _ignore_perms():
        for lead in leads:
            frappe.db.set_value("Lead", lead, "lead_owner", salesperson)
        frappe.db.commit()

    return {"assigned": len(leads), "salesperson": salesperson}


@frappe.whitelist(methods=["POST"])
def unassign_leads(leads):
    """
    Admin bulk-unassign: clear lead_owner on every given lead, sending them
    back to the unassigned pool. Manager-only. A separate endpoint from
    assign_leads (rather than assign_leads with an empty salesperson) so the
    intent is explicit at the call site, not implied by an omitted argument.
    """
    only_manager()
    if isinstance(leads, str):
        leads = json.loads(leads) if leads.strip() else []
    if not leads:
        frappe.throw("At least one lead is required.", frappe.ValidationError)

    _assert_all_lead_and_quotation_pipeline(leads)

    with _ignore_perms():
        for lead in leads:
            frappe.db.set_value("Lead", lead, "lead_owner", None)
        frappe.db.commit()

    return {"unassigned": len(leads)}


@frappe.whitelist()
def salesperson_conversion_stats():
    """
    Per-salesperson pipeline + conversion snapshot for the admin Leads page:
    total leads, converted count, lost count, conversion rate, currently
    active quotations sent + their value. Manager-only.
    """
    only_manager()
    # lead_pipeline excludes leads captured by the older route-sales
    # lead-capture flow -- see get_my_leads / _ensure_lead_custom_fields.
    leads = frappe.get_all(
        "Lead", filters={"lead_pipeline": "Lead & Quotation"},
        fields=["name", "lead_owner", "status"],
    )
    leads_by_owner = {}
    for lead in leads:
        leads_by_owner.setdefault(lead["lead_owner"] or "", []).append(lead)

    # Union of the formal "Route Sales User" role and whoever actually owns a
    # lead right now -- a lead can end up with an owner whose role assignment
    # is out of date (reassigned, role changed after the fact, etc.), and the
    # report should still surface their numbers rather than silently drop them.
    role_users = set(frappe.get_all(
        "Has Role", filters={"role": RoleName.ROUTE_SALES_USER, "parenttype": "User"}, pluck="parent",
    ))
    owner_users = {owner for owner in leads_by_owner if owner}
    user_names = sorted(role_users | owner_users)
    users = frappe.get_all(
        "User",
        filters={"name": ["in", user_names], "enabled": 1} if user_names else {"name": ["in", []]},
        fields=["name", "full_name"], order_by="full_name asc",
    )

    lead_names = [l["name"] for l in leads]
    quotations_by_lead = {}
    if lead_names:
        quotations = frappe.get_all(
            DocType.QUOTATION,
            filters={"party_name": ["in", lead_names], "quotation_to": "Lead"},
            fields=["party_name", "docstatus", "grand_total"],
        )
        for q in quotations:
            quotations_by_lead.setdefault(q["party_name"], []).append(q)

    rows = []
    for user in users:
        my_leads = leads_by_owner.get(user["name"], [])
        total = len(my_leads)
        converted = sum(1 for l in my_leads if l["status"] == "Converted")
        lost = sum(1 for l in my_leads if l["status"] == "Lost Quotation")

        quotations_sent, pipeline_value = 0, 0.0
        for lead in my_leads:
            for q in quotations_by_lead.get(lead["name"], []):
                if q["docstatus"] == 1:
                    quotations_sent += 1
                    pipeline_value += q["grand_total"] or 0

        rows.append({
            "salesperson": user["name"],
            "salesperson_name": user["full_name"],
            "total_leads": total,
            "converted": converted,
            "lost": lost,
            "conversion_rate": round((converted / total) * 100, 1) if total else 0,
            "quotations_sent": quotations_sent,
            "pipeline_value": pipeline_value,
        })

    return {"salespeople": rows, "unassigned_leads": len(leads_by_owner.get("", []))}


@frappe.whitelist()
def list_payment_terms_templates():
    require_login()
    return frappe.get_all(
        "Payment Terms Template",
        fields=["name", "template_name"],
        order_by="template_name asc",
    )


@frappe.whitelist()
def get_default_tax_rate():
    """
    Client-side preview only -- the real tax is computed server-side on
    submit via _apply_default_taxes(), same default template either way.
    Lets the quotation builder show a live Amount/Tax/Total breakdown while
    picking items, without duplicating the rate as a frontend constant (see
    the Route Delivery Payment Modes / Item Categories removals earlier this
    project for why that's the pattern to avoid).
    """
    require_login()
    template = get_default_taxes_and_charges_template()
    if not template:
        return {"template": None, "rate_percent": 0}

    rows = frappe.db.get_all(
        "Sales Taxes and Charges",
        filters={"parenttype": "Sales Taxes and Charges Template", "parent": template},
        fields=["rate"],
    )
    rate_percent = sum(r["rate"] or 0 for r in rows)
    return {"template": template, "rate_percent": rate_percent}


@frappe.whitelist()
def list_items(search=None, page=1, page_length=100):
    """
    Plain item catalog for the quotation builder -- deliberately NOT
    route_sales.api.items.get_customer_items, which requires a real
    Customer on one of the caller's assigned routes (assert_customer_access)
    and applies van-stock capping. Neither concept exists for a Lead CRM
    salesperson (no route, no van) -- this lists the full sellable catalog
    with list-price only, exactly matching the "take order + quotation,
    nothing else" scope of this pipeline.
    """
    require_login()
    page, page_length = paginate(page, page_length, max_page_length=500)

    filters = {"disabled": 0, "is_stock_item": 1}
    or_filters = None
    if search:
        or_filters = {
            "item_code": ["like", f"%{search}%"],
            "item_name": ["like", f"%{search}%"],
        }

    rows = frappe.get_all(
        DocType.ITEM,
        filters=filters,
        or_filters=or_filters,
        fields=["item_code", "item_name", "stock_uom"],
        order_by="item_code asc",
        limit_start=(page - 1) * page_length,
        limit_page_length=page_length,
    )
    if not rows:
        return {"items": []}

    price_list = get_default_price_list()
    item_codes = [r["item_code"] for r in rows]
    price_rows = frappe.get_all(
        "Item Price",
        filters={"price_list": price_list, "item_code": ["in", item_codes]},
        fields=["item_code", "price_list_rate"],
    )
    price_map = {r["item_code"]: r["price_list_rate"] for r in price_rows}

    return {
        "items": [
            {
                "item_code": r["item_code"],
                "item_name": r["item_name"],
                "uom": r["stock_uom"],
                "price": price_map.get(r["item_code"]) or 0,
            }
            for r in rows
        ],
    }
