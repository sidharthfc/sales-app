import { useState } from 'react'
import { Truck, ChevronRight, ChevronUp, Package } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { useAsync } from '@/lib/hooks'
import AdminListPage from '@/components/shared/AdminListPage'

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d) ? String(ts) : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export default function AdminVanStock() {
  const [expanded, setExpanded] = useState(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  const dataVersion = useAppStore(s => s.dataVersion)
  const { data, loading, reload } = useAsync(
    () => api.get(endpoints.adminGetVanStock, { params: { date } }),
    [date, dataVersion],
    { errorMessage: 'Failed to load van stock.' },
  )
  const sessions = Array.isArray(data) ? data : []

  return (
    <AdminListPage
      title="Van Stock"
      subtitle={sessions.length > 0 ? `${sessions.length} session${sessions.length !== 1 ? 's' : ''} on ${date}` : null}
      headerExtra={
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="admin-date-input" />
      }
      onRefresh={reload}
      refreshing={loading}
      className="max-w-3xl"
      loading={loading}
      empty={sessions.length === 0}
      emptyContent={
        <div className="py-16 flex flex-col items-center gap-3">
          <Truck className="w-10 h-10 text-slate-200" />
          <p className="text-slate-400 text-sm">No sessions found for {date}.</p>
        </div>
      }
    >
      <div className="space-y-3">
        {sessions.map(s => (
          <VanCard
            key={s.session}
            s={s}
            expanded={expanded === s.session}
            onToggle={() => setExpanded(expanded === s.session ? null : s.session)}
          />
        ))}
      </div>
    </AdminListPage>
  )
}

function VanCard({ s, expanded, onToggle }) {
  const { summary } = s
  const pct = summary.total_loaded > 0
    ? Math.round((summary.total_delivered / summary.total_loaded) * 100)
    : 0

  return (
    <div className="admin-surface overflow-hidden">
      <button onClick={onToggle} className="w-full p-4 text-left hover:bg-slate-50 transition-colors">
        <div className="flex items-start gap-3">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${s.is_active ? 'bg-green-50' : 'bg-slate-100'}`}>
            <Truck className={`w-5 h-5 ${s.is_active ? 'text-green-600' : 'text-slate-400'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-slate-800 text-sm">{s.salesperson_name}</p>
              {s.is_active
                ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-green-50 text-green-700 px-2 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Active</span>
                : <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">Done</span>
              }
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {s.vehicle || 'No vehicle'} · {s.route_name || 'No route'}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {fmtTime(s.start_time)}{s.end_time ? ` – ${fmtTime(s.end_time)}` : ' (ongoing)'}
            </p>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" /> : <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" />}
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-semibold text-slate-400">Delivery progress</span>
            <span className="text-[11px] font-bold text-amber-600">{pct}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-4 gap-2 mt-3">
          {[
            { label: 'Loaded',    value: summary.total_loaded,    color: 'text-slate-700' },
            { label: 'Delivered', value: summary.total_delivered, color: 'text-green-600' },
            { label: 'Returned',  value: summary.total_returned,  color: 'text-rose-600'  },
            { label: 'Remaining', value: summary.remaining,       color: 'text-amber-600' },
          ].map(stat => (
            <div key={stat.label} className="admin-surface-soft py-2 text-center">
              <p className={`text-lg font-extrabold ${stat.color}`}>{stat.value}</p>
              <p className="text-[10px] font-semibold text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/50 p-4">
          {s.items.length === 0 ? (
            <div className="flex items-center gap-2 py-2 text-slate-400">
              <Package className="w-4 h-4 text-slate-300" />
              <p className="text-sm">No items loaded for this session.</p>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Item Breakdown</p>
              <div className="space-y-2">
                {/* Header */}
                <div className="grid grid-cols-5 gap-1 px-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <div className="col-span-2">Item</div>
                  <div className="text-center">Loaded</div>
                  <div className="text-center">Deliv.</div>
                  <div className="text-center">Remain</div>
                </div>
                {s.items.map(item => (
                  <div key={item.item_code} className="grid grid-cols-5 gap-1 items-center admin-surface px-3 py-2.5">
                    <div className="col-span-2 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{item.item_name}</p>
                      <p className="text-[11px] text-slate-400">{item.item_code}</p>
                    </div>
                    <p className="text-sm font-bold text-slate-700 text-center">{item.qty_loaded}</p>
                    <p className="text-sm font-bold text-green-600 text-center">{item.qty_delivered}</p>
                    <p className={`text-sm font-bold text-center ${item.qty_remaining > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {item.qty_remaining}
                    </p>
                  </div>
                ))}
              </div>

              {/* Returned items sub-section */}
              {s.items.some(i => i.qty_returned > 0) && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-rose-400 mb-2">Returned to Van</p>
                  {s.items.filter(i => i.qty_returned > 0).map(item => (
                    <div key={`ret-${item.item_code}`} className="flex items-center justify-between bg-rose-50 rounded-xl px-3 py-2 border border-rose-100 mb-1.5">
                      <p className="text-sm font-semibold text-slate-800 truncate">{item.item_name}</p>
                      <p className="text-sm font-bold text-rose-600 flex-shrink-0">{item.qty_returned} returned</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
