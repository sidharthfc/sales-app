import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import MobileLayout    from '@/components/layout/MobileLayout'
import useAppStore     from '@/store/useAppStore'
import api, { clearStoredCredentials, endpoints } from '@/api/client'
import { PageLoader }  from '@/components/shared/Spinner'
import { AUTH_STORAGE_KEYS } from '@/lib/constants'
import { applyBrandTheme } from '@/lib/theme'
import { SuccessPopup } from '@/lib/toast'
import { connectRealtime, disconnectRealtime } from '@/lib/realtime'


const Login = lazy(() => import('@/pages/Login'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const RoutesPage = lazy(() => import('@/pages/Routes'))
const Sales = lazy(() => import('@/pages/Sales'))
const Orders = lazy(() => import('@/pages/Orders'))
const Payments = lazy(() => import('@/pages/Payments'))
const Invoices = lazy(() => import('@/pages/Invoices'))
const Leads = lazy(() => import('@/pages/Leads'))
const Returns = lazy(() => import('@/pages/Returns'))
const Expenses = lazy(() => import('@/pages/Expenses'))
const Profile = lazy(() => import('@/pages/Profile'))
const More = lazy(() => import('@/pages/More'))
const AdminShell      = lazy(() => import('@/pages/admin/AdminShell'))
const AdminOverview   = lazy(() => import('@/pages/admin/AdminOverview'))
const AdminRoutes     = lazy(() => import('@/pages/admin/AdminRoutes'))
const AdminTracking   = lazy(() => import('@/pages/admin/AdminTracking'))
const AdminOrders     = lazy(() => import('@/pages/admin/AdminOrders'))
const AdminReturns    = lazy(() => import('@/pages/admin/AdminReturns'))
const AdminExpenses   = lazy(() => import('@/pages/admin/AdminExpenses'))
const AdminVanStock   = lazy(() => import('@/pages/admin/AdminVanStock'))
const AdminAttendance = lazy(() => import('@/pages/admin/AdminAttendance'))
const AdminLeads      = lazy(() => import('@/pages/admin/AdminLeads'))
const AdminCrmOverview = lazy(() => import('@/pages/admin/AdminCrmOverview'))
const CustomerDetail = lazy(() => import('@/pages/CustomerDetail'))
const MyDay          = lazy(() => import('@/pages/MyDay'))
const VanStock       = lazy(() => import('@/pages/VanStock'))
const MyCustomers    = lazy(() => import('@/pages/MyCustomers'))
const RouteOverdue       = lazy(() => import('@/pages/RouteOverdue'))
const RoutePendingOrders = lazy(() => import('@/pages/RoutePendingOrders'))
const MyLeads      = lazy(() => import('@/pages/MyLeads'))
const LeadDetail   = lazy(() => import('@/pages/LeadDetail'))
const MyQuotations = lazy(() => import('@/pages/MyQuotations'))
const QuotationForm = lazy(() => import('@/pages/QuotationForm'))
const MyDayCrm      = lazy(() => import('@/pages/MyDayCrm'))

function ProtectedRoute({ children, salesOnly = false }) {
  const user        = useAppStore(s => s.user)
  const authChecked = useAppStore(s => s.authChecked)
  if (!authChecked) return <PageLoader />
  if (!user)        return <Navigate to="/login" replace />
  // Redirect admins away from the sales UI to the admin panel
  if (salesOnly && user.isAdmin) return <Navigate to="/admin" replace />
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

// Gates an individual leaf route (nested inside the parent ProtectedRoute's
// Outlet) behind a Route Sales Settings feature flag — a disabled feature's
// URL redirects rather than rendering a dead page, covering deep links too,
// not just the nav tile that would normally hide it.
function FeatureGate({ featureKey, children }) {
  const features = useAppStore(s => s.features)
  if (!features[featureKey]) return <Navigate to="/dashboard" replace />
  return children
}

function RootRedirect() {
  const user        = useAppStore(s => s.user)
  const authChecked = useAppStore(s => s.authChecked)
  if (!authChecked) return <PageLoader />
  if (!user)        return <Navigate to="/login" replace />
  return <Navigate to={user.isAdmin ? '/admin' : '/dashboard'} replace />
}

// Overview itself is deployment-aware (see AdminOverviewRoute below), so the
// admin's landing tab is always Overview -- it just shows different content.
function AdminIndexRedirect() {
  return <Navigate to="/admin/overview" replace />
}

// The route-sales Overview (today's visits/orders/collections) has nothing
// to show on a Lead CRM-only deployment -- swap in the CRM-flavored one
// (KPIs + team conversion) instead, so "Overview" stays a meaningful landing
// page for either kind of deployment.
function AdminOverviewRoute() {
  const features = useAppStore(s => s.features)
  return features.enable_lead_crm ? <AdminCrmOverview /> : <AdminOverview />
}

export default function App() {
  const setUser        = useAppStore(s => s.setUser)
  const setSession     = useAppStore(s => s.setSession)
  const setAuthChecked = useAppStore(s => s.setAuthChecked)
  const clearSession   = useAppStore(s => s.clearSession)
  const setConfig      = useAppStore(s => s.setConfig)
  const branding       = useAppStore(s => s.branding)
  const user           = useAppStore(s => s.user)
  const socketioPort   = useAppStore(s => s.socketioPort)
  const invalidateData = useAppStore(s => s.invalidateData)

  // Applies whenever branding changes (login, bootstrap restore, or the
  // pre-auth guest fetch from Login.jsx) — cascades to every bg-brand/
  // text-brand-dark/etc. usage app-wide via the CSS custom properties
  // Tailwind's @theme block already registers, no per-component change.
  useEffect(() => {
    applyBrandTheme(branding)
  }, [branding])

  // ── Restore session from stored token on first load ────────────────────────
  useEffect(() => {
    const restore = async () => {
      try {
        const apiKey    = localStorage.getItem(AUTH_STORAGE_KEYS.API_KEY)
        const apiSecret = localStorage.getItem(AUTH_STORAGE_KEYS.API_SECRET)
        if (!apiKey || !apiSecret) throw new Error('No token')

        const data = await api.get(endpoints.getBootstrap)
        if (!data?.email) throw new Error('Invalid session')
        setUser({
          email:       data.email,
          fullName:    data.full_name,
          salesperson: data.salesperson,
          code:        data.code,
          territory:   data.territory,
          roles:       data.roles || [],
          isAdmin:     !!data.is_admin,
        })
        setConfig({ features: data.features, branding: data.branding, paymentModes: data.payment_modes, socketioPort: data.socketio_port, salesPipelineStart: data.sales_pipeline_start })
        // Restore active session so pages like Van Stock work without
        // requiring the user to visit the Routes page first.
        if (data.active_session?.name) {
          setSession(data.active_session)
        } else {
          clearSession()
        }
      } catch (_) {
        clearStoredCredentials()
        clearSession()
      } finally {
        setAuthChecked(true)
      }
    }
    restore()
  }, [clearSession, setAuthChecked, setConfig, setSession, setUser])

  // ── Realtime: connect once logged in and the socketio port is known,
  // disconnect on logout. Backend saves (this device, another device, or
  // the desk) then drive `dataVersion` bumps that every page's fetch
  // already depends on.
  useEffect(() => {
    if (!user || !socketioPort) return
    connectRealtime()
    return () => disconnectRealtime()
  }, [user, socketioPort])

  // ── Fallback for when the socket was suspended (backgrounded tab/app,
  // dropped connection) and its own reconnect hasn't caught up yet: a
  // resumed foreground/network state is itself a reason to refetch.
  useEffect(() => {
    const onResume = () => invalidateData()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onResume()
    }
    window.addEventListener('focus', onResume)
    window.addEventListener('online', onResume)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onResume)
      window.removeEventListener('online', onResume)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [invalidateData])

  // Mounted at /route_sales/* when served from within the Frappe site
  // (see hooks.py website_route_rules); root-relative in local dev.
  const basename = import.meta.env.PROD ? '/route_sales' : '/'

  return (
    <BrowserRouter basename={basename}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected */}
          <Route path="/" element={<ProtectedRoute salesOnly><MobileLayout /></ProtectedRoute>}>
            <Route index              element={<RootRedirect />} />
            <Route path="dashboard"   element={<Dashboard />}      />
            <Route path="routes"      element={<FeatureGate featureKey="enable_routes_tile"><RoutesPage /></FeatureGate>}     />
            <Route path="sales"       element={<Sales />}          />
            <Route path="orders"      element={<FeatureGate featureKey="enable_orders_tile"><Orders /></FeatureGate>}         />
            <Route path="payments"    element={<FeatureGate featureKey="enable_payment_tile"><Payments /></FeatureGate>}       />
            <Route path="invoices"    element={<FeatureGate featureKey="enable_invoice_tile"><Invoices /></FeatureGate>}       />
            <Route path="leads"       element={<FeatureGate featureKey="enable_leads"><Leads /></FeatureGate>}          />
            <Route path="returns"     element={<FeatureGate featureKey="enable_returns"><Returns /></FeatureGate>}        />
            <Route path="expenses"    element={<FeatureGate featureKey="enable_expenses"><Expenses /></FeatureGate>}       />
            <Route path="profile"     element={<Profile />}        />
            <Route path="more"        element={<More />}           />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="my-day"       element={<MyDay />}          />
            <Route path="van-stock"    element={<VanStock />}       />
            <Route path="my-customers" element={<MyCustomers />}    />
            <Route path="route-overdue"        element={<RouteOverdue />}        />
            <Route path="route-pending-orders" element={<RoutePendingOrders />}  />
            <Route path="leads-crm"      element={<FeatureGate featureKey="enable_lead_crm"><MyLeads /></FeatureGate>}    />
            <Route path="leads-crm/:id"  element={<FeatureGate featureKey="enable_lead_crm"><LeadDetail /></FeatureGate>} />
            <Route path="quotations"     element={<FeatureGate featureKey="enable_lead_crm"><MyQuotations /></FeatureGate>} />
            <Route path="quotations/new/:lead" element={<FeatureGate featureKey="enable_lead_crm"><QuotationForm /></FeatureGate>} />
            <Route path="quotations/:quotation/edit" element={<FeatureGate featureKey="enable_lead_crm"><QuotationForm /></FeatureGate>} />
            <Route path="my-day-crm"     element={<FeatureGate featureKey="enable_lead_crm"><MyDayCrm /></FeatureGate>} />
          </Route>

          {/* Admin — full page, own layout with sub-routes */}
          <Route path="admin" element={<ProtectedRoute><AdminShell /></ProtectedRoute>}>
            <Route index element={<AdminIndexRedirect />} />
            <Route path="overview"    element={<AdminOverviewRoute />} />
            <Route path="attendance"  element={<AdminAttendance />}  />
            <Route path="routes"      element={<AdminRoutes />}      />
            <Route path="tracking"    element={<FeatureGate featureKey="enable_admin_tracking"><AdminTracking /></FeatureGate>}    />
            <Route path="orders"      element={<AdminOrders />}      />
            <Route path="returns"     element={<AdminReturns />}     />
            <Route path="expenses"    element={<AdminExpenses />}    />
            <Route path="leads"       element={<FeatureGate featureKey="enable_lead_crm"><AdminLeads /></FeatureGate>} />
            <Route path="vans"        element={<AdminVanStock />}    />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      <Toaster position="top-center" richColors closeButton />
      <SuccessPopup />
    </BrowserRouter>
  )
}
