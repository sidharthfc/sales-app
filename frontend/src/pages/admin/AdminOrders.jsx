import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, ChevronUp, Phone, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import { fmt } from '@/lib/format'

export default function AdminOrders() {
  const [routes,        setRoutes]        = useState([])
  const [orders,        setOrders]        = useState([])
  const [loading,       setLoading]       = useState(false)
  const [loadingMeta,   setLoadingMeta]   = useState(true)
  const [expanded,      setExpanded]      = useState(null)
  const [selectedRoute, setSelectedRoute] = useState('')
  const loadSeqRef = useRef(0)

  useEffect(() => {
    api.get(endpoints.adminGetRoutes)
      .then(r => setRoutes(Array.isArray(r) ? r : []))
      .catch(() => {})
      .finally(() => setLoadingMeta(false))
  }, [])

  const load = useCallback(async () => {
    const loadId = ++loadSeqRef.current
    if (!selectedRoute) {
      setOrders([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const d = await api.get(endpoints.adminGetRouteOrders, {
        params: { route: selectedRoute },
      })
      if (loadId !== loadSeqRef.current) return
      setOrders(Array.isArray(d) ? d : [])
    } catch (err) {
      if (loadId !== loadSeqRef.current) return
      toast.error(err.message || 'Failed to load orders.')
    } finally {
      if (loadId === loadSeqRef.current) {
        setLoading(false)
      }
    }
  }, [selectedRoute])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30s when a route is selected
  useEffect(() => {
    if (!selectedRoute) return
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [selectedRoute, load])

  const pendingRows  = orders.filter(c => c.orders_count > 0 || c.invoices_count > 0)
  const clearedRows  = orders.filter(c => c.orders_count === 0 && c.invoices_count === 0)
  const totalOrdered     = pendingRows.reduce((s, c) => s + c.total_ordered, 0)
  const totalOutstanding = pendingRows.reduce((s, c) => s + c.total_outstanding, 0)
  const overdueInvoices  = pendingRows.reduce((s, c) => (
    s + (c.invoices?.filter((inv) => inv.status === 'Overdue').length || 0)
  ), 0)
  const selectedRouteLabel = selectedRoute
    ? routes.find((route) => route.name === selectedRoute)?.route_name || 'Selected Route'
    : 'All Routes'

  return (
    <div className="admin-page">

      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-800 font-bold text-xl">Orders & Payments</h1>
          {selectedRoute && orders.length > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">
              {pendingRows.length} pending · {clearedRows.length} cleared · auto-syncs every 30s
            </p>
          )}
          {!selectedRoute && orders.length > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">
              Viewing all route customers with pending orders or invoices
            </p>
          )}
        </div>
        <button onClick={load} disabled={loading}
          className="admin-icon-button w-9 h-9">
          <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Route filter */}
      <div className="admin-surface p-4">
        <div className="relative">
          <select value={selectedRoute} onChange={e => { setSelectedRoute(e.target.value); setExpanded(null) }}
            disabled={loadingMeta}
            className="admin-input appearance-none pr-8 disabled:opacity-50">
            <option value="">All Routes</option>
            {routes.map(r => <option key={r.name} value={r.name}>{r.route_name}</option>)}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Summary */}
      {pendingRows.length > 0 && (
        <div className="space-y-3">
          <div className="admin-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Scope</p>
            <p className="mt-1 text-sm font-bold text-slate-900">{selectedRouteLabel}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Customers',     value: pendingRows.length,           color: 'text-slate-800',  suffix: '' },
            { label: 'Pending Orders',value: `₹${fmt(totalOrdered)}`,      color: 'text-orange-600', suffix: '' },
            { label: 'Outstanding',   value: `₹${fmt(totalOutstanding)}`,  color: 'text-amber-600',  suffix: '' },
            { label: 'Overdue',       value: overdueInvoices,              color: 'text-red-500',    suffix: '' },
          ].map(s => (
            <div key={s.label} className="admin-surface px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{s.label}</p>
              <p className={`text-base font-extrabold mt-0.5 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
        </div>
      )}

      {/* List */}
      {loading && orders.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">
          {selectedRoute ? 'No pending orders or outstanding invoices for this route.' : 'No pending orders or outstanding invoices across all routes.'}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Pending customers first */}
          {pendingRows.map(cust => (
            <CustomerOrderRow
              key={cust.customer}
              cust={cust}
              expanded={expanded === cust.customer}
              onToggle={() => setExpanded(expanded === cust.customer ? null : cust.customer)}
            />
          ))}

          {/* Cleared customers */}
          {clearedRows.length > 0 && (
            <>
              {pendingRows.length > 0 && (
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-300 px-1 pt-2">
                  Cleared — no pending orders
                </p>
              )}
              {clearedRows.map(cust => (
                <ClearedRow key={cust.customer} cust={cust} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function CustomerOrderRow({ cust, expanded, onToggle }) {
  return (
    <div className="admin-surface overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 transition-colors">
        <div className="w-9 h-9 rounded-full bg-orange-50 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-bold text-orange-500">{cust.sequence || '—'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm truncate">{cust.customer_name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {cust.orders_count > 0   && <Tag color="text-orange-600 bg-orange-50">{cust.orders_count} pending order{cust.orders_count > 1 ? 's' : ''}</Tag>}
            {cust.invoices_count > 0 && <Tag color="text-amber-600 bg-amber-50">₹{fmt(cust.total_outstanding)} due</Tag>}
            {cust.invoices?.some((inv) => inv.status === 'Overdue') && <Tag color="text-red-600 bg-red-50">Overdue invoices</Tag>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {cust.total_outstanding > 0 && <p className="text-sm font-bold text-amber-600">₹{fmt(cust.total_outstanding)}</p>}
          {cust.total_ordered > 0    && <p className="text-xs text-slate-400">₹{fmt(cust.total_ordered)}</p>}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-300 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 p-4 space-y-4 bg-slate-50/50">
          {cust.mobile_no && (
            <a href={`tel:${cust.mobile_no}`} className="inline-flex items-center gap-1.5 text-xs text-amber-600 font-semibold">
              <Phone className="w-3 h-3" />{cust.mobile_no}
            </a>
          )}

          {cust.orders.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Pending Orders</p>
              <div className="space-y-1">
                {cust.orders.map(o => (
                  <div key={o.name} className="flex items-center justify-between admin-surface px-3 py-2 border-orange-100">
                    <div>
                      <p className="font-mono text-xs font-semibold text-slate-700">{o.name}</p>
                      {o.date && <p className="text-[10px] text-slate-400">{o.date}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-orange-600 font-semibold">{o.status}</span>
                      <p className="text-sm font-bold text-slate-800">₹{fmt(o.grand_total)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {cust.invoices.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widests text-slate-400 mb-2">Outstanding Invoices</p>
              <div className="space-y-1">
                {cust.invoices.map(inv => (
                  <div key={inv.name} className="flex items-center justify-between admin-surface px-3 py-2 border-amber-100">
                    <div>
                      <p className="font-mono text-xs font-semibold text-slate-700">{inv.name}</p>
                      {inv.date && <p className="text-[10px] text-slate-400">{inv.date}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {inv.status === 'Overdue' && (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                          Overdue
                        </span>
                      )}
                      <span className="text-[11px] font-semibold text-amber-600">₹{fmt(inv.outstanding_amount)} due</span>
                      <p className="text-sm font-bold text-slate-800">₹{fmt(inv.grand_total)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ClearedRow({ cust }) {
  return (
    <div className="admin-surface px-4 py-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-slate-400">{cust.sequence || '—'}</span>
      </div>
      <p className="flex-1 text-sm text-slate-500 truncate">{cust.customer_name}</p>
      <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
    </div>
  )
}

function Tag({ children, color }) {
  return <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${color}`}>{children}</span>
}
