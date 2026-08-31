"""
route_sales.api.crm
====================
Lead-to-quotation CRM pipeline, gated by Route Sales Settings.enable_lead_crm.

Distinct from route_sales.api.leads (that module is route-sales' own
lead-capture flow, access-controlled by `owner` = whoever captured the
lead while out on a route). This module is for the admin-assigns-a-lead-
to-a-salesperson model instead, access-controlled by Lead.lead_owner.

GET  /api/method/route_sales.api.crm.get_my_leads
GET  /api/method/route_sales.api.crm.get_lead_detail
POST /api/method/route_sales.api.crm.log_followup
POST /api/method/route_sales.api.crm.update_lead_status
POST /api/method/route_sales.api.crm.create_quotation_for_lead
POST /api/method/route_sales.api.crm.renegotiate_quotation
GET  /api/method/route_sales.api.crm.get_quotation_history
GET  /api/method/route_sales.api.crm.list_payment_terms_templates
"""

import contextlib
import json

import frappe
from frappe.utils import add_days, now_datetime, today

from route_sales.api.constants import DocType, get_company, get_default_price_list
from route_sales.api.route_utils import try_set_missing_values
from route_sales.api.security import is_manager, require_login
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
def get_my_leads(status=None, page=1, page_length=50):
    """
    Leads assigned to the current user (Lead.lead_owner). Managers may omit
    lead_owner filtering entirely to see every lead in the pipeline.
    """
    require_login()
    page, page_length = paginate(page, page_length)

    filters = {} if is_manager() else {"lead_owner": frappe.session.user}
    if status:
        filters["status"] = status

    rows = frappe.get_all(
        "Lead",
        filters=filters,
        fields=[
            "name", "lead_name", "company_name", "mobile_no", "status",
            "lead_owner", "territory", "next_follow_up_date", "modified",
        ],
        order_by="modified desc",
        limit_start=(page - 1) * page_length,
        limit_page_length=page_length,
    )
    total = frappe.db.count("Lead", filters=filters)
    return {"total": total, "leads": rows}


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
    quotations = frappe.get_all(
        DocType.QUOTATION,
        filters={"party_name": lead, "quotation_to": "Lead"},
        fields=["name", "status", "docstatus", "grand_total", "amended_from", "transaction_date", "creation"],
        order_by="creation asc",
    )

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

    doc.status = status
    doc.flags.ignore_permissions = True
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"lead": doc.name, "status": doc.status}


def _build_quotation_items(items, price_list):
    """Shared item-row validation/building for both create and renegotiate --
    mirrors selling.py's create_quotation validation exactly."""
    if isinstance(items, str):
        items = json.loads(items) if items.strip() else []
    if not items:
        frappe.throw("At least one item is required.", frappe.ValidationError)

    rows = []
    for row in items:
        item_code = row.get("item_code")
        qty = float(row.get("qty", 1))
        if not item_code:
            frappe.throw("Each item must have an 'item_code'.", frappe.ValidationError)
        if qty <= 0:
            frappe.throw(f"Quantity must be > 0 for item '{item_code}'.", frappe.ValidationError)

        rate = row.get("rate")
        if rate is None:
            rate = frappe.db.get_value(
                "Item Price", {"item_code": item_code, "price_list": price_list}, "price_list_rate"
            ) or 0
        rows.append({"item_code": item_code, "qty": qty, "rate": float(rate)})
    return rows


def _quotation_summary(doc):
    return {
        "quotation": doc.name,
        "amended_from": doc.amended_from,
        "grand_total": doc.grand_total,
        "status": doc.status,
        "items": [
            {
                "item_code": d.item_code, "item_name": d.item_name,
                "qty": d.qty, "rate": d.rate, "amount": d.amount, "uom": d.uom,
            }
            for d in doc.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def create_quotation_for_lead(lead, items, payment_terms_template=None):
    """
    Step 1 of the negotiation chain -- creates and submits a Quotation
    against the Lead directly (quotation_to="Lead"), representing the first
    price offered. Every later price change goes through
    renegotiate_quotation instead of editing this in place, so the full
    offer history stays a real, auditable document chain.
    """
    require_login()

    lead_doc = frappe.get_doc("Lead", lead)
    _assert_lead_access(lead_doc)

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
        try_set_missing_values(qt, "crm.py create_quotation_for_lead")
        qt.insert(ignore_permissions=True)
        qt.submit()
        frappe.db.commit()

    return _quotation_summary(qt)


@frappe.whitelist(methods=["POST"])
def renegotiate_quotation(quotation, items, payment_terms_template=None):
    """
    Cancels the current submitted Quotation and creates a new amended draft
    with the renegotiated items/rates, then submits it -- so the price
    history for this lead is a real Frappe document chain
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
            original.cancel()
            frappe.db.commit()

        amended = frappe.copy_doc(original)
        amended.amended_from = original.name
        amended.docstatus = 0
        amended.transaction_date = today()
        amended.valid_till = add_days(today(), 7)
        amended.items = []
        for row in quotation_items:
            amended.append("items", row)
        if payment_terms_template:
            amended.payment_terms_template = payment_terms_template

        amended.flags.ignore_permissions = True
        try_set_missing_values(amended, "crm.py renegotiate_quotation")
        amended.insert(ignore_permissions=True)
        amended.submit()
        frappe.db.commit()

    return _quotation_summary(amended)


@frappe.whitelist()
def get_quotation_history(lead):
    require_login()
    lead_doc = frappe.get_doc("Lead", lead)
    _assert_lead_access(lead_doc)

    return frappe.get_all(
        DocType.QUOTATION,
        filters={"party_name": lead, "quotation_to": "Lead"},
        fields=["name", "status", "docstatus", "grand_total", "amended_from", "transaction_date", "creation"],
        order_by="creation asc",
    )


@frappe.whitelist()
def list_payment_terms_templates():
    require_login()
    return frappe.get_all(
        "Payment Terms Template",
        fields=["name", "template_name"],
        order_by="template_name asc",
    )
