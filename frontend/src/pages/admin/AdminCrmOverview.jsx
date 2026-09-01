import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, Users, UserPlus, CalendarClock, FileText, TrendingUp,
} from 'lucide-react'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { useAsync } from '@/lib/hooks'
import { fmt2 } from '@/lib/format'

// Admin landing page for a Lead CRM deployment -- KPI snapshot + team
// conversion, in the same spirit as the route-sales AdminOverview.jsx but
// built on crm.py's own summary endpoints (get_my_day_summary returns the
// org-wide totals here since is_manager() bypasses its lead_owner filter).
export default function AdminCrmOverview() {
  const navigate = useNavigate()

  const dataVersion = useAppStore(s => s.dataVersion)
  const { data: summary, loading: summaryLoading, reload: reloadSummary } = useAsync(
    () => api.get(endpoints.getCrmMyDay),
    [dataVersion],
    { errorMessage: 'Failed to load overview.' },
  )
  const { data: statsData, loading: statsLoading, reload: reloadStats } = useAsync(
    () => api.get(endpoints.adminConversionStats),
    [dataVersion],
    { errorMessage: 'Failed to load conversion stats.' },
  )
  const salespeopleStats = statsData?.salespeople || []
  const unassignedCount  = statsData?.unassigned_leads || 0
  const loading = summaryLoading || statsLoading

  const reload = () => { reloadSummary(); reloadStats() }

  useEffect(() => {
    const id = setInterval(reload, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const followUpsDue = (summary?.follow_ups_today || 0) + (summary?.follow_ups_overdue || 0)

  return (
    <div className="admin-page space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-800 font-bold text-xl">Overview</h1>
          <p className="text-slate-400 text-xs mt-0.5">{summary?.date || '—'} · auto-refreshes every minute</p>
        </div>
        <button onClick={reload} disabled={loading} className="admin-icon-button w-9 h-9">
          <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          icon={Users} iconBg="bg-emerald-50" iconColor="text-emerald-600"
          label="Total Leads" value={summary?.total_leads ?? '—'} loading={loading}
          sub={unassignedCount > 0 ? `${unassignedCount} unassigned` : 'All assigned'}
          onClick={() => navigate('/admin/leads')}
        />
        <KpiCard
          icon={UserPlus} iconBg="bg-blue-50" iconColor="text-blue-600"
          label="New Today" value={summary?.leads_created_today ?? '—'} loading={loading}
          sub="Leads created today"
          onClick={() => navigate('/admin/leads')}
        />
        <KpiCard
          icon={CalendarClock} iconBg="bg-amber-50" iconColor="text-amber-600"
          label="Follow-ups Due" value={followUpsDue} loading={loading}
          sub={summary?.follow_ups_overdue > 0 ? `${summary.follow_ups_overdue} overdue` : 'None overdue'}
          warn={summary?.follow_ups_overdue > 0}
          onClick={() => navigate('/admin/leads')}
        />
        <KpiCard
          icon={FileText} iconBg="bg-orange-50" iconColor="text-brand-dark"
          label="Quotations Today" value={summary?.quotations_sent_today ?? '—'} loading={loading}
          sub={summary ? `₹${fmt2(summary.value_sent_today)}` : ''}
          onClick={() => navigate('/admin/leads')}
        />
      </div>

      {/* Team conversion */}
      <div className="admin-surface p-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Team Conversion</p>
        {salespeopleStats.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">
            {loading ? 'Loading…' : 'No salespeople with leads yet.'}
          </p>
        ) : (
          <div className="space-y-3">
            {salespeopleStats.map(sp => (
              <button
                key={sp.salesperson}
                onClick={() => navigate('/admin/leads')}
                className="w-full flex items-center gap-3 text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0 text-brand-dark text-xs font-bold">
                  {(sp.salesperson_name || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{sp.salesperson_name}</p>
                  <p className="text-xs text-slate-400">
                    {sp.total_leads} leads · {sp.converted} converted · {sp.lost} lost
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-slate-800">{sp.conversion_rate}%</p>
                  <p className="text-[11px] text-slate-400">₹{fmt2(sp.pipeline_value)} pipeline</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="admin-surface p-4 bg-gradient-to-br from-white to-[#FFF7EC]">
        <div className="flex items-start justify-between gap-3 mb-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Active Pipeline Value</p>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-purple-50">
            <TrendingUp className="w-4 h-4 text-purple-600" />
          </div>
        </div>
        <p className="text-2xl font-extrabold text-slate-800">
          {summary ? `₹${fmt2(summary.active_pipeline_value)}` : '—'}
        </p>
        <p className="text-xs text-slate-400 mt-1.5">Sum of every currently active quotation</p>
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, iconBg, iconColor, label, value, sub, loading, warn, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`admin-surface p-4 text-left transition-transform hover:-translate-y-0.5 active:translate-y-0 ${warn ? 'border-red-200' : ''}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
      </div>
      {loading && value === '—' ? (
        <div className="h-7 w-16 bg-slate-100 rounded-lg animate-pulse" />
      ) : (
        <p className={`text-2xl font-extrabold ${warn ? 'text-red-500' : 'text-slate-800'}`}>{value}</p>
      )}
      {sub && <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{sub}</p>}
    </button>
  )
}
