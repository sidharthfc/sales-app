import { create } from 'zustand'

// Mirrors route_sales.api.constants._FEATURE_FLAG_DEFAULTS on the backend —
// used only until the real bootstrap/login response arrives, so nav/routes
// never flash "everything hidden" while that first request is in flight.
const DEFAULT_FEATURES = {
  enable_deliver_bill:          true,
  enable_take_order:            true,
  enable_leads:                 true,
  enable_returns:                true,
  enable_expenses:              true,
  enable_admin_tracking:        true,
  enable_routes_tile:           true,
  enable_payment_tile:          true,
  enable_invoice_tile:          true,
  enable_orders_tile:           true,
  enable_more_tab:              true,
  enable_lead_crm:              false,
  take_order_bills_immediately: false,
}

const DEFAULT_BRANDING = {
  app_name:      'Route Sales',
  display_name:  'Route Sales',
  logo:          null,
  primary_color: '#E8972A',
  accent_color:  '#D4780A',
}

// Used only until the real bootstrap/login response arrives with the real
// core Mode of Payment list -- Cash is the one mode safe to assume exists
// everywhere, so the payment picker isn't empty for that first frame.
const DEFAULT_PAYMENT_MODES = [{ name: 'Cash', type: 'Cash' }]

const useAppStore = create((set) => ({
  // ── Auth ────────────────────────────────────────────────────────────────────
  authChecked:  false,
  user:         null,           // { email, fullName, salesperson, code, territory }
  setAuthChecked: (v)    => set({ authChecked: v }),
  setUser:       (user)  => set({ user }),
  clearUser:     ()      => set({
    user: null,
    session: null,
    todayRoute: null,
    customers: [],
    selectedCustomer: null,
    features: DEFAULT_FEATURES,
    branding: DEFAULT_BRANDING,
    paymentModes: DEFAULT_PAYMENT_MODES,
  }),

  // ── Per-client config (Route Sales Settings, fetched at login/boot) ─────────
  features: DEFAULT_FEATURES,
  branding: DEFAULT_BRANDING,
  paymentModes: DEFAULT_PAYMENT_MODES,
  socketioPort: null,
  // Merges per-key: a key that's simply omitted (e.g. Login.jsx's pre-auth
  // branding-only fetch) leaves the existing store value alone instead of
  // resetting it to defaults. A key that IS passed but empty/null still
  // falls back to its default, same as before.
  setConfig: ({ features, branding, paymentModes, socketioPort } = {}) => set((state) => ({
    features:     features     !== undefined ? (features || DEFAULT_FEATURES) : state.features,
    branding:     branding     !== undefined ? (branding || DEFAULT_BRANDING) : state.branding,
    paymentModes: paymentModes !== undefined ? (paymentModes?.length ? paymentModes : DEFAULT_PAYMENT_MODES) : state.paymentModes,
    socketioPort: socketioPort !== undefined ? socketioPort : state.socketioPort,
  })),

  // ── Active session ──────────────────────────────────────────────────────────
  session:       null,          // { name, start_time, route, total_customers }
  setSession:   (s)     => set({ session: s }),
  clearSession: ()      => set({ session: null, selectedCustomer: null }),

  // ── Today's route & customers ───────────────────────────────────────────────
  todayRoute:   null,
  setTodayRoute: (r)    => set({ todayRoute: r }),

  customers:    [],
  setCustomers: (c)     => set({ customers: c }),
  updateCustomerStatus: (customerId, status) =>
    set((state) => ({
      customers: state.customers.map((c) =>
        c.customer === customerId ? { ...c, visit_status: status } : c
      ),
    })),

  selectedCustomer: null,
  setSelectedCustomer: (customer) => set({ selectedCustomer: customer }),
  clearSelectedCustomer: () => set({ selectedCustomer: null }),

  // ── Data sync ────────────────────────────────────────────────────────────────
  // Increments whenever data may have changed anywhere -- a delivery/payment
  // completing in this app, a realtime event from the backend (another
  // device or the desk), or the app regaining focus/network after being
  // backgrounded. Pages subscribe to this and re-fetch their data when it
  // changes, so a bump here is the one signal that drives every kind of
  // "please refresh" in the app.
  dataVersion: 0,
  invalidateData: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}))

export default useAppStore
