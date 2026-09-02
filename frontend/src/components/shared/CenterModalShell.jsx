// Centered-dialog shell -- dim backdrop, a rounded card centered in the
// viewport, closing when the backdrop itself (not the card) is tapped. Used
// where a modal reads more like a document/dialog than a bottom-sheet form
// (e.g. QuotationViewModal, CreateLeadModal, LeadPickerModal). Sibling to
// ModalShell (the bottom-sheet shell) -- pick whichever shell fits the
// modal's content, not a hard rule.
//
// No default overflow/height beyond max-h-[85vh] -- same as ModalShell,
// deliberately unopinionated, so a caller can pass its own scroll strategy
// (a flat "overflow-y-auto" for simple content, or "flex flex-col
// overflow-hidden" with an internal flex-1 scroll region for a modal with
// fixed header/footer bands around a scrolling middle).
//
// Usage:
//   <CenterModalShell onClose={onClose} className="overflow-y-auto">
//     <ModalHeader title="Quotation" onClose={onClose} showHandle={false} />
//     <div className="px-4 py-4 space-y-4">...</div>
//   </CenterModalShell>
export default function CenterModalShell({ onClose, className = '', children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={e => e.target === e.currentTarget && onClose?.()}
    >
      <div className={`w-full max-w-[400px] bg-white rounded-3xl shadow-2xl max-h-[85vh] ${className}`.trim()}>
        {children}
      </div>
    </div>
  )
}
