export const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0)

export const fmt2 = (n) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n || 0)

export const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export const statusStyle = {
  Paid:            'bg-green-100 text-green-700',
  Unpaid:          'bg-red-100 text-red-700',
  'Partly Paid':   'bg-amber-100 text-amber-700',
  Overdue:         'bg-red-100 text-red-700',
  Submitted:       'bg-blue-100 text-blue-700',
  Draft:           'bg-slate-100 text-slate-600',
  Cancelled:       'bg-slate-100 text-slate-400',
  Return:          'bg-purple-100 text-purple-700',
}

export const inputCls = 'w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-700 placeholder-slate-400 outline-none focus:border-brand transition-colors'

export const fieldCls = 'border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 bg-white w-full'
