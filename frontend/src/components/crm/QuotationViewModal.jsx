import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import CenterModalShell from '@/components/shared/CenterModalShell'
import ModalHeader from '@/components/ui/ModalHeader'
import Spinner from '@/components/shared/Spinner'
import { fmt2 } from '@/lib/format'
import { useAsync, useSubmit } from '@/lib/hooks'
import { showSuccess } from '@/lib/toastStore'
import { QUOTATION_STATUS_BADGE } from '@/lib/constants'

// Read/act surface for one quotation -- fetches its own detail so it works
// the same regardless of whether the caller has a full quotation object on
// hand (LeadDetail) or only the lighter get_my_quotations summary row
// (MyQuotations). Actions shown depend on docstatus:
//   0 Draft   -> Edit Draft / Submit / Discard
//   1 Active  -> Cancel / Amend
//   2 Cancelled -> read-only, links to whatever superseded it (if anything)
export default function QuotationViewModal({ quotationName, onClose, onChanged, onEdit }) {
  const navigate = useNavigate()
  const dataVersion = useAppStore(s => s.dataVersion)
  const [submitting, submit] = useSubmit()
  const [confirming, setConfirming] = useState(null) // null | 'cancel' | 'discard'

  const { data: detail, loading, reload } = useAsync(
    () => api.get(endpoints.getQuotationDetail, { params: { quotation: quotationName } }),
    [quotationName, dataVersion],
    { enabled: !!quotationName, errorMessage: 'Failed to load quotation.' },
  )

  // get_quotation_detail returns this directly (a plain quotation-name
  // string, or null) -- no separate history fetch needed just to find it.
  const successor = detail?.successor || null

  const runAction = async (endpoint, successMessage, { closeAfter = false } = {}) => {
    try {
      await submit(async () => {
        await api.post(endpoint, { quotation: quotationName })
        showSuccess(successMessage)
      })
      setConfirming(null)
      onChanged?.()
      if (closeAfter) onClose?.()
      else reload()
    } catch {
      // toasted in useSubmit
    }
  }

  const handleEdit = () => {
    // Callers only read detail.quotation off this to navigate to
    // /quotations/:quotation/edit -- QuotationForm does its own
    // get_quotation_detail fetch from that route param, so no need to
    // normalize this object's shape for anything downstream.
    onEdit?.(detail)
  }

  const badge = detail ? (QUOTATION_STATUS_BADGE[detail.docstatus] || QUOTATION_STATUS_BADGE[0]) : null

  return (
    <CenterModalShell onClose={onClose} className="flex flex-col overflow-hidden">
      <ModalHeader title="Quotation" subtitle={quotationName} onClose={onClose} showHandle={false} />

      {loading || !detail ? (
        <div className="flex items-center justify-center py-10"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badge.cls}`}>{badge.label}</span>
              <span className="text-lg font-bold text-brand">₹ {fmt2(detail.grand_total)}</span>
            </div>

            <div className="space-y-1.5">
              {detail.items.map(d => (
                <div key={d.item_code} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0 text-sm">
                  <span className="text-slate-700 truncate flex-1">{d.item_name}</span>
                  <span className="text-slate-400 text-xs ml-2">{d.qty} {d.uom} × ₹{fmt2(d.rate)}</span>
                </div>
              ))}
            </div>

            <div className="bg-slate-50 rounded-xl px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-medium text-slate-700">₹ {fmt2(detail.net_total)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Tax</span>
                <span className="font-medium text-slate-700">₹ {fmt2(detail.total_taxes_and_charges)}</span>
              </div>
            </div>

            {detail.payment_terms_template && (
              <p className="text-xs text-slate-500">Payment plan: {detail.payment_terms_template}</p>
            )}

            {detail.docstatus === 2 && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                {successor
                  ? <>Superseded by <span className="font-mono font-semibold text-slate-700">{successor}</span>.</>
                  : 'Cancelled, no revision was created.'}
              </p>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-slate-100 px-4 py-3 space-y-2">
            {detail.docstatus === 0 && confirming !== 'discard' && (
              <>
                <button
                  onClick={handleEdit}
                  className="w-full border-2 border-brand text-brand font-bold py-3 rounded-xl text-sm"
                >
                  Edit Draft
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirming('discard')}
                    disabled={submitting}
                    className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-3 rounded-xl text-sm disabled:opacity-60"
                  >
                    Discard
                  </button>
                  <button
                    onClick={() => runAction(endpoints.submitQuotation, 'Quotation submitted.')}
                    disabled={submitting}
                    className="flex-1 brand-gradient text-white font-bold py-3 rounded-xl text-sm disabled:opacity-60"
                  >
                    {submitting ? 'Submitting…' : 'Submit'}
                  </button>
                </div>
              </>
            )}

            {detail.docstatus === 0 && confirming === 'discard' && (
              <>
                <p className="text-sm text-slate-600 text-center">Discard this draft? This can't be undone.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirming(null)}
                    className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-3 rounded-xl text-sm"
                  >
                    Keep Draft
                  </button>
                  <button
                    onClick={() => runAction(endpoints.discardQuotationDraft, 'Draft discarded.', { closeAfter: true })}
                    disabled={submitting}
                    className="flex-1 bg-red-500 text-white font-bold py-3 rounded-xl text-sm disabled:opacity-60"
                  >
                    {submitting ? 'Discarding…' : 'Discard'}
                  </button>
                </div>
              </>
            )}

            {detail.docstatus === 1 && confirming !== 'cancel' && (
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirming('cancel')}
                  disabled={submitting}
                  className="flex-1 border-2 border-red-200 text-red-500 font-bold py-3 rounded-xl text-sm disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEdit}
                  disabled={submitting}
                  className="flex-1 brand-gradient text-white font-bold py-3 rounded-xl text-sm disabled:opacity-60"
                >
                  Amend
                </button>
              </div>
            )}

            {detail.docstatus === 1 && confirming === 'cancel' && (
              <>
                <p className="text-sm text-slate-600 text-center">Cancel this quotation? The lead will have no active offer.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirming(null)}
                    className="flex-1 border-2 border-slate-200 text-slate-500 font-bold py-3 rounded-xl text-sm"
                  >
                    Keep Active
                  </button>
                  <button
                    onClick={() => runAction(endpoints.cancelQuotation, 'Quotation cancelled.')}
                    disabled={submitting}
                    className="flex-1 bg-red-500 text-white font-bold py-3 rounded-xl text-sm disabled:opacity-60"
                  >
                    {submitting ? 'Cancelling…' : 'Cancel Quotation'}
                  </button>
                </div>
              </>
            )}

            {detail.docstatus === 2 && (
              <button
                onClick={() => { onClose?.(); navigate(`/leads-crm/${detail.lead}`) }}
                className="w-full border-2 border-slate-200 text-slate-600 font-bold py-3 rounded-xl text-sm"
              >
                View Lead
              </button>
            )}
          </div>
        </>
      )}
    </CenterModalShell>
  )
}
