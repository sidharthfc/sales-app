import useAppStore from '@/store/useAppStore'
import { BASE_URL } from '@/api/client'

// Renders this client's uploaded logo, or a 2-letter monogram derived from
// their display name when none is set. Used everywhere the app previously
// hardcoded the "LX" LMNTRIX mark.
export default function BrandMark({ className = '' }) {
  const branding = useAppStore(s => s.branding)

  if (branding.logo) {
    return <img src={BASE_URL + branding.logo} alt={branding.display_name} className={`object-contain ${className}`} />
  }

  return (
    <span className={`font-extrabold ${className}`}>
      {(branding.display_name || 'Route Sales').trim().slice(0, 2).toUpperCase()}
    </span>
  )
}
