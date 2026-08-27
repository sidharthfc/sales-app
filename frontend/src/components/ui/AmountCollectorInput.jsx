import { useEffect, useRef, useState } from 'react'
import { PencilLine, Lock } from 'lucide-react'
import { fmt } from '@/lib/format'

// Amount input used in payment collection and delivery modals.
// Supports edit/lock toggle, preset buttons, and over-limit validation.
//
// Props:
//   outstanding : number  — maximum collectable amount
//   disabled    : bool
//   onChange    : fn(amount: number)  — called when the entered amount changes
export default function AmountCollectorInput({ outstanding, disabled = false, onChange }) {
  const [amount,          setAmount]          = useState(String(outstanding || 0))
  const [isEditing,       setIsEditing]       = useState(false)
  const inputRef = useRef(null)

  const enteredAmount = parseFloat(amount) || 0
  const remaining     = outstanding - enteredAmount
  const isOver        = enteredAmount > outstanding
  const isPartial     = enteredAmount > 0 && enteredAmount < outstanding

  useEffect(() => {
    setAmount(String(outstanding || 0))
  }, [outstanding])

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  useEffect(() => {
    onChange?.(enteredAmount)
  }, [enteredAmount])

  const handleChange = (val) => {
    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) setAmount(val)
  }

  const handleBlur = () => {
    const parsed = parseFloat(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setAmount(String(outstanding))
    } else {
      setAmount(String(Number(Math.min(parsed, outstanding).toFixed(2))))
    }
    setIsEditing(false)
  }

  const preset = (val) => { setAmount(String(val)); setIsEditing(false) }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Amount to Collect
        </label>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-brand-dark disabled:opacity-60"
        >
          <PencilLine className="h-3.5 w-3.5" />
          Edit
        </button>
      </div>

      <div className="relative">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-semibold text-lg">₹</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={e => handleChange(e.target.value)}
          onBlur={handleBlur}
          readOnly={!isEditing}
          disabled={disabled}
          placeholder="0"
          className={`w-full rounded-xl border-2 pl-9 pr-12 py-3 text-xl font-bold text-slate-900 focus:outline-none disabled:opacity-60 ${
            isEditing ? 'border-brand bg-white' : 'border-slate-200 bg-slate-50'
          }`}
        />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
          {isEditing ? <PencilLine className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </span>
      </div>

      <p className="mt-1.5 text-[11px] text-slate-500">
        {isEditing
          ? 'Edit the amount for a partial collection.'
          : 'Tap Edit to change the amount.'}
      </p>

      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={() => preset(outstanding)}
          className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-orange-50 text-brand-dark border border-orange-200"
        >
          Full ₹{fmt(outstanding)}
        </button>
        <button
          type="button"
          onClick={() => preset(Math.round(outstanding / 2))}
          className="flex-1 text-xs font-semibold py-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-200"
        >
          Half ₹{fmt(Math.round(outstanding / 2))}
        </button>
      </div>

      {enteredAmount > 0 && !isOver && (
        <div className={`mt-2 rounded-lg px-3 py-2 text-xs font-medium ${
          isPartial ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
        }`}>
          {isPartial
            ? `Partial payment — ₹${fmt(remaining)} will remain outstanding`
            : 'Full payment — invoice will be settled'}
        </div>
      )}
      {isOver && (
        <p className="mt-2 text-xs text-red-500 font-medium">Amount exceeds outstanding balance</p>
      )}
    </div>
  )
}
