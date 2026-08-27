// A single labeled stat tile used in the 3-column summary grids across pages.
//
// Usage:
//   <StatCard label="Invoices" value={summary.total_invoices} />
//   <StatCard label="Outstanding" value={`₹${fmt(summary.total_outstanding)}`} valueClass="text-brand-dark" />
export default function StatCard({ label, value, valueClass = 'text-slate-900' }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-3 shadow-sm ring-1 ring-slate-100">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${valueClass}`}>{value ?? '—'}</p>
    </div>
  )
}
