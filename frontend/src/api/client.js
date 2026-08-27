import axios from 'axios'
import { AUTH_STORAGE_KEYS } from '@/lib/constants'

export const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Attach token auth on every request if stored (mobile — bypasses cookie issues)
api.interceptors.request.use((config) => {
  const key    = localStorage.getItem(AUTH_STORAGE_KEYS.API_KEY)
  const secret = localStorage.getItem(AUTH_STORAGE_KEYS.API_SECRET)
  if (key && secret) {
    config.headers['Authorization'] = `token ${key}:${secret}`
  }
  return config
})

// Unwrap Frappe's { message: ... } envelope
api.interceptors.response.use(
  (res) => {
    if (res.data && 'message' in res.data) return res.data.message
    return res.data
  },
  (error) => {
    const data = error.response?.data || {}
    // _server_messages is a JSON-encoded string array in Frappe e.g. '["<b>Error</b>: msg"]'
    let srvMsg = null
    if (data._server_messages) {
      try {
        const parsed = JSON.parse(data._server_messages)
        const raw = Array.isArray(parsed) ? parsed[0] : parsed
        srvMsg = raw ? String(raw).replace(/<[^>]+>/g, '').trim() : null
      } catch (_) {
        srvMsg = null
      }
    }
    const msg =
      data.message ||
      data.exception ||
      data.exc ||
      srvMsg ||
      data.exc_type ||
      error.message
    return Promise.reject(new Error(msg))
  }
)

export const endpoints = {
  // Sessions
  startSession:         '/api/method/route_sales.api.sessions.start_session',
  endSession:           '/api/method/route_sales.api.sessions.end_session',
  getSessionSummary:    '/api/method/route_sales.api.sessions.get_session_summary',
  getRecentSessions:    '/api/method/route_sales.api.sessions.get_recent_sessions',
  getVehicles:          '/api/method/route_sales.api.sessions.get_vehicles',
  uploadOdometerPhoto:  '/api/method/route_sales.api.sessions.upload_odometer_photo',
  // Auth
  getBootstrap:      '/api/method/route_sales.api.auth.get_bootstrap',
  revokeApiCredentials: '/api/method/route_sales.api.auth.revoke_api_credentials',
  // Routes
  getTodayRoute:     '/api/method/route_sales.api.routes.get_today_route',
  // Visits
  checkin:           '/api/method/route_sales.api.visits.checkin_customer',
  checkout:          '/api/method/route_sales.api.visits.checkout_customer',
  skipCustomer:      '/api/method/route_sales.api.visits.skip_customer',
  // Customers
  getCustomer:       '/api/method/route_sales.api.customers.get_customer_details',
  // Items
  getItems:          '/api/method/route_sales.api.items.get_customer_items',
  searchItemsForVan: '/api/method/route_sales.api.items.search_items_for_van',
  // Orders
  getOrders:         '/api/method/route_sales.api.orders.get_customer_orders',
  // Selling flow (Quotation → Sales Order → Invoice → Payment)
  createQuotation:      '/api/method/route_sales.api.selling.create_quotation',
  confirmOrder:         '/api/method/route_sales.api.selling.confirm_order',
  completePayment:      '/api/method/route_sales.api.selling.complete_payment',
  getQuotation:         '/api/method/route_sales.api.selling.get_quotation',
  createSalesOrderOnly: '/api/method/route_sales.api.selling.create_sales_order_only',
  // Delivery flow
  getPendingOrders:          '/api/method/route_sales.api.delivery.get_pending_orders',
  createDeliveryNote:        '/api/method/route_sales.api.delivery.create_delivery_note',
  createInvoiceFromDelivery: '/api/method/route_sales.api.delivery.create_invoice_from_delivery',
  // Van stock
  saveSessionStock:       '/api/method/route_sales.api.stock.save_session_stock',
  saveReturnStock:        '/api/method/route_sales.api.stock.save_return_stock',
  getSessionStock:        '/api/method/route_sales.api.stock.get_session_stock',
  getRouteStockSuggestion: '/api/method/route_sales.api.stock.get_route_stock_suggestion',
  // Customer outstanding
  getCustomerOutstanding: '/api/method/route_sales.api.customers.get_customer_outstanding',
  // Invoices
  createInvoice:     '/api/method/route_sales.api.invoices.create_sales_invoice',
  getInvoices:       '/api/method/route_sales.api.invoices.get_customer_invoices',
  // Payments
  getPayments:       '/api/method/route_sales.api.payments.get_payment_list',
  collectPayment:    '/api/method/route_sales.api.payments.collect_payment',
  // Leads
  createLead:        '/api/method/route_sales.api.leads.create_lead',
  getLeads:          '/api/method/route_sales.api.leads.get_leads',
  getLead:           '/api/method/route_sales.api.leads.get_lead',
  updateLead:        '/api/method/route_sales.api.leads.update_lead',
  // Returns
  getReturnableItems: '/api/method/route_sales.api.returns.get_returnable_items',
  createReturn:      '/api/method/route_sales.api.returns.create_return',
  // Expenses
  submitExpense:     '/api/method/route_sales.api.expenses.submit_expense',
  getExpenses:       '/api/method/route_sales.api.expenses.get_expense_list',
  // Dashboard
  getDashboard:      '/api/method/route_sales.api.dashboard.get_dashboard_stats',
  // Location tracking
  updateLocation:    '/api/method/route_sales.api.location.update_location',
  getLiveLocations:  '/api/method/route_sales.api.location.get_live_locations',
  // My Day
  getMyDay:                '/api/method/route_sales.api.my_day.get_my_day',
  getRouteOverdueInvoices: '/api/method/route_sales.api.my_day.get_route_overdue_invoices',
  getRoutePendingOrders:   '/api/method/route_sales.api.my_day.get_route_pending_orders',
  // My Customers
  getMyCustomers:    '/api/method/route_sales.api.customers.get_my_customers',
  // Admin
  adminCheckRole:       '/api/method/route_sales.api.admin.check_admin_role',
  adminGetSalespersons: '/api/method/route_sales.api.admin.get_salespersons',
  adminGetRoutes:       '/api/method/route_sales.api.admin.get_routes',
  adminGetAssignments:  '/api/method/route_sales.api.admin.get_assignments',
  adminAssignRoute:     '/api/method/route_sales.api.admin.assign_route',
  adminUnassignRoute:   '/api/method/route_sales.api.admin.unassign_route',
  adminGetRouteCustomers: '/api/method/route_sales.api.admin.get_route_customers',
  adminGetEmployeeDay:    '/api/method/route_sales.api.admin.admin_get_employee_day',
  adminGetOverview:       '/api/method/route_sales.api.admin.admin_get_overview',
  adminGetAllLocations:   '/api/method/route_sales.api.admin.admin_get_all_locations',
  adminGetRouteOrders:    '/api/method/route_sales.api.admin.admin_get_route_orders',
  adminGetReturns:        '/api/method/route_sales.api.admin.admin_get_returns',
  adminGetVanStock:       '/api/method/route_sales.api.admin.admin_get_van_stock',
  adminGetExpenses:       '/api/method/route_sales.api.admin.admin_get_expenses',
  adminGetAttendance:     '/api/method/route_sales.api.admin.admin_get_attendance',
}

/**
 * Upload a File object as an odometer photo.
 * Returns the Frappe file URL string.
 */
async function _uploadFile(file, endpoint) {
  const key    = localStorage.getItem(AUTH_STORAGE_KEYS.API_KEY)
  const secret = localStorage.getItem(AUTH_STORAGE_KEYS.API_SECRET)
  const form   = new FormData()
  form.append('file', file)
  const headers = {}
  if (key && secret) headers['Authorization'] = `token ${key}:${secret}`

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: form,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message || 'Upload failed.')
  const data = json.message ?? json
  return data.file_url
}

export const uploadOdometerPhoto = (file) => _uploadFile(file, endpoints.uploadOdometerPhoto)
export const uploadReceiptPhoto  = (file) => _uploadFile(file, endpoints.uploadOdometerPhoto)

export function clearStoredCredentials() {
  localStorage.removeItem(AUTH_STORAGE_KEYS.API_KEY)
  localStorage.removeItem(AUTH_STORAGE_KEYS.API_SECRET)
}

export async function revokeApiCredentials() {
  try {
    await api.post(endpoints.revokeApiCredentials)
  } catch (_) {
    // Best effort. We still clear local state below.
  } finally {
    clearStoredCredentials()
  }
}

export default api
