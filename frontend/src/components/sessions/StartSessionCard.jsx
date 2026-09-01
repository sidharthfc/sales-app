import { useState, useEffect, useRef } from 'react'
import { Play, MapPin, Truck, Car, ChevronDown, Camera, X, Gauge, Search, Plus, Minus, Package } from 'lucide-react'
import { toast } from 'sonner'
import { showSuccess } from '@/lib/toastStore'
import api, { endpoints, uploadPhoto } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import Spinner from '@/components/shared/Spinner'
import StepDots from '@/components/shared/StepDots'
import { useSearch } from '@/lib/hooks'
import { TRAVEL_MODES } from '@/lib/constants'

export default function StartSessionCard({ assignment, onStarted }) {
  const user = useAppStore(s => s.user)

  const [step, setStep] = useState(0)

  // Step 0 state
  const [travelMode,    setTravelMode]    = useState('Company Van')
  const [vehicle,       setVehicle]       = useState(assignment?.vehicle || '')
  const [ownVehicleNo,  setOwnVehicleNo]  = useState('')
  const [vehicles,      setVehicles]      = useState([])
  const [odoStart,      setOdoStart]      = useState('')
  const [odoPhoto,      setOdoPhoto]      = useState(null)
  const [odoPreview,    setOdoPreview]    = useState(null)
  const [loadingStart,  setLoadingStart]  = useState(false)
  const [startedSession, setStartedSession] = useState(null)

  // Step 1 state (van stock)
  // Debounced via useSearch — searchItemsForVan is a real API call per
  // keystroke, unlike pages that just filter an already-loaded in-memory list.
  const { query: stockSearch, debouncedQuery: debouncedStockSearch, setQuery: setStockSearchQuery, reset: resetStockSearch } = useSearch(300)
  const [searchResults,     setSearchResults]     = useState([])
  const [searching,         setSearching]         = useState(false)
  const [stockItems,        setStockItems]        = useState([])   // [{ item_code, item_name, stock_uom, qty, suggested }]
  const [savingStock,       setSavingStock]       = useState(false)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [suggestionMeta,    setSuggestionMeta]    = useState(null)  // { total_orders }

  const cameraRef = useRef(null)

  useEffect(() => {
    api.get(endpoints.getVehicles)
      .then(data => setVehicles(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const handlePhotoCapture = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setOdoPhoto(file)
    const reader = new FileReader()
    reader.onload = () => setOdoPreview(reader.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const clearPhoto = () => {
    setOdoPhoto(null)
    setOdoPreview(null)
  }

  const handleStartSession = async () => {
    if (!assignment) { toast.error('No route assignment found for today.'); return }
    if (!user?.salesperson) { toast.error('Salesperson not set. Please log in again.'); return }

    const finalVehicle = travelMode === 'Own Vehicle'
      ? ownVehicleNo.trim() || null
      : vehicle || null

    setLoadingStart(true)
    try {
      let photoUrl = null
      if (odoPhoto) photoUrl = await uploadPhoto(odoPhoto)

      const result = await api.post(endpoints.startSession, {
        salesperson:          user.salesperson,
        route_assignment:     assignment.name,
        travel_mode:          travelMode,
        vehicle:              finalVehicle,
        odometer_start:       odoStart ? parseInt(odoStart, 10) : null,
        odometer_start_photo: photoUrl,
      })

      setStartedSession(result)

      // Load stock suggestions from pending orders on the route
      setLoadingSuggestions(true)
      try {
        const suggestion = await api.get(endpoints.getRouteStockSuggestion, {
          params: { route_assignment: assignment.name },
        })
        if (suggestion?.items?.length > 0) {
          setStockItems(suggestion.items.map(i => ({
            item_code:  i.item_code,
            item_name:  i.item_name,
            stock_uom:  i.stock_uom,
            qty:        i.suggested_qty,
            suggested:  true,
            order_count: i.order_count,
          })))
          setSuggestionMeta({ total_orders: suggestion.total_orders })
        }
      } catch {
        // suggestions are non-critical — salesperson can add manually
      } finally {
        setLoadingSuggestions(false)
      }

      setStep(1)
    } catch (err) {
      toast.error(err.message || 'Failed to start session.')
    } finally {
      setLoadingStart(false)
    }
  }

  const handleStockSearch = (val) => {
    setStockSearchQuery(val)
    // Clear the dropdown immediately on empty input rather than waiting out
    // the debounce — matches the previous synchronous-clear behavior.
    if (!val.trim()) setSearchResults([])
  }

  useEffect(() => {
    if (!debouncedStockSearch) { setSearching(false); return }
    let cancelled = false
    setSearching(true)
    api.get(endpoints.searchItemsForVan, { params: { search: debouncedStockSearch, limit: 20 } })
      .then((data) => { if (!cancelled) setSearchResults(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setSearchResults([]) })
      .finally(() => { if (!cancelled) setSearching(false) })
    return () => { cancelled = true }
  }, [debouncedStockSearch])

  const addStockItem = (item) => {
    setStockItems(prev => {
      if (prev.find(i => i.item_code === item.item_code)) return prev
      return [...prev, { ...item, qty: 1 }]
    })
    resetStockSearch()
    setSearchResults([])
  }

  const updateQty = (item_code, val) => {
    const n = parseInt(val, 10)
    if (val === '' || val === '0' || isNaN(n) || n <= 0) {
      setStockItems(prev => prev.filter(i => i.item_code !== item_code))
      return
    }
    setStockItems(prev => prev.map(i => i.item_code === item_code ? { ...i, qty: n } : i))
  }

  const adjustQty = (item_code, delta) => {
    setStockItems(prev => prev.map(i => {
      if (i.item_code !== item_code) return i
      const next = (i.qty || 0) + delta
      return next <= 0 ? null : { ...i, qty: next }
    }).filter(Boolean))
  }

  const handleFinish = async () => {
    if (stockItems.length > 0 && startedSession) {
      setSavingStock(true)
      try {
        await api.post(endpoints.saveSessionStock, {
          route_session: startedSession.session,
          items: stockItems.map(i => ({ item_code: i.item_code, qty_loaded: i.qty })),
        })
      } catch (err) {
        toast.error('Stock save failed: ' + (err.message || 'Unknown error'))
      } finally {
        setSavingStock(false)
      }
    }
    showSuccess('Session started.')
    onStarted(startedSession)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
          <Play className="w-5 h-5 text-brand-dark" />
        </div>
        <div>
          <p className="font-semibold text-slate-900">Start Your Day</p>
          <p className="text-xs text-slate-400">Session not started yet</p>
        </div>
      </div>

      <StepDots step={step} total={2} className="mb-4" />

      {step === 0 && (
        <>
          {assignment && (
            <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-brand flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-800">{assignment.route_name || assignment.route}</p>
                <p className="text-xs text-slate-500">{assignment.name}</p>
              </div>
            </div>
          )}

          {/* Travel mode */}
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-2">Travel Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {TRAVEL_MODES.map(m => (
                <button
                  key={m}
                  onClick={() => setTravelMode(m)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                    travelMode === m
                      ? 'border-brand bg-orange-50 text-brand-dark'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  {m === 'Company Van' ? <Truck className="w-3.5 h-3.5" /> : <Car className="w-3.5 h-3.5" />}
                  {m}
                </button>
              ))}
            </div>
          </div>

          {travelMode === 'Company Van' && (
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">Select Vehicle</label>
              <div className="relative">
                <select
                  value={vehicle}
                  onChange={e => setVehicle(e.target.value)}
                  className="w-full appearance-none border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 bg-white outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                >
                  <option value="">— Select a vehicle —</option>
                  {vehicles.map(v => (
                    <option key={v.name} value={v.name}>{v.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
              {vehicles.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">All company vehicles are currently in use.</p>
              )}
            </div>
          )}

          {travelMode === 'Own Vehicle' && (
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">
                Vehicle Number <span className="text-slate-400">(optional)</span>
              </label>
              <input
                placeholder="e.g. KL-07-AB-1234"
                value={ownVehicleNo}
                onChange={e => setOwnVehicleNo(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
          )}

          {/* Odometer */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5" /> Odometer at Start
            </p>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1.5">
                Reading (km) <span className="text-slate-400">(optional)</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                placeholder="e.g. 45230"
                value={odoStart}
                onChange={e => setOdoStart(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
              />
            </div>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhotoCapture}
            />
            {odoPreview ? (
              <div className="relative w-full">
                <img src={odoPreview} alt="Odometer" className="w-full h-32 object-cover rounded-xl border border-slate-200" />
                <button onClick={clearPhoto} className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
                  <X className="w-4 h-4 text-white" />
                </button>
                <p className="text-xs text-slate-500 mt-1 text-center">Odometer photo captured</p>
              </div>
            ) : (
              <button
                onClick={() => cameraRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-200 rounded-xl py-3 flex items-center justify-center gap-2 text-sm text-slate-500 active:bg-slate-50"
              >
                <Camera className="w-4 h-4" />
                Capture Odometer Photo
              </button>
            )}
          </div>

          <button
            onClick={handleStartSession}
            disabled={loadingStart}
            className="w-full bg-brand text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:bg-brand-dark disabled:opacity-60 transition-colors"
          >
            {loadingStart ? <Spinner size="sm" className="border-white border-t-orange-300" /> : <Play className="w-4 h-4" />}
            {loadingStart ? 'Starting…' : 'Start Session'}
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <div className="text-center space-y-1 pb-1">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center mx-auto">
              <Package className="w-5 h-5 text-green-600" />
            </div>
            <p className="font-semibold text-slate-900">Van Stock Loading</p>
            <p className="text-xs text-slate-500">Review suggested quantities and adjust before leaving</p>
          </div>

          {loadingSuggestions && (
            <div className="flex items-center justify-center gap-2 py-2 text-xs text-slate-400">
              <Spinner size="sm" /> Loading suggestions from pending orders…
            </div>
          )}

          {suggestionMeta && !loadingSuggestions && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
              <Package className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-700 font-medium">
                Pre-filled from <span className="font-bold">{suggestionMeta.total_orders} pending orders</span> on your route. Adjust quantities as needed.
              </p>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={stockSearch}
              onChange={e => handleStockSearch(e.target.value)}
              placeholder="Search items to add…"
              className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
            {searching && <Spinner size="sm" className="absolute right-3 top-1/2 -translate-y-1/2" />}
          </div>

          {/* Search results dropdown */}
          {searchResults.length > 0 && (
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-48 overflow-y-auto -mt-2">
              {searchResults.map(item => (
                <button
                  key={item.item_code}
                  onClick={() => addStockItem(item)}
                  className="w-full text-left px-3 py-2.5 flex items-center justify-between active:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">{item.item_name}</p>
                    <p className="text-xs text-slate-400">{item.item_code} · {item.stock_uom}</p>
                  </div>
                  <Plus className="w-4 h-4 text-brand flex-shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Added items list */}
          {stockItems.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Items to Load ({stockItems.length})</p>
              {stockItems.map(item => (
                <div key={item.item_code} className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.item_name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-slate-400">{item.stock_uom}</p>
                      {item.suggested && (
                        <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                          {item.order_count} order{item.order_count > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => adjustQty(item.item_code, -1)}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center active:bg-slate-100"
                    >
                      <Minus className="w-3.5 h-3.5 text-slate-600" />
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={item.qty}
                      onChange={e => updateQty(item.item_code, e.target.value)}
                      className="w-14 text-center border border-slate-200 rounded-lg py-1 text-sm font-semibold bg-white focus:outline-none focus:border-brand"
                    />
                    <button
                      onClick={() => adjustQty(item.item_code, 1)}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center active:bg-slate-100"
                    >
                      <Plus className="w-3.5 h-3.5 text-slate-600" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-slate-400">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No items added yet</p>
              <p className="text-xs mt-0.5">Search above to add items you're loading</p>
            </div>
          )}

          <button
            onClick={handleFinish}
            disabled={savingStock}
            className="w-full bg-brand text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:bg-brand-dark disabled:opacity-60 transition-colors"
          >
            {savingStock ? <Spinner size="sm" className="border-white border-t-orange-300" /> : <Play className="w-4 h-4" />}
            {savingStock ? 'Saving…' : stockItems.length > 0 ? `Start Route (${stockItems.length} items)` : 'Start Route'}
          </button>
        </>
      )}
    </div>
  )
}
