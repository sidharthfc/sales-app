import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Users, Phone, CheckCircle2, MapPin, X } from 'lucide-react'
import { showSuccess } from '@/lib/toastStore'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { useAsync, useSubmit } from '@/lib/hooks'
import AdminListPage from '@/components/shared/AdminListPage'
import AdminLeadDetailModal from '@/components/admin/AdminLeadDetailModal'
import { LEAD_STATUSES as STATUS_OPTIONS } from '@/lib/constants'

// KPI-card drill-down filters (from the Overview page's "New Today" /
// "Follow-ups Due" / "Quotations Today" cards) live in the URL rather than
// plain useState so a direct link/navigate() from AdminCrmOverview lands
// pre-filtered instead of always opening to the unfiltered list.
export default function AdminLeads() {
  const [searchParams, setSearchParams] = useSearchParams()
  const createdToday   = searchParams.get('created_today') === '1'
  const followUpDue    = searchParams.get('follow_up_due') || ''
  const quotationToday = searchParams.get('quotation_today') === '1'
  const kpiFilterLabel = createdToday
    ? 'New leads today'
    : followUpDue === 'due' ? 'Follow-ups due'
    : followUpDue === 'today' ? 'Follow-ups due today'
    : followUpDue === 'overdue' ? 'Overdue follow-ups'
    : quotationToday ? 'Quotations sent today'
    : null
  const clearKpiFilter = () => setSearchParams({}, { replace: true })

  const [statusFilter,   setStatusFilter]   = useState('')
  const [ownerFilter,    setOwnerFilter]    = useState('')
  const [territoryFilter, setTerritoryFilter] = useState('')
  const [selected,       setSelected]       = useState(() => new Set())
  const [assignTo,       setAssignTo]       = useState('')
  const [assigning,      submitAssign]      = useSubmit()
  const [confirmingUnassign, setConfirmingUnassign] = useState(false)
  const [unassigning,    submitUnassign]    = useSubmit()
  const [viewingLead,    setViewingLead]    = useState(null)

  const { data: territoriesData } = useAsync(() => api.get(endpoints.listTerritories), [])
  const territories = useMemo(() => (Array.isArray(territoriesData) ? territoriesData : []), [territoriesData])

  const { data: spData } = useAsync(
    () => api.get(endpoints.adminListSalespeople),
    [],
  )
  const salespeople = useMemo(() => (Array.isArray(spData) ? spData : []), [spData])

  const dataVersion = useAppStore(s => s.dataVersion)
  const { data: leadsData, loading, reload } = useAsync(
    () => api.get(endpoints.getMyLeads, {
      params: {
        page_length: 200,
        ...(statusFilter    ? { status: statusFilter } : {}),
        ...(ownerFilter     ? { lead_owner: ownerFilter } : {}),
        ...(territoryFilter ? { territory: territoryFilter } : {}),
        ...(createdToday    ? { created_today: 1 } : {}),
        ...(followUpDue     ? { follow_up_due: followUpDue } : {}),
        ...(quotationToday  ? { quotation_today: 1 } : {}),
      },
    }),
    [statusFilter, ownerFilter, territoryFilter, createdToday, followUpDue, quotationToday, dataVersion],
    { errorMessage: 'Failed to load leads.' },
  )
  const leads = leadsData?.leads || []

  const nameByEmail = useMemo(() => {
    const map = {}
    salespeople.forEach(sp => { map[sp.name] = sp.full_name })
    return map
  }, [salespeople])

  const toggleSelected = (leadName) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(leadName)) next.delete(leadName)
    else next.add(leadName)
    return next
  })

  const clearSelection = () => {
    setSelected(new Set())
    setConfirmingUnassign(false)
  }

  const allFilteredSelected = leads.length > 0 && leads.every(l => selected.has(l.name))
  const toggleSelectAllFiltered = () => setSelected(
    allFilteredSelected ? new Set() : new Set(leads.map(l => l.name))
  )

  const handleAssign = async () => {
    if (!assignTo || selected.size === 0) return
    try {
      const result = await submitAssign(() => api.post(endpoints.adminAssignLeads, {
        leads: Array.from(selected),
        salesperson: assignTo,
      }))
      showSuccess(`Assigned ${result.assigned} lead${result.assigned === 1 ? '' : 's'} to ${nameByEmail[assignTo] || assignTo}.`)
      clearSelection()
      setAssignTo('')
      reload()
    } catch {
      // toasted in useSubmit
    }
  }

  const handleUnassign = async () => {
    if (selected.size === 0) return
    try {
      const result = await submitUnassign(() => api.post(endpoints.adminUnassignLeads, {
        leads: Array.from(selected),
      }))
      showSuccess(`Unassigned ${result.unassigned} lead${result.unassigned === 1 ? '' : 's'}.`)
      clearSelection()
      reload()
    } catch {
      // toasted in useSubmit
    }
  }

  return (
    <AdminListPage
      title="Leads"
      subtitle={`${leads.length} lead${leads.length === 1 ? '' : 's'}`}
      onRefresh={reload}
      refreshing={loading}
      className="max-w-3xl"
      beforeList={
        <>
          {/* KPI-card drill-down filter (from Overview) */}
          {kpiFilterLabel && (
            <div className="flex items-center justify-between gap-2 bg-brand-50 border border-brand-100 rounded-xl px-3 py-2">
              <span className="text-sm font-semibold text-brand-dark">Showing: {kpiFilterLabel}</span>
              <button
                onClick={clearKpiFilter}
                className="flex items-center gap-1 text-xs font-bold text-brand-dark"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-white outline-none focus:border-brand"
            >
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={ownerFilter}
              onChange={e => setOwnerFilter(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-white outline-none focus:border-brand"
            >
              <option value="">All Salespeople</option>
              <option value="__unassigned__">Unassigned</option>
              {salespeople.map(sp => <option key={sp.name} value={sp.name}>{sp.full_name}</option>)}
            </select>
            <select
              value={territoryFilter}
              onChange={e => setTerritoryFilter(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-white outline-none focus:border-brand"
            >
              <option value="">All Territories</option>
              {territories.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Select all (filtered) */}
          {leads.length > 0 && (
            <button
              onClick={toggleSelectAllFiltered}
              className="self-start flex items-center gap-2 text-sm font-semibold text-brand-dark"
            >
              <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${allFilteredSelected ? 'bg-brand border-brand' : 'border-slate-300'}`}>
                {allFilteredSelected && <CheckCircle2 className="w-4 h-4 text-white" strokeWidth={3} />}
              </span>
              {allFilteredSelected ? 'Deselect all' : `Select all ${leads.length}${territoryFilter ? ` in ${territoryFilter}` : ''}`}
            </button>
          )}

          {/* Bulk assign/unassign bar */}
          {selected.size > 0 && !confirmingUnassign && (
            <div className="admin-surface p-3 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-700">{selected.size} selected</span>
              <select
                value={assignTo}
                onChange={e => setAssignTo(e.target.value)}
                className="flex-1 min-w-[160px] border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-white outline-none focus:border-brand"
              >
                <option value="">Assign to…</option>
                {salespeople.map(sp => <option key={sp.name} value={sp.name}>{sp.full_name}</option>)}
              </select>
              <button
                onClick={handleAssign}
                disabled={!assignTo || assigning}
                className="brand-gradient text-white text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-60"
              >
                {assigning ? 'Assigning…' : 'Assign'}
              </button>
              <button
                onClick={() => setConfirmingUnassign(true)}
                disabled={assigning}
                className="border-2 border-red-200 text-red-600 text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-60"
              >
                Unassign
              </button>
              <button onClick={clearSelection} className="text-sm text-slate-400 font-medium px-2">
                Clear
              </button>
            </div>
          )}

          {/* Unassign confirmation */}
          {selected.size > 0 && confirmingUnassign && (
            <div className="admin-surface p-3 flex items-center gap-2 flex-wrap border-red-200 bg-red-50">
              <span className="text-sm font-semibold text-red-700">
                Unassign {selected.size} lead{selected.size === 1 ? '' : 's'}? They'll go back to the unassigned pool.
              </span>
              <button
                onClick={handleUnassign}
                disabled={unassigning}
                className="bg-red-600 text-white text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-60"
              >
                {unassigning ? 'Unassigning…' : 'Confirm Unassign'}
              </button>
              <button
                onClick={() => setConfirmingUnassign(false)}
                disabled={unassigning}
                className="text-sm text-slate-500 font-medium px-2"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      }
      loading={loading}
      empty={leads.length === 0}
      emptyContent={
        <div className="py-16 flex flex-col items-center gap-3">
          <Users className="w-10 h-10 text-slate-200" />
          <p className="text-slate-400 text-sm">No leads match these filters.</p>
        </div>
      }
    >
      <div className="space-y-2">
        {leads.map(lead => (
          <LeadRow
            key={lead.name}
            lead={lead}
            checked={selected.has(lead.name)}
            onToggle={() => toggleSelected(lead.name)}
            onOpenDetail={() => setViewingLead(lead.name)}
            ownerName={lead.lead_owner ? (nameByEmail[lead.lead_owner] || lead.lead_owner) : null}
          />
        ))}
      </div>

      {viewingLead && (
        <AdminLeadDetailModal
          leadName={viewingLead}
          onClose={() => setViewingLead(null)}
          onChanged={reload}
          salespeople={salespeople}
          nameByEmail={nameByEmail}
        />
      )}
    </AdminListPage>
  )
}

// Tapping the row body opens the lead detail modal; only the checkbox itself
// toggles bulk selection (stopPropagation so it doesn't also open the modal).
function LeadRow({ lead, checked, onToggle, onOpenDetail, ownerName }) {
  return (
    <div
      onClick={onOpenDetail}
      className={`w-full text-left admin-surface p-4 flex items-start gap-3 transition-colors cursor-pointer ${checked ? 'ring-2 ring-brand' : ''}`}
    >
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onToggle() }}
        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${checked ? 'bg-brand border-brand' : 'border-slate-300'}`}
      >
        {checked && <CheckCircle2 className="w-4 h-4 text-white" strokeWidth={3} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 text-sm truncate">{lead.lead_name}</p>
            {lead.company_name && <p className="text-xs text-slate-400 truncate">{lead.company_name}</p>}
          </div>
          <span className="flex-shrink-0 rounded-full bg-brand-50 text-brand-dark text-xs font-semibold px-2.5 py-1">
            {lead.status}
          </span>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
          {lead.mobile_no && (
            <a
              href={`tel:${lead.mobile_no}`}
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-brand-dark font-medium"
            >
              <Phone className="w-3.5 h-3.5" /> {lead.mobile_no}
            </a>
          )}
          {lead.district && (
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {lead.district}</span>
          )}
          <span className={ownerName ? 'text-slate-500' : 'text-amber-600 font-semibold'}>
            {ownerName || 'Unassigned'}
          </span>
        </div>
      </div>
    </div>
  )
}
