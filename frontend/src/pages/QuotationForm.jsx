import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Search, Pencil, Trash2, FileText } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import { PageLoader } from '@/components/shared/Spinner'
import { fmt2 } from '@/lib/format'
import { useAsync, useSearch, useSubmit } from '@/lib/hooks'
import { showSuccess } from '@/lib/toastStore'

// Routed at quotations/new/:lead (create) and quotations/:quotation/edit
// (edit-draft or amend, mode decided by the fetched doc's docstatus). The
// edit path's detail fetch has to fully resolve before QuotationFormBody
// mounts -- its `cart` state seeds itself from existingQuotation once, on
// mount, so mounting it early with a still-loading `null` would lose the
// item pre-fill the moment the fetch actually completes.
export default function QuotationForm() {
  const { lead: leadParam, quotation: quotationParam } = useParams()
  const navigate = useNavigate()

  const { data: fetched, loading } = useAsync(
    () => api.get(endpoints.getQuotationDetail, { params: { quotation: quotationParam } }),
    [quotationParam],
    { enabled: !!quotationParam, errorMessage: 'Failed to load quotation.' },
  )

  if (quotationParam && loading) return <PageLoader />
  if (quotationParam && !fetched) {
    return (
      <div className="h-full bg-app-bg">
        <PageHeader title="Quotation" onBack={() => navigate(-1)} />
        <div className="px-4 pt-8">
          <EmptyState icon={FileText} title="Quotation not found" />
        </div>
      </div>
    )
  }

  // get_quotation_detail keys the doc name "quotation", not "name" --
  // normalized here so the rest of this page can just read .name, matching
  // the shape LeadDetail's own quotations list already uses.
  const existingQuotation = fetched ? { ...fetched, name: fetched.quotation } : null
  const lead = existingQuotation?.lead || leadParam

  return (
    <QuotationFormBody
      key={quotationParam || leadParam}
      lead={lead}
      existingQuotation={existingQuotation}
      navigate={navigate}
    />
  )
}

// Shared by three cases, told apart by mode:
//   - 'create'     (existingQuotation=null): the first quotation for a lead.
//     Offers both "Save as Draft" and "Submit Quotation" -- the common
//     one-tap-submit path stays available alongside a real draft pause.
//   - 'edit-draft' (existingQuotation.docstatus===0): editing an
//     already-created draft in place before it's submitted.
//   - 'amend'      (existingQuotation.docstatus===1): revising an active
//     quotation's price -- cancels the original and creates a new draft,
//     matching Frappe's own native Cancel + Amend lifecycle. Submitting the
//     resulting draft is a separate later step (from QuotationViewModal),
//     not bundled into this action.
// Item rate is directly editable per row -- unlike Sales.jsx's price-list-
// driven catalog, price negotiation IS the point of this page.
function QuotationFormBody({ lead, existingQuotation, navigate }) {
  const mode = !existingQuotation ? 'create' : existingQuotation.docstatus === 0 ? 'edit-draft' : 'amend'
  const [cart, setCart] = useState(() => {
    const map = {}
    for (const item of existingQuotation?.items || []) {
      map[item.item_code] = {
        item_name: item.item_name, uom: item.uom, qty: item.qty, rate: item.rate,
        // Carried straight from get_quotation_detail's own per-row check --
        // true when this item's master has been deleted or disabled since
        // the row was added (amending an old quotation is exactly when
        // this turns up). Snapshotted item_name/uom/rate above still
        // display fine either way; what's blocked is saving it as-is.
        unavailable: !!item.item_unavailable,
      }
    }
    return map
  })
  const [paymentTermsTemplate, setPaymentTermsTemplate] = useState(existingQuotation?.payment_terms_template || '')
  const [submitting, submit] = useSubmit()

  // ── Product entry form: search one product at a time, configure Rate/Qty,
  // tap Add Product to commit it into `cart` -- then the form resets for the
  // next one. `cart` stays keyed by item_code, so re-adding the same code
  // (via the table's edit pencil, see below) overwrites that row in place
  // rather than creating a duplicate -- no separate "editing" state needed.
  const { query: productQuery, debouncedQuery: debouncedProductQuery, setQuery: setProductQuery, reset: resetProductQuery } = useSearch(300)
  const [selectedItem, setSelectedItem] = useState(null)
  const [showProductDropdown, setShowProductDropdown] = useState(false)
  const [entryQty, setEntryQty] = useState('')
  const [entryRate, setEntryRate] = useState('')
  const productInputRef = useRef(null)
  const addProductCardRef = useRef(null)

  // No query yet -- tapping the field should browse the full catalog, not
  // require typing first; a real search still narrows it once they type.
  const { data: catalogData, loading: itemsLoading } = useAsync(
    () => api.get(endpoints.listCrmItems, {
      params: { search: debouncedProductQuery || undefined, page_length: debouncedProductQuery ? 20 : 100 },
    }),
    [debouncedProductQuery],
    { errorMessage: 'Failed to load items.' },
  )
  const productMatches = catalogData?.items || []

  // Set only via the table's edit pencil -- distinguishes "editing an
  // existing line" from "adding a fresh one" so the form can say so
  // explicitly (button label, a banner on the card) instead of silently
  // overwriting the row with no visible acknowledgement that's what's
  // about to happen.
  const [editingItemCode, setEditingItemCode] = useState(null)

  const pickProduct = (item) => {
    setSelectedItem(item)
    setProductQuery(item.item_name)
    setEntryRate(String(item.price ?? ''))
    setShowProductDropdown(false)
    // A fresh pick from search is always "add", even if it happens to
    // match a code already in the cart -- editing an existing line only
    // starts via the table's pencil icon.
    setEditingItemCode(null)
  }

  const handleProductBlur = () => {
    setTimeout(() => setShowProductDropdown(false), 150)
  }

  // Adding several items in a row is the single most common thing this page
  // does, so the entry form re-focuses itself after Add/Update -- and since
  // the input was already focused, a real tap on it fires no further onFocus
  // event on mobile (nothing to open the browse list without this), so the
  // auto-refocus opens it too instead of leaving the user stuck typing blind.
  const handleProductFocus = () => {
    setShowProductDropdown(true)
  }

  const entryAmount = (parseFloat(entryQty) || 0) * (parseFloat(entryRate) || 0)

  const resetEntryForm = () => {
    setSelectedItem(null)
    setEditingItemCode(null)
    resetProductQuery()
    setEntryQty('')
    setEntryRate('')
  }

  const addProductToCart = () => {
    const qty = parseFloat(entryQty) || 0
    const rate = parseFloat(entryRate) || 0
    if (!selectedItem || qty <= 0) return
    setCart(prev => ({
      ...prev,
      [selectedItem.item_code]: { item_name: selectedItem.item_name, uom: selectedItem.uom, qty, rate },
    }))
    resetEntryForm()
    // Back to Product for the next item without an extra tap -- see
    // handleProductFocus for why this also reopens the browse dropdown.
    productInputRef.current?.focus()
  }

  const editRow = (row) => {
    setSelectedItem({ item_code: row.item_code, item_name: row.item_name, uom: row.uom })
    setEditingItemCode(row.item_code)
    setProductQuery(row.item_name)
    setEntryRate(String(row.rate))
    setEntryQty(String(row.qty))
    setShowProductDropdown(false)
    // The row being edited can be scrolled well below the entry form --
    // without this, tapping the pencil silently repopulates fields the
    // user can't currently see, which reads as broken.
    addProductCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Trash icon needs a second tap to actually remove a line -- Cancel and
  // Discard elsewhere in this same flow already get a confirm step, and a
  // single mis-tap here would silently drop a line with no undo.
  const [confirmRemoveCode, setConfirmRemoveCode] = useState(null)
  const confirmRemoveTimer = useRef(null)
  useEffect(() => () => clearTimeout(confirmRemoveTimer.current), [])

  const handleRemoveTap = (itemCode) => {
    if (confirmRemoveCode === itemCode) {
      clearTimeout(confirmRemoveTimer.current)
      setConfirmRemoveCode(null)
      setCart(prev => {
        const next = { ...prev }
        delete next[itemCode]
        return next
      })
      return
    }
    setConfirmRemoveCode(itemCode)
    clearTimeout(confirmRemoveTimer.current)
    confirmRemoveTimer.current = setTimeout(() => setConfirmRemoveCode(null), 2500)
  }

  const { data: templatesData } = useAsync(
    () => api.get(endpoints.listPaymentTermsTemplates),
    [],
    { errorMessage: 'Failed to load payment terms.' },
  )
  const templates = templatesData || []

  // Preview only -- the real tax is computed server-side (same default
  // template) when the quotation is actually submitted. Fetched rather than
  // hardcoded so this can't drift from whatever's actually configured.
  const { data: taxData } = useAsync(
    () => api.get(endpoints.getDefaultTaxRate),
    [],
  )
  const taxRatePercent = taxData?.rate_percent || 0

  const cartRows = useMemo(() => Object.entries(cart).map(([item_code, row]) => ({ item_code, ...row })), [cart])
  // Amount = pre-tax subtotal (what actually gets submitted as item rates).
  // Total = tax-inclusive, what the customer actually pays -- and what a
  // negotiated final figure means, so that's what the editable field below
  // represents, not the pre-tax Amount.
  const amount = cartRows.reduce((s, r) => s + (r.qty || 0) * (r.rate || 0), 0)
  const taxAmount = amount * (taxRatePercent / 100)
  const total = amount + taxAmount

  // Editing the Total directly scales every item's rate by the same factor
  // (target_subtotal / current_subtotal) instead of requiring a per-item
  // edit -- for when the customer negotiated one final lump-sum figure.
  // Typed value is tax-inclusive, so it's backed out to a pre-tax target
  // first. The last row absorbs any rounding leftover so the pre-tax sum
  // lands exactly on that target, not just close to it (the tax-inclusive
  // total can still be off by a paisa or two as a result -- see amount/qty
  // rounding limits noted where this was built).
  const [totalInput, setTotalInput] = useState(null)
  const applyTotalEdit = () => {
    const newTotal = parseFloat(totalInput)
    if (!newTotal || newTotal <= 0 || amount <= 0 || cartRows.length === 0) { setTotalInput(null); return }

    const targetAmount = newTotal / (1 + taxRatePercent / 100)
    const factor = targetAmount / amount
    const updated = {}
    let runningAmount = 0
    cartRows.forEach((row, i) => {
      if (i === cartRows.length - 1) return
      const rate = Math.round(row.rate * factor * 100) / 100
      updated[row.item_code] = { ...cart[row.item_code], rate }
      runningAmount += rate * row.qty
    })
    const last = cartRows[cartRows.length - 1]
    const lastRate = Math.round(((targetAmount - runningAmount) / last.qty) * 100) / 100
    updated[last.item_code] = { ...cart[last.item_code], rate: lastRate }

    setCart(prev => ({ ...prev, ...updated }))
    setTotalInput(null)
  }

  const handleSave = async (alsoSubmit = false) => {
    const items = cartRows.filter(r => r.qty > 0).map(r => ({ item_code: r.item_code, qty: r.qty, rate: r.rate }))
    if (!items.length) return

    try {
      await submit(async () => {
        // Same check the backend enforces (_build_quotation_items) --
        // caught here too so a stale row (its Item deleted/disabled since
        // this quotation was created, most commonly found while amending
        // an older one) is a clear, immediate message pointing at the
        // exact item, not a round-trip to the server to find out.
        const stale = cartRows.find(r => r.unavailable)
        if (stale) {
          throw new Error(`"${stale.item_name}" is no longer available -- remove it before saving.`)
        }

        let saved
        if (mode === 'edit-draft') {
          saved = await api.post(endpoints.saveQuotationDraft, {
            quotation: existingQuotation.name,
            items,
            payment_terms_template: paymentTermsTemplate || null,
          })
          showSuccess('Draft saved.')
        } else if (mode === 'amend') {
          saved = await api.post(endpoints.renegotiateQuotation, {
            quotation: existingQuotation.name,
            items,
            payment_terms_template: paymentTermsTemplate || null,
          })
          showSuccess('Revision created.')
        } else {
          saved = await api.post(endpoints.createQuotationForLead, {
            lead,
            items,
            payment_terms_template: paymentTermsTemplate || null,
          })
          if (alsoSubmit) {
            saved = await api.post(endpoints.submitQuotation, { quotation: saved.quotation })
            showSuccess('Quotation submitted.')
          } else {
            showSuccess('Draft saved.')
          }
        }
        return saved
      })
      navigate(`/leads-crm/${lead}`)
    } catch {
      // toasted in useSubmit
    }
  }

  const title = mode === 'edit-draft' ? 'Edit Draft' : mode === 'amend' ? 'Amend Quotation' : 'New Quotation'

  return (
    <div className="h-full overflow-y-auto bg-app-bg">
      <PageHeader title={title} onBack={() => navigate(-1)}>
        {mode !== 'create' && (
          <p className="mt-1 text-sm text-white/80 font-mono">{existingQuotation.name}</p>
        )}
      </PageHeader>

      <div className="px-4 pt-4 pb-6 space-y-4">
        {/* Add Product card -- search one product, configure Rate/Qty,
            Add Product commits it into the Items card below. */}
        <div ref={addProductCardRef} className="bg-white rounded-2xl shadow-sm p-4">
          {editingItemCode ? (
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-dark">Editing Item</p>
              <button type="button" onClick={resetEntryForm} className="text-xs font-semibold text-slate-400">
                Cancel
              </button>
            </div>
          ) : (
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Add Product</p>
          )}

          <div className="relative mb-3">
            <div className={`border rounded-xl flex items-center px-3 gap-2 bg-white ${editingItemCode ? 'border-brand' : 'border-slate-200'}`}>
              <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <input
                ref={productInputRef}
                value={productQuery}
                onChange={e => { setProductQuery(e.target.value); setSelectedItem(null); setEditingItemCode(null); setShowProductDropdown(true) }}
                onFocus={handleProductFocus}
                onBlur={handleProductBlur}
                placeholder="search item name"
                className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
              />
            </div>
            {showProductDropdown && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {itemsLoading ? (
                  <p className="px-3 py-2.5 text-xs text-slate-400">Searching…</p>
                ) : productMatches.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-slate-400">No items found</p>
                ) : (
                  productMatches.map(item => (
                    <button
                      key={item.item_code}
                      type="button"
                      onMouseDown={() => pickProduct(item)}
                      className="w-full text-left px-3 py-2.5 hover:bg-brand-50 border-b border-slate-100 last:border-0"
                    >
                      <p className="text-sm font-medium text-slate-800">{item.item_name}</p>
                      <p className="text-xs text-slate-400">₹{fmt2(item.price)} / {item.uom}</p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                Rate
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={entryRate}
                onChange={e => setEntryRate(e.target.value)}
                disabled={!selectedItem}
                placeholder="0.00"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand disabled:opacity-60"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                Quantity
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={entryQty}
                onChange={e => setEntryQty(e.target.value)}
                disabled={!selectedItem}
                placeholder="0"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand disabled:opacity-60"
              />
            </div>
          </div>

          <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5 mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Line Amount</span>
            <span className="text-sm font-bold text-slate-700">₹ {fmt2(entryAmount)}</span>
          </div>

          <button
            type="button"
            onClick={addProductToCart}
            disabled={!selectedItem || (parseFloat(entryQty) || 0) <= 0}
            className="w-full brand-gradient text-white font-bold py-3 rounded-xl text-sm disabled:opacity-60"
          >
            {editingItemCode ? 'Update Product' : 'Add Product'}
          </button>
        </div>

        {/* Items card -- Amount/Tax/Total fold into the bottom of this same
            card as a receipt-style footer, directly under what they're
            summing, instead of a separate pinned block. */}
        {cartRows.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Items Added ({cartRows.length})
            </p>
            {/* One stacked block per item, not a multi-column grid -- a grid's
                columns can't stay aligned once a product name wraps to two
                lines, and there isn't enough width on a phone for 5 columns
                (Product/Rate/Qty/Amount/actions) to breathe anyway. */}
            <div className="divide-y divide-slate-100">
              {cartRows.map(row => (
                <div key={row.item_code} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-800 flex-1 min-w-0">{row.item_name}</p>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      {/* Editing (Pencil) re-runs the product picker, which
                          already only offers real, enabled items -- so it's
                          hidden here rather than left to fail; Remove is the
                          only valid action on a stale row. */}
                      {!row.unavailable && (
                        <button type="button" onClick={() => editRow(row)} className="text-slate-400 p-2 -m-2">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {/* p-2/-m-2 on both states (not just the armed one) --
                          a 14px icon with no padding is a ~14px tap target,
                          well under any real touch-target minimum, sitting
                          right next to the pencil button. Padding here
                          enlarges the hit area without changing the visible
                          layout (negative margin cancels it back out), and
                          keeping it identical across both states means
                          arming the confirm no longer shifts the row. */}
                      <button
                        type="button"
                        onClick={() => handleRemoveTap(row.item_code)}
                        title={confirmRemoveCode === row.item_code ? 'Tap again to remove' : undefined}
                        className={`p-2 -m-2 ${confirmRemoveCode === row.item_code
                          ? 'bg-red-500 text-white rounded-full'
                          : row.unavailable ? 'text-red-400' : 'text-slate-300'}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-slate-400">{row.qty} {row.uom} × ₹{fmt2(row.rate)}</span>
                    <span className="text-sm font-bold text-slate-700">₹ {fmt2(row.qty * row.rate)}</span>
                  </div>
                  {row.unavailable && (
                    <p className="text-xs text-red-500 font-medium mt-1">
                      No longer available -- remove this item to continue.
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Amount/Tax as a tight two-row breakdown, right-aligned --
                the standard invoice pattern (Subtotal / Tax / Total, each
                its own scannable line) instead of folding the numbers into
                a run-on caption sentence, which only got harder to read as
                the figures grew. */}
            <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Amount</span>
                <span>₹ {fmt2(amount)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Tax{taxRatePercent > 0 ? ` (${taxRatePercent}%)` : ''}</span>
                <span>₹ {fmt2(taxAmount)}</span>
              </div>
            </div>

            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
              <div>
                <span className="text-base font-bold text-slate-800">Total</span>
                <p className="text-[11px] text-slate-400">Tap to negotiate</p>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xl font-bold text-brand">₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={totalInput ?? total.toFixed(2)}
                  onFocus={() => setTotalInput(total.toFixed(2))}
                  onChange={e => setTotalInput(e.target.value)}
                  onBlur={applyTotalEdit}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                  className="w-28 bg-transparent outline-none text-xl font-bold text-brand text-right"
                />
              </div>
            </div>
          </div>
        )}

        {/* Payment Plan card -- optional, has a sensible default. */}
        {templates.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Payment Plan</p>
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

        {/* Plain, unstuck buttons at the end of the scrollable content --
            not a pinned toolbar, matching how other simple forms in this
            app (CreateLeadModal.jsx) end with an inline button. */}
        {mode === 'create' ? (
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={submitting || cartRows.length === 0}
              className="flex-1 border-2 border-brand text-brand font-bold py-3 rounded-2xl text-sm disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Save as Draft'}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={submitting || cartRows.length === 0}
              className="flex-1 brand-gradient text-white font-bold py-3 rounded-2xl text-sm disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Submit Quotation →'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => handleSave(false)}
            disabled={submitting || cartRows.length === 0}
            className="w-full brand-gradient text-white font-bold py-3 rounded-2xl text-sm disabled:opacity-60"
          >
            {submitting ? 'Saving…' : mode === 'edit-draft' ? 'Save Draft →' : 'Create Revision →'}
          </button>
        )}
      </div>
    </div>
  )
}
