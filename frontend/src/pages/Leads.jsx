import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown, ChevronRight, Flame, Snowflake, Phone,
  Plus, UserRound, MessageSquarePlus,
} from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import OrangeHeader from '@/components/shared/OrangeHeader'
import Spinner from '@/components/shared/Spinner'
import { ListSkeleton } from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { inputCls as input } from '@/lib/format'

const emptyForm = {
  lead_name: '',
  company_name: '',
  mobile_no: '',
  place: '',
  district: '',
  remarks: '',
  lead_quality: 'Cold',
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Leads() {
  const session = useAppStore(s => s.session)

  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading]       = useState(true)
  const [leads, setLeads]           = useState([])
  const [expandedLead, setExpandedLead] = useState(null)   // lead name string

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.get(endpoints.getLeads, { params: { page_length: 100 } })
      setLeads(result?.leads || [])
    } catch (err) {
      toast.error(err.message || 'Failed to load leads.')
      setLeads([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  const handleSubmit = async () => {
    const required = [
      ['lead_name',    'Lead Name'],
      ['company_name', 'Company Name'],
      ['mobile_no',    'Mobile Number'],
      ['place',        'Place'],
      ['district',     'District'],
      ['remarks',      'Remarks'],
    ]
    for (const [key, label] of required) {
      if (!form[key].trim()) { toast.error(`${label} is required.`); return }
    }
    setSubmitting(true)
    try {
      await api.post(endpoints.createLead, {
        lead_name:    form.lead_name.trim(),
        company_name: form.company_name.trim(),
        mobile_no:    form.mobile_no.trim(),
        place:        form.place.trim(),
        district:     form.district.trim(),
        remarks:      form.remarks.trim(),
        lead_quality: form.lead_quality,
        route_session: session?.name || null,
      })
      toast.success('Lead created!')
      setForm(emptyForm)
      setShowForm(false)
      fetchLeads()
    } catch (err) {
      toast.error(err.message || 'Failed to create lead.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleLeadUpdated = (updated) => {
    setLeads(prev => prev.map(l =>
      l.name === updated.lead
        ? { ...l, lead_quality: updated.lead_quality, status: updated.status }
        : l
    ))
  }

  const hotLeads  = leads.filter(l => l.lead_quality === 'Hot')
  const coldLeads = leads.filter(l => l.lead_quality !== 'Hot')

  return (
    <div className="min-h-screen bg-app-bg">
      <OrangeHeader title="Leads">
        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">
              {leads.length} lead{leads.length !== 1 ? 's' : ''}
              {hotLeads.length > 0 && (
                <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {hotLeads.length} Hot
                </span>
              )}
            </p>
            <p className="text-xs text-white/75">Tap a lead to view history and update.</p>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-brand-dark"
          >
            <Plus className="h-4 w-4" />
            {showForm ? 'Close' : 'New Lead'}
          </button>
        </div>
      </OrangeHeader>

      <div className="px-4 pt-4 space-y-4">

        {/* ── Create Form ─────────────────────────────────────────────────── */}
        {showForm && (
          <div className="rounded-2xl bg-white p-4 shadow-sm space-y-4">
            <p className="text-sm font-bold text-slate-800">New Lead</p>

            <Field label="Lead Name *">
              <input
                value={form.lead_name}
                onChange={e => setField('lead_name', e.target.value)}
                placeholder="Full name of the contact"
                className={input}
              />
            </Field>

            <Field label="Company Name *">
              <input
                value={form.company_name}
                onChange={e => setField('company_name', e.target.value)}
                placeholder="Business / shop name"
                className={input}
              />
            </Field>

            <Field label="Mobile Number *">
              <input
                type="tel"
                value={form.mobile_no}
                onChange={e => setField('mobile_no', e.target.value)}
                placeholder="10-digit mobile number"
                className={input}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Place *">
                <input
                  value={form.place}
                  onChange={e => setField('place', e.target.value)}
                  placeholder="City / locality"
                  className={input}
                />
              </Field>
              <Field label="District *">
                <input
                  value={form.district}
                  onChange={e => setField('district', e.target.value)}
                  placeholder="District"
                  className={input}
                />
              </Field>
            </div>

            <Field label="Remarks *">
              <textarea
                value={form.remarks}
                onChange={e => setField('remarks', e.target.value)}
                placeholder="What is this lead about?"
                rows={3}
                className={`${input} resize-none`}
              />
            </Field>

            {/* Hot / Cold toggle */}
            <Field label="Lead Quality *">
              <div className="flex gap-3">
                <button
                  onClick={() => setField('lead_quality', 'Hot')}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 py-3 text-sm font-bold transition-colors ${
                    form.lead_quality === 'Hot'
                      ? 'border-red-500 bg-red-50 text-red-600'
                      : 'border-slate-200 bg-white text-slate-400'
                  }`}
                >
                  <Flame className="h-4 w-4" /> Hot
                </button>
                <button
                  onClick={() => setField('lead_quality', 'Cold')}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 py-3 text-sm font-bold transition-colors ${
                    form.lead_quality === 'Cold'
                      ? 'border-blue-500 bg-blue-50 text-blue-600'
                      : 'border-slate-200 bg-white text-slate-400'
                  }`}
                >
                  <Snowflake className="h-4 w-4" /> Cold
                </button>
              </div>
            </Field>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 font-semibold text-white disabled:opacity-60"
            >
              {submitting && <Spinner size="sm" className="border-white border-t-orange-300" />}
              Create Lead
            </button>
          </div>
        )}

        {/* ── Lead List ──────────────────────────────────────────────────── */}
        {loading ? (
          <ListSkeleton count={4} />
        ) : leads.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="No leads yet"
            description="Tap New Lead to capture your first prospect."
          />
        ) : (
          <>
            {hotLeads.length > 0 && (
              <Section title="Hot Leads" icon={<Flame className="w-4 h-4 text-red-500" />}>
                {hotLeads.map(lead => (
                  <LeadCard
                    key={lead.name}
                    lead={lead}
                    expanded={expandedLead === lead.name}
                    onToggle={() => setExpandedLead(p => p === lead.name ? null : lead.name)}
                    onUpdated={handleLeadUpdated}
                  />
                ))}
              </Section>
            )}
            {coldLeads.length > 0 && (
              <Section title="Cold Leads" icon={<Snowflake className="w-4 h-4 text-blue-400" />}>
                {coldLeads.map(lead => (
                  <LeadCard
                    key={lead.name}
                    lead={lead}
                    expanded={expandedLead === lead.name}
                    onToggle={() => setExpandedLead(p => p === lead.name ? null : lead.name)}
                    onUpdated={handleLeadUpdated}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function Section({ title, icon, children }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        {icon}
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p>
      </div>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function LeadCard({ lead, expanded, onToggle, onUpdated }) {
  const [detail, setDetail]         = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Update panel state
  const [remark, setRemark]         = useState('')
  const [quality, setQuality]       = useState(lead.lead_quality || 'Cold')
  const [saving, setSaving]         = useState(false)

  const isHot = lead.lead_quality === 'Hot'

  const fetchDetail = async () => {
    if (detail) return
    setLoadingDetail(true)
    try {
      const d = await api.get(endpoints.getLead, { params: { lead: lead.name } })
      setDetail(d)
      setQuality(d.lead_quality || 'Cold')
    } catch (err) {
      toast.error(err.message || 'Failed to load lead details.')
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleToggle = () => {
    if (!expanded) fetchDetail()
    onToggle()
  }

  const handleCall = (e) => {
    e.stopPropagation()
    if (lead.mobile_no) {
      window.location.href = `tel:${lead.mobile_no}`
    }
  }

  const handleUpdate = async () => {
    if (!remark.trim() && quality === (detail?.lead_quality || 'Cold')) {
      toast.error('Add a remark or change lead quality to update.')
      return
    }
    setSaving(true)
    try {
      const result = await api.post(endpoints.updateLead, {
        lead: lead.name,
        remarks: remark.trim() || null,
        lead_quality: quality,
      })
      toast.success('Lead updated!')
      setRemark('')
      setDetail(prev => prev ? { ...prev, lead_quality: result.lead_quality, notes: result.notes } : prev)
      onUpdated(result)
    } catch (err) {
      toast.error(err.message || 'Failed to update lead.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-all ${
      isHot ? 'border-red-100' : 'border-slate-100'
    }`}>
      {/* Card header — tappable row */}
      <div className="p-4" onClick={handleToggle}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-slate-900 truncate">{lead.lead_name || lead.name}</p>
              <QualityBadge quality={lead.lead_quality} />
            </div>
            <p className="mt-0.5 text-xs text-slate-500 truncate">{lead.company_name}</p>
            {(lead.place || lead.district) && (
              <p className="mt-0.5 text-[11px] text-slate-400">
                {[lead.place, lead.district].filter(Boolean).join(', ')}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {lead.mobile_no && (
              <button
                onClick={handleCall}
                className="w-9 h-9 rounded-full bg-green-50 border border-green-200 flex items-center justify-center active:bg-green-100"
              >
                <Phone className="w-4 h-4 text-green-600" />
              </button>
            )}
            {expanded
              ? <ChevronDown className="w-4 h-4 text-slate-400" />
              : <ChevronRight className="w-4 h-4 text-slate-400" />
            }
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
          {lead.mobile_no && <span>{lead.mobile_no}</span>}
          <span>·</span>
          <span>{lead.creation?.slice(0, 10)}</span>
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-4">
          {loadingDetail ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : (
            <>
              {/* Notes history */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Visit History</p>
                {(detail?.notes || []).length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No remarks yet.</p>
                ) : (
                  <div className="space-y-2">
                    {[...(detail?.notes || [])].reverse().map((n, i) => (
                      <div key={i} className="bg-white rounded-xl border border-slate-100 px-3 py-2.5">
                        <p className="text-xs text-slate-700">{n.note}</p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          {n.added_on?.slice(0, 16).replace('T', ' ')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Update panel */}
              <div className="space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Update Lead</p>

                {/* Hot / Cold toggle */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setQuality('Hot')}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 py-2.5 text-xs font-bold transition-colors ${
                      quality === 'Hot'
                        ? 'border-red-500 bg-red-50 text-red-600'
                        : 'border-slate-200 bg-white text-slate-400'
                    }`}
                  >
                    <Flame className="h-3.5 w-3.5" /> Hot
                  </button>
                  <button
                    onClick={() => setQuality('Cold')}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 py-2.5 text-xs font-bold transition-colors ${
                      quality === 'Cold'
                        ? 'border-blue-500 bg-blue-50 text-blue-600'
                        : 'border-slate-200 bg-white text-slate-400'
                    }`}
                  >
                    <Snowflake className="h-3.5 w-3.5" /> Cold
                  </button>
                </div>

                {/* Remark textarea */}
                <textarea
                  value={remark}
                  onChange={e => setRemark(e.target.value)}
                  placeholder="Add a follow-up remark..."
                  rows={2}
                  className={`${input} resize-none text-xs`}
                />

                <button
                  onClick={handleUpdate}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving
                    ? <Spinner size="sm" className="border-white border-t-orange-300" />
                    : <MessageSquarePlus className="w-4 h-4" />
                  }
                  Save Update
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function QualityBadge({ quality }) {
  if (quality === 'Hot') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">
        <Flame className="w-2.5 h-2.5" /> Hot
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-500">
      <Snowflake className="w-2.5 h-2.5" /> Cold
    </span>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label>
      {children}
    </div>
  )
}
