import useAppStore from '@/store/useAppStore'
import { BASE_URL } from '@/api/client'

// Renders this client's uploaded logo, or a 2-letter monogram derived from
// their display name when none is set. Used everywhere the app previously
// hardcoded the "LX" LMNTRIX mark.
//
// An uploaded logo renders at its own natural shape -- no background box, no
// padding -- since the artwork already carries its own shape/backdrop; a
// forced white box around it just adds free space the logo didn't ask for.
// The text monogram fallback is the opposite case: raw text needs a
// background box to read as a mark, so only that branch gets one.
export default function BrandMark({ size = 40, tone = 'white', className = '' }) {
  const branding = useAppStore(s => s.branding)
  const px = `${size}px`

  if (branding.logo) {
    return (
      <img
        src={BASE_URL + branding.logo}
        alt={branding.display_name}
        style={{ width: px, height: px }}
        className={`object-contain flex-shrink-0 ${className}`}
      />
    )
  }

  const boxTone = tone === 'translucent' ? 'bg-white/20 text-white' : 'bg-white text-brand'
  return (
    <span
      style={{ width: px, height: px }}
      className={`flex-shrink-0 flex items-center justify-center font-extrabold ${boxTone} ${className}`}
    >
      {(branding.display_name || 'FCTrail').trim().slice(0, 2).toUpperCase()}
    </span>
  )
}
