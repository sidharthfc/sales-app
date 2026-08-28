import { CheckCircle2 } from 'lucide-react'

// Shared "success" state for the delivery action modals: a green checkmark,
// a heading, modal-specific body content (passed as children), and a Done
// button that closes the modal.
//
// Usage:
//   <SuccessPanel heading="Collected!" onDone={onClose}>
//     <p>...</p>
//   </SuccessPanel>
export default function SuccessPanel({ heading, onDone, padding = 'py-4', children }) {
  return (
    <div className={`text-center ${padding} space-y-3`}>
      <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle2 className="w-8 h-8 text-green-500" />
      </div>
      <p className="font-bold text-slate-900 text-lg">{heading}</p>
      {children}
      <button
        onClick={onDone}
        className="w-full bg-green-500 text-white font-semibold py-3 rounded-xl mt-2"
      >
        Done
      </button>
    </div>
  )
}
