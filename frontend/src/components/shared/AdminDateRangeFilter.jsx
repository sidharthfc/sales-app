import { ChevronDown } from 'lucide-react'

// AdminDateRangeFilter — salesperson dropdown + from/to date range filter.
// Shared by AdminExpenses and AdminReturns, which had this block verbatim
// (same JSX structure, same input classes) apart from the "all" option label.
//
// Usage:
//   <AdminDateRangeFilter
//     salespersons={salespersons}
//     salesperson={selectedSp}
//     onSalespersonChange={setSelectedSp}
//     allLabel="All Employees"
//     fromDate={fromDate}
//     onFromDateChange={setFromDate}
//     toDate={toDate}
//     onToDateChange={setToDate}
//   />
export default function AdminDateRangeFilter({
  salespersons,
  salesperson,
  onSalespersonChange,
  allLabel = 'All Salespersons',
  fromDate,
  onFromDateChange,
  toDate,
  onToDateChange,
}) {
  return (
    <div className="admin-surface p-4 space-y-3">
      <div className="relative">
        <select value={salesperson} onChange={e => onSalespersonChange(e.target.value)}
          className="admin-input appearance-none pr-8">
          <option value="">{allLabel}</option>
          {salespersons.map(s => <option key={s.name} value={s.name}>{s.sales_person_name}</option>)}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">From</label>
          <input type="date" value={fromDate} onChange={e => onFromDateChange(e.target.value)}
            className="admin-input py-2" />
        </div>
        <div className="flex-1">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">To</label>
          <input type="date" value={toDate} onChange={e => onToDateChange(e.target.value)}
            className="admin-input py-2" />
        </div>
      </div>
    </div>
  )
}
