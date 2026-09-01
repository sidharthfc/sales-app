import { useCallback, useState } from 'react'
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
import { paymentModesWithoutCredit, defaultPaymentMode } from '@/lib/constants'

export default function CollectPaymentModal({ invoice, customer, onClose, onCollected }) {
  // invoice: { invoice, outstanding_amount, overdue, due_date }
  const session                = useAppStore(s => s.session)
  const paymentModes           = paymentModesWithoutCredit(useAppStore(s => s.paymentModes))
  const invalidateTransactions = useAppStore(s => s.invalidateTransactions)
  const outstanding = invoice.outstanding_amount || 0

  const [enteredAmount, setEnteredAmount] = useState(outstanding)
  const [isOver,        setIsOver]        = useState(false)
  const [mode,          setMode]          = useState(() => defaultPaymentMode(paymentModes))
  const [submitting,    setSubmitting]    = useState(false)
  const [done,          setDone]          = useState(null)

  const handleAmountChange = useCallback(({ amount, isOver: over }) => {
    setEnteredAmount(amount)
    setIsOver(over)
  }, [])

  const handleCollect = async () => {
    if (submitting) return
    if (enteredAmount <= 0) { toast.error('Enter a valid amount.'); return }
    if (isOver) { toast.error(`Amount cannot exceed outstanding ₹${fmt(outstanding)}.`); return }

    setSubmitting(true)
    try {
      const result = await api.post(endpoints.collectPayment, {
        customer:        customer.customer,
        amount:          enteredAmount,
        mode_of_payment: mode,
        invoice:         invoice.invoice,
        route_session:   session?.name || null,
      })
      const remaining = Math.max(0, outstanding - enteredAmount)
      setDone({ ...result, remaining })
      showSuccess('Payment collected.')
      invalidateTransactions()
      onCollected?.()
    } catch (err) {
      toast.error(err.message || 'Payment failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <ModalHeader title="Collect Payment" subtitle={invoice.invoice} onClose={onClose} />

      <div className="px-4 py-4 space-y-4">
          {done ? (
            <SuccessPanel heading="Collected!" onDone={onClose}>
              <p className="text-sm text-slate-600">₹{fmt(done.paid_amount)} via {done.mode_of_payment}</p>
              <p className="text-xs text-slate-500 font-mono">{invoice.invoice}</p>
              {done.remaining > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-amber-600 font-semibold">Balance remaining</p>
                  <p className="text-xl font-bold text-amber-700 mt-0.5">
                    ₹{fmt(done.invoice_outstanding_after ?? done.remaining)}
                  </p>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <p className="text-sm font-semibold text-green-700">Invoice fully settled</p>
                </div>
              )}
            </SuccessPanel>
          ) : (
            <>
              <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400">Outstanding</p>
                  <p className="text-xl font-bold text-slate-800">₹{fmt(outstanding)}</p>
                </div>
                {invoice.overdue && (
                  <span className="text-xs font-semibold bg-red-50 text-red-600 px-2.5 py-1 rounded-full">Overdue</span>
                )}
                {!invoice.overdue && invoice.due_date && (
                  <span className="text-xs text-slate-400">Due {invoice.due_date}</span>
                )}
              </div>

              <div className="rounded-xl border border-orange-100 bg-orange-50/60 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-dark">Applying to Invoice</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 font-mono truncate">{invoice.invoice}</p>
                    <p className="text-xs text-slate-500 truncate">{customer.customer_name || customer.customer}</p>
                  </div>
                  <p className="text-sm font-bold text-brand-dark">₹{fmt(outstanding)}</p>
                </div>
              </div>

              <AmountCollectorInput
                outstanding={outstanding}
                disabled={submitting}
                onChange={handleAmountChange}
              />

              <PaymentModeSelector
                value={mode}
                onChange={setMode}
                includeCredit={false}
                disabled={submitting}
              />

              <button
                onClick={handleCollect}
                disabled={submitting || enteredAmount <= 0 || isOver}
                className="w-full bg-brand text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 active:bg-brand-dark"
              >
                {submitting
                  ? <><Spinner size="sm" className="border-white border-t-orange-300" /> Processing…</>
                  : `Collect ₹${enteredAmount > 0 ? fmt(enteredAmount) : '—'}`
                }
              </button>
            </>
          )}
      </div>
    </ModalShell>
  )
}
