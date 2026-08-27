import { X } from 'lucide-react'

// Bottom-sheet modal header with drag handle, title/subtitle, and close button.
//
// Usage:
//   <ModalHeader title="Collect Payment" subtitle="INV-2024-00123" onClose={onClose} />
export default function ModalHeader({ title, subtitle, onClose }) {
  return (
    <>
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-10 h-1 bg-slate-200 rounded-full" />
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div>
          <p className="font-bold text-slate-900">{title}</p>
          {subtitle && <p className="text-xs text-slate-400 font-mono">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100"
        >
          <X className="w-4 h-4 text-slate-500" />
        </button>
      </div>
    </>
  )
}
