import { useState, useRef } from 'react'
import { StopCircle, Clock, Users, IndianRupee, TrendingUp, Receipt, Camera, X, Gauge, Package, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints, uploadPhoto } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import Spinner from '@/components/shared/Spinner'
import StepDots from '@/components/shared/StepDots'
import { fmt } from '@/lib/format'

export default function EndSessionModal({ onClose, onEnded }) {
  const session      = useAppStore(s => s.session)
  const clearSession = useAppStore(s => s.clearSession)

  const [step,       setStep]       = useState(0)
  const [loading,    setLoading]    = useState(false)
  const [summary,    setSummary]    = useState(null)
  const [odoEnd,     setOdoEnd]     = useState('')
  const [odoPhoto,   setOdoPhoto]   = useState(null)
  const [odoPreview, setOdoPreview] = useState(null)

  // Step 1 — return stock
  const [returnItems,  setReturnItems]  = useState([])     // [{ item_code, item_name, qty_loaded, qty_returned }]
  const [loadingStock, setLoadingStock] = useState(false)
  const [savingReturn, setSavingReturn] = useState(false)

  const cameraRef = useRef(null)

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

  const loadReturnStock = async (sessionName) => {
    setLoadingStock(true)
    try {
      const stockResult = await api.get(endpoints.getSessionStock, { params: { route_session: sessionName } })
      const loaded = stockResult?.items || []
      return loaded.map(i => ({
        item_code:     i.item_code,
        item_name:     i.item_name,
        stock_uom:     i.stock_uom,
        qty_loaded:    i.qty_loaded,
        qty_delivered: i.qty_delivered || 0,
        qty_returned:  i.qty_returned || 0,
      }))
    } catch (err) {
      toast.error(err.message || 'Failed to load van stock.')
      return null
    } finally {
      setLoadingStock(false)
    }
  }

  const finalizeEndSession = async (itemsToReturn) => {
    if (!session?.name) {
      toast.error('No active session found.')
      return
    }

    setLoading(true)
    try {
      const sessionName = session.name

      if (itemsToReturn?.length) {
        await api.post(endpoints.saveReturnStock, {
          route_session: sessionName,
          items: itemsToReturn.map(i => ({ item_code: i.item_code, qty_returned: i.qty_returned })),
        })
      }

      let photoUrl = null
      if (odoPhoto) photoUrl = await uploadPhoto(odoPhoto)

      const result = await api.post(endpoints.endSession, {
        route_session:      sessionName,
        odometer_end:       odoEnd ? parseInt(odoEnd, 10) : null,
        odometer_end_photo: photoUrl,
      })
      setSummary(result)
      clearSession()
      setStep(2)
    } catch (err) {
      toast.error(err.message || 'Failed to end session.')
    } finally {
      setLoading(false)
    }
  }

  const handleEnd = async () => {
    if (!session?.name) {
      toast.error('No active session found.')
      return
    }

    const loadedItems = await loadReturnStock(session.name)
    if (loadedItems === null) return

    setReturnItems(loadedItems)
    if (loadedItems.length === 0) {
      await finalizeEndSession([])
      return
    }

    setStep(1)
  }

  const handleReturnQty = (item_code, val) => {
    const n = parseFloat(val)
    setReturnItems(prev => prev.map(i =>
      i.item_code === item_code
        ? { ...i, qty_returned: isNaN(n) || n < 0 ? 0 : Math.min(n, i.qty_loaded) }
        : i
    ))
  }

  const handleSaveReturn = async () => {
    setSavingReturn(true)
    try {
      await finalizeEndSession(returnItems)
    } catch (err) {
      toast.error('Return stock save failed: ' + (err.message || ''))
    } finally {
      setSavingReturn(false)
    }
  }

  const skipReturn = async () => {
    setSavingReturn(true)
    try {
      await finalizeEndSession(returnItems.map(i => ({ ...i, qty_returned: 0 })))
    } finally {
      setSavingReturn(false)
    }
  }

  const handleModalClose = () => {
    if (loading || savingReturn || loadingStock) return
    if (step === 1) {
      toast.error('Complete the return stock step before closing the session.')
      return
    }
    onClose?.()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-black/50" onClick={handleModalClose}>
      <div
        className="w-full max-w-[430px] mx-auto bg-white rounded-t-3xl p-6 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto" />

        {step === 0 && (
          <>
            <StepDots step={0} total={3} color="bg-red-500" />
            <div className="text-center space-y-1">
              <h2 className="text-lg font-bold text-slate-900">End Session</h2>
              <p className="text-sm text-slate-500">Record your final odometer reading before closing.</p>
            </div>

            {session && (
              <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Current Session</p>
                <p className="font-semibold text-slate-800">{session.name}</p>
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Started at {session.start_time}
                </p>
              </div>
            )}

            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5" /> Odometer at End
              </p>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1.5">
                  Reading (km) <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 45620"
                  value={odoEnd}
                  onChange={e => setOdoEnd(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
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
                  <img src={odoPreview} alt="Odometer End" className="w-full h-32 object-cover rounded-xl border border-slate-200" />
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

            <div className="flex gap-3">
              <button onClick={handleModalClose} className="flex-1 border border-slate-200 text-slate-600 font-semibold py-3 rounded-xl">
                Cancel
              </button>
              <button
                onClick={handleEnd}
                disabled={loading}
                className="flex-1 bg-red-500 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:bg-red-600 disabled:opacity-60"
              >
                {loading
                  ? <Spinner size="sm" className="border-white border-t-red-300" />
                  : <StopCircle className="w-4 h-4" />
                }
                {loading ? 'Ending…' : 'End Session'}
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <StepDots step={1} total={3} color="bg-red-500" />
            <div className="text-center space-y-1">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center mx-auto">
                <Package className="w-5 h-5 text-amber-600" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Return Stock</h2>
              <p className="text-sm text-slate-500">Enter how many items you're returning unsold.</p>
            </div>

            {loadingStock ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : returnItems.length === 0 ? (
              <div className="text-center py-6 text-slate-400">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No van stock was recorded at session start</p>
              </div>
            ) : (
              <>
                {/* Summary bar */}
                {(() => {
                  const totalLoaded   = returnItems.reduce((s, i) => s + (i.qty_loaded || 0), 0)
                  const totalReturned = returnItems.reduce((s, i) => s + (i.qty_returned || 0), 0)
                  const totalSold     = returnItems.reduce((s, i) => s + (i.qty_delivered || 0), 0)
                  return (
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-xl p-3">
                      <div className="text-center">
                        <p className="text-xs text-slate-500">Loaded</p>
                        <p className="text-base font-bold text-slate-800">{totalLoaded}</p>
                      </div>
                      <div className="text-center border-x border-slate-200">
                        <p className="text-xs text-slate-500">Sold</p>
                        <p className="text-base font-bold text-green-600">{totalSold}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-slate-500">Returning</p>
                        <p className="text-base font-bold text-amber-600">{totalReturned}</p>
                      </div>
                    </div>
                  )
                })()}

                <div className="space-y-2">
                  {returnItems.map(item => (
                    <div key={item.item_code} className="bg-slate-50 rounded-xl px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{item.item_name}</p>
                          <p className="text-xs text-slate-400">Loaded: {item.qty_loaded} {item.stock_uom}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-500 flex-shrink-0">Returning:</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={item.qty_returned}
                          onChange={e => handleReturnQty(item.item_code, e.target.value)}
                          min="0"
                          max={item.qty_loaded}
                          className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center bg-white focus:outline-none focus:border-blue-500"
                        />
                        <span className="text-xs text-slate-400">{item.stock_uom}</span>
                        <span className="ml-auto text-xs text-green-600 font-medium">
                          Sold: {(item.qty_loaded || 0) - (item.qty_returned || 0)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-3">
              <button
                onClick={skipReturn}
                className="flex-1 border border-slate-200 text-slate-600 font-semibold py-3 rounded-xl"
              >
                Skip
              </button>
              <button
                onClick={handleSaveReturn}
                disabled={savingReturn}
                className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 active:bg-blue-700 disabled:opacity-60"
              >
                {savingReturn
                  ? <Spinner size="sm" className="border-white border-t-blue-300" />
                  : <ChevronRight className="w-4 h-4" />
                }
                {savingReturn ? 'Saving…' : 'Save & Continue'}
              </button>
            </div>
          </>
        )}

        {step === 2 && summary && (
          <DaySummary summary={summary} returnItems={returnItems} onDone={() => { onEnded?.(); onClose() }} />
        )}
      </div>
    </div>
  )
}

function DaySummary({ summary, returnItems, onDone }) {
  const s = summary.summary || {}

  const totalLoaded   = returnItems.reduce((acc, i) => acc + (i.qty_loaded || 0), 0)
  const totalReturned = returnItems.reduce((acc, i) => acc + (i.qty_returned || 0), 0)
  const totalSold     = returnItems.reduce((acc, i) => acc + (i.qty_delivered || 0), 0)

  return (
    <div className="space-y-4">
      <StepDots step={2} total={3} color="bg-red-500" />
      <div className="text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <TrendingUp className="w-7 h-7 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Day Complete!</h2>
        <p className="text-sm text-slate-500 mt-1">
          {summary.duration_hours} hrs · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SumCard icon={Users}       label="Customers"  value={`${s.visited || 0}/${s.total_customers || 0}`} color="blue"   />
        <SumCard icon={TrendingUp}  label="Invoices"   value={s.invoices_created || 0}                       color="purple" />
        <SumCard icon={IndianRupee} label="Billed"     value={`₹${fmt(s.total_billed)}`}                     color="blue"   />
        <SumCard icon={IndianRupee} label="Collected"  value={`₹${fmt(s.total_collected)}`}                  color="green"  />
        <SumCard icon={Receipt}     label="Expenses"   value={`₹${fmt(s.total_expenses)}`}                   color="amber"  />
        <SumCard icon={Users}       label="Skipped"    value={s.skipped || 0}                                color="red"    />
      </div>

      {totalLoaded > 0 && (
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Van Stock Summary
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-bold text-slate-800">{totalLoaded}</p>
              <p className="text-xs text-slate-500">Loaded</p>
            </div>
            <div>
              <p className="text-lg font-bold text-green-600">{totalSold}</p>
              <p className="text-xs text-slate-500">Sold</p>
            </div>
            <div>
              <p className="text-lg font-bold text-amber-600">{totalReturned}</p>
              <p className="text-xs text-slate-500">Returned</p>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={onDone}
        className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl active:bg-blue-700 transition-colors"
      >
        Back to Dashboard
      </button>
    </div>
  )
}

function SumCard({ icon: Icon, label, value, color }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    amber:  'bg-amber-50 text-amber-600',
    red:    'bg-red-50 text-red-500',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-3">
      <div className={`inline-flex p-1.5 rounded-lg mb-1.5 ${colors[color]}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <p className="text-base font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
}
