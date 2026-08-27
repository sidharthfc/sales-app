import { Banknote, Smartphone, Building2, CreditCard } from 'lucide-react'

// ── Pagination ────────────────────────────────────────────────────────────────
export const PAGE_SIZE        = 50
export const PAGE_SIZE_SEARCH = 20
export const PAGE_SIZE_RECENT = 3

// ── Visit status ──────────────────────────────────────────────────────────────
export const VISIT_STATUS = {
  VISITED: 'Visited',
  SKIPPED: 'Skipped',
  CLOSED:  'Closed',
  PENDING: 'Pending',
}

// ── Payment modes ─────────────────────────────────────────────────────────────
// Single source of truth — previously defined 3 different ways across Sales.jsx,
// CollectPaymentModal.jsx, and DeliverOrderModal.jsx.
export const PAYMENT_MODES = [
  { key: 'Cash',          label: 'Cash',          icon: Banknote  },
  { key: 'UPI',           label: 'UPI',           icon: Smartphone },
  { key: 'Bank Transfer', label: 'Bank Transfer', icon: Building2 },
  { key: 'Credit',        label: 'Credit',        icon: CreditCard },
]

// Modes that exclude the Credit option (for standalone payment collection).
export const PAYMENT_MODES_NO_CREDIT = PAYMENT_MODES.filter(m => m.key !== 'Credit')

// ── Order / delivery statuses ─────────────────────────────────────────────────
export const PENDING_DELIVERY_STATUSES = ['To Deliver and Bill', 'To Deliver', 'Partly Delivered']
export const COMPLETED_ORDER_STATUSES  = ['Completed', 'Closed']

// ── Brand colors (JS values for inline styles / dynamic class generation) ─────
// For static Tailwind classes prefer the CSS tokens: bg-brand, text-brand-dark, etc.
export const BRAND = {
  DEFAULT: '#E8972A',
  DARK:    '#D4780A',
  LIGHT:   '#F0A030',
  BG_50:   '#FFF1DE',
  BG_100:  '#FFE0B0',
}
