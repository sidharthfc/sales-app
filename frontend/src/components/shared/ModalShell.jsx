// Bottom-sheet shell shared by the delivery action modals (CollectPaymentModal,
// DeliverOrderModal): a full-screen transparent backdrop anchoring a white
// rounded-top sheet to the bottom of the viewport, closing when the backdrop
// itself (not the sheet) is tapped.
//
// Not used by EndSessionModal — that modal intentionally uses a different
// shell (dim backdrop, higher z-index, inverted click-outside handling) that
// matches other blocking-dialog modals elsewhere in the app.
//
// Usage:
//   <ModalShell onClose={onClose}>
//     <ModalHeader .../>
//     <div className="px-4 py-4 space-y-4">...</div>
//   </ModalShell>
export default function ModalShell({ onClose, className = '', children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      onClick={e => e.target === e.currentTarget && onClose?.()}
    >
      <div className={`w-full bg-white rounded-t-3xl shadow-2xl ${className}`.trim()}>
        {children}
      </div>
    </div>
  )
}
