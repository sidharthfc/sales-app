import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, TrendingUp, Banknote, Target,
  Package, Navigation, RotateCcw, Wallet, MapPin, Receipt
} from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { getActiveCheckedInCustomer, toSelectedCustomer } from '@/lib/customerContext'

const modules = [
  { label: 'Sales',    to: '/sales',     bg: '#FEE8D5', color: '#C45E0A', icon: TrendingUp, requiresCheckIn: true  },
  { label: 'Payment',  to: '/payments',  bg: '#E3E8FF', color: '#3347CC', icon: Banknote,   requiresCheckIn: true  },
  { label: 'Leads',    to: '/leads',     bg: '#FFE0EA', color: '#CC2D5C', icon: Target,     requiresCheckIn: false },
  { label: 'Invoice',  to: '/invoices',  bg: '#EDE0FF', color: '#7030CC', icon: Receipt,    requiresCheckIn: true  },
  { label: 'Orders',   to: '/orders',    bg: '#FFF3D6', color: '#A07000', icon: Package,    requiresCheckIn: true  },
  { label: 'Routes',   to: '/routes',    bg: '#D6F5E6', color: '#157A45', icon: Navigation, requiresCheckIn: false },
  { label: 'Return',   to: '/returns',   bg: '#FFE8D5', color: '#C45E0A', icon: RotateCcw,  requiresCheckIn: true  },
  { label: 'Expenses', to: '/expenses',  bg: '#FFFAD6', color: '#8A6800', icon: Wallet,     requiresCheckIn: false },
]

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good Morning'
  if (h < 17) return 'Good Afternoon'
  return 'Good Evening'
}

export default function Dashboard() {
  const navigate = useNavigate()
  const user     = useAppStore(s => s.user)
  const session  = useAppStore(s => s.session)
  const customers = useAppStore(s => s.customers)
  const setCustomers = useAppStore(s => s.setCustomers)
  const setSelectedCustomer = useAppStore(s => s.setSelectedCustomer)
  const clearSelectedCustomer = useAppStore(s => s.clearSelectedCustomer)
  const [stats, setStats] = useState({ visited: 0, orders: 0, checkin: 0 })
  const activeCustomer = getActiveCheckedInCustomer(customers || [])

  const firstName = user?.fullName?.split(' ')[0] || 'Sales Rep'

  useEffect(() => {
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
  }, [session?.name])

  useEffect(() => {
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
  }, [clearSelectedCustomer, setCustomers, setSelectedCustomer])

  return (
    <div className="h-full w-full flex flex-col bg-[#FFF8F0] overflow-hidden">

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
          <StatCard label="Visited"  value={stats.visited} bg="#D8EEFF" Icon={MapPin}     iconColor="#1A6FCC" />
          <StatCard label="Orders"   value={stats.orders}  bg="#FFE9D8" Icon={Package}    iconColor="#C45E0A" />
          <StatCard label="Check-In" value={stats.checkin} bg="#D8F5E9" Icon={Navigation} iconColor="#157A45" />
        </div>
      </div>

      {/* ── Scrollable content ─────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-5 pb-4"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
          <div className="grid grid-cols-2 gap-3">
          {modules.map(({ label, to, bg, color, icon: Icon, requiresCheckIn }) => (
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

        {session && (
          <div className="mt-3 bg-white rounded-2xl p-4 border border-orange-100 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-brand font-bold uppercase tracking-wider">Active Session</p>
                <p className="text-slate-800 font-bold text-sm mt-0.5">{session.name}</p>
              </div>
              <button
                onClick={() => navigate('/routes')}
                className="bg-brand text-white text-xs font-bold px-4 py-2 rounded-xl"
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

function StatCard({ label, value, bg, Icon, iconColor }) {
  return (
    <div className="flex-1 rounded-2xl p-3 flex flex-col justify-between" style={{ backgroundColor: bg, minHeight: '78px' }}>
      <p className="text-slate-600 text-xs font-semibold">{label}</p>
      <div className="flex items-end justify-between mt-1">
        <p className="text-slate-800 text-2xl font-extrabold">{value}</p>
        <Icon className="w-5 h-5 mb-0.5" style={{ color: iconColor }} strokeWidth={2} />
      </div>
    </div>
  )
}
