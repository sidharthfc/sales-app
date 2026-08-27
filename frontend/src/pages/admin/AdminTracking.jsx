import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, MapPin, WifiOff, Navigation2, Users } from 'lucide-react'
import { GoogleMap, useJsApiLoader, Marker, InfoWindow } from '@react-google-maps/api'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''

const COLORS = [
  '#E8972A', '#10B981', '#3B82F6', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1',
]

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d) ? String(ts) : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export default function AdminTracking() {
  const [reps,    setReps]    = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSalesperson, setActiveSalesperson] = useState(null)
  const mapRef = useRef(null)
  const loadSeqRef = useRef(0)

  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_KEY })

  const load = useCallback(async () => {
    const loadId = ++loadSeqRef.current
    setLoading(true)
    try {
      const d = await api.get(endpoints.adminGetAllLocations)
      if (loadId !== loadSeqRef.current) return
      setReps(Array.isArray(d) ? d : [])
    } catch (err) {
      if (loadId !== loadSeqRef.current) return
      toast.error(err.message || 'Failed to load locations.')
    } finally {
      if (loadId === loadSeqRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  const repsWithLoc = reps.filter(r => r.location?.lat && r.location?.lng)
  const activeRep = activeSalesperson
    ? reps.find(rep => rep.salesperson === activeSalesperson) || null
    : null

  const defaultCenter = repsWithLoc.length > 0
    ? { lat: repsWithLoc[0].location.lat, lng: repsWithLoc[0].location.lng }
    : { lat: 20.5937, lng: 78.9629 }

  const mapCenter = activeRep?.location
    ? { lat: activeRep.location.lat, lng: activeRep.location.lng }
    : defaultCenter

  useEffect(() => {
    if (!activeSalesperson) return
    if (!reps.some(rep => rep.salesperson === activeSalesperson)) {
      setActiveSalesperson(null)
    }
  }, [activeSalesperson, reps])

  return (
    <div className="flex flex-col h-full">

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Navigation2 className="w-4 h-4 text-amber-500" />
          <p className="font-semibold text-slate-700 text-sm">
            {repsWithLoc.length} of {reps.length} active reps tracked
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">auto-refresh 30s</span>
          <button onClick={load} disabled={loading}
            className="admin-icon-button w-8 h-8 bg-slate-50">
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">

        {/* Map */}
        <div className="flex-1 relative">
          {!MAPS_KEY || !isLoaded ? (
            <NoMap reps={reps} />
          ) : (
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={mapCenter}
              zoom={activeRep?.location ? 15 : repsWithLoc.length > 0 ? 12 : 6}
              options={{ disableDefaultUI: false, zoomControl: true, mapTypeControl: false, streetViewControl: false }}
              onLoad={map => { mapRef.current = map }}
            >
              {repsWithLoc.map((rep, idx) => (
                <Marker
                  key={rep.salesperson}
                  position={{ lat: rep.location.lat, lng: rep.location.lng }}
                  title={rep.salesperson_name}
                  onClick={() => setActiveSalesperson(rep.salesperson)}
                  icon={{
                    path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
                    fillColor: COLORS[idx % COLORS.length],
                    fillOpacity: 1,
                    strokeColor: '#fff',
                    strokeWeight: 2,
                    scale: 1.8,
                    anchor: { x: 12, y: 22 },
                  }}
                />
              ))}

              {activeRep?.location && (
                <InfoWindow
                  position={{ lat: activeRep.location.lat, lng: activeRep.location.lng }}
                  onCloseClick={() => setActiveSalesperson(null)}
                >
                  <div className="p-1 min-w-[140px]">
                    <p className="font-bold text-slate-800 text-sm">{activeRep.salesperson_name}</p>
                    {activeRep.route_name && <p className="text-xs text-slate-500 mt-0.5">{activeRep.route_name}</p>}
                    <p className="text-xs text-slate-500 mt-1">
                      Visits: <span className="font-semibold text-slate-700">{activeRep.visits_done}/{activeRep.visits_total}</span>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Last ping: {fmtTime(activeRep.location.timestamp)}
                      {activeRep.location.accuracy ? ` · ±${Math.round(activeRep.location.accuracy)}m` : ''}
                    </p>
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          )}
        </div>

        {/* Side panel */}
        <aside className="hidden md:flex flex-col w-64 bg-white border-l border-slate-100 overflow-y-auto flex-shrink-0">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Active Reps</p>
          </div>
          {reps.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 p-6 text-center">
              <Users className="w-8 h-8 text-slate-200" />
              <p className="text-sm">No active sessions</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {reps.map((rep, idx) => (
                <button
                  key={rep.salesperson}
                  onClick={() => {
                    setActiveSalesperson(rep.salesperson)
                    if (rep.location && mapRef.current) {
                      mapRef.current.panTo({ lat: rep.location.lat, lng: rep.location.lng })
                      mapRef.current.setZoom(15)
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left ${activeSalesperson === rep.salesperson ? 'bg-amber-50' : ''}`}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: COLORS[idx % COLORS.length] + '22' }}>
                    <span className="text-xs font-bold" style={{ color: COLORS[idx % COLORS.length] }}>
                      {rep.salesperson_name?.[0]?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{rep.salesperson_name}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {rep.route_name || rep.salesperson}
                    </p>
                    <p className="text-[11px] mt-0.5">
                      {rep.location
                        ? <span className="text-green-600 font-medium">● {fmtTime(rep.location.timestamp)}</span>
                        : <span className="text-slate-300">No signal</span>
                      }
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold text-slate-700">{rep.visits_done}</p>
                    <p className="text-[10px] text-slate-400">visited</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* Mobile rep list */}
      <div className="md:hidden bg-white border-t border-slate-100 max-h-48 overflow-y-auto flex-shrink-0">
        {reps.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">No active sessions</p>
        ) : (
          <div className="flex gap-2 p-3 overflow-x-auto">
              {reps.map((rep, idx) => (
                <button key={rep.salesperson}
                onClick={() => setActiveSalesperson(activeSalesperson === rep.salesperson ? null : rep.salesperson)}
                className={`flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl border text-center transition-colors ${
                  activeSalesperson === rep.salesperson ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: COLORS[idx % COLORS.length] + '33' }}>
                  <span className="text-xs font-bold" style={{ color: COLORS[idx % COLORS.length] }}>
                    {rep.salesperson_name?.[0]?.toUpperCase()}
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-slate-700 max-w-[64px] truncate">{rep.salesperson_name?.split(' ')?.[0] ?? ''}</p>
                <p className="text-[10px] text-slate-400">
                  {rep.location ? <span className="text-green-600">●</span> : <span className="text-slate-300">●</span>}
                  {' '}{rep.visits_done}v
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function NoMap({ reps }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 bg-slate-50 p-6">
      <WifiOff className="w-10 h-10 text-slate-300" />
      <div className="text-center">
        <p className="font-semibold text-slate-600">Google Maps not configured</p>
        <p className="text-xs text-slate-400 mt-1">Set VITE_GOOGLE_MAPS_KEY to enable live map</p>
      </div>
      {reps.length > 0 && (
        <div className="w-full max-w-sm space-y-2 mt-2">
          {reps.map(rep => (
            <div key={rep.salesperson} className="admin-surface-soft px-4 py-3 flex items-center gap-3">
              <MapPin className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">{rep.salesperson_name}</p>
                {rep.location
                  ? <p className="text-xs text-slate-400">{rep.location.lat.toFixed(5)}, {rep.location.lng.toFixed(5)}</p>
                  : <p className="text-xs text-slate-300">No location signal</p>
                }
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
