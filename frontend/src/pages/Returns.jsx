import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, RotateCcw, ChevronRight, X, ArrowLeft, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import Spinner from '@/components/shared/Spinner'
import { fmt, fieldCls as fc } from '@/lib/format'
import { useActiveCustomer, useAsync, useSubmit } from '@/lib/hooks'
import { PAGE_SIZE } from '@/lib/constants'

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function Returns() {
  const navigate       = useNavigate()
  const session        = useAppStore(s => s.session)
  const activeCustomer = useActiveCustomer()
  const [showForm, setShowForm] = useState(false)

  const { data: returnsData, loading, setData: setReturns } = useAsync(
    () => api.get(endpoints.getInvoices, {
      params: { customer: activeCustomer.customer, status: 'Return', page_length: PAGE_SIZE },
    }).then((result) => (result?.invoices || []).map((inv) => ({
      name: inv.name,
      customer: activeCustomer.customer_name || activeCustomer.customer,
      invoice: inv.return_against,
      amount: Math.abs(inv.grand_total || 0),
      date: inv.posting_date,
      reason: inv.remarks || 'Return',
    }))),
    [activeCustomer?.customer, activeCustomer?.customer_name],
    { enabled: !!activeCustomer?.customer, errorMessage: 'Failed to load returns.', resetOnError: true },
  )
  const returns = returnsData || []

  // Close the "new return" form if the checked-in customer changes (e.g. checkout) —
  // adjusted during render per https://react.dev/learn/you-might-not-need-an-effect
  // instead of an effect, to avoid an extra render pass.
  const [prevActiveCustomer, setPrevActiveCustomer] = useState(activeCustomer)
  if (activeCustomer !== prevActiveCustomer) {
    setPrevActiveCustomer(activeCustomer)
    if (!activeCustomer) setShowForm(false)
  }

  const total = returns.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="pb-4">
      {!showForm ? (
        <>
          <div className="bg-red-500 px-4 pt-4 pb-6">
            <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center mb-3">
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <p className="text-red-100 text-sm">Returns (This Month)</p>
            <p className="text-3xl font-bold text-white mt-1">₹{fmt(total)}</p>
            <p className="text-red-100 text-xs mt-1">{returns.length} credit notes</p>
          </div>

          <div className="px-4 -mt-3 space-y-2">
            {activeCustomer && loading ? (
              <div className="flex justify-center py-8">
                <Spinner size="sm" className="border-red-200 border-t-red-500" />
              </div>
            ) : returns.map(r => (
              <div key={r.name} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
                <div className="w-9 h-9 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <RotateCcw className="w-4 h-4 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 text-sm truncate">{r.customer}</p>
                  <p className="text-xs text-slate-400">{r.invoice} · {r.date}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{r.reason}</p>
                </div>
                <p className="font-bold text-red-600 text-sm flex-shrink-0">-₹{fmt(r.amount)}</p>
                <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
              </div>
            ))}
          </div>

          {activeCustomer && (
            <button onClick={() => setShowForm(true)}
              className="fixed bottom-20 right-4 w-14 h-14 bg-red-500 rounded-full shadow-lg flex items-center justify-center">
              <Plus className="w-6 h-6 text-white" />
            </button>
          )}

          {!activeCustomer && (
            <div className="mx-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
              Returns become read-only after customer checkout.
            </div>
          )}
        </>
      ) : (
        <NewReturnForm
          session={session}
          customer={activeCustomer}
          onClose={() => setShowForm(false)}
          onSuccess={(r) => { setReturns(prev => [r, ...(prev || [])]); setShowForm(false) }}
        />
      )}
    </div>
  )
}

function NewReturnForm({ session, customer, onClose, onSuccess }) {
  const [invSearch,     setInvSearch]     = useState('')      // typed text
  const [selectedInv,   setSelectedInv]   = useState('')      // confirmed invoice name
  const [showDropdown,  setShowDropdown]  = useState(false)
  const [loadingItems,  setLoadingItems]  = useState(false)
  const [returnItems,   setReturnItems]   = useState([])
  const [reason,        setReason]        = useState('')
  const [submitting,    submit]           = useSubmit()

  // Load last 15 days invoices for this customer
  const { data: invoicesData, loading: loadingInv } = useAsync(
    () => api.get(endpoints.getInvoices, {
      params: {
        customer:    customer.customer,
        from_date:   daysAgo(15),
        page_length: PAGE_SIZE,
      },
    }),
    [customer?.customer],
    { enabled: !!customer?.customer },
  )
  const invoices = useMemo(() => invoicesData?.invoices || [], [invoicesData])

  // Filter list by what user has typed
  const filteredInvoices = useMemo(() => {
    if (!invSearch.trim()) return invoices
    const q = invSearch.toLowerCase()
    return invoices.filter(inv =>
      inv.name.toLowerCase().includes(q) ||
      String(inv.grand_total || '').includes(q)
    )
  }, [invoices, invSearch])

  // Load remaining returnable items from backend (accounts for prior partial returns)
  const handleInvoiceSelect = async (invName) => {
    setSelectedInv(invName)
    setInvSearch(invName)
    setShowDropdown(false)
    setReturnItems([])
    if (!invName) return
    setLoadingItems(true)
    try {
      const rows = await api.get(endpoints.getReturnableItems, { params: { invoice: invName } })
      const returnable = (rows || []).filter(d => d.returnable_qty > 0).map(d => ({
        item_code: d.item_code,
        item_name: d.item_name || d.item_code,
        max_qty:   d.returnable_qty,
        qty:       d.returnable_qty,
        selected:  true,
      }))
      if (!returnable.length) {
        toast.error('No remaining returnable quantity for this invoice.')
        return
      }
      setReturnItems(returnable)
    } catch (err) {
      toast.error(err?.message || 'Could not load invoice items.')
    } finally {
      setLoadingItems(false)
    }
  }

  // If user finishes typing a valid invoice code not in list
  const handleInvInputBlur = () => {
    setTimeout(() => setShowDropdown(false), 150)
    if (invSearch && invSearch !== selectedInv) {
      handleInvoiceSelect(invSearch.trim())
    }
  }

  const toggleItem = (i) => setReturnItems(prev => prev.map((it, idx) => idx === i ? { ...it, selected: !it.selected } : it))
  const updateQty  = (i, val) => {
    const n = parseFloat(val)
    setReturnItems(prev => prev.map((it, idx) => idx === i ? { ...it, qty: isNaN(n) || n <= 0 ? 1 : Math.min(n, it.max_qty) } : it))
  }

  const handleSubmit = async () => {
    if (!selectedInv)   { toast.error('Select an invoice first.'); return }
    if (!reason.trim()) { toast.error('Reason for return is required.'); return }
    const selectedItems = returnItems.filter(it => it.selected)
    if (!selectedItems.length) { toast.error('Select at least one item to return.'); return }

    try {
      await submit(async () => {
        const result = await api.post(endpoints.createReturn, {
          invoice:       selectedInv,
          items:         selectedItems.map(it => ({ item_code: it.item_code, qty: it.qty })),
          reason,
          route_session: session?.name || null,
        })
        toast.success('Return created!')
        onSuccess({
          name:     result.return_invoice,
          customer: result.customer,
          invoice:  selectedInv,
          amount:   Math.abs(result.grand_total || 0),
          date:     new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
          reason,
        })
      })
    } catch {
      // toasted in useSubmit
    }
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-900">New Return</h2>
        <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
      </div>

      {/* Invoice picker */}
      <Field label="Original Invoice">
        {loadingInv ? (
          <div className="flex items-center gap-2 py-2"><Spinner size="sm" /><span className="text-xs text-slate-400">Loading invoices…</span></div>
        ) : (
          <div className="relative">
            <div className="relative">
              <input
                type="text"
                placeholder="Search or type invoice…"
                value={invSearch}
                onChange={e => { setInvSearch(e.target.value); setShowDropdown(true) }}
                onFocus={() => setShowDropdown(true)}
                onBlur={handleInvInputBlur}
                className={fc + ' pr-8'}
              />
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            {showDropdown && filteredInvoices.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {filteredInvoices.map(inv => (
                  <button
                    key={inv.name}
                    type="button"
                    onMouseDown={() => handleInvoiceSelect(inv.name)}
                    className="w-full text-left px-3 py-2.5 hover:bg-red-50 border-b border-slate-100 last:border-0"
                  >
                    <p className="text-sm font-medium text-slate-800">{inv.name}</p>
                    <p className="text-xs text-slate-400">₹{fmt(inv.grand_total)} · {inv.posting_date}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Field>

      {/* Items — auto-loaded from invoice */}
      {loadingItems && (
        <div className="flex items-center gap-2 py-2"><Spinner size="sm" /><span className="text-xs text-slate-400">Loading items…</span></div>
      )}

      {returnItems.length > 0 && (
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-2">Return Items</label>
          <div className="space-y-2">
            {returnItems.map((item, i) => (
              <div key={item.item_code} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 border transition-colors ${item.selected ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={() => toggleItem(i)}
                  className="w-4 h-4 accent-red-500 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{item.item_name}</p>
                  <p className="text-xs text-slate-400">{item.item_code} · max {item.max_qty}</p>
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  value={item.qty}
                  onChange={e => updateQty(i, e.target.value)}
                  disabled={!item.selected}
                  className="w-16 text-center border border-slate-200 rounded-lg py-1 text-sm font-semibold bg-white focus:outline-none focus:border-red-400 disabled:opacity-40"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <Field label="Reason">
        <textarea rows={3} placeholder="Describe the reason…" className={fc + ' resize-none'} value={reason} onChange={e => setReason(e.target.value)} />
      </Field>

      <button disabled={submitting || !selectedInv} onClick={handleSubmit}
        className="w-full bg-red-500 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">
        {submitting ? <Spinner size="sm" className="border-white border-t-red-300" /> : <RotateCcw className="w-4 h-4" />}
        {submitting ? 'Creating…' : 'Create Return'}
      </button>
    </div>
  )
}

function Field({ label, children }) {
  return <div><label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>{children}</div>
}
