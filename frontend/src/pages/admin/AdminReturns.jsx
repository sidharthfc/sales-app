import { useState } from 'react'
import { RotateCcw, ChevronRight, ChevronUp } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import { fmt } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import AdminListPage from '@/components/shared/AdminListPage'
import AdminDateRangeFilter from '@/components/shared/AdminDateRangeFilter'

export default function AdminReturns() {
  const [expanded,   setExpanded]   = useState(null)
  const [selectedSp, setSelectedSp] = useState('')
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10))
  const [toDate,   setToDate]   = useState(new Date().toISOString().slice(0, 10))

  const { data: spData } = useAsync(
    () => api.get(endpoints.adminGetSalespersons),
    [],
  )
  const salespersons = Array.isArray(spData) ? spData : []

  const { data, loading, reload } = useAsync(
    () => api.get(endpoints.adminGetReturns, {
      params: {
        salesperson: selectedSp || undefined,
        from_date: fromDate,
        to_date:   toDate,
      },
    }),
    [selectedSp, fromDate, toDate],
    { errorMessage: 'Failed to load returns.' },
  )
  const returns = Array.isArray(data) ? data : []
  const totalReturned = returns.reduce((s, r) => s + r.grand_total, 0)

  return (
    <AdminListPage
      title="Returns"
      subtitle={returns.length > 0 ? `${returns.length} returns · ₹${fmt(totalReturned)} total` : null}
      onRefresh={reload}
      refreshing={loading}
      className="max-w-3xl"
      beforeList={
        <AdminDateRangeFilter
          salespersons={salespersons}
          salesperson={selectedSp}
          onSalespersonChange={setSelectedSp}
          allLabel="All Salespersons"
          fromDate={fromDate}
          onFromDateChange={setFromDate}
          toDate={toDate}
          onToDateChange={setToDate}
        />
      }
      loading={loading}
      empty={returns.length === 0}
      emptyContent={
        <div className="py-16 flex flex-col items-center gap-3">
          <RotateCcw className="w-10 h-10 text-slate-200" />
          <p className="text-slate-400 text-sm">No returns found for this period.</p>
        </div>
      }
    >
      <div className="space-y-2">
        {returns.map(ret => (
          <ReturnRow
            key={ret.name}
            ret={ret}
            expanded={expanded === ret.name}
            onToggle={() => setExpanded(expanded === ret.name ? null : ret.name)}
          />
        ))}
      </div>
    </AdminListPage>
  )
}

function ReturnRow({ ret, expanded, onToggle }) {
  return (
    <div className="admin-surface overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 transition-colors">
        <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0">
          <RotateCcw className="w-4 h-4 text-rose-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-xs font-semibold text-slate-700">{ret.name}</p>
          <p className="text-sm font-semibold text-slate-800 truncate mt-0.5">{ret.customer_name}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {ret.posting_date}
            {ret.return_against && <span> · Against <span className="font-mono font-medium">{ret.return_against}</span></span>}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-base font-bold text-rose-600">₹{fmt(ret.grand_total)}</p>
          <p className="text-xs text-slate-400">{ret.items?.length || 0} items</p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-300 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />}
      </button>

      {expanded && ret.items?.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/50 p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Returned Items</p>
          <div className="space-y-1.5">
            {ret.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between admin-surface px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">{item.item_name}</p>
                  <p className="text-xs text-slate-400">{item.item_code}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-xs font-semibold text-slate-600">{item.qty} units</p>
                  <p className="text-sm font-bold text-rose-600">₹{fmt(item.amount)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
