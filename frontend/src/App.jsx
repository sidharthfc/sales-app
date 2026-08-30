import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import MobileLayout    from '@/components/layout/MobileLayout'
import useAppStore     from '@/store/useAppStore'
import api, { clearStoredCredentials, endpoints } from '@/api/client'
import { PageLoader }  from '@/components/shared/Spinner'
import { AUTH_STORAGE_KEYS } from '@/lib/constants'


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
const CustomerDetail = lazy(() => import('@/pages/CustomerDetail'))
const MyDay          = lazy(() => import('@/pages/MyDay'))
const VanStock       = lazy(() => import('@/pages/VanStock'))
const MyCustomers    = lazy(() => import('@/pages/MyCustomers'))
const RouteOverdue       = lazy(() => import('@/pages/RouteOverdue'))
const RoutePendingOrders = lazy(() => import('@/pages/RoutePendingOrders'))

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

export default function App() {
  const setUser        = useAppStore(s => s.setUser)
  const setSession     = useAppStore(s => s.setSession)
  const setAuthChecked = useAppStore(s => s.setAuthChecked)
  const clearSession   = useAppStore(s => s.clearSession)
  const setConfig      = useAppStore(s => s.setConfig)

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
        setConfig({ features: data.features, branding: data.branding, itemCategories: data.item_categories })
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
            <Route path="routes"      element={<RoutesPage />}     />
            <Route path="sales"       element={<Sales />}          />
            <Route path="orders"      element={<Orders />}         />
            <Route path="payments"    element={<Payments />}       />
            <Route path="invoices"    element={<Invoices />}       />
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
          </Route>

          {/* Admin — full page, own layout with sub-routes */}
          <Route path="admin" element={<ProtectedRoute><AdminShell /></ProtectedRoute>}>
            <Route index element={<Navigate to="/admin/overview" replace />} />
            <Route path="overview"    element={<AdminOverview />}    />
            <Route path="attendance"  element={<AdminAttendance />}  />
            <Route path="routes"      element={<AdminRoutes />}      />
            <Route path="tracking"    element={<FeatureGate featureKey="enable_admin_tracking"><AdminTracking /></FeatureGate>}    />
            <Route path="orders"      element={<AdminOrders />}      />
            <Route path="returns"     element={<AdminReturns />}     />
            <Route path="expenses"    element={<AdminExpenses />}    />
            <Route path="vans"        element={<AdminVanStock />}    />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      <Toaster position="top-center" richColors closeButton />
    </BrowserRouter>
  )
}
