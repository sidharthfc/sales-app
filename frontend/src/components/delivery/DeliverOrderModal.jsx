import { useCallback, useEffect, useMemo, useState } from 'react'
import { Truck, Plus, Minus } from 'lucide-react'
import { toast } from 'sonner'
import { showSuccess } from '@/lib/toastStore'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import Spinner from '@/components/shared/Spinner'
import ModalShell from '@/components/shared/ModalShell'
import SuccessPanel from '@/components/shared/SuccessPanel'
import ModalHeader from '@/components/ui/ModalHeader'
import AmountCollectorInput from '@/components/ui/AmountCollectorInput'
import PaymentModeSelector from '@/components/ui/PaymentModeSelector'
import { fmt } from '@/lib/format'
import { paymentModesWithCredit, defaultPaymentMode } from '@/lib/constants'

export default function DeliverOrderModal({ order, onClose, onDelivered }) {
  // order: { sales_order, date, grand_total, status, items: [{item_code, item_name, pending_qty, rate, uom}] }
  const session             = useAppStore(s => s.session)
  const paymentModes        = paymentModesWithCredit(useAppStore(s => s.paymentModes))
  const invalidateData = useAppStore(s => s.invalidateData)

  const [deliveryItems, setDeliveryItems] = useState([])
  const [stockLoading,  setStockLoading]  = useState(false)
  const [mode,          setMode]          = useState(() => defaultPaymentMode(paymentModes))
  const [enteredAmount, setEnteredAmount] = useState(0)
  const [amountIsOver,    setAmountIsOver]    = useState(false)
  const [amountIsPartial, setAmountIsPartial] = useState(false)
  const [submitting,    setSubmitting]    = useState(false)
  const [done,          setDone]          = useState(null)   // { invoice, grand_total, payment_recorded }
  const [partialDN,     setPartialDN]     = useState(null)   // DN name when step 1 ok but step 2 failed

  const outstanding = useMemo(
    () => deliveryItems.reduce((sum, item) => sum + ((item.qty || 0) * (item.rate || 0)), 0),
    [deliveryItems]
  )
  const remaining  = Math.max(0, outstanding - enteredAmount)
  // AmountCollectorInput isn't rendered at all in Credit mode, so its reported
  // isOver/isPartial go stale as soon as mode switches away — mask them here
  // exactly as before so Credit mode always reads as "not over/not partial".
  const isPartial  = mode !== 'Credit' && amountIsPartial
  const isOver     = mode !== 'Credit' && amountIsOver

  const handleAmountChange = useCallback(({ amount, isOver: over, isPartial: partial }) => {
    setEnteredAmount(amount)
    setAmountIsOver(over)
    setAmountIsPartial(partial)
  }, [])

  useEffect(() => {
    const nextItems = (order.items || []).map((item) => ({
      ...item,
      qty:    item.pending_qty || 0,
      maxQty: item.pending_qty || 0,
    }))
    setDeliveryItems(nextItems)
    setDone(null)
    setPartialDN(null)
  }, [order.items, order.sales_order])

  useEffect(() => {
    let cancelled = false
    if (!session?.name) return undefined

    setStockLoading(true)
    api.get(endpoints.getSessionStock, { params: { route_session: session.name } })
      .then((data) => {
        if (cancelled) return
        const stockMap = new Map((data?.items || []).map((item) => [item.item_code, item.qty_remaining || 0]))
        setDeliveryItems((prev) => prev.map((item) => {
          const vanQty  = stockMap.has(item.item_code) ? Number(stockMap.get(item.item_code) || 0) : item.pending_qty || 0
          const maxQty  = Math.max(0, Math.min(item.pending_qty || 0, vanQty))
          const current = Number(item.qty) || 0
          return { ...item, maxQty, qty: Math.min(current, maxQty) }
        }))
      })
      .catch(() => {
        // Keep order pending quantities as a fallback if stock fetch fails.
      })
      .finally(() => { if (!cancelled) setStockLoading(false) })

    return () => { cancelled = true }
  }, [session?.name, order.sales_order])

  const updateDeliveryQty = (itemCode, nextValue) => {
    setDeliveryItems((prev) => prev.map((item) => {
      if (item.item_code !== itemCode) return item
      if (nextValue === '') return { ...item, qty: '' }
      const parsed = Number(nextValue)
      if (!Number.isFinite(parsed)) return item
      return { ...item, qty: Math.max(0, Math.min(parsed, item.maxQty ?? item.pending_qty ?? 0)) }
    }))
  }

  const bumpDeliveryQty = (itemCode, delta) => {
    setDeliveryItems((prev) => prev.map((item) => {
      if (item.item_code !== itemCode) return item
      const current = Number(item.qty) || 0
      return { ...item, qty: Math.max(0, Math.min(current + delta, item.maxQty ?? item.pending_qty ?? 0)) }
    }))
  }

  const handleDeliver = async () => {
    if (submitting) return
    const selectedItems = deliveryItems
      .map((item) => ({ item_code: item.item_code, qty: Number(item.qty) || 0 }))
      .filter((item) => item.qty > 0)
    if (!selectedItems.length) { toast.error('Select at least one item quantity to deliver.'); return }
    if (mode !== 'Credit') {
      if (enteredAmount <= 0) { toast.error('Enter a valid amount to collect.'); return }
      if (isOver) { toast.error(`Amount cannot exceed invoice total ₹${fmt(outstanding)}.`); return }
    }

    setSubmitting(true)
    let dnName = partialDN  // reuse existing DN if retrying after step-2 failure
    try {
      // Step 1 — create delivery note (idempotent: returns existing unbilled DN on retry)
      if (!dnName) {
        const dn = await api.post(endpoints.createDeliveryNote, {
          sales_order:   order.sales_order,
          items:         selectedItems,
          route_session: session?.name || null,
        })
        dnName = dn.delivery_note
        setPartialDN(dnName)
      }
      // Step 2 — create invoice from delivery note + record payment
      const result = await api.post(endpoints.createInvoiceFromDelivery, {
        delivery_note:     dnName,
        mode_of_payment:   mode,
        amount_to_collect: mode === 'Credit' ? 0 : enteredAmount,
      })
      setPartialDN(null)
      setDone(result)
      if (result.submit_error) {
        toast.warning(`Delivered, but invoice is in draft. Contact manager. (${result.invoice})`)
      } else {
        showSuccess('Delivered & billed.')
      }
      invalidateData()
      onDelivered?.()
    } catch (err) {
      if (dnName) {
        toast.error(`Billing failed (DN: ${dnName}). Tap again to retry billing only.`)
      } else {
        toast.error(err.message || 'Delivery failed.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onClose={onClose} className="max-h-[85vh] flex flex-col">
      <div className="flex-shrink-0">
        <ModalHeader title="Deliver Order" subtitle={order.sales_order} onClose={onClose} />
      </div>

      <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">
          {done ? (
            <SuccessPanel heading="Delivered!" onDone={onClose} padding="py-6">
              <p className="text-sm text-slate-500">{done.invoice} · ₹{fmt(done.grand_total)}</p>
              <p className="text-xs text-slate-400">
                {done.payment_recorded
                  ? `Payment recorded · ₹${fmt(done.collected_amount || done.grand_total)} collected`
                  : mode === 'Credit' ? 'Credit — payment pending' : 'Payment not recorded'}
              </p>
            </SuccessPanel>
          ) : (
            <>
              {/* Items list */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Items to Deliver</p>
                <div className="space-y-1.5">
                  {deliveryItems.map(item => (
                    <div key={item.item_code} className="flex items-center justify-between gap-2 bg-slate-50 rounded-xl px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{item.item_name}</p>
                        <p className="text-xs text-slate-400">{item.item_code}</p>
                        <p className="mt-1 text-[10px] text-slate-400">
                          Pending {item.pending_qty} {item.uom} · Van {item.maxQty ?? item.pending_qty} {item.uom}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button type="button" onClick={() => bumpDeliveryQty(item.item_code, -1)}
                          className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <div className="w-20">
                          <input
                            type="number" min="0" max={item.maxQty ?? item.pending_qty ?? 0}
                            value={item.qty ?? 0}
                            onChange={(e) => updateDeliveryQty(item.item_code, e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm font-semibold text-slate-700 focus:outline-none focus:border-brand"
                          />
                          <p className="mt-1 text-center text-[10px] text-slate-400">max {item.maxQty ?? item.pending_qty} {item.uom}</p>
                        </div>
                        <button type="button" onClick={() => bumpDeliveryQty(item.item_code, 1)}
                          className="w-8 h-8 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {stockLoading && <p className="text-xs text-slate-400">Refreshing van stock…</p>}

              <div className="flex items-center justify-between bg-brand-50 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-slate-700">Total</p>
                <p className="text-lg font-bold text-brand-dark">₹{fmt(order.grand_total)}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Collection Summary</p>
                <p className="mt-1 text-sm text-slate-700">
                  {mode === 'Credit'
                    ? 'This will create the invoice without collecting payment now.'
                    : isPartial
                      ? `This will create the invoice and collect ₹${fmt(enteredAmount)} now. ₹${fmt(remaining)} will remain pending.`
                      : `This will create the invoice and collect the exact invoice total of ₹${fmt(outstanding)}.`
                  }
                </p>
              </div>

              {mode !== 'Credit' && (
                <AmountCollectorInput
                  outstanding={outstanding}
                  disabled={submitting}
                  onChange={handleAmountChange}
                />
              )}

              <PaymentModeSelector
                value={mode}
                onChange={setMode}
                includeCredit={true}
                disabled={submitting}
              />

              <button
                onClick={handleDeliver}
                disabled={submitting || (mode !== 'Credit' && (enteredAmount <= 0 || isOver))}
                className="w-full brand-gradient text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 active:bg-brand-dark"
              >
                {submitting
                  ? <><Spinner size="sm" className="border-white border-t-brand-300" /> Processing…</>
                  : <><Truck className="w-4 h-4" /> {mode === 'Credit' ? 'Bill Only' : 'Bill & Collect'}</>
                }
              </button>
            </>
          )}
      </div>
    </ModalShell>
  )
}
