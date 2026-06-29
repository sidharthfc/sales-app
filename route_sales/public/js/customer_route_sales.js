/**
 * Client Script — doctype: Customer
 * Handles Route Sales automation on the Customer form.
 */

frappe.ui.form.on("Customer", {

    // ----------------------------------------------------------------
    // refresh: set field states on load
    // ----------------------------------------------------------------
    refresh(frm) {
        set_route_sales_state(frm);
    },

    // ----------------------------------------------------------------
    // is_route_customer: toggle mandatory & compute next visit
    // ----------------------------------------------------------------
    is_route_customer(frm) {
        set_route_sales_state(frm);
        if (frm.doc.is_route_customer && frm.doc.visit_day) {
            set_next_visit(frm);
        }
    },

    // ----------------------------------------------------------------
    // route: auto-pull salesperson from Sales Route when route changes
    // ----------------------------------------------------------------
    route(frm) {
        if (!frm.doc.route) return;
        frappe.db.get_value("Sales Route", frm.doc.route, "salesperson", (r) => {
            if (r && r.salesperson && !frm.doc.primary_sales_executive) {
                frm.set_value("primary_sales_executive", r.salesperson);
            }
        });
    },

    // ----------------------------------------------------------------
    // visit_day: compute next_scheduled_visit
    // ----------------------------------------------------------------
    visit_day(frm) {
        if (frm.doc.visit_day) {
            set_next_visit(frm);
        }
    }
});

// ----------------------------------------------------------------
// Helper: toggle required state and coloring for route-related fields
// ----------------------------------------------------------------
function set_route_sales_state(frm) {
    const is_route = frm.doc.is_route_customer;
    frm.set_df_property("route", "reqd", is_route ? 1 : 0);
    // Keep the field query aligned with Sales Route records
    frm.set_query("route", function() {
        return {};
    });
    frm.set_df_property("primary_sales_executive", "reqd", is_route ? 1 : 0);
    frm.refresh_fields(["route", "primary_sales_executive"]);
}

// ----------------------------------------------------------------
// Helper: compute next occurrence of visit_day from today
// ----------------------------------------------------------------
function set_next_visit(frm) {
    const day_indices = {
        "Monday": 1, "Tuesday": 2, "Wednesday": 3,
        "Thursday": 4, "Friday": 5, "Saturday": 6, "Sunday": 0
    };
    const target_day = day_indices[frm.doc.visit_day];
    if (target_day === undefined) return;

    const today = frappe.datetime.get_today();
    const today_date = frappe.datetime.str_to_obj(today);
    const today_day = today_date.getDay();  // 0 = Sunday

    let diff = target_day - today_day;
    if (diff <= 0) diff += 7;  // always schedule future

    const next_visit = frappe.datetime.add_days(today, diff);
    frm.set_value("next_scheduled_visit", next_visit);
}
