"""
Patch: add_db_indices
Adds missing database indices that are critical for Route Sales query performance.

Route Session: salesperson + end_time — queried on every API call via get_active_session()
Route Visit:   route_session + visit_status — queried in session summary, admin overview
"""
import frappe


def execute():
    db = frappe.db

    # ── Route Session ─────────────────────────────────────────────────────────
    # get_active_session() filters by salesperson WHERE end_time IS NULL on every request.
    if not _index_exists("tabRoute Session", "rs_salesperson_end_time"):
        db.sql("""
            ALTER TABLE `tabRoute Session`
            ADD INDEX `rs_salesperson_end_time` (`salesperson`(140), `end_time`)
        """)

    # ── Route Visit ───────────────────────────────────────────────────────────
    # Session summary and admin overview filter by route_session and visit_status together.
    if not _index_exists("tabRoute Visit", "rv_session_status"):
        db.sql("""
            ALTER TABLE `tabRoute Visit`
            ADD INDEX `rv_session_status` (`route_session`(140), `visit_status`(20))
        """)

    frappe.db.commit()


def _index_exists(table, index_name):
    result = frappe.db.sql(
        "SELECT COUNT(*) FROM information_schema.statistics "
        "WHERE table_schema = DATABASE() "
        "AND table_name = %s AND index_name = %s",
        (table, index_name),
    )
    return result and result[0][0] > 0
