import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Building2, Plus, X } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import PageHeader from '@/components/shared/PageHeader'
import DataList from '@/components/ui/DataList'
import LeadPickerModal from '@/components/crm/LeadPickerModal'
import QuotationViewModal from '@/components/crm/QuotationViewModal'
import { useAsync } from '@/lib/hooks'
import { fmt2, fmtDate } from '@/lib/format'
import { PAGE_SIZE, QUOTATION_STATUS_BADGE } from '@/lib/constants'

export default function MyQuotations() {
  const navigate = useNavigate()
  const dataVersion = useAppStore(s => s.dataVersion)

  const [showLeadPicker, setShowLeadPicker] = useState(false)
  const [viewingQuotation, setViewingQuotation] = useState(null)

  // Dashboard's "Sent Today" stat card links here with ?sent_today=1 --
  // same URL-param-driven-filter pattern as MyLeads' follow_up_due.
  const [searchParams, setSearchParams] = useSearchParams()
  const sentToday = searchParams.get('sent_today') === '1'
  const clearSentTodayFilter = () => setSearchParams({}, { replace: true })

  const { data, loading, error } = useAsync(
    () => api.get(endpoints.getMyQuotations, {
      params: {
        page_length: PAGE_SIZE,
        ...(sentToday ? { sent_today: 1 } : {}),
      },
    }),
    [sentToday, dataVersion],
    { errorMessage: 'Failed to load quotations.', resetOnError: true },
  )

  const quotations = data?.quotations || []

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-24">
      <PageHeader
        title="Quotations"
        onBack={() => navigate('/dashboard')}
        right={(
          <button
            onClick={() => setShowLeadPicker(true)}
            className="w-9 h-9 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center"
          >
            <Plus className="w-4 h-4 text-white" />
          </button>
        )}
      />

      <div className="px-4 pt-4 space-y-3">
        {sentToday && (
          <div className="flex items-center justify-between gap-2 bg-brand-50 border border-brand-100 rounded-xl px-3 py-2">
            <span className="text-sm font-semibold text-brand-dark">Showing: Sent today</span>
            <button
              onClick={clearSentTodayFilter}
              className="flex items-center gap-1 text-xs font-bold text-brand-dark"
            >
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          </div>
        )}

        <DataList
          loading={loading}
          error={error}
          empty={quotations.length === 0}
          emptyIcon={FileText}
          emptyTitle="No quotations yet"
          emptyDescription="Quotations you send to your leads will show up here."
        >
          {quotations.map(q => {
            const badge = QUOTATION_STATUS_BADGE[q.docstatus] || QUOTATION_STATUS_BADGE[0]
            return (
              <button
                key={q.lead}
                onClick={() => setViewingQuotation(q.quotation)}
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

      {showLeadPicker && (
        <LeadPickerModal
          onClose={() => setShowLeadPicker(false)}
          onPick={(lead) => {
            setShowLeadPicker(false)
            navigate(`/quotations/new/${lead.name}`)
          }}
        />
      )}

      {viewingQuotation && (
        <QuotationViewModal
          quotationName={viewingQuotation}
          onClose={() => setViewingQuotation(null)}
          onEdit={(detail) => { setViewingQuotation(null); navigate(`/quotations/${detail.quotation}/edit`) }}
        />
      )}
    </div>
  )
}
