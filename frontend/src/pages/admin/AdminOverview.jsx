import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RefreshCw, Users, UserCheck, Activity, ShoppingBag,
  IndianRupee, TrendingUp, Truck, RotateCcw, Receipt,
  AlertTriangle, Clock, ChevronRight, X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { fmt } from '@/lib/format'

const CARD_GROUPS = [
  {
    title: 'Field Team',
    cards: [
      { id: 'total_salespersons', label: 'Total Reps', icon: Users, iconBg: 'bg-slate-100', iconColor: 'text-slate-600', accent: 'text-slate-800', route: '/admin/attendance' },
      { id: 'assigned', label: 'Assigned', icon: UserCheck, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', accent: 'text-blue-600', route: '/admin/routes' },
      { id: 'active_now', label: 'Active Now', icon: Activity, iconBg: 'bg-green-50', iconColor: 'text-green-600', accent: 'text-green-600', route: '/admin/tracking', pulse: true },
      { id: 'started_today', label: 'Started Today', icon: Clock, iconBg: 'bg-amber-50', iconColor: 'text-amber-600', accent: 'text-amber-600', route: '/admin/attendance' },
    ],
  },
  {
    title: 'Business Today',
    cards: [
      { id: 'orders_today', label: 'Orders Today', icon: ShoppingBag, iconBg: 'bg-orange-50', iconColor: 'text-orange-600', accent: 'text-orange-600', route: '/admin/orders' },
      { id: 'invoiced_today', label: 'Invoiced Today', icon: TrendingUp, iconBg: 'bg-purple-50', iconColor: 'text-purple-600', accent: 'text-purple-600', route: '/admin/orders' },
      { id: 'collected_today', label: 'Collected Today', icon: IndianRupee, iconBg: 'bg-green-50', iconColor: 'text-green-600', accent: 'text-green-600', route: '/admin/orders', featured: true },
      { id: 'expenses_today', label: 'Expenses Today', icon: Receipt, iconBg: 'bg-amber-50', iconColor: 'text-amber-600', accent: 'text-amber-600', route: '/admin/expenses' },
    ],
  },
  {
    title: 'Action Center',
    cards: [
      { id: 'pending_deliveries', label: 'Pending Delivery', icon: Truck, iconBg: 'bg-sky-50', iconColor: 'text-sky-600', accent: 'text-sky-600', route: '/admin/orders' },
      { id: 'returns_today', label: 'Returns Today', icon: RotateCcw, iconBg: 'bg-rose-50', iconColor: 'text-rose-600', accent: 'text-rose-600', route: '/admin/returns' },
      { id: 'overdue_invoices', label: 'Overdue Invoices', icon: AlertTriangle, iconBg: 'bg-red-50', iconColor: 'text-red-500', accent: 'text-red-500', route: '/admin/orders', warn: true },
    ],
  },
]

const QUICK_VIEW_META = {
  total_salespersons: { title: 'All Sales Reps', emptyText: 'No active sales reps found.', route: '/admin/attendance', actionLabel: 'Open Attendance' },
  assigned: { title: 'Assigned Reps', emptyText: 'No reps are assigned to a route right now.', route: '/admin/routes', actionLabel: 'Open Routes' },
  active_now: { title: 'Active Reps', emptyText: 'No reps are active right now.', route: '/admin/tracking', actionLabel: 'Open Tracking' },
  started_today: { title: 'Started Today', emptyText: 'No reps have started a session today.', route: '/admin/attendance', actionLabel: 'Open Attendance' },
  orders_today: { title: 'Orders Today', emptyText: 'No sales orders were created today.', route: '/admin/orders', actionLabel: 'Open Orders' },
  invoiced_today: { title: 'Invoices Today', emptyText: 'No invoices were created today.', route: '/admin/orders', actionLabel: 'Open Orders' },
  collected_today: { title: 'Collections Today', emptyText: 'No collections were recorded today.', route: '/admin/orders', actionLabel: 'Open Orders' },
  pending_deliveries: { title: 'Pending Deliveries', emptyText: 'There are no pending deliveries right now.', route: '/admin/orders', actionLabel: 'Open Orders' },
  returns_today: { title: 'Returns Today', emptyText: 'No returns were created today.', route: '/admin/returns', actionLabel: 'Open Returns' },
  expenses_today: { title: 'Expenses Today', emptyText: 'No expenses were recorded today.', route: '/admin/expenses', actionLabel: 'Open Expenses' },
  overdue_invoices: { title: 'Overdue Invoices', emptyText: 'No overdue invoices at the moment.', route: '/admin/orders', actionLabel: 'Open Orders' },
}

export default function AdminOverview() {
  const navigate = useNavigate()
  const dataVersion = useAppStore(s => s.dataVersion)
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeCard, setActiveCard] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get(endpoints.adminGetOverview)
      setData(d)
    } catch (err) {
      toast.error(err.message || 'Failed to load overview.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load, dataVersion])

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  const k = data?.kpis
  const quickViews = useMemo(() => data?.quick_views || {}, [data?.quick_views])
  const activeMeta = activeCard ? QUICK_VIEW_META[activeCard] : null
  const activeItems = activeCard ? (quickViews[activeCard] || []) : []

  const cards = useMemo(() => ({
    total_salespersons: { value: k?.total_salespersons ?? '—', subtitle: `${quickViews.total_salespersons?.length || 0} reps in quick view` },
    assigned: { value: k?.assigned ?? '—', subtitle: `${quickViews.assigned?.length || 0} reps assigned today` },
    active_now: { value: k?.active_now ?? '—', subtitle: k?.active_now > 0 ? 'Live route activity available' : 'No sessions active right now' },
    started_today: { value: k?.started_today ?? '—', subtitle: 'Sessions started or completed today' },
    orders_today: { value: k ? `₹${fmt(k.orders_total)}` : '—', subtitle: k ? `${k.orders_count} orders created today` : '' },
    invoiced_today: { value: k ? `₹${fmt(k.invoiced_total)}` : '—', subtitle: 'Submitted invoices for today' },
    collected_today: { value: k ? `₹${fmt(k.collections_total)}` : '—', subtitle: Object.keys(k?.collections_by_mode || {}).length > 0 ? `${Object.keys(k.collections_by_mode).length} payment modes` : 'No collections recorded' },
    pending_deliveries: { value: k?.pending_deliveries ?? '—', subtitle: 'Orders still waiting to be delivered' },
    returns_today: { value: k?.returns_today ?? '—', subtitle: 'Credit-note returns created today' },
    expenses_today: { value: k ? `₹${fmt(k.expenses_total)}` : '—', subtitle: quickViews.expenses_today?.length > 0 ? `${quickViews.expenses_today.length} recent entries` : 'No expenses recorded today' },
    overdue_invoices: { value: k?.overdue_invoices ?? '—', subtitle: k?.overdue_invoices > 0 ? 'Needs collection follow-up' : 'Everything is current' },
  }), [k, quickViews])

  return (
    <div className="admin-page space-y-5">

      {/* Title row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-800 font-bold text-xl">Today's Overview</h1>
          <p className="text-slate-400 text-xs mt-0.5">{data?.date || '—'} · auto-refreshes every minute</p>
        </div>
        <button onClick={load} disabled={loading}
          className="admin-icon-button w-9 h-9">
          <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {CARD_GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">{group.title}</p>
              <p className="text-sm text-slate-500 mt-1">
                Tap any card for a quick view and a shortcut into the related admin screen.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {group.cards.map((card) => (
              <KpiCard
                key={card.id}
                icon={card.icon}
                iconBg={card.iconBg}
                iconColor={card.iconColor}
                label={card.label}
                value={cards[card.id]?.value ?? '—'}
                sub={cards[card.id]?.subtitle}
                loading={loading}
                pulse={card.pulse}
                warn={card.warn}
                featured={card.featured}
                accent={card.accent}
                onClick={() => setActiveCard(card.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Collections by mode */}
      {k?.collections_by_mode && Object.keys(k.collections_by_mode).length > 0 && (
        <div className="admin-surface p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Collections by Mode</p>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(k.collections_by_mode).map(([mode, amt]) => (
              <div key={mode} className="admin-surface-soft px-3 py-2.5 text-center">
                <p className="text-xs font-semibold text-slate-500">{mode}</p>
                <p className="text-base font-bold text-slate-800 mt-0.5">₹{fmt(amt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeCard && activeMeta && (
        <QuickViewSheet
          title={activeMeta.title}
          items={activeItems}
          emptyText={activeMeta.emptyText}
          onClose={() => setActiveCard(null)}
          onOpenPage={() => {
            setActiveCard(null)
            navigate(activeMeta.route)
          }}
          actionLabel={activeMeta.actionLabel}
        />
      )}

    </div>
  )
}

function KpiCard({ icon: Icon, iconBg, iconColor, label, value, sub, loading, pulse, warn, featured, accent, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`admin-surface p-4 text-left transition-transform hover:-translate-y-0.5 active:translate-y-0 ${warn ? 'border-red-200' : ''} ${featured ? 'col-span-2 bg-gradient-to-br from-white to-[#FFF7EC]' : ''}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          {pulse && <span className="absolute w-2 h-2 rounded-full bg-green-400 animate-ping opacity-75" />}
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
      </div>
      {loading && value === '—' ? (
        <div className="h-7 w-16 bg-slate-100 rounded-lg animate-pulse" />
      ) : (
        <p className={`text-2xl font-extrabold ${warn ? 'text-red-500' : accent || 'text-slate-800'}`}>
          {value}
        </p>
      )}
      {sub && <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{sub}</p>}
      <div className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-brand">
        Quick view <ChevronRight className="w-3.5 h-3.5" />
      </div>
    </button>
  )
}

function QuickViewSheet({ title, items, emptyText, onClose, onOpenPage, actionLabel }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-end bg-black/45" onClick={onClose}>
      <div
        className="w-full max-w-[430px] mx-auto rounded-t-[28px] bg-white p-5 shadow-2xl max-h-[82vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200 mb-4" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Quick View</p>
            <h2 className="text-lg font-bold text-slate-900 mt-1">{title}</h2>
            <p className="text-sm text-slate-500 mt-1">
              {items.length > 0 ? `${items.length} recent records` : emptyText}
            </p>
          </div>
          <button type="button" onClick={onClose} className="admin-icon-button w-9 h-9">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="admin-surface-soft mt-4 p-4 text-sm text-slate-500">{emptyText}</div>
        ) : (
          <div className="mt-4 space-y-2">
            {items.map((item, index) => (
              <QuickViewRow key={item.name || item.salesperson || `${title}-${index}`} item={item} />
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="admin-surface px-4 py-3 text-sm font-semibold text-slate-600">
            Close
          </button>
          <button type="button" onClick={onOpenPage} className="rounded-2xl brand-gradient px-4 py-3 text-sm font-semibold text-white">
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function QuickViewRow({ item }) {
  const title = item.customer || item.salesperson_name || item.employee || item.name
  const secondary = item.route_name || item.type || item.mode || item.status || item.return_against || null
  const primaryValue = item.amount != null
    ? `₹${fmt(item.amount)}`
    : item.visits_done != null
    ? `${item.visits_done} visits`
    : null
  const extraValue = item.outstanding_amount != null && item.outstanding_amount > 0
    ? `₹${fmt(item.outstanding_amount)} due`
    : item.visits_skipped != null && item.visits_skipped > 0
    ? `${item.visits_skipped} skipped`
    : null

  return (
    <div className="admin-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{title}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {item.name}
            {item.date ? ` · ${item.date}` : ''}
          </p>
          {secondary && <p className="text-xs text-slate-500 mt-1">{secondary}</p>}
          {item.remarks && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{item.remarks}</p>}
          {item.notes && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{item.notes}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          {primaryValue && <p className="text-sm font-bold text-slate-800">{primaryValue}</p>}
          {extraValue && <p className="text-[11px] text-amber-600 mt-0.5">{extraValue}</p>}
        </div>
      </div>
    </div>
  )
}
