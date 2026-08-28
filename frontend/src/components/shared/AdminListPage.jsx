import { RefreshCw } from 'lucide-react'

// AdminListPage — shared shell for the title + refresh button + loading/empty
// pattern common to most /admin/* list pages (Attendance, Expenses, Orders,
// Returns, VanStock). AdminTracking (map + side panel, no list) and
// AdminRoutes (drill-down detail view, custom multi-stat header) don't share
// this shape and are left as bespoke pages.
//
// Renders, as direct children of `.admin-page` (which applies `space-y-4`,
// so child count/order matters):
//   1. header row: title + optional subtitle + headerExtra + refresh button
//   2. beforeList (optional) — filters, summary cards, page-specific
//   3. loading ? "Loading…" : empty ? emptyContent : children
//
// Usage:
//   <AdminListPage
//     title="Van Stock"
//     subtitle={sessions.length > 0 ? `${sessions.length} sessions on ${date}` : null}
//     headerExtra={<input type="date" .../>}
//     onRefresh={reload}
//     refreshing={loading}
//     className="max-w-3xl"
//     beforeList={<SomeFilters />}
//     loading={loading}
//     empty={sessions.length === 0}
//     emptyContent={<div className="py-16 ...">No sessions found.</div>}
//   >
//     {sessions.map(s => <VanCard key={s.session} s={s} />)}
//   </AdminListPage>
export default function AdminListPage({
  title,
  subtitle,
  headerExtra,
  onRefresh,
  refreshing,
  className = '',
  beforeList,
  loading,
  empty,
  emptyContent,
  children,
}) {
  return (
    <div className={['admin-page', className].filter(Boolean).join(' ')}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-800 font-bold text-xl">{title}</h1>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {headerExtra}
          <button onClick={onRefresh} disabled={refreshing} className="admin-icon-button w-9 h-9">
            <RefreshCw className={`w-4 h-4 text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {beforeList}

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
      ) : empty ? (
        emptyContent
      ) : (
        children
      )}
    </div>
  )
}
