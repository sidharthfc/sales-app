// Overrides the brand color tokens Tailwind v4's @theme block registers as
// real CSS custom properties on :root (see index.css). Every bg-brand /
// text-brand-dark / etc. utility already resolves through var(--color-brand)
// at generation time, so setting these here cascades everywhere with no
// per-component changes needed.

function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '')
  const full  = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  const int   = parseInt(full, 16)
  if (full.length !== 6 || Number.isNaN(int)) return null
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

function toHex({ r, g, b }) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)))
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('')
}

// Mixes a color toward white by `amount` (0 = unchanged, 1 = white) — used
// to derive the lighter tint/tile-background variants from just the one
// primary color a client configures, instead of leaving them stuck at the
// original orange.
function lighten(hex, amount) {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return toHex({
    r: rgb.r + (255 - rgb.r) * amount,
    g: rgb.g + (255 - rgb.g) * amount,
    b: rgb.b + (255 - rgb.b) * amount,
  })
}

export function applyBrandTheme({ primary_color, accent_color } = {}) {
  if (typeof document === 'undefined') return
  const root = document.documentElement.style
  if (!hexToRgb(primary_color)) return // malformed/missing — leave the built-in defaults alone

  root.setProperty('--color-brand', primary_color)
  // -dark is always an auto-darkened primary, not the raw accent -- it backs
  // small UI elements (badges, borders, hover states) that need to read as
  // "darker than primary", and a client's accent_color can be lighter than
  // primary (e.g. Faircode's own mint accent vs. its blue primary), which
  // would look backwards there. -accent carries the raw, un-modified accent
  // hue instead, used only where real two-color contrast is wanted (see
  // .brand-gradient in index.css) -- that's the one place an accent that's
  // lighter, or a different hue entirely, is exactly the point.
  root.setProperty('--color-brand-dark', lighten(primary_color, -0.15 /* darken */))
  root.setProperty('--color-brand-accent', accent_color && hexToRgb(accent_color) ? accent_color : lighten(primary_color, -0.15))
  root.setProperty('--color-brand-light', lighten(primary_color, 0.15))
  root.setProperty('--color-brand-50', lighten(primary_color, 0.92))
  root.setProperty('--color-brand-100', lighten(primary_color, 0.82))
  root.setProperty('--color-brand-200', lighten(primary_color, 0.65))
  root.setProperty('--color-brand-300', lighten(primary_color, 0.50))
}
