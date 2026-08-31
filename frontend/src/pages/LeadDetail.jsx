import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Phone, Video, FileText, History, ClipboardList } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import OrangeHeader from '@/components/shared/OrangeHeader'
import EmptyState from '@/components/shared/EmptyState'
import { PageLoader } from '@/components/shared/Spinner'
import QuotationModal from '@/components/crm/QuotationModal'
import { fmt2 } from '@/lib/format'
import { useAsync, useSubmit } from '@/lib/hooks'

const LEAD_STATUSES = [
  'Lead', 'Open', 'Replied', 'Interested', 'Quotation',
  'Opportunity', 'Converted', 'Lost Quotation', 'Do Not Contact',
]

export default function LeadDetail() {
  const { id: lead } = useParams()
  const navigate = useNavigate()

  const [followupType, setFollowupType] = useState('Call')
  const [followupNotes, setFollowupNotes] = useState('')
  const [nextFollowUp, setNextFollowUp] = useState('')
  const [showQuotationModal, setShowQuotationModal] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [loggingFollowup, submitFollowup] = useSubmit()
  const [changingStatus, submitStatus] = useSubmit()

  const { data: detail, loading, reload } = useAsync(
    () => api.get(endpoints.getLeadDetail, { params: { lead } }),
    [lead],
    { enabled: !!lead, errorMessage: 'Failed to load lead.', resetOnError: true },
  )

  if (loading) return <PageLoader />
  if (!detail) {
    return (
      <div className="h-full bg-app-bg">
        <OrangeHeader title="Lead" onBack={() => navigate('/leads-crm')} />
        <div className="px-4 pt-8">
          <EmptyState icon={ClipboardList} title="Lead not found" />
        </div>
      </div>
    )
  }

  const quotations = detail.quotations || []
  const activeQuotation = quotations.find(q => q.docstatus === 1) || null
  const history = [...quotations].reverse()

  const handleLogFollowup = async () => {
    if (!followupNotes.trim()) return
    try {
      await submitFollowup(() => api.post(endpoints.logFollowup, {
        lead, type: followupType, notes: followupNotes.trim(),
        next_follow_up_date: nextFollowUp || null,
      }))
      setFollowupNotes('')
      setNextFollowUp('')
      reload()
    } catch {
      // toasted in useSubmit
    }
  }

  const handleStatusChange = async (status) => {
    try {
      await submitStatus(() => api.post(endpoints.updateLeadStatus, { lead, status }))
      reload()
    } catch {
      // toasted in useSubmit
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-24">
      <OrangeHeader title={detail.lead_name} onBack={() => navigate('/leads-crm')}>
        {detail.company_name && <p className="mt-1 text-sm text-white/80">{detail.company_name}</p>}
        <div className="mt-3 flex items-center gap-3 text-xs text-white/80">
          {detail.mobile_no && (
            <a
              href={`tel:${detail.mobile_no}`}
              className="flex items-center gap-1.5 bg-white/20 border border-white/30 rounded-full px-3 py-1.5 text-white font-semibold"
            >
              <Phone className="w-3.5 h-3.5" /> {detail.mobile_no}
            </a>
          )}
          {detail.territory && <span>{detail.territory}</span>}
        </div>
      </OrangeHeader>

      <div className="px-4 pt-4 space-y-4">
        {/* Status */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Status</p>
          <select
            value={detail.status}
            disabled={changingStatus}
            onChange={e => handleStatusChange(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 bg-white outline-none focus:border-brand disabled:opacity-60"
          >
            {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {detail.next_follow_up_date && (
            <p className="mt-2 text-xs text-brand-dark bg-orange-50 rounded-lg px-3 py-1.5 inline-block">
              Next follow up: {detail.next_follow_up_date}
            </p>
          )}
        </div>

        {/* Quotation */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Quotation</p>
            {quotations.length > 0 && (
              <button
                onClick={() => setShowHistory(v => !v)}
                className="flex items-center gap-1 text-xs text-slate-400 font-medium"
              >
                <History className="w-3.5 h-3.5" /> {showHistory ? 'Hide' : 'History'} ({quotations.length})
              </button>
            )}
          </div>

          {activeQuotation ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono font-semibold text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                  {activeQuotation.name}
                </span>
                <span className="text-lg font-bold text-brand">₹ {fmt2(activeQuotation.grand_total)}</span>
              </div>
              {activeQuotation.items.map(d => (
                <div key={d.item_code} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0 text-sm">
                  <span className="text-slate-700 truncate flex-1">{d.item_name}</span>
                  <span className="text-slate-400 text-xs ml-2">{d.qty} {d.uom} × ₹{fmt2(d.rate)}</span>
                </div>
              ))}
              {activeQuotation.payment_terms_template && (
                <p className="mt-2 text-xs text-slate-500">Payment plan: {activeQuotation.payment_terms_template}</p>
              )}
              <button
                onClick={() => setShowQuotationModal(true)}
                className="mt-3 w-full border-2 border-brand text-brand font-bold py-2.5 rounded-xl text-sm"
              >
                Cancel Quotation →
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-3">No active quotation yet.</p>
              <button
                onClick={() => setShowQuotationModal(true)}
                className="w-full bg-brand text-white font-bold py-3 rounded-xl text-sm"
              >
                Create Quotation →
              </button>
            </>
          )}

          {showHistory && (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
              {history.map(q => (
                <div key={q.name} className="flex items-center justify-between text-xs">
                  <span className={`font-mono ${q.docstatus === 1 ? 'text-brand font-semibold' : 'text-slate-400 line-through'}`}>
                    {q.name}
                  </span>
                  <span className={q.docstatus === 1 ? 'text-brand font-semibold' : 'text-slate-400'}>
                    ₹{fmt2(q.grand_total)} · {q.docstatus === 2 ? 'Cancelled' : q.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Follow-up */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Log Follow-up</p>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setFollowupType('Call')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border-2 ${
                followupType === 'Call' ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 text-slate-500'
              }`}
            >
              <Phone className="w-3.5 h-3.5" /> Call
            </button>
            <button
              onClick={() => setFollowupType('Visit')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border-2 ${
                followupType === 'Visit' ? 'border-brand bg-brand/5 text-brand' : 'border-slate-200 text-slate-500'
              }`}
            >
              <Video className="w-3.5 h-3.5" /> Visit
            </button>
          </div>
          <textarea
            value={followupNotes}
            onChange={e => setFollowupNotes(e.target.value)}
            placeholder="What was discussed?"
            rows={2}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand mb-2"
          />
          <label className="text-xs font-semibold text-slate-500 block mb-1">Next follow-up (optional)</label>
          <input
            type="date"
            value={nextFollowUp}
            onChange={e => setNextFollowUp(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand mb-3"
          />
          <button
            onClick={handleLogFollowup}
            disabled={loggingFollowup || !followupNotes.trim()}
            className="w-full bg-brand text-white font-bold py-2.5 rounded-xl text-sm disabled:opacity-60"
          >
            {loggingFollowup ? 'Saving…' : 'Log Follow-up'}
          </button>
        </div>

        {/* Timeline */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Activity</p>
          {(detail.notes || []).length === 0 ? (
            <p className="text-sm text-slate-400">No activity logged yet.</p>
          ) : (
            <div className="space-y-3">
              {detail.notes.map((n, i) => (
                <div key={i} className="flex gap-2">
                  <FileText className="w-4 h-4 text-slate-300 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">{n.note}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{n.added_by} · {n.added_on}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showQuotationModal && (
        <QuotationModal
          lead={lead}
          existingQuotation={activeQuotation}
          onClose={() => setShowQuotationModal(false)}
          onSaved={() => { setShowQuotationModal(false); reload() }}
        />
      )}
    </div>
  )
}
