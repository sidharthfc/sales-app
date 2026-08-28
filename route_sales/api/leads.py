"""
route_sales.api.leads
=====================
GET  /api/method/route_sales.api.leads.get_leads
GET  /api/method/route_sales.api.leads.get_lead
POST /api/method/route_sales.api.leads.create_lead
POST /api/method/route_sales.api.leads.update_lead
"""

import frappe
from frappe.utils import now_datetime
from route_sales.api.security import require_login
from route_sales.api.constants import SESSION_REMARK_PREFIX, get_company
from route_sales.api.utils import paginate


def _ensure_lead_custom_fields():
    """Create lead_quality and district custom fields on Lead if they don't exist."""
    fields = [
        {
            "dt": "Lead",
            "fieldname": "lead_quality",
            "label": "Lead Quality",
            "fieldtype": "Select",
            "options": "\nHot\nCold",
            "insert_after": "status",
        },
        {
            "dt": "Lead",
            "fieldname": "district",
            "label": "District",
            "fieldtype": "Data",
            "insert_after": "city",
        },
    ]
    changed = False
    for f in fields:
        if not frappe.db.exists("Custom Field", {"dt": f["dt"], "fieldname": f["fieldname"]}):
            doc = frappe.get_doc({"doctype": "Custom Field", **f})
            doc.insert(ignore_permissions=True)
            changed = True
    if changed:
        frappe.db.commit()


@frappe.whitelist()
def get_leads(page=1, page_length=50):
    require_login()

    page, page_length = paginate(page, page_length)

    filters = {"owner": frappe.session.user}

    rows = frappe.db.get_all(
        "Lead",
        filters=filters,
        fields=[
            "name",
            "lead_name",
            "company_name",
            "mobile_no",
            "city",
            "district",
            "lead_quality",
            "status",
            "creation",
        ],
        order_by="creation desc",
        limit_start=(page - 1) * page_length,
        limit_page_length=page_length,
    )
    total = frappe.db.count("Lead", filters=filters)

    return {
        "total": total,
        "leads": [
            {
                "name": row["name"],
                "lead_name": row.get("lead_name"),
                "company_name": row.get("company_name"),
                "mobile_no": row.get("mobile_no"),
                "place": row.get("city"),
                "district": row.get("district"),
                "lead_quality": row.get("lead_quality") or "Cold",
                "status": row.get("status"),
                "creation": str(row["creation"]) if row.get("creation") else None,
            }
            for row in rows
        ],
    }


@frappe.whitelist()
def get_lead(lead):
    require_login()

    doc = frappe.get_doc("Lead", lead)
    if doc.owner != frappe.session.user:
        from route_sales.api.security import is_manager
        if not is_manager():
            frappe.throw("You do not have access to this lead.", frappe.PermissionError)

    notes = []
    for n in (doc.notes or []):
        notes.append({
            "note": n.note,
            "added_by": n.added_by,
            "added_on": str(n.added_on) if n.added_on else None,
        })

    return {
        "name": doc.name,
        "lead_name": doc.lead_name,
        "company_name": doc.company_name,
        "mobile_no": doc.mobile_no,
        "place": doc.city,
        "district": getattr(doc, "district", None),
        "lead_quality": getattr(doc, "lead_quality", None) or "Cold",
        "status": doc.status,
        "creation": str(doc.creation) if doc.creation else None,
        "notes": notes,
    }


@frappe.whitelist(methods=["POST"])
def create_lead(
    lead_name,
    company_name,
    mobile_no,
    place,
    district,
    remarks,
    lead_quality,
    route_session=None,
):
    """
    Create a Lead captured by a salesperson.

    All parameters are mandatory.
    lead_quality : "Hot" | "Cold"
    place        : city / locality
    district     : district name
    remarks      : initial note
    """
    require_login()

    # Validate
    for param, label in [
        (lead_name, "Lead Name"),
        (company_name, "Company Name"),
        (mobile_no, "Mobile Number"),
        (place, "Place"),
        (district, "District"),
        (remarks, "Remarks"),
        (lead_quality, "Lead Quality"),
    ]:
        if not (param or "").strip():
            frappe.throw(f"{label} is required.", frappe.ValidationError)

    if lead_quality not in ("Hot", "Cold"):
        frappe.throw("Lead Quality must be Hot or Cold.", frappe.ValidationError)

    # Duplicate mobile check
    existing = frappe.db.get_value("Lead", {"mobile_no": mobile_no.strip()}, "name")
    if existing:
        frappe.throw(
            f"A lead with mobile '{mobile_no}' already exists: {existing}.",
            frappe.DuplicateEntryError,
        )

    # Parse first/last name
    parts = lead_name.strip().split(None, 1)
    first_name = parts[0]
    last_name = parts[1] if len(parts) > 1 else None

    notes = [{
        "note": remarks.strip(),
        "added_by": frappe.session.user,
        "added_on": now_datetime(),
    }]
    if route_session:
        notes.insert(0, {
            "note": f"Captured during {SESSION_REMARK_PREFIX}{route_session}",
            "added_by": frappe.session.user,
            "added_on": now_datetime(),
        })

    lead_doc = frappe.get_doc({
        "doctype": "Lead",
        "first_name": first_name,
        "last_name": last_name,
        "company_name": company_name.strip(),
        "mobile_no": mobile_no.strip(),
        "city": place.strip(),
        "status": "Lead",
        "company": get_company(),
        "notes": notes,
    })
    lead_doc.lead_quality = lead_quality
    lead_doc.district = district.strip()
    lead_doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "lead": lead_doc.name,
        "lead_name": lead_doc.lead_name,
        "company_name": lead_doc.company_name,
        "mobile_no": lead_doc.mobile_no,
        "place": lead_doc.city,
        "district": district.strip(),
        "lead_quality": lead_quality,
        "status": lead_doc.status,
    }


@frappe.whitelist(methods=["POST"])
def update_lead(lead, remarks=None, lead_quality=None, status=None):
    """
    Add a follow-up remark and/or update lead_quality / status.

    lead         : str  – Lead name (e.g. CRM-LEAD-2026-00001)
    remarks      : str, optional – New remark to append
    lead_quality : str, optional – "Hot" | "Cold"
    status       : str, optional – ERPNext lead status value
    """
    require_login()

    doc = frappe.get_doc("Lead", lead)
    if doc.owner != frappe.session.user:
        from route_sales.api.security import is_manager
        if not is_manager():
            frappe.throw("You do not have access to this lead.", frappe.PermissionError)

    if lead_quality and lead_quality not in ("Hot", "Cold"):
        frappe.throw("Lead Quality must be Hot or Cold.", frappe.ValidationError)

    if remarks and remarks.strip():
        doc.append("notes", {
            "note": remarks.strip(),
            "added_by": frappe.session.user,
            "added_on": now_datetime(),
        })

    if lead_quality:
        doc.lead_quality = lead_quality

    if status:
        doc.status = status

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    notes = [
        {
            "note": n.note,
            "added_by": n.added_by,
            "added_on": str(n.added_on) if n.added_on else None,
        }
        for n in (doc.notes or [])
    ]

    return {
        "lead": doc.name,
        "lead_quality": getattr(doc, "lead_quality", None) or "Cold",
        "status": doc.status,
        "notes": notes,
    }
