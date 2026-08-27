"""
route_sales.api.delivery
========================
Pending order delivery flow:
  Fetch pending Sales Orders → Create Delivery Note → Create Invoice from DN

GET  /api/method/route_sales.api.delivery.get_pending_orders
POST /api/method/route_sales.api.delivery.create_delivery_note
POST /api/method/route_sales.api.delivery.create_invoice_from_delivery
"""

import frappe
import json
import contextlib
from frappe.utils import today, add_days
from route_sales.api.constants import COMPANY, WAREHOUSE, DEBIT_ACCOUNT, PENDING_DELIVERY_STATUSES, CURRENCY, DocType, ModeOfPayment
from route_sales.api.security import assert_customer_access, assert_customer_readonly_access, ensure_route_session_access
from route_sales.api.stock import get_session_stock_summary


@contextlib.contextmanager
def _ignore_perms():
    original_user = frappe.session.user
    frappe.set_user("Administrator")
    try:
        yield
    finally:
        frappe.set_user(original_user)


@frappe.whitelist()
def get_pending_orders(customer):
    """
    Returns submitted Sales Orders that still have items pending delivery.
    Status: To Deliver and Bill | To Deliver | Partly Delivered.

    Parameters
    ----------
    customer : str – Customer name.

    Returns
    -------
    [
      {
        "sales_order", "date", "delivery_date", "grand_total", "status",
        "items": [{
          "item_code", "item_name", "qty", "delivered_qty", "pending_qty", "rate", "uom"
        }]
      }
    ]
    """
    assert_customer_readonly_access(customer)

    orders = frappe.db.get_all(
        DocType.SALES_ORDER,
        filters={
            "customer":  customer,
            "docstatus": 1,
            "status":    ["in", PENDING_DELIVERY_STATUSES],
        },
        fields=["name", "transaction_date", "delivery_date", "grand_total", "status"],
        order_by="transaction_date desc",
    )

    result = []
    for order in orders:
        rows = frappe.db.get_all(
            "Sales Order Item",
            filters={"parent": order["name"]},
            fields=["item_code", "item_name", "qty", "delivered_qty", "rate", "uom"],
        )
        pending_items = []
        for row in rows:
            pending = (row["qty"] or 0) - (row["delivered_qty"] or 0)
            if pending > 0:
                pending_items.append({
                    "item_code":     row["item_code"],
                    "item_name":     row["item_name"],
                    "qty":           row["qty"],
                    "delivered_qty": row["delivered_qty"] or 0,
                    "pending_qty":   pending,
                    "rate":          row["rate"],
                    "uom":           row["uom"],
                })

        if pending_items:
            result.append({
                "sales_order":   order["name"],
                "date":          str(order["transaction_date"]),
                "delivery_date": str(order["delivery_date"]) if order.get("delivery_date") else None,
                "grand_total":   order["grand_total"],
                "status":        order["status"],
                "items":         pending_items,
            })

    return result


@frappe.whitelist(methods=["POST"])
def create_delivery_note(sales_order, items=None, route_session=None):
    """
    Create a Delivery Note (full or partial) from a submitted Sales Order.

    Parameters
    ----------
    sales_order : str  – Sales Order name.
    items       : list, optional
                  [{ "item_code": str, "qty": float }]
                  If omitted, all pending qty is delivered.
                  Pass as JSON string via HTTP.

    Returns
    -------
    {
      "delivery_note": str,
      "sales_order":   str,
      "customer":      str,
      "items": [{ "item_code", "item_name", "qty", "rate", "amount" }]
    }
    """
    if route_session:
        ensure_route_session_access(route_session)

    so = frappe.get_doc(DocType.SALES_ORDER, sales_order)
    assert_customer_access(so.customer)

    if so.docstatus != 1:
        frappe.throw(f"Sales Order '{sales_order}' is not submitted.", frappe.ValidationError)

    # ── Idempotency: return existing unbilled DN for this SO (today) ──────────
    # Handles the case where DN creation succeeded but invoice creation failed,
    # and the user retries — prevents a second Delivery Note for the same order.
    existing_unbilled = _find_unbilled_dn_for_order(sales_order)
    if existing_unbilled:
        existing_dn = frappe.get_doc(DocType.DELIVERY_NOTE, existing_unbilled)
        return {
            "delivery_note": existing_dn.name,
            "sales_order":   sales_order,
            "customer":      so.customer,
            "grand_total":   existing_dn.grand_total,
            "items": [
                {
                    "item_code": d.item_code,
                    "item_name": d.item_name,
                    "qty":       d.qty,
                    "rate":      d.rate,
                    "amount":    d.amount,
                }
                for d in existing_dn.items
            ],
        }

    if isinstance(items, str):
        items = json.loads(items) if items.strip() else []
    item_requests = items or []

    # Validate requested quantities against the order's remaining deliverable qty.
    requested_qty_map = {}
    so_item_rows = frappe.db.get_all(
        "Sales Order Item",
        filters={"parent": sales_order},
        fields=["item_code", "qty", "delivered_qty"],
    )
    remaining_qty_map = {
        row["item_code"]: max(0, float(row.get("qty") or 0) - float(row.get("delivered_qty") or 0))
        for row in so_item_rows
    }

    for row in item_requests:
        item_code = row.get("item_code")
        if not item_code:
            frappe.throw("Each delivery line must include an item_code.", frappe.ValidationError)
        if item_code not in remaining_qty_map:
            frappe.throw(
                f"Item '{item_code}' is not part of Sales Order '{sales_order}'.",
                frappe.ValidationError,
            )
        requested_qty = float(row.get("qty") or 0)
        if requested_qty <= 0:
            frappe.throw(
                f"Delivery quantity must be greater than 0 for item '{item_code}'.",
                frappe.ValidationError,
            )
        remaining_qty = remaining_qty_map[item_code]
        if requested_qty > remaining_qty:
            frappe.throw(
                f"Requested qty {requested_qty} for item '{item_code}' exceeds pending qty {remaining_qty}.",
                frappe.ValidationError,
            )
        requested_qty_map[item_code] = requested_qty

    if route_session:
        session_stock_map = {
            row["item_code"]: float(row.get("qty_remaining") or 0)
            for row in get_session_stock_summary(route_session)
        }
        # Only enforce the check for items that were explicitly loaded into the van.
        # Items not tracked in van stock are allowed through freely.
        for item_code, requested_qty in requested_qty_map.items():
            if item_code not in session_stock_map:
                continue
            available_qty = session_stock_map[item_code]
            if requested_qty > available_qty:
                frappe.throw(
                    f"Requested qty {requested_qty} for item '{item_code}' exceeds van stock {available_qty} "
                    f"for Route Session '{route_session}'.",
                    frappe.ValidationError,
                )

    with _ignore_perms():
        from erpnext.selling.doctype.sales_order.sales_order import make_delivery_note
        dn = make_delivery_note(sales_order)
        dn.set_warehouse = WAREHOUSE

        if requested_qty_map:
            for row in dn.items:
                if row.item_code in requested_qty_map:
                    row.qty = requested_qty_map[row.item_code]
                else:
                    row.qty = 0
            dn.items = [r for r in dn.items if (r.qty or 0) > 0]

        if not dn.items:
            frappe.throw("No deliverable items.", frappe.ValidationError)

        try:
            dn.set_missing_values()
            dn.calculate_taxes_and_totals()
        except Exception:
            frappe.log_error(frappe.get_traceback(), "set_missing_values non-critical (delivery.py)")

        if route_session:
            session_note = f"Route Session: {route_session}"
            dn.instructions = (
                f"{session_note}\n{dn.instructions}"
                if dn.instructions else session_note
            )

        dn.insert(ignore_permissions=True)
        dn.submit()
        frappe.db.commit()

    return {
        "delivery_note": dn.name,
        "sales_order":   sales_order,
        "customer":      so.customer,
        "grand_total":   dn.grand_total,
        "items": [
            {
                "item_code": d.item_code,
                "item_name": d.item_name,
                "qty":       d.qty,
                "rate":      d.rate,
                "amount":    d.amount,
            }
            for d in dn.items
        ],
    }


@frappe.whitelist(methods=["POST"])
def create_invoice_from_delivery(delivery_note, mode_of_payment=ModeOfPayment.CASH, due_days=0, amount_to_collect=None):
    """
    Create and submit a Sales Invoice from a submitted Delivery Note,
    then record payment (unless Credit mode).

    Parameters
    ----------
    delivery_note   : str  – Delivery Note name.
    mode_of_payment : str  – Cash | UPI | Bank Transfer | Credit.
    due_days        : int  – Due days for Credit mode.
    amount_to_collect : float, optional – Partial/full amount to collect now.

    Returns
    -------
    {
      "invoice", "delivery_note", "grand_total",
      "outstanding_amount", "payment_recorded"
    }
    """
    dn = frappe.get_doc(DocType.DELIVERY_NOTE, delivery_note)
    assert_customer_access(dn.customer)

    if dn.docstatus != 1:
        frappe.throw(f"Delivery Note '{delivery_note}' is not submitted.", frappe.ValidationError)

    # Guard: prevent duplicate invoices for the same Delivery Note
    inv_item_rows = frappe.db.get_all(
        "Sales Invoice Item",
        filters={"delivery_note": delivery_note},
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
                f"A Sales Invoice ({existing_inv}) already exists for Delivery Note '{delivery_note}'.",
                frappe.ValidationError,
            )

    with _ignore_perms():
        from erpnext.stock.doctype.delivery_note.delivery_note import make_sales_invoice
        sinv = make_sales_invoice(delivery_note)
        sinv.debit_to      = DEBIT_ACCOUNT
        sinv.due_date      = add_days(today(), int(due_days))
        sinv.set_warehouse = WAREHOUSE

        try:
            sinv.set_missing_values()
        except Exception:
            frappe.log_error(frappe.get_traceback(), "set_missing_values non-critical (delivery.py invoice)")

        sinv.insert(ignore_permissions=True)

        submit_error = None
        try:
            sinv.submit()
        except Exception as e:
            frappe.log_error(frappe.get_traceback(), "Invoice from DN Submit Error")
            submit_error = str(e)

        frappe.db.commit()

    payment_recorded = False
    collected_amount = 0
    if sinv.docstatus == 1 and mode_of_payment and mode_of_payment.lower() != "credit":
        try:
            requested_amount = float(amount_to_collect) if amount_to_collect not in (None, "") else (sinv.outstanding_amount or 0)
        except (TypeError, ValueError):
            frappe.throw("amount_to_collect must be a number.", frappe.ValidationError)
        if requested_amount < 0:
            frappe.throw("Amount to collect cannot be negative.", frappe.ValidationError)
        collected_amount = min(requested_amount, sinv.outstanding_amount or 0)
        payment_recorded = _record_payment(sinv, mode_of_payment, collected_amount)

    refreshed_outstanding = sinv.outstanding_amount or 0
    if sinv.docstatus == 1:
        refreshed_outstanding = frappe.db.get_value(
            DocType.SALES_INVOICE, sinv.name, "outstanding_amount"
        ) or 0

    return {
        "invoice":            sinv.name,
        "delivery_note":      delivery_note,
        "grand_total":        sinv.grand_total,
        "outstanding_amount": refreshed_outstanding,
        "collected_amount":   collected_amount if payment_recorded else 0,
        "submit_error":       submit_error,
        "payment_recorded":   payment_recorded,
    }


def _record_payment(sinv, mode_of_payment, amount=None):
    if sinv.docstatus != 1 or not mode_of_payment:
        return False
    if not sinv.outstanding_amount or sinv.outstanding_amount <= 0:
        return False
    amount = float(amount) if amount is not None else (sinv.outstanding_amount or 0)
    if amount <= 0:
        return False
    amount = min(amount, sinv.outstanding_amount or 0)
    try:
        with _ignore_perms():
            account = frappe.db.get_value(
                DocType.MODE_OF_PAYMENT_ACCOUNT,
                {"parent": mode_of_payment, "company": COMPANY},
                "default_account",
            )
            if not account:
                return False
            pe = frappe.get_doc({
                "doctype":              DocType.PAYMENT_ENTRY,
                "payment_type":         "Receive",
                "mode_of_payment":      mode_of_payment,
                "party_type":           DocType.CUSTOMER,
                "party":                sinv.customer,
                "company":              COMPANY,
                "posting_date":         sinv.posting_date,
                "paid_amount":          amount,
                "received_amount":      amount,
                "paid_to":              account,
                "paid_from":            DEBIT_ACCOUNT,
                "paid_from_account_currency": CURRENCY,
                "paid_to_account_currency":   CURRENCY,
                "references": [{
                    "reference_doctype": DocType.SALES_INVOICE,
                    "reference_name":    sinv.name,
                    "allocated_amount":  amount,
                }],
            })
            pe.insert(ignore_permissions=True)
            pe.submit()
            frappe.db.commit()
        return True
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Payment Entry from DN Error")
        return False


def _find_unbilled_dn_for_order(sales_order):
    """
    Return the name of a submitted, not-yet-invoiced Delivery Note created
    today for the given Sales Order, or None. Used for idempotent DN creation.
    """
    linked = frappe.db.get_all(
        "Delivery Note Item",
        filters={"against_sales_order": sales_order},
        fields=["parent"],
        distinct=True,
        limit_page_length=0,
    )
    if not linked:
        return None
    dn_names = [r["parent"] for r in linked]
    return frappe.db.get_value(
        DocType.DELIVERY_NOTE,
        {
            "name":       ["in", dn_names],
            "docstatus":  1,
            "per_billed": 0,
        },
        "name",
        order_by="creation desc",
    )
