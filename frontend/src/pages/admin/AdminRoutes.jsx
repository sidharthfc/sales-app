import { useCallback, useEffect, useState } from 'react'
import {
  RefreshCw, ChevronDown, ChevronRight, Trash2,
  CheckCircle2, AlertCircle, Clock, ArrowLeft,
  MapPin, TrendingUp, IndianRupee, Package, WifiOff,
} from 'lucide-react'
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import { fmt } from '@/lib/format'
import { VISIT_STATUS } from '@/lib/constants'

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return isNaN(d) ? String(ts) : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export default function AdminRoutes() {
  const [assignments, setAssignments] = useState([])
  const [routes,      setRoutes]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState({})
  const [selected,    setSelected]    = useState(null)
  const [empDay,      setEmpDay]      = useState(null)
  const [empLoading,  setEmpLoading]  = useState(false)
  const [unassignTarget, setUnassignTarget] = useState(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const [aData, rData] = await Promise.all([
        api.get(endpoints.adminGetAssignments, { params: { date } }),
        api.get(endpoints.adminGetRoutes),
      ])
      setAssignments(aData?.assignments || [])
      setRoutes(Array.isArray(rData) ? rData : [])
    } catch (err) {
      toast.error(err.message || 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { loadList() }, [loadList])

  // Auto-refresh list every 30s when not in detail view
  useEffect(() => {
    if (selected) return
    const id = setInterval(loadList, 30_000)
    return () => clearInterval(id)
  }, [selected, loadList])

  const loadEmpDay = useCallback(async (salesperson) => {
    setEmpLoading(true)
    try {
      const d = await api.get(endpoints.adminGetEmployeeDay, { params: { salesperson, date } })
      setEmpDay(d)
    } catch (err) {
      toast.error(err.message || 'Failed to load employee data.')
    } finally {
      setEmpLoading(false)
    }
  }, [date])

  const openDetail = (row) => {
    setSelected(row)
    setEmpDay(null)
    loadEmpDay(row.salesperson)
  }

  const handleAssign = async (salesperson, route) => {
    setSaving(p => ({ ...p, [salesperson]: true }))
    try {
      await api.post(endpoints.adminAssignRoute, { salesperson, route, date })
      toast.success('Route assigned!')
      loadList()
      if (selected?.salesperson === salesperson) loadEmpDay(salesperson)
    } catch (err) {
      toast.error(err.message || 'Failed to assign.')
    } finally {
      setSaving(p => ({ ...p, [salesperson]: false }))
    }
  }

  const handleConfirmUnassign = async () => {
    if (!unassignTarget) return
    const { salesperson } = unassignTarget
    setSaving(p => ({ ...p, [salesperson]: true }))
    try {
      await api.post(endpoints.adminUnassignRoute, { salesperson })
      toast.success('Route unassigned.')
      setUnassignTarget(null)
      await loadList()
      if (selected?.salesperson === salesperson) { setSelected(null); setEmpDay(null) }
    } catch (err) {
      toast.error(err.message || 'Failed to unassign.')
    } finally {
      setSaving(p => ({ ...p, [salesperson]: false }))
    }
  }

  if (selected) {
    return (
      <>
        <EmployeeDetail
          key={`${selected.salesperson}-${date}`}
          sp={selected}
          data={empDay}
          loading={empLoading}
          routes={routes}
          date={date}
          saving={!!saving[selected.salesperson]}
          onBack={() => { setSelected(null); setEmpDay(null) }}
          onAssign={route => handleAssign(selected.salesperson, route)}
          onUnassign={() => setUnassignTarget({
            salesperson:      selected.salesperson,
            salesperson_name: selected.salesperson_name,
            route_name:       empDay?.assignment?.route_name || selected.route_name,
          })}
          onRefresh={() => loadEmpDay(selected.salesperson)}
        />
        {unassignTarget && (
          <UnassignModal
            target={unassignTarget}
            saving={!!saving[unassignTarget.salesperson]}
            onConfirm={handleConfirmUnassign}
            onCancel={() => setUnassignTarget(null)}
          />
        )}
      </>
    )
  }

  const assigned   = assignments.filter(a => a.route).length
  const active     = assignments.filter(a => a.session_active).length
  const unassigned = assignments.length - assigned

  return (
    <div className="admin-page max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-800 font-bold text-xl">Route Assignments</h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
            <span className="text-green-600 font-semibold">{active} active</span>
            <span>{assigned} assigned</span>
            <span className="text-amber-600 font-semibold">{unassigned} unassigned</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="admin-date-input" />
          <button onClick={loadList} disabled={loading}
            className="admin-icon-button w-9 h-9">
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
      ) : assignments.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">No salespersons found.</div>
      ) : (
        <div className="space-y-2">
          {assignments.map(row => (
            <button key={row.salesperson} onClick={() => openDetail(row)}
              className="w-full admin-surface p-4 flex items-center gap-3 hover:border-slate-200 transition-colors text-left">
              <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                <span className="font-bold text-slate-600 text-base">{row.salesperson_name?.[0]?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 text-sm truncate">{row.salesperson_name}</p>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{row.route_name || 'No route assigned'}</p>
              </div>
              <StatusBadge row={row} />
              <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ row }) {
  if (row.session_active) return <span className="inline-flex items-center gap-1 text-xs font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full flex-shrink-0"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Active</span>
  if (row.session_started) return <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full flex-shrink-0">Day Done</span>
  if (row.route) return <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full flex-shrink-0">Assigned</span>
  return <span className="text-xs font-semibold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full flex-shrink-0">No Route</span>
}

function EmployeeDetail({ sp, data, loading, routes, saving, onBack, onAssign, onUnassign, onRefresh }) {
  const [draftRouteSel, setDraftRouteSel] = useState(null)
  const routeSel = draftRouteSel ?? (data?.assignment?.route || '')

  const changed = routeSel !== (data?.assignment?.route || '')
  const visitedPct = data?.progress?.total_customers > 0
    ? Math.round((data.progress.visited / data.progress.total_customers) * 100)
    : 0

  return (
    <div className="admin-page max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="admin-icon-button w-9 h-9">
          <ArrowLeft className="w-4 h-4 text-slate-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-slate-800 font-bold text-xl truncate">{sp.salesperson_name}</h1>
          <p className="text-slate-400 text-xs">{sp.salesperson}</p>
        </div>
        <button onClick={onRefresh} disabled={loading}
          className="admin-icon-button w-9 h-9">
          <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && !data ? (
        <div className="py-20 text-center text-slate-400 text-sm">Loading…</div>
      ) : (
        <>
          {/* Route assignment */}
          <Section title="Route Assignment">
            <div className="relative mb-3">
              <select value={routeSel} onChange={e => setDraftRouteSel(e.target.value)}
                className="admin-input appearance-none pr-8">
                <option value="">— No Route —</option>
                {routes.map(r => <option key={r.name} value={r.name}>{r.route_name}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            <div className="flex gap-2">
              {changed && (
                <button onClick={() => onAssign(routeSel)} disabled={saving}
                  className="flex-1 bg-amber-500 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save Assignment'}
                </button>
              )}
              {data?.assignment && !changed && (
                <button onClick={onUnassign}
                  className="flex items-center gap-1.5 text-sm text-red-500 border border-red-100 rounded-xl px-4 py-2.5 hover:bg-red-50">
                  <Trash2 className="w-4 h-4" /> Unassign
                </button>
              )}
            </div>
            {data?.session && (
              <div className="mt-3 admin-surface-soft px-3 py-2.5 space-y-1 text-xs text-slate-600">
                {data.assignment?.vehicle && <p>Vehicle: <span className="font-semibold">{data.assignment.vehicle}</span></p>}
                <p>Session started: <span className="font-semibold">{fmtTime(data.session.start_time)}</span></p>
                {data.session.end_time && <p>Session ended: <span className="font-semibold">{fmtTime(data.session.end_time)}</span></p>}
              </div>
            )}
            {!data?.assignment && <p className="mt-2 text-xs text-slate-400 text-center">No route assigned.</p>}
          </Section>

          {/* Progress */}
          {data?.progress && (
            <Section title="Daily Progress">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-600">Route Progress</span>
                <span className="text-sm font-bold text-amber-600">{visitedPct}%</span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${visitedPct}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MiniStat value={data.progress.visited}   label="Visited"   color="text-green-600" bg="bg-green-50" />
                <MiniStat value={data.progress.skipped}   label="Skipped"   color="text-amber-600" bg="bg-amber-50" />
                <MiniStat value={data.progress.remaining} label="Remaining" color="text-slate-500"  bg="bg-slate-50" />
              </div>
            </Section>
          )}

          {/* Location */}
          {data?.location ? (
            <Section title="Live Location">
              <LocationMap location={data.location} name={sp.salesperson_name} />
              <p className="text-xs text-slate-400 mt-2 text-center">
                Last ping: {fmtTime(data.location.timestamp)}
                {data.location.accuracy ? ` · ±${Math.round(data.location.accuracy)}m` : ''}
              </p>
            </Section>
          ) : data?.session?.is_active ? (
            <Section title="Live Location">
              <div className="flex items-center gap-3 py-2">
                <WifiOff className="w-5 h-5 text-slate-300" />
                <p className="text-sm text-slate-400">No location signal yet</p>
              </div>
            </Section>
          ) : null}

          {/* Customers */}
          {data?.customers?.length > 0 && (
            <Section title={`Customers · ${data.customers.length}`}>
              <div className="space-y-2">
                {data.customers.map((c, i) => <CustomerRow key={c.customer} c={c} i={i} />)}
              </div>
            </Section>
          )}

          {/* Sales */}
          {data?.sales && (
            <Section title="Sales Today">
              <DataRow icon={Package}     iconBg="bg-orange-50" iconColor="text-orange-500" label="Orders Taken"   value={`${data.sales.orders_count} orders`} />
              <DataRow icon={TrendingUp}  iconBg="bg-amber-50"  iconColor="text-amber-600"  label="Sales Amount"   value={`₹${fmt(data.sales.total_amount)}`} bold />
              <DataRow icon={IndianRupee} iconBg="bg-purple-50" iconColor="text-purple-600" label="Invoiced"        value={`₹${fmt(data.sales.invoiced_amount)}`} bold />
            </Section>
          )}

          {/* Collections */}
          {data?.collections && (
            <Section title="Collections Today">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-slate-600">Total Collected</span>
                <span className="text-2xl font-extrabold text-green-600">₹{fmt(data.collections.total)}</span>
              </div>
              {Object.keys(data.collections.by_mode).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(data.collections.by_mode).map(([mode, amt]) => (
                    <div key={mode} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                      <span className="text-xs font-semibold text-slate-600">{mode}</span>
                      <span className="text-sm font-bold text-slate-800">₹{fmt(amt)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-slate-400 text-center py-2">No collections yet</p>}
            </Section>
          )}

          {/* Expenses */}
          <Section title="Expenses">
            {data?.expenses?.length > 0 ? (
              <>
                <div className="space-y-2">
                  {data.expenses.map((e, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-slate-700">{e.type}</p>
                        {e.notes && <p className="text-xs text-slate-400">{e.notes}</p>}
                        <p className="text-[10px] text-slate-400">{fmtTime(e.time)}</p>
                      </div>
                      <p className="text-base font-bold text-slate-800">₹{fmt(e.amount)}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                  <span className="text-xs font-semibold text-slate-500">Total</span>
                  <span className="text-sm font-bold text-slate-700">₹{fmt(data.expenses.reduce((s, e) => s + (e.amount || 0), 0))}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400 text-center py-4">No expenses recorded</p>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function CustomerRow({ c, i }) {
  const icon =
    c.status === VISIT_STATUS.VISITED ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> :
    c.status === VISIT_STATUS.SKIPPED ? <AlertCircle  className="w-4 h-4 text-amber-400  flex-shrink-0" /> :
                             <Clock        className="w-4 h-4 text-slate-300  flex-shrink-0" />
  const dur = c.checkin_time && c.checkout_time
    ? Math.round((new Date(c.checkout_time) - new Date(c.checkin_time)) / 60000)
    : null

  return (
    <div className="flex items-start gap-3 bg-slate-50 rounded-xl px-3 py-2.5">
      <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
        {c.sequence || i + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{c.customer_name || c.customer}</p>
        {c.status !== VISIT_STATUS.PENDING && (
          <p className="text-[10px] text-slate-400 mt-0.5">
            {c.checkin_time ? `IN ${fmtTime(c.checkin_time)}` : c.status}
            {c.checkout_time ? ` · OUT ${fmtTime(c.checkout_time)}` : ''}
            {dur != null ? ` · ${dur}m` : ''}
          </p>
        )}
        {c.mobile_no && <a href={`tel:${c.mobile_no}`} className="text-[10px] text-amber-600 font-semibold mt-0.5 block">{c.mobile_no}</a>}
      </div>
      {icon}
    </div>
  )
}

function LocationMap({ location, name }) {
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_KEY })
  const center = { lat: location.lat, lng: location.lng }
  if (!MAPS_KEY || !isLoaded) {
    return (
      <div className="bg-slate-100 rounded-xl h-28 flex flex-col items-center justify-center gap-1.5">
        <MapPin className="w-5 h-5 text-amber-500" />
        <p className="text-xs text-slate-500">{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height: 200 }}>
      <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={center} zoom={15} options={{ disableDefaultUI: true }}>
        <Marker position={center} title={name} />
      </GoogleMap>
    </div>
  )
}

function UnassignModal({ target, saving, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div className="admin-surface w-full max-w-sm p-6 space-y-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <Trash2 className="w-6 h-6 text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Unassign Route?</h2>
          <p className="text-sm text-slate-500">
            Remove <span className="font-semibold text-slate-700">{target.salesperson_name}</span> from{' '}
            <span className="font-semibold text-slate-700">{target.route_name || '—'}</span>?
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-xl text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={saving} className="flex-1 bg-red-500 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-60">
            {saving ? 'Removing…' : 'Yes, Unassign'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="admin-surface p-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">{title}</p>
      {children}
    </div>
  )
}

function MiniStat({ value, label, color, bg }) {
  return (
    <div className={`${bg} rounded-xl py-3 flex flex-col items-center gap-0.5`}>
      <p className={`text-xl font-extrabold ${color}`}>{value}</p>
      <p className="text-[10px] font-semibold text-slate-500">{label}</p>
    </div>
  )
}

function DataRow({ icon: Icon, iconBg, iconColor, label, value, bold }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <span className="flex-1 text-sm text-slate-600">{label}</span>
      <span className={`text-sm flex-shrink-0 ${bold ? 'font-bold text-slate-800' : 'font-medium text-slate-700'}`}>{value}</span>
    </div>
  )
}
