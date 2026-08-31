import { useNavigate } from 'react-router-dom'
import { FileText, Building2 } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import OrangeHeader from '@/components/shared/OrangeHeader'
import DataList from '@/components/ui/DataList'
import { useAsync } from '@/lib/hooks'
import { fmt2, fmtDate } from '@/lib/format'
import { PAGE_SIZE } from '@/lib/constants'

// docstatus: 0 draft, 1 submitted (active/current offer), 2 cancelled
// (superseded by a later version -- see crm.py's cancel + amend chain).
const STATUS_BADGE = {
  0: { label: 'Draft',     cls: 'bg-amber-50 text-amber-600' },
  1: { label: 'Active',    cls: 'bg-brand-50 text-brand-dark' },
  2: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-400' },
}

export default function MyQuotations() {
  const navigate = useNavigate()

  const { data, loading, error } = useAsync(
    () => api.get(endpoints.getMyQuotations, { params: { page_length: PAGE_SIZE } }),
    [],
    { errorMessage: 'Failed to load quotations.', resetOnError: true },
  )

  const quotations = data?.quotations || []

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-24">
      <OrangeHeader title="Quotations" onBack={() => navigate('/dashboard')} />

      <div className="px-4 pt-4 space-y-3">
        <DataList
          loading={loading}
          error={error}
          empty={quotations.length === 0}
          emptyIcon={FileText}
          emptyTitle="No quotations yet"
          emptyDescription="Quotations you send to your leads will show up here."
        >
          {quotations.map(q => {
            const badge = STATUS_BADGE[q.docstatus] || STATUS_BADGE[0]
            return (
              <button
                key={q.lead}
                onClick={() => navigate(`/leads-crm/${q.lead}`)}
                className="w-full text-left rounded-2xl border border-slate-100 bg-white p-4 shadow-sm active:scale-[0.99] transition-transform"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{q.lead_name}</p>
                    {q.company_name && (
                      <p className="text-xs text-slate-400 truncate flex items-center gap-1 mt-0.5">
                        <Building2 className="w-3 h-3" /> {q.company_name}
                      </p>
                    )}
                  </div>
                  <span className={`flex-shrink-0 rounded-full text-xs font-semibold px-2.5 py-1 ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400">
                    {q.quotation}{q.version_count > 1 ? ` · v${q.version_count}` : ''}
                  </span>
                  <span className="text-base font-bold text-brand">₹ {fmt2(q.grand_total)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{fmtDate(q.creation)}</p>
              </button>
            )
          })}
        </DataList>
      </div>
    </div>
  )
}
