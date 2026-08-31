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
  enable_cash:                  true,
  enable_upi:                   true,
  enable_bank_transfer:         true,
  enable_credit:                true,
}

const DEFAULT_BRANDING = {
  display_name:  'Route Sales',
  logo:          null,
  primary_color: '#E8972A',
  accent_color:  '#D4780A',
}

// Mirrors route_sales.api.constants.DEFAULT_ITEM_CATEGORIES.
const DEFAULT_ITEM_CATEGORIES = [
  { label: 'Electrical', item_group: null, item_code_prefix: 'ELE' },
  { label: 'Plumbing',   item_group: null, item_code_prefix: 'PLM' },
  { label: 'CPVC',       item_group: null, item_code_prefix: 'PLU' },
]

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
    itemCategories: DEFAULT_ITEM_CATEGORIES,
  }),

  // ── Per-client config (Route Sales Settings, fetched at login/boot) ─────────
  features: DEFAULT_FEATURES,
  branding: DEFAULT_BRANDING,
  itemCategories: DEFAULT_ITEM_CATEGORIES,
  // Merges per-key: a key that's simply omitted (e.g. Login.jsx's pre-auth
  // branding-only fetch) leaves the existing store value alone instead of
  // resetting it to defaults. A key that IS passed but empty/null still
  // falls back to its default, same as before.
  setConfig: ({ features, branding, itemCategories } = {}) => set((state) => ({
    features:       features       !== undefined ? (features || DEFAULT_FEATURES) : state.features,
    branding:       branding       !== undefined ? (branding || DEFAULT_BRANDING) : state.branding,
    itemCategories: itemCategories !== undefined ? (itemCategories?.length ? itemCategories : DEFAULT_ITEM_CATEGORIES) : state.itemCategories,
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

  // ── Transaction sync ────────────────────────────────────────────────────────
  // Increments whenever a delivery or payment completes anywhere in the app.
  // Pages subscribe to this and re-fetch their data when it changes.
  transactionVersion: 0,
  invalidateTransactions: () => set((s) => ({ transactionVersion: s.transactionVersion + 1 })),
}))

export default useAppStore
