import { useState } from 'react'
import api, { endpoints } from '@/api/client'
import ModalShell from '@/components/shared/ModalShell'
import ModalHeader from '@/components/ui/ModalHeader'
import { useAsync, useSubmit } from '@/lib/hooks'

// Self-service lead capture for a salesperson working the pipeline --
// auto-assigned to whoever creates it (see crm.py create_lead).
export default function CreateLeadModal({ onClose, onCreated }) {
  const [leadName, setLeadName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [mobileNo, setMobileNo] = useState('')
  const [district, setDistrict] = useState('')
  const [submitting, submit] = useSubmit()

  const { data: districtsData } = useAsync(() => api.get(endpoints.listDistricts), [])
  const districts = Array.isArray(districtsData) ? districtsData : []

  const canSave = leadName.trim().length > 0 && district.trim().length > 0

  const handleSubmit = async () => {
    if (!canSave) return
    try {
      const result = await submit(() => api.post(endpoints.createCrmLead, {
        lead_name: leadName.trim(),
        district: district.trim(),
        company_name: companyName.trim() || undefined,
        mobile_no: mobileNo.trim() || undefined,
      }))
      onCreated?.(result)
    } catch {
      // toasted in useSubmit
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader title="New Lead" onClose={onClose} />

      <div className="px-4 py-4 space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
            Contact Name *
          </label>
          <input
            value={leadName}
            onChange={e => setLeadName(e.target.value)}
            placeholder="e.g. Ramesh Kumar"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
            Company Name
          </label>
          <input
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="e.g. Ramesh TMT Traders"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
            Mobile Number
          </label>
          <input
            value={mobileNo}
            onChange={e => setMobileNo(e.target.value)}
            placeholder="e.g. 9999900001"
            inputMode="tel"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
            District *
          </label>
          <input
            value={district}
            onChange={e => setDistrict(e.target.value)}
            placeholder="e.g. Kannur"
            list="crm-district-options"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand"
          />
          <datalist id="crm-district-options">
            {districts.map(d => <option key={d} value={d} />)}
          </datalist>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || !canSave}
          className="w-full bg-brand text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-60 mt-2"
        >
          {submitting ? 'Saving…' : 'Create Lead →'}
        </button>
      </div>
    </ModalShell>
  )
}
