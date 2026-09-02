import { paymentModesWithCredit, paymentModesWithoutCredit } from '@/lib/constants'
import useAppStore from '@/store/useAppStore'

// Grid of payment mode buttons.
//
// Props:
//   value          : str     — selected mode key e.g. 'Cash'
//   onChange       : fn      — called with the new mode key
//   includeCredit  : bool    — show Credit option (default true)
//   disabled       : bool
export default function PaymentModeSelector({ value, onChange, includeCredit = true, disabled = false }) {
  const paymentModes = useAppStore(s => s.paymentModes)
  const modes = includeCredit ? paymentModesWithCredit(paymentModes) : paymentModesWithoutCredit(paymentModes)

  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
        Payment Mode
      </label>
      <div className={`grid gap-2 ${modes.length <= 2 ? 'grid-cols-2' : modes.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {modes.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(key)}
            className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
              value === key
                ? 'border-brand bg-brand-50 text-brand-dark'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
