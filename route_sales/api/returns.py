"""
route_sales.api.returns
=======================
GET  /api/method/route_sales.api.returns.get_returnable_items
POST /api/method/route_sales.api.returns.create_return
"""

import frappe
from frappe.utils import today
from route_sales.api.constants import COMPANY, WAREHOUSE, DEBIT_ACCOUNT, DocType, SESSION_REMARK_PREFIX
from route_sales.api.security import assert_customer_access, ensure_route_session_access
from route_sales.api.route_utils import try_set_missing_values


def _already_returned_map(invoice):
    """
    Map of item_code -> total qty already returned against `invoice`
    across all prior submitted return invoices.
    """
    prior_return_invoices = frappe.db.get_all(
        DocType.SALES_INVOICE,
        filters={"return_against": invoice, "docstatus": 1},
        fields=["name"],
        limit_page_length=0,
    )
    prior_return_rows = frappe.db.get_all(
        "Sales Invoice Item",
        filters={"parent": ["in", [r["name"] for r in prior_return_invoices]]},
        fields=["item_code", "qty"],
        limit_page_length=0,
    ) if prior_return_invoices else []
    already_returned_map = {}
    for row in prior_return_rows:
        ic = row["item_code"]
        already_returned_map[ic] = already_returned_map.get(ic, 0) + abs(float(row.get("qty") or 0))
    return already_returned_map


@frappe.whitelist()
def get_returnable_items(invoice):
    """
    Returns the remaining returnable quantities for each item on a submitted invoice.

    Response
    --------
    [{ "item_code", "item_name", "original_qty", "already_returned", "returnable_qty" }]
    """
    orig = frappe.db.get_value(
        DocType.SALES_INVOICE,
        invoice,
        ["name", "customer", "docstatus", "is_return"],
        as_dict=True,
    )
    if not orig:
        frappe.throw(f"Invoice '{invoice}' not found.", frappe.DoesNotExistError)
    if orig["docstatus"] != 1:
        frappe.throw(f"Invoice '{invoice}' is not submitted.", frappe.ValidationError)
    if orig["is_return"]:
        frappe.throw(f"Invoice '{invoice}' is itself a return.", frappe.ValidationError)
    assert_customer_access(orig["customer"])

    orig_items = frappe.db.get_all(
        "Sales Invoice Item",
        filters={"parent": invoice},
        fields=["item_code", "item_name", "qty"],
        order_by="idx asc",
    )

    already_returned_map = _already_returned_map(invoice)

    result = []
    for row in orig_items:
        original_qty = abs(float(row["qty"] or 0))
        already_returned = already_returned_map.get(row["item_code"], 0)
        returnable_qty = max(0, original_qty - already_returned)
        result.append({
            "item_code":        row["item_code"],
            "item_name":        row["item_name"],
            "original_qty":     original_qty,
            "already_returned": already_returned,
            "returnable_qty":   returnable_qty,
        })
    return result


@frappe.whitelist(methods=["POST"])
def create_return(
    invoice,
    items=None,
    reason=None,
    route_session=None,
):
    """
    Create a Sales Return (Credit Note) against an existing Sales Invoice.

    If no items are specified, all items from the original invoice are returned
    in full. Partial returns are supported by supplying a subset of items with
    their return quantities.

    Parameters
    ----------
    invoice       : str  – Original Sales Invoice name.
    items         : list, optional – [{ "item_code": str, "qty": float }, ...]
                    Quantities must be positive; they are negated internally.
                    Omit to return the full invoice.
    reason        : str, optional – Reason for the return (stored in remarks).
    route_session : str, optional – Route Session where return was initiated.

    Returns
    -------
    {
      "return_invoice":   str,   ← Credit Note name
      "original_invoice": str,
      "customer":         str,
      "grand_total":      float, ← negative (credit)
      "status":           str,
      "items": [{ "item_code", "item_name", "qty", "rate", "amount" }]
    }
    """
    # ── Validate original invoice ─────────────────────────────────────────────
    if route_session:
        ensure_route_session_access(route_session)

    orig = frappe.db.get_value(
        DocType.SALES_INVOICE,
        invoice,
        ["name", "customer", "docstatus", "is_return", "status", "update_stock"],
        as_dict=True,
    )
    if not orig:
        frappe.throw(f"Invoice '{invoice}' not found.", frappe.DoesNotExistError)
    if orig["docstatus"] != 1:
        frappe.throw(
            f"Invoice '{invoice}' is not submitted (docstatus={orig['docstatus']}).",
            frappe.ValidationError,
        )
    if orig["is_return"]:
        frappe.throw(
            f"Invoice '{invoice}' is itself a return. Cannot return a return.",
            frappe.ValidationError,
        )
    assert_customer_access(orig["customer"])

    # ── Load original line items ───────────────────────────────────────────────
    orig_items = frappe.db.get_all(
        "Sales Invoice Item",
        filters={"parent": invoice},
        fields=["item_code", "item_name", "qty", "rate", "warehouse",
                "allow_zero_valuation_rate"],
        order_by="idx asc",
    )
    orig_map = {r["item_code"]: r for r in orig_items}

    already_returned_map = _already_returned_map(invoice)

    # ── Deserialise items arg if JSON string ───────────────────────────────────
    if isinstance(items, str):
        import json
        items = json.loads(items) if items.strip() else []

    # ── Build return line items ────────────────────────────────────────────────
    if not items:
        # Full return
        return_items = []
        for row in orig_items:
            original_qty = abs(float(row["qty"] or 0))
            already_returned_qty = already_returned_map.get(row["item_code"], 0)
            remaining_returnable_qty = max(0, original_qty - already_returned_qty)
            if remaining_returnable_qty <= 0:
                continue
            return_items.append({
                "item_code":               row["item_code"],
                "qty":                     -remaining_returnable_qty,
                "rate":                    row["rate"],
                "warehouse":               row["warehouse"] or WAREHOUSE,
                "allow_zero_valuation_rate": row["allow_zero_valuation_rate"],
            })
        if not return_items:
            frappe.throw(
                f"Invoice '{invoice}' has no remaining returnable quantity.",
                frappe.ValidationError,
            )
    else:
        return_items = []
        for row in items:
            item_code = row.get("item_code")
            qty       = abs(float(row.get("qty", 0)))

            if not item_code:
                frappe.throw("Each item must have an 'item_code'.", frappe.ValidationError)
            if qty <= 0:
                frappe.throw(
                    f"Return quantity must be > 0 for '{item_code}'.",
                    frappe.ValidationError,
                )
            if item_code not in orig_map:
                frappe.throw(
                    f"Item '{item_code}' was not in the original invoice '{invoice}'.",
                    frappe.ValidationError,
                )

            orig_row = orig_map[item_code]
            original_qty = abs(float(orig_row["qty"] or 0))
            already_returned_qty = already_returned_map.get(item_code, 0)
            remaining_returnable_qty = max(0, original_qty - already_returned_qty)

            if qty > remaining_returnable_qty:
                frappe.throw(
                    f"Return qty ({qty}) for '{item_code}' exceeds "
                    f"remaining returnable qty ({remaining_returnable_qty}).",
                    frappe.ValidationError,
                )

            return_items.append({
                "item_code":               item_code,
                "qty":                     -qty,
                "rate":                    orig_row["rate"],
                "warehouse":               orig_row["warehouse"] or WAREHOUSE,
                "allow_zero_valuation_rate": orig_row["allow_zero_valuation_rate"],
            })

    # ── Build remarks ──────────────────────────────────────────────────────────
    remarks_parts = [f"Return against {invoice}"]
    if reason:
        remarks_parts.append(f"Reason: {reason}")
    if route_session:
        remarks_parts.append(f"{SESSION_REMARK_PREFIX}{route_session}")

    # ── Create return invoice ──────────────────────────────────────────────────
    frappe.flags.ignore_permissions = True
    try:
        return_doc = frappe.get_doc({
            "doctype":          DocType.SALES_INVOICE,
            "company":          COMPANY,
            "customer":         orig["customer"],
            "posting_date":     today(),
            "is_return":        1,
            "return_against":   invoice,
            "update_stock":     orig.get("update_stock") or 0,
            "debit_to":         DEBIT_ACCOUNT,
            "items":            return_items,
            "remarks":          "\n".join(remarks_parts),
        })
        try_set_missing_values(return_doc, "returns.py")
        return_doc.insert(ignore_permissions=True)
        return_doc.flags.ignore_permissions = True
        return_doc.submit()
        frappe.db.commit()
    finally:
        frappe.flags.ignore_permissions = False

    return {
        "return_invoice":   return_doc.name,
        "original_invoice": invoice,
        "customer":         orig["customer"],
        "grand_total":      return_doc.grand_total,
        "status":           return_doc.status,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
            }
            for d in return_doc.items
        ],
    }
