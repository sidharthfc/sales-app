app_name = "route_sales"
app_title = "FCTrail"
app_publisher = "LMNTRIX Pvt Ltd"
app_description = "Route Sales Management System for electrical and plumbing trading company."
app_email = "routesales@lmntrix.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "route_sales",
# 		"logo": "/assets/route_sales/logo.png",
# 		"title": "Route Sales",
# 		"route": "/route_sales",
# 		"has_permission": "route_sales.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/route_sales/css/route_sales.css"
# app_include_js = "/assets/route_sales/js/route_sales.js"

# include js, css files in header of web template
# web_include_css = "/assets/route_sales/css/route_sales.css"
# web_include_js = "/assets/route_sales/js/route_sales.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "route_sales/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
    "Customer": "public/js/customer_route_sales.js"
}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "route_sales/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Route Sales PWA (frontend/, built to route_sales/public/frontend by
# `bench build`) — served at /route_sales, client-side routes fall through
# to the same page so React Router can take over. See
# route_sales/www/route_sales.py.
#
# The sw.min.js rule must come before the wildcard: a service worker's max
# scope is the directory it's served from, and /assets/route_sales/frontend/
# (where the JS/CSS bundle actually lives) is a sibling of /route_sales/, not
# a parent of it -- registering it from there could never cover this app's
# own pages, which silently fails Chrome's "Install" criteria (no error, it
# just never offers to install). Serving this one file natively from here
# instead gives it the right scope with no extra header/config needed. The
# physical copy at www/route_sales/sw.min.js is kept in sync by a `cp` step
# chained onto package.json's "build" script (frontend/vite.config.js has
# the full explanation), not by hand.
website_route_rules = [
	{"from_route": "/route_sales/sw.min.js", "to_route": "route_sales/sw.min.js"},
	{"from_route": "/route_sales/<path:app_path>", "to_route": "route_sales"},
]

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "route_sales.utils.jinja_methods",
# 	"filters": "route_sales.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "route_sales.install.before_install"
after_install = [
	"route_sales.api.leads._ensure_lead_custom_fields",
	"route_sales.api.selling._ensure_route_session_custom_fields",
]
after_migrate = [
	"route_sales.api.leads._ensure_lead_custom_fields",
	"route_sales.api.selling._ensure_route_session_custom_fields",
]

# Uninstallation
# ------------

# before_uninstall = "route_sales.uninstall.before_uninstall"
# after_uninstall = "route_sales.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "route_sales.utils.before_app_install"
# after_app_install = "route_sales.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "route_sales.utils.before_app_uninstall"
# after_app_uninstall = "route_sales.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "route_sales.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
    "Customer": {
        "validate": "route_sales.api.route_utils.customer_validate"
    }
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"route_sales.tasks.all"
# 	],
# 	"daily": [
# 		"route_sales.tasks.daily"
# 	],
# 	"hourly": [
# 		"route_sales.tasks.hourly"
# 	],
# 	"weekly": [
# 		"route_sales.tasks.weekly"
# 	],
# 	"monthly": [
# 		"route_sales.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "route_sales.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "route_sales.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "route_sales.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "route_sales.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["route_sales.utils.before_request"]
# after_request = ["route_sales.utils.after_request"]

# Job Events
# ----------
# before_job = ["route_sales.utils.before_job"]
# after_job = ["route_sales.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"route_sales.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []


fixtures = [
    {"dt": "Role", "filters": [["role_name", "in", ("Route Sales User", "Route Sales Manager")]]},
    {"dt": "Custom DocPerm", "filters": [["role", "in", ("Route Sales User", "Route Sales Manager")]]},
    {
        "dt": "Custom Field",
        "filters": [["dt", "=", "Item"], ["fieldname", "in", (
            "pressure_rating", "pipe_size", "material", "wattage", "voltage"
        )]]
    },
    {
        "dt": "Custom Field",
        "filters": [["dt", "=", "Customer"], ["fieldname", "in", (
            "route_sales_details_section", "is_route_customer", "route",
            "primary_sales_executive", "beat_area_code", "visit_day",
            "visit_tracking_section", "last_visit_date", "next_scheduled_visit",
            "visit_sequence", "sales_control_section", "priority_level",
            "preferred_payment_mode", "outstanding_limit_alert",
            "geo_location_section", "latitude", "longitude"
        )]]
    },
    {
        "dt": "Property Setter",
        "filters": [["doc_type", "=", "Item"]]
    },
]
