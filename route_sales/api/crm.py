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

from route_sales.api.constants import DocType, RoleName, get_company, get_default_price_list
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
def get_my_leads(status=None, lead_owner=None, district=None, page=1, page_length=50):
    """
    Leads assigned to the current user (Lead.lead_owner). Managers may omit
    lead_owner filtering to see every lead in the pipeline, or pass it
    explicitly -- a specific salesperson's user id, or the sentinel
    "__unassigned__" -- to power the admin Leads page's filters. Non-managers
    can never see anyone else's leads; lead_owner is ignored for them.
    district filters on the exact (free-text) value, meant to be populated
    from list_districts() rather than typed, so it always matches.
    """
    require_login()
    page, page_length = paginate(page, page_length)

    if is_manager():
        filters = {}
        if lead_owner == "__unassigned__":
            filters["lead_owner"] = ["is", "not set"]
        elif lead_owner:
            filters["lead_owner"] = lead_owner
    else:
        filters = {"lead_owner": frappe.session.user}
    if status:
        filters["status"] = status
    if district:
        filters["district"] = district

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
    values = frappe.get_all("Lead", filters={"district": ["is", "set"]}, pluck="district")
    return sorted({v.strip() for v in values if v and v.strip()})


@frappe.whitelist(methods=["POST"])
def create_lead(lead_name, district=None, company_name=None, mobile_no=None):
    """
    Self-service lead creation for a salesperson working the pipeline --
    auto-assigned to whoever creates it (lead_owner = session user), the
    walk-up/cold-call equivalent of the admin assigning one instead.
    district is mandatory -- matches Lead.district's own reqd=1 (see
    leads.py's _ensure_lead_custom_fields) and this app's need to filter/
    bulk-assign leads by location from the admin side.
    """
    require_login()
    if not (lead_name or "").strip():
        frappe.throw("Lead name is required.", frappe.ValidationError)
    if not (district or "").strip():
        frappe.throw("District is required.", frappe.ValidationError)

    with _ignore_perms():
        doc = frappe.get_doc({
            "doctype": "Lead",
            "lead_name": lead_name.strip(),
            "company_name": (company_name or "").strip() or None,
            "mobile_no": (mobile_no or "").strip() or None,
            "district": district.strip(),
            "lead_owner": frappe.session.user,
            "status": "Lead",
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
            "name", "status", "docstatus", "grand_total", "amended_from",
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
        "payment_terms_template": doc.payment_terms_template,
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

    return _quotations_for_lead(lead)


@frappe.whitelist()
def get_my_quotations(page=1, page_length=50):
    """
    One row per lead (that has at least one quotation), showing its current
    "head" quotation -- the submitted one if there is one, otherwise the
    most recent draft/cancelled -- for the dashboard's Quotations tile.
    Full version history is still available via get_quotation_history /
    get_lead_detail once the salesperson drills into that lead.
    """
    require_login()
    page, page_length = paginate(page, page_length)

    lead_filters = {} if is_manager() else {"lead_owner": frappe.session.user}
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
    lead_filters = {} if is_manager() else {"lead_owner": frappe.session.user}

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
    leads = frappe.get_all("Lead", fields=["name", "lead_owner", "status"])
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
