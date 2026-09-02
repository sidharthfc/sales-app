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
// Real core Mode of Payment records (Route Sales Settings.payment_modes from
// get_bootstrap/mobile_login) -- not a hardcoded list. Every mode returned by
// the backend is already guaranteed enabled + account-mapped for this
// company, so there's no client-side toggle to apply here.
const MODE_TYPE_ICONS = {
  Cash:  Banknote,
  Bank:  Building2,
  Phone: Smartphone,
}
const DEFAULT_MODE_ICON = CreditCard

// "Credit" (skip payment now, book as receivable) isn't a real core Mode of
// Payment -- selling.py special-cases it separately from
// record_payment_for_invoice. Always available, no per-client toggle.
export const CREDIT_MODE = { key: 'Credit', label: 'Credit', icon: CreditCard }

// modes: [{ name, type }] as returned by the backend.
const toUiModes = (modes) =>
  (modes || []).map(m => ({ key: m.name, label: m.name, icon: MODE_TYPE_ICONS[m.type] || DEFAULT_MODE_ICON }))

export const paymentModesWithCredit    = (modes) => [...toUiModes(modes), CREDIT_MODE]
export const paymentModesWithoutCredit = (modes) => toUiModes(modes)

// Cash wins when present (today's default everywhere); otherwise the first
// mode in the given (already UI-shaped) list.
export const defaultPaymentMode = (uiModes) => uiModes.find(m => m.key === 'Cash')?.key || uiModes[0]?.key || 'Cash'

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

// ── Quotation status (docstatus: 0 draft, 1 submitted/active, 2 cancelled
// -- superseded by a later version, see crm.py's cancel + amend chain) ───────
export const QUOTATION_STATUS_BADGE = {
  0: { label: 'Draft',     cls: 'bg-amber-50 text-amber-600' },
  1: { label: 'Active',    cls: 'bg-brand-50 text-brand-dark' },
  2: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-400' },
}

// ── Brand colors (JS values for inline styles / dynamic class generation) ─────
// For static Tailwind classes prefer the CSS tokens: bg-brand, text-brand-dark, etc.
export const BRAND = {
  DEFAULT: '#E8972A',
  DARK:    '#D4780A',
  LIGHT:   '#F0A030',
  BG_50:   '#FFF1DE',
  BG_100:  '#FFE0B0',
}
