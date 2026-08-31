import { useMemo, useState } from 'react'
import { Search, Minus, Plus, X } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import ModalShell from '@/components/shared/ModalShell'
import ModalHeader from '@/components/ui/ModalHeader'
import { ListSkeleton } from '@/components/shared/Skeleton'
import { fmt2 } from '@/lib/format'
import { useAsync, useSearch, useSubmit } from '@/lib/hooks'

// Shared by both the first quotation (existingQuotation=null -> create) and
// every later negotiation round (existingQuotation set -> renegotiate).
// Item rate is directly editable per row -- unlike Sales.jsx's price-list-
// driven catalog, price negotiation IS the point of this modal.
export default function QuotationModal({ lead, existingQuotation, onClose, onSaved }) {
  const isRenegotiate = !!existingQuotation
  const { query: search, debouncedQuery, setQuery: setSearch } = useSearch(300)
  const [cart, setCart] = useState(() => {
    const map = {}
    for (const item of existingQuotation?.items || []) {
      map[item.item_code] = { item_name: item.item_name, uom: item.uom, qty: item.qty, rate: item.rate }
    }
    return map
  })
  const [paymentTermsTemplate, setPaymentTermsTemplate] = useState(existingQuotation?.payment_terms_template || '')
  const [submitting, submit] = useSubmit()

  const { data: catalogData, loading: itemsLoading } = useAsync(
    () => api.get(endpoints.listCrmItems, { params: { search: debouncedQuery || undefined, page_length: 100 } }),
    [debouncedQuery],
    { errorMessage: 'Failed to load items.' },
  )
  const catalog = catalogData?.items || []

  const { data: templatesData } = useAsync(
    () => api.get(endpoints.listPaymentTermsTemplates),
    [],
    { errorMessage: 'Failed to load payment terms.' },
  )
  const templates = templatesData || []

  const setQty = (item, qty) => setCart(prev => {
    if (qty <= 0) { const n = { ...prev }; delete n[item.item_code]; return n }
    const existing = prev[item.item_code]
    return { ...prev, [item.item_code]: { item_name: item.item_name, uom: item.uom, qty, rate: existing?.rate ?? item.price } }
  })

  const setRate = (itemCode, rate) => setCart(prev => (
    prev[itemCode] ? { ...prev, [itemCode]: { ...prev[itemCode], rate } } : prev
  ))

  const cartRows = useMemo(() => Object.entries(cart).map(([item_code, row]) => ({ item_code, ...row })), [cart])
  const total = cartRows.reduce((s, r) => s + (r.qty || 0) * (r.rate || 0), 0)

  const handleSubmit = async () => {
    const items = cartRows.filter(r => r.qty > 0).map(r => ({ item_code: r.item_code, qty: r.qty, rate: r.rate }))
    if (!items.length) return

    try {
      const result = await submit(async () => {
        if (isRenegotiate) {
          return api.post(endpoints.renegotiateQuotation, {
            quotation: existingQuotation.name,
            items,
            payment_terms_template: paymentTermsTemplate || null,
          })
        }
        return api.post(endpoints.createQuotationForLead, {
          lead,
          items,
          payment_terms_template: paymentTermsTemplate || null,
        })
      })
      onSaved?.(result)
    } catch {
      // toasted in useSubmit
    }
  }

  return (
    <ModalShell onClose={onClose} className="max-h-[88vh] flex flex-col">
      <ModalHeader
        title={isRenegotiate ? 'Cancel & Revise Quotation' : 'New Quotation'}
        subtitle={isRenegotiate ? existingQuotation.name : undefined}
        onClose={onClose}
      />

      <div className="flex-shrink-0 px-4 pt-3">
        <div className="bg-slate-50 rounded-xl flex items-center px-3 gap-2">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search item name"
            className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {itemsLoading ? (
          <ListSkeleton count={4} />
        ) : catalog.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-6">No items found</p>
        ) : (
          catalog.map(item => {
            const qty = cart[item.item_code]?.qty || 0
            return (
              <div key={item.item_code} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{item.item_name}</p>
                  <p className="text-xs text-slate-400">₹{fmt2(item.price)} / {item.uom}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setQty(item, Math.max(0, qty - 1))}
                    className="w-7 h-7 border border-slate-200 rounded-lg flex items-center justify-center text-slate-600 bg-white active:bg-slate-100"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-8 text-center text-sm font-semibold text-slate-700">{qty || 0}</span>
                  <button
                    type="button"
                    onClick={() => setQty(item, qty + 1)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-brand text-white active:opacity-80"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {cartRows.length > 0 && (
        <div className="flex-shrink-0 border-t border-slate-100 px-4 py-3 space-y-2 max-h-[30vh] overflow-y-auto">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Quoted Items</p>
          {cartRows.map(row => (
            <div key={row.item_code} className="flex items-center gap-2">
              <p className="flex-1 min-w-0 text-sm text-slate-700 truncate">{row.item_name}</p>
              <span className="text-xs text-slate-400">{row.qty} {row.uom} ×</span>
              <div className="flex items-center bg-slate-50 rounded-lg px-2 py-1 w-24">
                <span className="text-xs text-slate-400">₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={row.rate}
                  onChange={e => setRate(row.item_code, parseFloat(e.target.value) || 0)}
                  className="w-full bg-transparent outline-none text-sm font-semibold text-slate-700 text-right"
                />
              </div>
              <button type="button" onClick={() => setQty(row, 0)} className="text-slate-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-shrink-0 border-t border-slate-100 px-4 py-3 space-y-3">
        {templates.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
              Payment Plan
            </label>
            <select
              value={paymentTermsTemplate}
              onChange={e => setPaymentTermsTemplate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 bg-white outline-none focus:border-brand"
            >
              <option value="">No fixed plan (pay on delivery)</option>
              {templates.map(t => (
                <option key={t.name} value={t.name}>{t.template_name || t.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-slate-700">Total</span>
          <span className="text-lg font-bold text-brand">₹ {fmt2(total)}</span>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting || cartRows.length === 0}
          className="w-full bg-brand text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-60"
        >
          {submitting ? 'Saving…' : isRenegotiate ? 'Cancel & Submit New Quotation →' : 'Send Quotation →'}
        </button>
      </div>
    </ModalShell>
  )
}
