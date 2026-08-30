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

// Maps a PAYMENT_MODES key to its Route Sales Settings feature flag.
const PAYMENT_MODE_FEATURE_KEYS = {
  Cash:            'enable_cash',
  UPI:             'enable_upi',
  'Bank Transfer': 'enable_bank_transfer',
  Credit:          'enable_credit',
}

// Narrows a PAYMENT_MODES-shaped list down to whatever this client's
// settings enable. Use wherever payment modes are rendered/selected.
export const enabledPaymentModes = (modes, features) =>
  modes.filter(m => features[PAYMENT_MODE_FEATURE_KEYS[m.key]])

// Cash wins when enabled (today's default everywhere); otherwise the first
// mode this client's settings actually allow, from whichever list the
// caller cares about (with or without Credit).
export const defaultPaymentMode = (features, modes = PAYMENT_MODES) =>
  enabledPaymentModes(modes, features)[0]?.key || 'Cash'

// ── Travel modes ──────────────────────────────────────────────────────────────
export const TRAVEL_MODES = ['Company Van', 'Own Vehicle']

// ── Auth storage keys ────────────────────────────────────────────────────────
export const AUTH_STORAGE_KEYS = {
  API_KEY:    'frappe_api_key',
  API_SECRET: 'frappe_api_secret',
}

// ── GPS / location tracking ──────────────────────────────────────────────────
export const GPS_MAX_AGE_MS          = 10000
export const GPS_TIMEOUT_MS          = 15000
export const LOCATION_PUSH_INTERVAL_MS = 30000

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
