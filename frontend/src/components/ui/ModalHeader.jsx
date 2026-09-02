import { X } from 'lucide-react'

// Modal header with title/subtitle and close button. Shows a drag handle by
// default (the bottom-sheet affordance used by ModalShell-based modals) --
// pass showHandle={false} for a CenterModalShell-based modal, where a drag
// handle would be a meaningless leftover.
//
// brand-gradient background (matching PageHeader/AdminShell/every other
// header in the app) with its own rounded-t-3xl -- both CenterModalShell and
// ModalShell use that same radius, and neither shell guarantees it clips an
// unrounded child itself (overflow is left to the caller), so this rounds
// its own top corners rather than depending on that.
//
// Usage:
//   <ModalHeader title="Collect Payment" subtitle="INV-2024-00123" onClose={onClose} />
//   <ModalHeader title="Quotation" onClose={onClose} showHandle={false} />
export default function ModalHeader({ title, subtitle, onClose, showHandle = true }) {
  return (
    <div className="brand-gradient rounded-t-3xl flex-shrink-0">
      {showHandle && (
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-white/40 rounded-full" />
        </div>
      )}
      <div className={`flex items-center justify-between px-4 ${showHandle ? 'pb-3' : 'py-3'}`}>
        <div>
          <p className="font-bold text-white">{title}</p>
          {subtitle && <p className="text-xs text-white/70 font-mono">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20"
        >
          <X className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  )
}
