import { useMemo, useState } from 'react'
import { Search, Building2, Users } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import CenterModalShell from '@/components/shared/CenterModalShell'
import ModalHeader from '@/components/ui/ModalHeader'
import DataList from '@/components/ui/DataList'
import { useAsync } from '@/lib/hooks'
import { PAGE_SIZE } from '@/lib/constants'

// Pick a lead to start a new quotation for -- used by MyQuotations.jsx's
// "Create Quotation" entry point, which (unlike LeadDetail's) has no lead
// already in context. Same search-over-getMyLeads pattern MyLeads.jsx uses.
export default function LeadPickerModal({ onClose, onPick }) {
  const [search, setSearch] = useState('')

  const { data, loading } = useAsync(
    () => api.get(endpoints.getMyLeads, { params: { page_length: PAGE_SIZE } }),
    [],
    { errorMessage: 'Failed to load leads.' },
  )

  const leads = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = data?.leads || []
    if (!q) return rows
    return rows.filter(l =>
      (l.lead_name || '').toLowerCase().includes(q) ||
      (l.company_name || '').toLowerCase().includes(q)
    )
  }, [data, search])

  return (
    <CenterModalShell onClose={onClose} className="flex flex-col overflow-hidden">
      <ModalHeader title="Pick a Lead" onClose={onClose} showHandle={false} />

      <div className="flex-shrink-0 px-4 pt-3">
        <div className="bg-slate-50 rounded-xl flex items-center px-3 gap-2">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search name or company"
            className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
            autoFocus
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <DataList
          loading={loading}
          empty={leads.length === 0}
          emptyIcon={Users}
          emptyTitle="No leads found"
          emptyDescription="Leads assigned to you will show up here."
        >
          {leads.map(lead => (
            <button
              key={lead.name}
              onClick={() => onPick?.(lead)}
              className="w-full text-left rounded-xl border border-slate-100 bg-white p-3 shadow-sm active:scale-[0.99] transition-transform mb-2"
            >
              <p className="font-semibold text-slate-800 truncate">{lead.lead_name}</p>
              {lead.company_name && (
                <p className="text-xs text-slate-400 truncate flex items-center gap-1 mt-0.5">
                  <Building2 className="w-3 h-3" /> {lead.company_name}
                </p>
              )}
            </button>
          ))}
        </DataList>
      </div>
    </CenterModalShell>
  )
}
