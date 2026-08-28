import { useState } from 'react'
import { Receipt, ExternalLink } from 'lucide-react'
import api, { endpoints, BASE_URL } from '@/api/client'
import { fmt } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import AdminListPage from '@/components/shared/AdminListPage'
import AdminDateRangeFilter from '@/components/shared/AdminDateRangeFilter'

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d) ? String(ts) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AdminExpenses() {
  const [selectedSp, setSelectedSp] = useState('')
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10))
  const [toDate,   setToDate]   = useState(new Date().toISOString().slice(0, 10))

  const { data: spData } = useAsync(
    () => api.get(endpoints.adminGetSalespersons),
    [],
  )
  const salespersons = Array.isArray(spData) ? spData : []

  const { data, loading, reload } = useAsync(
    () => api.get(endpoints.adminGetExpenses, {
      params: {
        salesperson: selectedSp || undefined,
        from_date: fromDate,
        to_date:   toDate,
      },
    }),
    [selectedSp, fromDate, toDate],
    { errorMessage: 'Failed to load expenses.' },
  )
  const expenses = data?.expenses || []
  const summary  = data?.summary  || {}

  return (
    <AdminListPage
      title="Expenses"
      subtitle={summary.total > 0 ? `${expenses.length} entries · ₹${fmt(summary.total)} total` : null}
      onRefresh={reload}
      refreshing={loading}
      className="max-w-3xl"
      beforeList={
        <>
          <AdminDateRangeFilter
            salespersons={salespersons}
            salesperson={selectedSp}
            onSalespersonChange={setSelectedSp}
            allLabel="All Employees"
            fromDate={fromDate}
            onFromDateChange={setFromDate}
            toDate={toDate}
            onToDateChange={setToDate}
          />

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
        </>
      }
      loading={loading}
      empty={expenses.length === 0}
      emptyContent={
        <div className="py-16 flex flex-col items-center gap-3">
          <Receipt className="w-10 h-10 text-slate-200" />
          <p className="text-slate-400 text-sm">No expenses found for this period.</p>
        </div>
      }
    >
      <div className="space-y-2">
        {expenses.map(e => <ExpenseRow key={e.name} e={e} />)}
      </div>
    </AdminListPage>
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
