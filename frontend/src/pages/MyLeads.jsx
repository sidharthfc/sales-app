import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Filter, Target, Phone, CalendarClock, Plus, X } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import PageHeader from '@/components/shared/PageHeader'
import DataList from '@/components/ui/DataList'
import CreateLeadModal from '@/components/crm/CreateLeadModal'
import { useAsync } from '@/lib/hooks'
import { PAGE_SIZE, LEAD_STATUSES } from '@/lib/constants'

// Short label override for the one status whose full name doesn't fit a filter chip.
const SHORT_LABELS = { 'Lost Quotation': 'Lost' }
const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  ...LEAD_STATUSES.map(s => ({ key: s, label: SHORT_LABELS[s] || s })),
]

export default function MyLeads() {
  const navigate = useNavigate()
  const dataVersion = useAppStore(s => s.dataVersion)
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showCreate,   setShowCreate]   = useState(false)

  // Dashboard's "Follow-ups" stat card links here with ?follow_up_due=due --
  // same URL-param-driven-filter pattern as AdminLeads' KPI-card drill-downs.
  const [searchParams, setSearchParams] = useSearchParams()
  const followUpDue = searchParams.get('follow_up_due') || ''
  const clearFollowUpFilter = () => setSearchParams({}, { replace: true })

  const { data, loading, error, reload } = useAsync(
    () => api.get(endpoints.getMyLeads, {
      params: {
        page_length: PAGE_SIZE,
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(followUpDue ? { follow_up_due: followUpDue } : {}),
      },
    }),
    [statusFilter, followUpDue, dataVersion],
    { errorMessage: 'Failed to load leads.', resetOnError: true },
  )

  const leads = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = data?.leads || []
    if (!q) return rows
    return rows.filter(l =>
      (l.lead_name || '').toLowerCase().includes(q) ||
      (l.company_name || '').toLowerCase().includes(q) ||
      (l.mobile_no || '').toLowerCase().includes(q)
    )
  }, [data, search])

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-24">
      <PageHeader
        title="My Leads"
        onBack={() => navigate('/dashboard')}
        right={(
          <button
            onClick={() => setShowCreate(true)}
            className="w-9 h-9 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center"
          >
            <Plus className="w-4 h-4 text-white" />
          </button>
        )}
      >
        <div className="mt-4 bg-white rounded-xl flex items-center px-3 gap-2">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search name, company, mobile"
            className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
          />
        </div>
      </PageHeader>

      <div className="px-4 pt-4 space-y-3">
        {followUpDue && (
          <div className="flex items-center justify-between gap-2 bg-brand-50 border border-brand-100 rounded-xl px-3 py-2">
            <span className="text-sm font-semibold text-brand-dark">Showing: Follow-ups due</span>
            <button
              onClick={clearFollowUpFilter}
              className="flex items-center gap-1 text-xs font-bold text-brand-dark"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 flex items-center px-3 gap-2">
          <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700"
          >
            {STATUS_FILTERS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <DataList
          loading={loading}
          error={error}
          empty={leads.length === 0}
          emptyIcon={Target}
          emptyTitle="No leads found"
          emptyDescription="Leads assigned to you by your manager will show up here."
        >
          {leads.map(lead => (
            <button
              key={lead.name}
              onClick={() => navigate(`/leads-crm/${lead.name}`)}
              className="w-full text-left rounded-2xl border border-slate-100 bg-white p-4 shadow-sm active:scale-[0.99] transition-transform"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{lead.lead_name}</p>
                  {lead.company_name && (
                    <p className="text-xs text-slate-400 truncate">{lead.company_name}</p>
                  )}
                </div>
                <span className="flex-shrink-0 rounded-full bg-brand-50 text-brand-dark text-xs font-semibold px-2.5 py-1">
                  {lead.status}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                {lead.mobile_no && (
                  <a
                    href={`tel:${lead.mobile_no}`}
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1 text-brand-dark font-medium"
                  >
                    <Phone className="w-3.5 h-3.5" /> {lead.mobile_no}
                  </a>
                )}
                {lead.next_follow_up_date && (
                  <span className="flex items-center gap-1">
                    <CalendarClock className="w-3.5 h-3.5" /> Follow up {lead.next_follow_up_date}
                  </span>
                )}
              </div>
            </button>
          ))}
        </DataList>
      </div>

      {showCreate && (
        <CreateLeadModal
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false)
            reload()
            if (created?.name) navigate(`/leads-crm/${created.name}`)
          }}
        />
      )}
    </div>
  )
}
