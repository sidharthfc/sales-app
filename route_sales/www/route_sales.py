from pathlib import Path

import frappe

no_cache = 1
no_sitemap = 1


def get_context(context):
	"""Serve the built Route Sales PWA (frontend/) as a raw SPA shell.

	The frontend's Vite build is configured with an absolute asset base
	(/assets/route_sales/frontend/), so the built index.html's own script/
	link tags already resolve correctly once injected here unmodified.
	"""
	context.no_cache = 1

	index_file = Path(frappe.get_app_path("route_sales")) / "public" / "frontend" / "index.html"
	if not index_file.exists():
		frappe.throw(
			"Route Sales frontend is not built. Run: bench build --app route_sales "
			"(from the frontend/ folder: npm install && npm run build).",
			frappe.DoesNotExistError,
		)

	context.index_html = index_file.read_text()
