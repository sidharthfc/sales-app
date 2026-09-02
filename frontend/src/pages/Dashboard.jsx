import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, TrendingUp, Banknote, Target,
  Package, Navigation, RotateCcw, Wallet, MapPin, Receipt, Users, FileText, Sun, CalendarClock
} from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { getActiveCheckedInCustomer, toSelectedCustomer } from '@/lib/customerContext'

// featureKeys: omitted only for tiles that are never toggle-able (none,
// currently — every tile maps to a real Route Sales Settings flag). When
// present, the tile shows if ANY listed features.<key> is true — 'Sales'
// needs at least one of Deliver & Bill / Take Order enabled, since
// Sales.jsx itself has nothing to show with both off.
const modules = [
  { label: 'Sales',    to: '/sales',     bg: '#FEE8D5', color: '#C45E0A', icon: TrendingUp, requiresCheckIn: true,  featureKeys: ['enable_deliver_bill', 'enable_take_order'] },
  { label: 'Payment',  to: '/payments',  bg: '#E3E8FF', color: '#3347CC', icon: Banknote,   requiresCheckIn: true,  featureKeys: ['enable_payment_tile'] },
  { label: 'Leads',    to: '/leads',     bg: '#FFE0EA', color: '#CC2D5C', icon: Target,     requiresCheckIn: false, featureKeys: ['enable_leads'] },
  { label: 'Invoice',  to: '/invoices',  bg: '#EDE0FF', color: '#7030CC', icon: Receipt,    requiresCheckIn: true,  featureKeys: ['enable_invoice_tile'] },
  { label: 'Orders',   to: '/orders',    bg: '#FFF3D6', color: '#A07000', icon: Package,    requiresCheckIn: true,  featureKeys: ['enable_orders_tile'] },
  { label: 'Routes',   to: '/routes',    bg: '#D6F5E6', color: '#157A45', icon: Navigation, requiresCheckIn: false, featureKeys: ['enable_routes_tile'] },
  { label: 'Return',   to: '/returns',   bg: '#FFE8D5', color: '#C45E0A', icon: RotateCcw,  requiresCheckIn: true,  featureKeys: ['enable_returns'] },
  { label: 'My Leads', to: '/leads-crm', bg: '#E0F7EC', color: '#0E8A5F', icon: Users,      requiresCheckIn: false, featureKeys: ['enable_lead_crm'] },
  { label: 'Quotations', to: '/quotations', bg: '#FFF0E0', color: '#B5560E', icon: FileText, requiresCheckIn: false, featureKeys: ['enable_lead_crm'] },
  { label: 'My Day',   to: '/my-day-crm', bg: '#DFF7FA', color: '#0E7490', icon: Sun,        requiresCheckIn: false, featureKeys: ['enable_lead_crm'] },
  { label: 'Expenses', to: '/expenses',  bg: '#FFFAD6', color: '#8A6800', icon: Wallet,     requiresCheckIn: false, featureKeys: ['enable_expenses'] },
]

const isModuleEnabled = (module, features) =>
  !module.featureKeys || module.featureKeys.some(key => features[key])

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good Morning'
  if (h < 17) return 'Good Afternoon'
  return 'Good Evening'
}

export default function Dashboard() {
  const navigate = useNavigate()
  const user     = useAppStore(s => s.user)
  const features = useAppStore(s => s.features)
  const session  = useAppStore(s => s.session)
  const customers = useAppStore(s => s.customers)
  const setCustomers = useAppStore(s => s.setCustomers)
  const setSelectedCustomer = useAppStore(s => s.setSelectedCustomer)
  const clearSelectedCustomer = useAppStore(s => s.clearSelectedCustomer)
  const dataVersion = useAppStore(s => s.dataVersion)
  const [stats, setStats] = useState({ visited: 0, orders: 0, checkin: 0 })
  const [crmStats, setCrmStats] = useState({ leads: 0, followUps: 0, quotationsToday: 0 })
  const activeCustomer = getActiveCheckedInCustomer(customers || [])
  const isLeadCrm = !!features.enable_lead_crm

  const firstName = user?.fullName?.split(' ')[0] || 'Sales Rep'

  // Route-based stats (Visited/Orders/Check-In) only apply when this
  // deployment actually runs the route-sales flow.
  useEffect(() => {
    if (isLeadCrm) return
    const fetchStats = () => {
      const params = session?.name ? { route_session: session.name } : {}
      api.get(endpoints.getDashboard, { params }).then(data => {
        if (data) setStats({
          visited: data.today?.visited  ?? data.today?.visits ?? 0,
          orders:  data.today?.orders   ?? data.month?.sales_orders ?? 0,
          checkin: data.today?.checkins ?? data.today?.sessions ?? 0,
        })
      }).catch(() => {})
    }

    fetchStats()

    // Poll every 30 s while a session is active
    if (!session?.name) return
    const id = setInterval(fetchStats, 30_000)
    return () => clearInterval(id)
  }, [session?.name, isLeadCrm, dataVersion])

  // Lead CRM equivalent: leads assigned, follow-ups due (today + overdue),
  // quotations sent today -- same "at a glance" cadence as the route stats.
  useEffect(() => {
    if (!isLeadCrm) return
    let cancelled = false
    const fetchCrmStats = () => {
      api.get(endpoints.getCrmMyDay).then(data => {
        if (!data || cancelled) return
        setCrmStats({
          leads:           data.total_leads ?? 0,
          followUps:       (data.follow_ups_today ?? 0) + (data.follow_ups_overdue ?? 0),
          quotationsToday: data.quotations_sent_today ?? 0,
        })
      }).catch(() => {})
    }
    fetchCrmStats()
    const id = setInterval(fetchCrmStats, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [isLeadCrm, dataVersion])

  useEffect(() => {
    if (isLeadCrm) return
    let cancelled = false

    api.get(endpoints.getTodayRoute)
      .then((data) => {
        if (cancelled) return
        const routeCustomers = data?.customers || []
        setCustomers(routeCustomers)
        const checkedInCustomer = getActiveCheckedInCustomer(routeCustomers)
        if (checkedInCustomer) setSelectedCustomer(toSelectedCustomer(checkedInCustomer))
        else clearSelectedCustomer()
      })
      .catch(() => {
        if (!cancelled) clearSelectedCustomer()
      })

    return () => {
      cancelled = true
    }
  }, [clearSelectedCustomer, setCustomers, setSelectedCustomer, isLeadCrm, dataVersion])

  return (
    <div className="h-full w-full flex flex-col bg-app-bg overflow-hidden">

      {/* ── Fixed header ──────────────────────────────────────────────── */}
      <div
        className="relative flex-shrink-0 rounded-b-[32px] shadow-md overflow-hidden brand-gradient"
      >
        {/* Decorative blobs — relative to THIS div now */}
        <div className="pointer-events-none absolute -top-10 -right-10 w-52 h-52 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute top-16 -right-4 w-32 h-32 rounded-full bg-white/[0.07]" />

        {/* Top row */}
        <div className="relative z-10 px-5 pt-12 pb-4 flex items-start justify-between">
          <div>
            <p className="text-white/75 text-sm font-medium tracking-wide">{getGreeting()}</p>
            <h1 className="text-white font-extrabold leading-tight mt-0.5 text-[28px]"
              style={{ letterSpacing: '-0.5px' }}>
              {firstName}
            </h1>
          </div>
          <button
            onClick={() => navigate('/profile')}
            className="w-11 h-11 rounded-full border-2 border-white/40 bg-white/20 flex items-center justify-center flex-shrink-0 mt-1"
          >
            <User className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Stat cards */}
        <div className="relative z-10 px-5 pb-5 flex gap-3">
          {isLeadCrm ? (
            <>
              <StatCard label="Lead Count" value={crmStats.leads}           bg="#D8EEFF" Icon={Users}         iconColor="#1A6FCC" />
              <StatCard label="Follow-ups" value={crmStats.followUps}       bg="#FFE9D8" Icon={CalendarClock} iconColor="#C45E0A" onClick={() => navigate('/leads-crm?follow_up_due=due')} />
              <StatCard label="Sent Today" value={crmStats.quotationsToday} bg="#D8F5E9" Icon={FileText}      iconColor="#157A45" onClick={() => navigate('/quotations?sent_today=1')} />
            </>
          ) : (
            <>
              <StatCard label="Visited"  value={stats.visited} bg="#D8EEFF" Icon={MapPin}     iconColor="#1A6FCC" />
              <StatCard label="Orders"   value={stats.orders}  bg="#FFE9D8" Icon={Package}    iconColor="#C45E0A" />
              <StatCard label="Check-In" value={stats.checkin} bg="#D8F5E9" Icon={Navigation} iconColor="#157A45" />
            </>
          )}
        </div>
      </div>

      {/* ── Scrollable content ─────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-5 pb-4"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
          <div className="grid grid-cols-2 gap-3">
          {modules.filter(m => isModuleEnabled(m, features)).map(({ label, to, bg, color, icon: Icon, requiresCheckIn }) => (
            <button
              key={label}
              onClick={() => {
                if (requiresCheckIn && !activeCustomer) {
                  toast.error('Check in a customer first from the Routes page.')
                  return
                }
                navigate(to)
              }}
              className="rounded-3xl active:scale-95 transition-transform text-left w-full"
              style={{ backgroundColor: bg }}
            >
              <div className="flex flex-col justify-between p-4 h-32">
                <div>
                  <span className="font-bold text-[15px] leading-tight block" style={{ color }}>
                    {label}
                  </span>
                  {requiresCheckIn && (
                    <span className="mt-1 block text-[11px] font-medium text-slate-500">
                      {activeCustomer
                        ? (activeCustomer.customer_name || activeCustomer.customer)
                        : 'Requires check-in'}
                    </span>
                  )}
                </div>
                <div className="flex justify-end">
                  <div
                    className="w-13 h-13 rounded-2xl flex items-center justify-center p-3"
                    style={{ backgroundColor: color + '20' }}
                  >
                    <Icon className="w-7 h-7" style={{ color }} strokeWidth={1.8} />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {session && !isLeadCrm && (
          <div className="mt-3 bg-white rounded-2xl p-4 border border-brand-100 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-brand font-bold uppercase tracking-wider">Active Session</p>
                <p className="text-slate-800 font-bold text-sm mt-0.5">{session.name}</p>
              </div>
              <button
                onClick={() => navigate('/routes')}
                className="brand-gradient text-white text-xs font-bold px-4 py-2 rounded-xl"
              >
                View Route
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// onClick is only passed for stat cards that lead somewhere the module
// tiles below don't already cover (e.g. Follow-ups) -- one without it stays
// a plain div, not a button, so it doesn't look tappable when it isn't.
function StatCard({ label, value, bg, Icon, iconColor, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`flex-1 rounded-2xl p-3 flex flex-col justify-between text-left ${onClick ? 'active:scale-95 transition-transform' : ''}`}
      style={{ backgroundColor: bg, minHeight: '78px' }}
    >
      <p className="text-slate-600 text-xs font-semibold">{label}</p>
      <div className="flex items-end justify-between mt-1">
        <p className="text-slate-800 text-2xl font-extrabold">{value}</p>
        <Icon className="w-5 h-5 mb-0.5" style={{ color: iconColor }} strokeWidth={2} />
      </div>
    </Tag>
  )
}
