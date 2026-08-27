import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ChevronDown, RotateCcw, ChevronRight, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import { fmt } from '@/lib/format'

export default function AdminReturns() {
  const [salespersons, setSalespersons] = useState([])
  const [returns,      setReturns]      = useState([])
  const [loading,      setLoading]      = useState(false)
  const [expanded,     setExpanded]     = useState(null)
  const [selectedSp,   setSelectedSp]   = useState('')
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10))
  const [toDate,   setToDate]   = useState(new Date().toISOString().slice(0, 10))
  const loadSeqRef = useRef(0)

  useEffect(() => {
    api.get(endpoints.adminGetSalespersons)
      .then(d => setSalespersons(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    const loadId = ++loadSeqRef.current
    setLoading(true)
    try {
      const d = await api.get(endpoints.adminGetReturns, {
        params: {
          salesperson: selectedSp || undefined,
          from_date: fromDate,
          to_date:   toDate,
        },
      })
      if (loadId !== loadSeqRef.current) return
      setReturns(Array.isArray(d) ? d : [])
    } catch (err) {
      if (loadId !== loadSeqRef.current) return
      toast.error(err.message || 'Failed to load returns.')
    } finally {
      if (loadId === loadSeqRef.current) {
        setLoading(false)
      }
    }
  }, [selectedSp, fromDate, toDate])

  useEffect(() => { load() }, [load])

  const totalReturned = returns.reduce((s, r) => s + r.grand_total, 0)

  return (
    <div className="admin-page max-w-3xl">

      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-800 font-bold text-xl">Returns</h1>
          {returns.length > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">{returns.length} returns · ₹{fmt(totalReturned)} total</p>
          )}
        </div>
        <button onClick={load} disabled={loading}
          className="admin-icon-button w-9 h-9">
          <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters */}
      <div className="admin-surface p-4 space-y-3">
        <div className="relative">
          <select value={selectedSp} onChange={e => setSelectedSp(e.target.value)}
            className="admin-input appearance-none pr-8">
            <option value="">All Salespersons</option>
            {salespersons.map(s => <option key={s.name} value={s.name}>{s.sales_person_name}</option>)}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="admin-input py-2" />
          </div>
          <div className="flex-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="admin-input py-2" />
          </div>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
      ) : returns.length === 0 ? (
        <div className="py-16 flex flex-col items-center gap-3">
          <RotateCcw className="w-10 h-10 text-slate-200" />
          <p className="text-slate-400 text-sm">No returns found for this period.</p>
        </div>
      ) : (
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
      )}
    </div>
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
