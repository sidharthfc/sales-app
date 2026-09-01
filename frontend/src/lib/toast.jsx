import { Check } from 'lucide-react'
import { useSuccessPopupStore } from '@/lib/toastStore'

// Mounted once at the app root (see App.jsx, alongside <Toaster/>).
export function SuccessPopup() {
  const message = useSuccessPopupStore(s => s.message)
  const visible = useSuccessPopupStore(s => s.visible)
  if (!message) return null

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center pointer-events-none transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className={`bg-white rounded-3xl shadow-2xl px-6 py-6 flex flex-col items-center gap-2.5 max-w-[220px] transition-transform duration-200 ${
          visible ? 'scale-100' : 'scale-90'
        }`}
      >
        <div className="brand-gradient w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
          <Check className="w-6 h-6 text-white" strokeWidth={3} />
        </div>
        <p className="text-sm font-semibold text-slate-800 text-center leading-snug">{message}</p>
      </div>
    </div>
  )
}
