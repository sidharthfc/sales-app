import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ChevronDown, Receipt, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints, BASE_URL } from '@/api/client'
import { fmt } from '@/lib/format'

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d) ? String(ts) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AdminExpenses() {
  const [salespersons, setSalespersons] = useState([])
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(false)
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
      const d = await api.get(endpoints.adminGetExpenses, {
        params: {
          salesperson: selectedSp || undefined,
          from_date: fromDate,
          to_date:   toDate,
        },
      })
      if (loadId !== loadSeqRef.current) return
      setData(d)
    } catch (err) {
      if (loadId !== loadSeqRef.current) return
      toast.error(err.message || 'Failed to load expenses.')
    } finally {
      if (loadId === loadSeqRef.current) {
        setLoading(false)
      }
    }
  }, [selectedSp, fromDate, toDate])

  useEffect(() => { load() }, [load])

  const expenses = data?.expenses || []
  const summary  = data?.summary  || {}

  return (
    <div className="admin-page max-w-3xl">

      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-800 font-bold text-xl">Expenses</h1>
          {summary.total > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">{expenses.length} entries · ₹{fmt(summary.total)} total</p>
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
            <option value="">All Employees</option>
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

      {/* Summary cards */}
      {expenses.length > 0 && (
        <>
          {Object.keys(summary.by_employee || {}).length > 1 && (
            <div className="admin-surface p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">By Employee</p>
              <div className="space-y-2">
                {Object.entries(summary.by_employee).sort((a, b) => b[1] - a[1]).map(([name, amt]) => (
                  <div key={name} className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700">{name}</p>
                    <p className="text-sm font-bold text-slate-800">₹{fmt(amt)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Object.keys(summary.by_type || {}).length > 0 && (
            <div className="admin-surface p-4">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">By Category</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(summary.by_type).sort((a, b) => b[1] - a[1]).map(([type, amt]) => (
                  <div key={type} className="admin-surface-soft px-3 py-2.5">
                    <p className="text-xs font-semibold text-slate-500">{type}</p>
                    <p className="text-base font-bold text-slate-800 mt-0.5">₹{fmt(amt)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Expense list */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
      ) : expenses.length === 0 ? (
        <div className="py-16 flex flex-col items-center gap-3">
          <Receipt className="w-10 h-10 text-slate-200" />
          <p className="text-slate-400 text-sm">No expenses found for this period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {expenses.map(e => <ExpenseRow key={e.name} e={e} />)}
        </div>
      )}
    </div>
  )
}

function ExpenseRow({ e }) {
  const receiptUrl = e.receipt ? `${BASE_URL}${e.receipt}` : null

  return (
    <div className="admin-surface p-4">
      <div className="flex items-start gap-3">
        {receiptUrl ? (
          <a href={receiptUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
            <img src={receiptUrl} alt="receipt"
              className="w-14 h-14 rounded-xl object-cover border border-slate-200 hover:opacity-80 transition-opacity" />
          </a>
        ) : (
          <div className="w-14 h-14 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center flex-shrink-0">
            <Receipt className="w-6 h-6 text-slate-300" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-800 text-sm">{e.expense_type}</p>
              <p className="text-xs text-slate-500 mt-0.5">{e.salesperson_name}</p>
            </div>
            <p className="text-base font-extrabold text-slate-800 flex-shrink-0">₹{fmt(e.amount)}</p>
          </div>
          {e.notes && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{e.notes}</p>}
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[11px] text-slate-400">{fmtTime(e.time)}</p>
            {receiptUrl && (
              <a href={receiptUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                <ExternalLink className="w-3 h-3" /> Receipt
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
