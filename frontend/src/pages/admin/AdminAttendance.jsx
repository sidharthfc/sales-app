import { useEffect, useState } from 'react'
import { Activity, CheckCircle2, Clock, Users } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import { fmt } from '@/lib/format'
import { useAsync } from '@/lib/hooks'
import AdminListPage from '@/components/shared/AdminListPage'

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d) ? String(ts) : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export default function AdminAttendance() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  const { data, loading, reload } = useAsync(
    () => api.get(endpoints.adminGetAttendance, { params: { date } }),
    [date],
    { errorMessage: 'Failed to load attendance.' },
  )

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(reload, 30_000)
    return () => clearInterval(id)
  }, [reload])

  const s = data?.summary
  const employees = data?.employees || []

  return (
    <AdminListPage
      title="Attendance"
      subtitle="auto-refreshes every 30s"
      headerExtra={
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="admin-date-input" />
      }
      onRefresh={reload}
      refreshing={loading}
      className="max-w-3xl"
      beforeList={
        s && (
          <div className="grid grid-cols-4 gap-2">
            <SumCard label="Total"       value={s.total}       color="text-slate-800"  bg="bg-slate-50"  icon={<Users       className="w-4 h-4 text-slate-400" />} />
            <SumCard label="Active"      value={s.active}      color="text-green-700"  bg="bg-green-50"  icon={<Activity    className="w-4 h-4 text-green-500" />} pulse={s.active > 0} />
            <SumCard label="Done"        value={s.done}        color="text-slate-700"  bg="bg-slate-100" icon={<CheckCircle2 className="w-4 h-4 text-slate-500" />} />
            <SumCard label="Not Started" value={s.not_started} color="text-amber-700"  bg="bg-amber-50"  icon={<Clock       className="w-4 h-4 text-amber-500" />} />
          </div>
        )
      }
      loading={loading && !data}
      empty={employees.length === 0}
      emptyContent={
        <div className="py-16 text-center text-slate-400 text-sm">No employees found.</div>
      }
    >
      <div className="space-y-2">
        {/* Active first, then done, then not started */}
        {['active', 'done', 'not_started'].map(status =>
          employees
            .filter(e => e.status === status)
            .map(emp => <EmpCard key={emp.salesperson} emp={emp} />)
        )}
      </div>
    </AdminListPage>
  )
}

function SumCard({ label, value, color, bg, icon, pulse }) {
  return (
    <div className={`${bg} rounded-2xl p-3 text-center`}>
      <div className="flex justify-center mb-1 relative">
        {pulse && <span className="absolute w-2 h-2 rounded-full bg-green-400 animate-ping opacity-75 top-0 right-0" />}
        {icon}
      </div>
      <p className={`text-xl font-extrabold ${color}`}>{value}</p>
      <p className="text-[10px] font-semibold text-slate-400 mt-0.5">{label}</p>
    </div>
  )
}

function EmpCard({ emp }) {
  const statusConfig =
    emp.status === 'active'
      ? { label: 'Active',      bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500 animate-pulse' }
      : emp.status === 'done'
      ? { label: 'Done',        bg: 'bg-slate-100', text: 'text-slate-600',  dot: null }
      : { label: 'Not Started', bg: 'bg-amber-50',  text: 'text-amber-700',  dot: null }

  const visitPct = emp.total_customers > 0
    ? Math.round((emp.visits_done / emp.total_customers) * 100)
    : 0

  return (
    <div className="admin-surface p-4">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base
          ${emp.status === 'active' ? 'bg-green-100 text-green-700'
          : emp.status === 'done'   ? 'bg-slate-100 text-slate-600'
          : 'bg-amber-50 text-amber-600'}`}>
          {emp.salesperson_name?.[0]?.toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-slate-800 text-sm">{emp.salesperson_name}</p>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusConfig.bg} ${statusConfig.text}`}>
              {statusConfig.dot && <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />}
              {statusConfig.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{emp.route_name || 'No route'}</p>

          {emp.status !== 'not_started' && (
            <div className="mt-2 space-y-1.5">
              {/* Times */}
              <p className="text-xs text-slate-500">
                {emp.start_time ? `In: ${fmtTime(emp.start_time)}` : ''}
                {emp.end_time ? ` · Out: ${fmtTime(emp.end_time)}` : emp.status === 'active' ? ' · ongoing' : ''}
                {emp.duration_hours ? ` · ${emp.duration_hours}h` : ''}
              </p>

              {/* Visit progress bar */}
              {emp.total_customers > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-slate-400">{emp.visits_done} / {emp.total_customers} customers</span>
                    <span className="text-[10px] font-bold text-amber-600">{visitPct}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${visitPct}%` }} />
                  </div>
                </div>
              )}

              {/* Stats row */}
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                {emp.visits_done > 0   && <span className="text-green-600 font-semibold">{emp.visits_done} visited</span>}
                {emp.visits_skipped > 0 && <span className="text-amber-600">{emp.visits_skipped} skipped</span>}
                {emp.expenses > 0      && <span className="text-rose-500">₹{fmt(emp.expenses)} expenses</span>}
              </div>
            </div>
          )}

          {emp.status === 'not_started' && !emp.assigned && (
            <p className="text-xs text-amber-600 mt-1">Not assigned to a route</p>
          )}
        </div>
      </div>
    </div>
  )
}
