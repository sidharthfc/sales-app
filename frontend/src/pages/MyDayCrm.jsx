import { useNavigate } from 'react-router-dom'
import { Users, UserPlus, CalendarClock, AlertCircle, FileText, TrendingUp } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import PageHeader from '@/components/shared/PageHeader'
import { PageLoader } from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
import { fmt2 } from '@/lib/format'
import { useAsync } from '@/lib/hooks'

// Quick "how's my day going" overview for the Lead CRM pipeline --
// deliberately separate from the route-based My Day page (that one is
// visit/delivery/invoice shaped and doesn't apply here).
export default function MyDayCrm() {
  const navigate = useNavigate()

  const { data, loading, error } = useAsync(
    () => api.get(endpoints.getCrmMyDay),
    [],
    { errorMessage: 'Failed to load your day summary.', resetOnError: true },
  )

  if (loading) return <PageLoader />

  if (!data || error) {
    return (
      <div className="h-full bg-app-bg">
        <PageHeader title="My Day" onBack={() => navigate('/dashboard')} />
        <div className="px-4 pt-8">
          <EmptyState icon={AlertCircle} title="Could not load your day summary" />
        </div>
      </div>
    )
  }

  const {
    date, total_leads, leads_by_status, leads_created_today,
    follow_ups_today, follow_ups_overdue, quotations_sent_today,
    value_sent_today, active_pipeline_value,
  } = data

  const statusEntries = Object.entries(leads_by_status || {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-8">
      <PageHeader title="My Day" onBack={() => navigate('/dashboard')}>
        <p className="mt-1 text-sm text-white/80">{date}</p>
      </PageHeader>

      <div className="px-4 pt-4 space-y-5">
        {/* Pipeline snapshot */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={Users} bg="#E0F7EC" color="#0E8A5F" value={total_leads} label="Total Leads" />
          <StatCard icon={UserPlus} bg="#E3E8FF" color="#3347CC" value={leads_created_today} label="New Today" />
          <StatCard icon={CalendarClock} bg="#FFF3D6" color="#A07000" value={follow_ups_today} label="Follow-ups Today" />
          <StatCard
            icon={AlertCircle}
            bg={follow_ups_overdue > 0 ? '#FDE2E2' : '#F1F5F9'}
            color={follow_ups_overdue > 0 ? '#C0362C' : '#94A3B8'}
            value={follow_ups_overdue}
            label="Overdue Follow-ups"
          />
        </div>

        {/* Quotations */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Quotations</p>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
            <Row
              icon={FileText} iconBg="bg-brand-50" iconColor="text-brand-dark"
              label="Sent Today"
              value={`${quotations_sent_today} · ₹${fmt2(value_sent_today)}`}
            />
            <Row
              icon={TrendingUp} iconBg="bg-purple-50" iconColor="text-purple-600"
              label="Active Pipeline Value" value={`₹${fmt2(active_pipeline_value)}`} bold
            />
          </div>
        </div>

        {/* Pipeline by status */}
        {statusEntries.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Pipeline by Status</p>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-2">
              {statusEntries.map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{status}</span>
                  <span className="text-sm font-bold text-slate-800">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, bg, color, value, label }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ backgroundColor: bg }}>
      <Icon className="w-5 h-5" style={{ color }} />
      <p className="text-2xl font-extrabold text-slate-800">{value}</p>
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
    </div>
  )
}

function Row({ icon: Icon, iconBg, iconColor, label, value, bold }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <p className="flex-1 text-sm text-slate-700">{label}</p>
      <p className={`text-sm flex-shrink-0 text-slate-800 ${bold ? 'font-bold' : 'font-medium'}`}>{value}</p>
    </div>
  )
}
