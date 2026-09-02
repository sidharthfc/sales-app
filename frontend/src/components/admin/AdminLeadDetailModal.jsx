import { useState } from 'react'
import { Phone, MapPin, CalendarClock } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import CenterModalShell from '@/components/shared/CenterModalShell'
import ModalHeader from '@/components/ui/ModalHeader'
import Spinner from '@/components/shared/Spinner'
import { fmt2 } from '@/lib/format'
import { useAsync, useSubmit } from '@/lib/hooks'
import { showSuccess } from '@/lib/toastStore'

// Read/assign surface for one lead, opened from a tap on an AdminLeads row.
// Fetches its own detail (same endpoint the salesperson-facing LeadDetail
// page uses) rather than trusting the lighter get_my_leads row already on
// hand, so status/notes/quotations are always current. Assign/unassign post
// straight to the same admin endpoints the bulk bar uses, just with a
// single-lead array.
export default function AdminLeadDetailModal({ leadName, onClose, onChanged, salespeople, nameByEmail }) {
  const dataVersion = useAppStore(s => s.dataVersion)
  const [assignTo, setAssignTo] = useState('')
  const [assigning, submitAssign] = useSubmit()
  const [unassigning, submitUnassign] = useSubmit()

  const { data: detail, loading, reload } = useAsync(
    () => api.get(endpoints.getLeadDetail, { params: { lead: leadName } }),
    [leadName, dataVersion],
    { enabled: !!leadName, errorMessage: 'Failed to load lead.' },
  )

  const handleAssign = async () => {
    if (!assignTo) return
    try {
      const result = await submitAssign(() => api.post(endpoints.adminAssignLeads, {
        leads: [leadName],
        salesperson: assignTo,
      }))
      showSuccess(`Assigned to ${nameByEmail[result.salesperson] || result.salesperson}.`)
      setAssignTo('')
      onChanged?.()
      reload()
    } catch {
      // toasted in useSubmit
    }
  }

  const handleUnassign = async () => {
    try {
      await submitUnassign(() => api.post(endpoints.adminUnassignLeads, { leads: [leadName] }))
      showSuccess('Lead unassigned.')
      onChanged?.()
      reload()
    } catch {
      // toasted in useSubmit
    }
  }

  const ownerName = detail?.lead_owner ? (nameByEmail[detail.lead_owner] || detail.lead_owner) : null

  return (
    <CenterModalShell onClose={onClose} className="flex flex-col overflow-hidden">
      <ModalHeader title={detail?.lead_name || 'Lead'} subtitle={leadName} onClose={onClose} showHandle={false} />

      {loading || !detail ? (
        <div className="flex items-center justify-center py-10"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-brand-50 text-brand-dark text-xs font-semibold px-2.5 py-1">
                {detail.status}
              </span>
              {detail.mobile_no && (
                <a href={`tel:${detail.mobile_no}`} className="flex items-center gap-1 text-sm text-brand-dark font-medium">
                  <Phone className="w-3.5 h-3.5" /> {detail.mobile_no}
                </a>
              )}
            </div>

            {detail.company_name && <p className="text-sm text-slate-600">{detail.company_name}</p>}

            <div className="flex items-center gap-4 text-xs text-slate-500">
              {detail.territory && (
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {detail.territory}</span>
              )}
              {detail.next_follow_up_date && (
                <span className="flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Follow up {detail.next_follow_up_date}</span>
              )}
            </div>

            <div className="bg-slate-50 rounded-xl px-3 py-2.5 flex items-center justify-between">
              <span className="text-sm text-slate-500">Assigned to</span>
              <span className={`text-sm font-semibold ${ownerName ? 'text-slate-700' : 'text-amber-600'}`}>
                {ownerName || 'Unassigned'}
              </span>
            </div>

            {detail.quotations?.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Quotations</p>
                <div className="space-y-1.5">
                  {detail.quotations.map(q => (
                    <div key={q.name} className="flex items-center justify-between text-sm py-1 border-b border-slate-50 last:border-0">
                      <span className="text-slate-600 font-mono text-xs">{q.name}</span>
                      <span className="font-medium text-slate-700">₹ {fmt2(q.grand_total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-slate-100 px-4 py-3 space-y-2">
            <div className="flex gap-2">
              <select
                value={assignTo}
                onChange={e => setAssignTo(e.target.value)}
                className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 bg-white outline-none focus:border-brand"
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
            </div>
            {detail.lead_owner && (
              <button
                onClick={handleUnassign}
                disabled={unassigning}
                className="w-full border-2 border-red-200 text-red-600 text-sm font-bold py-2.5 rounded-xl disabled:opacity-60"
              >
                {unassigning ? 'Unassigning…' : 'Unassign'}
              </button>
            )}
          </div>
        </>
      )}
    </CenterModalShell>
  )
}
