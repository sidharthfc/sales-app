from unittest import TestCase
from unittest.mock import MagicMock, patch

from route_sales.api import location, payments, sessions


class StartSessionGuardTests(TestCase):
    def test_rejects_mismatched_assignment_salesperson(self):
        fake_frappe = MagicMock()
        fake_frappe.PermissionError = RuntimeError
        fake_frappe.throw.side_effect = RuntimeError("mismatch")

        with patch("route_sales.api.sessions.frappe", fake_frappe), patch(
            "route_sales.api.sessions.resolve_salesperson", return_value="SP-001"
        ), patch(
            "route_sales.api.sessions.ensure_route_assignment_access",
            return_value={"salesperson": "SP-002", "date": "2026-04-01", "vehicle": None, "route": None},
        ), patch("route_sales.api.sessions.today", return_value="2026-04-01"):
            with self.assertRaises(RuntimeError):
                sessions.start_session("SP-001", "RA-0001")


class PaymentScopeTests(TestCase):
    def test_payment_entries_are_derived_from_invoice_references(self):
        responses = [
            [{"name": "INV-001"}, {"name": "INV-002"}],
            [{"parent": "PAY-001"}, {"parent": "PAY-002"}],
        ]

        fake_frappe = MagicMock()
        fake_frappe.db.get_all.side_effect = responses

        with patch("route_sales.api.payments.frappe", fake_frappe):
            result = payments._payment_entries_for_salesperson("SP-001", "2026-04-01", "2026-04-30")

        self.assertEqual(result, ["PAY-001", "PAY-002"])


class LiveLocationTests(TestCase):
    def test_update_location_rejects_closed_session(self):
        fake_session = {"salesperson": "SP-001", "end_time": "2026-04-01 18:00:00"}
        fake_frappe = MagicMock()
        fake_frappe.throw.side_effect = RuntimeError("closed")

        with patch("route_sales.api.location.frappe", fake_frappe), patch(
            "route_sales.api.location.get_user_context", return_value={"salesperson": "SP-001"}
        ), patch(
            "route_sales.api.location.ensure_route_session_access", return_value=fake_session
        ):
            with self.assertRaises(RuntimeError):
                location.update_location(10, 20, session_name="RS-0001")

    def test_get_live_locations_filters_to_today_open_sessions(self):
        cache = MagicMock()
        cache.get_value.return_value = None
        fake_frappe = MagicMock()
        fake_frappe.db.get_all.side_effect = [
            [{"name": "RS-0001", "salesperson": "SP-001"}],
            [{"name": "SP-001", "sales_person_name": "Alice"}],
        ]
        fake_frappe.cache.return_value = cache

        with patch("route_sales.api.location.frappe", fake_frappe), patch("route_sales.api.location.only_manager"), patch(
            "route_sales.api.location.today", return_value="2026-04-01"
        ):
            rows = location.get_live_locations()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["salesperson"], "SP-001")
        active_filters = fake_frappe.db.get_all.call_args_list[0].kwargs["filters"]
        self.assertEqual(active_filters["end_time"], ["is", "not set"])
        self.assertEqual(
            active_filters["start_time"],
            ["between", ["2026-04-01 00:00:00", "2026-04-01 23:59:59"]],
        )
