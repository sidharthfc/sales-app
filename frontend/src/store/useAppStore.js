import { create } from 'zustand'

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
  }),

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
