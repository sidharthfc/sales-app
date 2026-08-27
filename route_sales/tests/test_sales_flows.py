from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from route_sales.api import delivery, payments, selling


class CreateQuotationTests(TestCase):
    def test_create_quotation_rejects_empty_items(self):
        fake_frappe = MagicMock()
        fake_frappe.ValidationError = RuntimeError
        fake_frappe.throw.side_effect = RuntimeError("no items")

        with patch("route_sales.api.selling.frappe", fake_frappe), patch(
            "route_sales.api.selling.assert_customer_access"
        ):
            with self.assertRaises(RuntimeError):
                selling.create_quotation("CUST-001", [])

    def test_create_quotation_builds_route_session_remarks(self):
        fake_quote = SimpleNamespace(
            name="QTN-0001",
            grand_total=150.0,
            items=[SimpleNamespace(item_code="ITEM-001", item_name="Pipe", qty=2, rate=75, amount=150, uom="Nos")],
            set_missing_values=MagicMock(),
            insert=MagicMock(),
        )
        fake_frappe = MagicMock()
        fake_frappe.db.get_value.side_effect = ["Custom Price", None]
        fake_frappe.get_doc.return_value = fake_quote

        with patch("route_sales.api.selling.frappe", fake_frappe), patch(
            "route_sales.api.selling.assert_customer_access"
        ), patch("route_sales.api.selling.ensure_route_session_access"), patch(
            "route_sales.api.selling.today", return_value="2026-04-01"
        ), patch("route_sales.api.selling.add_days", return_value="2026-04-08"):
            result = selling.create_quotation(
                "CUST-001",
                [{"item_code": "ITEM-001", "qty": 2}],
                route_session="RS-0001",
                remarks="Priority customer",
            )

        payload = fake_frappe.get_doc.call_args.args[0]
        self.assertEqual(payload["selling_price_list"], "Custom Price")
        self.assertEqual(payload["remarks"], "Route Session: RS-0001\nPriority customer")
        self.assertEqual(result["quotation"], "QTN-0001")


class CompletePaymentTests(TestCase):
    def test_complete_payment_skips_payment_entry_for_credit_mode(self):
        fake_so = SimpleNamespace(customer="CUST-001", docstatus=1)
        fake_invoice = SimpleNamespace(
            name="SINV-0001",
            grand_total=250.0,
            outstanding_amount=250.0,
            docstatus=1,
            flags=SimpleNamespace(),
            set_missing_values=MagicMock(),
            insert=MagicMock(),
            submit=MagicMock(),
        )
        fake_frappe = MagicMock()
        fake_frappe.get_doc.return_value = fake_so

        with patch("route_sales.api.selling.frappe", fake_frappe), patch(
            "route_sales.api.selling.assert_customer_access"
        ), patch("route_sales.api.selling.record_payment_for_invoice") as record_payment, patch(
            "route_sales.api.selling.today", return_value="2026-04-01"
        ), patch(
            "route_sales.api.selling.add_days", return_value="2026-04-01"
        ), patch("erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice", return_value=fake_invoice):
            result = selling.complete_payment("SO-0001", mode_of_payment="Credit")

        record_payment.assert_not_called()
        self.assertFalse(result["payment_recorded"])
        self.assertEqual(result["invoice"], "SINV-0001")

    def test_complete_payment_records_payment_for_cash(self):
        fake_so = SimpleNamespace(customer="CUST-001", docstatus=1)
        fake_invoice = SimpleNamespace(
            name="SINV-0002",
            grand_total=400.0,
            outstanding_amount=400.0,
            docstatus=1,
            flags=SimpleNamespace(),
            set_missing_values=MagicMock(),
            insert=MagicMock(),
            submit=MagicMock(),
        )
        fake_frappe = MagicMock()
        fake_frappe.get_doc.return_value = fake_so

        with patch("route_sales.api.selling.frappe", fake_frappe), patch(
            "route_sales.api.selling.assert_customer_access"
        ), patch("route_sales.api.selling.record_payment_for_invoice", return_value=True) as record_payment, patch(
            "route_sales.api.selling.today", return_value="2026-04-01"
        ), patch(
            "route_sales.api.selling.add_days", return_value="2026-04-01"
        ), patch("erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice", return_value=fake_invoice):
            result = selling.complete_payment("SO-0002", mode_of_payment="Cash")

        record_payment.assert_called_once_with(fake_invoice, "Cash")
        self.assertTrue(result["payment_recorded"])


class DeliveryFlowTests(TestCase):
    def test_create_delivery_note_throws_when_no_items_remain(self):
        fake_so = SimpleNamespace(customer="CUST-001", docstatus=1)
        fake_dn = SimpleNamespace(items=[], set_missing_values=MagicMock(), calculate_taxes_and_totals=MagicMock())
        fake_frappe = MagicMock()
        fake_frappe.ValidationError = RuntimeError
        fake_frappe.throw.side_effect = RuntimeError("no deliverable items")
        fake_frappe.get_doc.return_value = fake_so

        with patch("route_sales.api.delivery.frappe", fake_frappe), patch(
            "route_sales.api.delivery.assert_customer_access"
        ), patch("erpnext.selling.doctype.sales_order.sales_order.make_delivery_note", return_value=fake_dn):
            with self.assertRaises(RuntimeError):
                delivery.create_delivery_note("SO-0001", items='[{"item_code":"ITEM-001","qty":0}]')

    def test_create_invoice_from_delivery_skips_payment_for_credit(self):
        fake_dn = SimpleNamespace(customer="CUST-001", docstatus=1)
        fake_invoice = SimpleNamespace(
            name="SINV-DN-0001",
            grand_total=180.0,
            outstanding_amount=180.0,
            docstatus=1,
            set_missing_values=MagicMock(),
            insert=MagicMock(),
            submit=MagicMock(),
        )
        fake_frappe = MagicMock()
        fake_frappe.get_doc.return_value = fake_dn

        with patch("route_sales.api.delivery.frappe", fake_frappe), patch(
            "route_sales.api.delivery.assert_customer_access"
        ), patch("route_sales.api.delivery.record_payment_for_invoice") as record_payment, patch(
            "route_sales.api.delivery.today", return_value="2026-04-01"
        ), patch(
            "route_sales.api.delivery.add_days", return_value="2026-04-01"
        ), patch("erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice", return_value=fake_invoice):
            result = delivery.create_invoice_from_delivery("DN-0001", mode_of_payment="Credit")

        record_payment.assert_not_called()
        self.assertFalse(result["payment_recorded"])

    def test_create_invoice_from_delivery_returns_refreshed_outstanding_after_collection(self):
        fake_dn = SimpleNamespace(customer="CUST-001", docstatus=1)
        fake_invoice = SimpleNamespace(
            name="SINV-DN-0002",
            grand_total=1074.0,
            outstanding_amount=1074.0,
            docstatus=1,
            set_missing_values=MagicMock(),
            insert=MagicMock(),
            submit=MagicMock(),
        )
        fake_frappe = MagicMock()
        fake_frappe.get_doc.return_value = fake_dn
        fake_frappe.db.get_value.return_value = 0.0

        with patch("route_sales.api.delivery.frappe", fake_frappe), patch(
            "route_sales.api.delivery.assert_customer_access"
        ), patch("route_sales.api.delivery.record_payment_for_invoice", return_value=True) as record_payment, patch(
            "route_sales.api.delivery.today", return_value="2026-04-01"
        ), patch(
            "route_sales.api.delivery.add_days", return_value="2026-04-01"
        ), patch("erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice", return_value=fake_invoice):
            result = delivery.create_invoice_from_delivery("DN-0002", mode_of_payment="Cash")

        record_payment.assert_called_once_with(fake_invoice, "Cash", 1074.0)
        self.assertTrue(result["payment_recorded"])
        self.assertEqual(result["collected_amount"], 1074.0)
        self.assertEqual(result["outstanding_amount"], 0.0)

    def test_create_invoice_from_delivery_supports_partial_collection_amount(self):
        fake_dn = SimpleNamespace(customer="CUST-001", docstatus=1)
        fake_invoice = SimpleNamespace(
            name="SINV-DN-0003",
            grand_total=1074.0,
            outstanding_amount=1074.0,
            docstatus=1,
            set_missing_values=MagicMock(),
            insert=MagicMock(),
            submit=MagicMock(),
        )
        fake_frappe = MagicMock()
        fake_frappe.get_doc.return_value = fake_dn
        fake_frappe.db.get_value.return_value = 537.0

        with patch("route_sales.api.delivery.frappe", fake_frappe), patch(
            "route_sales.api.delivery.assert_customer_access"
        ), patch("route_sales.api.delivery.record_payment_for_invoice", return_value=True) as record_payment, patch(
            "route_sales.api.delivery.today", return_value="2026-04-01"
        ), patch(
            "route_sales.api.delivery.add_days", return_value="2026-04-01"
        ), patch("erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice", return_value=fake_invoice):
            result = delivery.create_invoice_from_delivery(
                "DN-0003",
                mode_of_payment="Cash",
                amount_to_collect=537.0,
            )

        record_payment.assert_called_once_with(fake_invoice, "Cash", 537.0)
        self.assertTrue(result["payment_recorded"])
        self.assertEqual(result["collected_amount"], 537.0)
        self.assertEqual(result["outstanding_amount"], 537.0)


class CollectPaymentTests(TestCase):
    def test_collect_payment_returns_exact_invoice_allocation(self):
        fake_payment_entry = SimpleNamespace(
            name="PE-0001",
            insert=MagicMock(),
            submit=MagicMock(),
        )
        fake_frappe = MagicMock()
        fake_frappe.ValidationError = RuntimeError
        fake_frappe.DoesNotExistError = RuntimeError
        fake_frappe.db.exists.return_value = True
        fake_frappe.db.get_value.side_effect = [
            "Bank - LMN",  # mode of payment account
            "Best Kasaragod Pump House",  # customer name
            {"customer": "CUST-001", "outstanding_amount": 2830.0},  # invoice lookup
            1000.0,  # invoice outstanding after submit
        ]
        fake_frappe.get_doc.return_value = fake_payment_entry

        with patch("route_sales.api.payments.frappe", fake_frappe), patch(
            "route_sales.api.payments.assert_customer_access"
        ), patch("route_sales.api.payments.ensure_route_session_access"), patch(
            "route_sales.api.payments.today", return_value="2026-04-01"
        ):
            result = payments.collect_payment(
                customer="CUST-001",
                amount=1830.0,
                mode_of_payment="Cash",
                invoice="SINV-26-00010",
                route_session="RS-0001",
            )

        payload = fake_frappe.get_doc.call_args.args[0]
        self.assertEqual(payload["paid_amount"], 1830.0)
        self.assertEqual(payload["received_amount"], 1830.0)
        self.assertEqual(len(payload["references"]), 1)
        self.assertEqual(payload["references"][0]["reference_name"], "SINV-26-00010")
        self.assertEqual(payload["references"][0]["allocated_amount"], 1830.0)
        self.assertEqual(result["allocated_amount"], 1830.0)
        self.assertEqual(result["invoice_outstanding_after"], 1000.0)
        self.assertEqual(result["unallocated_amount"], 0.0)
