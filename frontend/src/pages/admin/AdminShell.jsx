import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Map, Navigation2, ShoppingBag,
  RotateCcw, Receipt, Truck, LogOut, ShieldAlert, CalendarCheck,
} from 'lucide-react'
import api, { endpoints, revokeApiCredentials } from '@/api/client'
import useAppStore from '@/store/useAppStore'

// featureKey omitted for tabs that are never toggle-able (Overview,
// Attendance, Routes, Orders, Van Stock).
const NAV = [
  { to: '/admin/overview',    label: 'Overview',    icon: LayoutDashboard },
  { to: '/admin/attendance',  label: 'Attendance',  icon: CalendarCheck   },
  { to: '/admin/routes',      label: 'Routes',      icon: Map             },
  { to: '/admin/tracking',    label: 'Tracking',    icon: Navigation2,    featureKey: 'enable_admin_tracking' },
  { to: '/admin/orders',      label: 'Orders',      icon: ShoppingBag     },
  { to: '/admin/returns',     label: 'Returns',     icon: RotateCcw,      featureKey: 'enable_returns'  },
  { to: '/admin/expenses',    label: 'Expenses',    icon: Receipt,        featureKey: 'enable_expenses' },
  { to: '/admin/vans',        label: 'Van Stock',   icon: Truck           },
]

export default function AdminShell() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const user      = useAppStore(s => s.user)
  const features  = useAppStore(s => s.features)
  const clearUser = useAppStore(s => s.clearUser)
  const nav = NAV.filter(n => !n.featureKey || features[n.featureKey])

  const [checking, setChecking] = useState(true)
  const [isAdmin,  setIsAdmin]  = useState(false)

  useEffect(() => {
    api.get(endpoints.adminCheckRole)
      .then(d => { setIsAdmin(d?.is_admin || false); setChecking(false) })
      .catch(() => setChecking(false))
  }, [])

  const handleLogout = async () => {
    await revokeApiCredentials()
    clearUser()
    navigate('/login')
  }

  if (checking) {
    return (
      <div className="h-screen flex items-center justify-center bg-app-bg">
        <div className="w-8 h-8 rounded-full border-4 border-orange-200 border-t-brand animate-spin" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-app-bg px-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-red-500" />
        </div>
        <p className="text-slate-800 font-bold text-xl">Access Denied</p>
        <p className="text-slate-500 text-sm">System Manager or Sales Manager role required.</p>
        <button onClick={() => navigate('/dashboard')} className="mt-2 text-sm text-brand underline font-medium">
          Back to Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-app-bg overflow-hidden">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex flex-col w-60 bg-white/90 border-r border-orange-100 flex-shrink-0 backdrop-blur-sm">
        {/* Brand */}
        <div className="px-5 py-5 bg-brand flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-extrabold text-sm">LX</span>
            </div>
            <div>
              <p className="text-white font-bold text-base leading-tight">Admin Panel</p>
              <p className="text-white/75 text-xs truncate max-w-[140px]">{user?.fullName}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-50 text-brand font-semibold'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`
              }
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${location.pathname.startsWith(to) ? 'bg-white text-brand' : 'bg-slate-50 text-slate-400'}`}>
                <Icon className="w-4 h-4 flex-shrink-0" />
              </div>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-orange-100">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm font-medium text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
          >
            <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center">
              <LogOut className="w-4 h-4 flex-shrink-0" />
            </div>
            Logout
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile header */}
        <header className="md:hidden bg-brand px-4 pt-10 pb-5 flex-shrink-0">
          <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
              <span className="text-white font-extrabold text-xs">LX</span>
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-xl">Admin Panel</p>
              <p className="text-white/70 text-xs truncate">{user?.fullName}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-white/80 border border-white/30 rounded-2xl px-3.5 py-2"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
          </div>
        </header>

        {/* Desktop page header */}
        <header className="hidden md:flex items-center justify-between px-6 py-4 bg-white border-b border-orange-100 flex-shrink-0">
          <p className="text-slate-800 font-bold text-lg">
            {nav.find(n => location.pathname.startsWith(n.to))?.label || 'Admin'}
          </p>
          <p className="text-sm text-slate-400">{user?.fullName}</p>
        </header>

        {/* Mobile tab bar */}
        <nav className="md:hidden bg-white border-t border-slate-100 flex-shrink-0">
          <div className="flex items-center h-16 overflow-x-auto scrollbar-none px-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to} to={to}
              className={({ isActive }) =>
                `min-w-[72px] flex flex-col items-center justify-center gap-1 h-full text-[10px] font-medium transition-colors ${
                  isActive
                    ? 'text-brand'
                    : 'text-slate-400'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-5 h-5 ${isActive ? 'text-brand' : 'text-slate-400'}`} strokeWidth={isActive ? 2.4 : 1.8} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
          </div>
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto pb-0 md:pb-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
