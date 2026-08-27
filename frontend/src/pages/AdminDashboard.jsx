import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, LogOut, XCircle, MapPin, ChevronDown,
  Clock, AlertCircle, ArrowLeft, WifiOff, Trash2,
  ChevronRight, CalendarDays, CheckCircle2, TrendingUp,
  Package, IndianRupee,
} from 'lucide-react'
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api'
import { toast } from 'sonner'
import api, { endpoints, revokeApiCredentials } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { fmt } from '@/lib/format'
import { BRAND, VISIT_STATUS } from '@/lib/constants'

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d)) return String(ts)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

// ── Root component ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const navigate  = useNavigate()
  const user      = useAppStore(s => s.user)
  const clearUser = useAppStore(s => s.clearUser)

  const [checking,  setChecking]  = useState(true)
  const [isAdmin,   setIsAdmin]   = useState(false)
  const [date,      setDate]      = useState(new Date().toISOString().slice(0, 10))
  const [assignments, setAssignments] = useState([])
  const [routes,    setRoutes]    = useState([])
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState({})

  // Detail view
  const [selectedSp,    setSelectedSp]    = useState(null)
  const [employeeDay,   setEmployeeDay]   = useState(null)
  const [empLoading,    setEmpLoading]    = useState(false)
  const [unassignTarget, setUnassignTarget] = useState(null)

  // Role check
  useEffect(() => {
    api.get(endpoints.adminCheckRole)
      .then(d => { setIsAdmin(d?.is_admin || false); setChecking(false) })
      .catch(() => setChecking(false))
  }, [])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const [aData, rData] = await Promise.all([
        api.get(endpoints.adminGetAssignments),
        api.get(endpoints.adminGetRoutes),
      ])
      setAssignments(aData?.assignments || [])
      setRoutes(Array.isArray(rData) ? rData : [])
    } catch (err) {
      toast.error(err.message || 'Failed to load data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (isAdmin) loadList() }, [isAdmin, loadList])

  const loadEmployeeDay = useCallback(async (salesperson) => {
    setEmpLoading(true)
    try {
      const data = await api.get(endpoints.adminGetEmployeeDay, {
        params: { salesperson, date },
      })
      setEmployeeDay(data)
    } catch (err) {
      toast.error(err.message || 'Failed to load employee data.')
    } finally {
      setEmpLoading(false)
    }
  }, [date])

  const openDetail = (row) => {
    setSelectedSp(row)
    setEmployeeDay(null)
    loadEmployeeDay(row.salesperson)
  }

  const closeDetail = () => {
    setSelectedSp(null)
    setEmployeeDay(null)
  }

  const handleAssign = async (salesperson, route) => {
    setSaving(p => ({ ...p, [salesperson]: true }))
    try {
      await api.post(endpoints.adminAssignRoute, { salesperson, route, date })
      toast.success('Route assigned!')
      loadList()
      if (selectedSp?.salesperson === salesperson) loadEmployeeDay(salesperson)
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
      if (selectedSp?.salesperson === salesperson) { setSelectedSp(null); setEmployeeDay(null) }
    } catch (err) {
      toast.error(err.message || 'Failed to unassign.')
    } finally {
      setSaving(p => ({ ...p, [salesperson]: false }))
    }
  }

  const handleLogout = async () => {
    await revokeApiCredentials()
    clearUser()
    navigate('/login')
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  if (checking) {
    return (
      <div className="h-full flex items-center justify-center bg-app-bg">
        <p className="text-slate-400 text-sm">Checking access…</p>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-app-bg px-8 text-center">
        <XCircle className="w-12 h-12 text-red-400" />
        <p className="text-slate-700 font-semibold text-lg">Access Denied</p>
        <p className="text-slate-400 text-sm">System Manager or Sales Manager role required.</p>
        <button onClick={() => navigate('/dashboard')} className="mt-2 text-sm text-brand underline">
          Go to Dashboard
        </button>
      </div>
    )
  }

  // ── Detail view ──────────────────────────────────────────────────────────

  if (selectedSp) {
    return (
      <>
        <EmployeeDetailView
          key={`${selectedSp.salesperson}:${employeeDay?.assignment?.route || ''}`}
          sp={selectedSp}
          data={employeeDay}
          loading={empLoading}
          routes={routes}
          date={date}
          saving={!!saving[selectedSp.salesperson]}
          onBack={closeDetail}
          onAssign={(route) => handleAssign(selectedSp.salesperson, route)}
          onUnassign={() => setUnassignTarget({
            salesperson:      selectedSp.salesperson,
            salesperson_name: selectedSp.salesperson_name,
            route_name:       employeeDay?.assignment?.route_name || selectedSp.route_name,
          })}
          onRefresh={() => loadEmployeeDay(selectedSp.salesperson)}
        />
        {unassignTarget && (
          <UnassignConfirmModal
            target={unassignTarget}
            saving={!!saving[unassignTarget.salesperson]}
            onConfirm={handleConfirmUnassign}
            onCancel={() => setUnassignTarget(null)}
          />
        )}
      </>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────

  const assigned   = assignments.filter(a => a.route).length
  const active     = assignments.filter(a => a.session_active).length
  const unassigned = assignments.length - assigned

  return (
    <div className="h-full flex flex-col bg-app-bg">

      {/* Header */}
      <div
        className="relative overflow-hidden px-4 pt-10 pb-4 flex-shrink-0 brand-gradient"
      >
        <div className="pointer-events-none absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10" />

        <div className="relative z-10 flex items-center justify-between mb-3">
          <button onClick={() => navigate(-1)}
            className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center">
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs text-white/80 border border-white/30 rounded-lg px-3 py-1.5">
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>

        <h1 className="text-white font-extrabold text-2xl relative z-10">Admin Panel</h1>
        <p className="text-white/75 text-xs mt-0.5 relative z-10">{user?.fullName}</p>

        {/* Date + Refresh */}
        <div className="relative z-10 mt-3 flex items-center gap-2">
          <div className="flex-1 bg-white/20 rounded-xl flex items-center px-3 gap-2 py-2.5">
            <CalendarDays className="w-4 h-4 text-white/70 flex-shrink-0" />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="flex-1 text-sm text-white bg-transparent outline-none"
              style={{ colorScheme: 'dark' }}
            />
          </div>
          <button onClick={loadList} disabled={loading}
            className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center active:bg-white/30 disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 text-white ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Summary */}
        <div className="relative z-10 mt-3 grid grid-cols-4 gap-2">
          {[
            { label: 'Total',    value: assignments.length, color: 'text-white' },
            { label: 'Assigned', value: assigned,           color: 'text-green-200' },
            { label: 'Active',   value: active,             color: 'text-yellow-200' },
            { label: 'Free',     value: unassigned,         color: 'text-red-200' },
          ].map(s => (
            <div key={s.label} className="bg-white/15 rounded-xl py-2 text-center">
              <p className={`text-lg font-extrabold ${s.color}`}>{s.value}</p>
              <p className="text-white/60 text-[10px]">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Employee list */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8 space-y-2">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
        ) : assignments.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">No salespersons found.</div>
        ) : (
          assignments.map(row => (
            <EmployeeCard key={row.salesperson} row={row} onTap={() => openDetail(row)} />
          ))
        )}
      </div>
    </div>
  )
}

// ── Employee card ─────────────────────────────────────────────────────────────

function EmployeeCard({ row, onTap }) {
  const s = row.session_active
    ? { label: 'Active',   bg: 'bg-green-100', text: 'text-green-700', pulse: true  }
    : row.session_started
    ? { label: 'Day Done', bg: 'bg-slate-100',  text: 'text-slate-600', pulse: false }
    : row.route
    ? { label: 'Assigned', bg: 'bg-blue-50',   text: 'text-blue-700',  pulse: false }
    : { label: 'No Route', bg: 'bg-amber-50',  text: 'text-amber-700', pulse: false }

  return (
    <button
      onClick={onTap}
      className="w-full bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3 active:bg-slate-50 text-left"
    >
      {/* Avatar */}
      <div className="w-11 h-11 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
        <span className="text-base font-bold text-brand-dark">
          {row.salesperson_name?.[0]?.toUpperCase()}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-800 text-sm truncate">{row.salesperson_name}</p>
        <p className="text-xs text-slate-400 mt-0.5 truncate">
          {row.route_name || 'No route assigned'}
        </p>
      </div>

      {/* Status badge */}
      <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${s.bg} ${s.text}`}>
        {s.pulse && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
        {s.label}
      </span>

      <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
    </button>
  )
}

// ── Employee detail view ──────────────────────────────────────────────────────

function EmployeeDetailView({ sp, data, loading, routes, saving, onBack, onAssign, onUnassign, onRefresh }) {
  const [routeSel, setRouteSel] = useState(data?.assignment?.route || '')

  const changed = routeSel !== (data?.assignment?.route || '')

  const s = sp.session_active
    ? { label: 'Active',   bg: 'bg-green-100', text: 'text-green-700', pulse: true  }
    : sp.session_started
    ? { label: 'Day Done', bg: 'bg-slate-100',  text: 'text-slate-600', pulse: false }
    : sp.route
    ? { label: 'Assigned', bg: 'bg-blue-50',   text: 'text-blue-700',  pulse: false }
    : { label: 'No Route', bg: 'bg-amber-50',  text: 'text-amber-700', pulse: false }

  const visitedPct = data?.progress?.total_customers > 0
    ? Math.round((data.progress.visited / data.progress.total_customers) * 100)
    : 0

  return (
    <div className="h-full flex flex-col bg-app-bg">

      {/* Header */}
      <div
        className="relative overflow-hidden px-4 pt-10 pb-5 flex-shrink-0 brand-gradient"
      >
        <div className="pointer-events-none absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10" />

        <div className="relative z-10 flex items-center justify-between mb-3">
          <button onClick={onBack}
            className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center">
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <button onClick={onRefresh} disabled={loading}
            className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 text-white ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/25 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-extrabold text-white">
              {sp.salesperson_name?.[0]?.toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-extrabold text-xl leading-tight truncate">{sp.salesperson_name}</h1>
            <p className="text-white/65 text-xs mt-0.5">{sp.salesperson}</p>
          </div>
          <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 ${s.bg} ${s.text}`}>
            {s.pulse && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
            {s.label}
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-10 space-y-3">

        {loading && !data ? (
          <div className="py-20 text-center text-slate-400 text-sm">Loading employee data…</div>
        ) : (
          <>
            {/* ── Route Assignment ─────────────────────────────────────── */}
            <Section title="Route Assignment">
              <div className="relative mb-3">
                <select
                  value={routeSel}
                  onChange={e => setRouteSel(e.target.value)}
                  className="w-full appearance-none border border-slate-200 rounded-xl px-3 py-2.5 pr-8 text-sm text-slate-700 bg-white outline-none focus:border-brand focus:ring-1 focus:ring-brand/20"
                >
                  <option value="">— No Route —</option>
                  {routes.map(r => (
                    <option key={r.name} value={r.name}>{r.route_name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>

              <div className="flex gap-2">
                {changed && (
                  <button
                    onClick={() => onAssign(routeSel)}
                    disabled={saving}
                    className="flex-1 bg-brand text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save Assignment'}
                  </button>
                )}
                {data?.assignment && !changed && (
                  <button
                    onClick={onUnassign}
                    className="flex items-center gap-1.5 text-sm text-red-500 border border-red-100 rounded-xl px-4 py-2.5 active:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" /> Unassign
                  </button>
                )}
              </div>

              {/* Session meta */}
              {data?.session && (
                <div className="mt-3 bg-slate-50 rounded-xl px-3 py-2.5 space-y-1 text-xs text-slate-600">
                  {data.assignment?.vehicle && (
                    <p>Vehicle: <span className="font-semibold">{data.assignment.vehicle}</span></p>
                  )}
                  {data.assignment?.travel_mode && (
                    <p>Mode: <span className="font-semibold">{data.assignment.travel_mode}</span></p>
                  )}
                  <p>Session started: <span className="font-semibold">{fmtTime(data.session.start_time)}</span></p>
                  {data.session.end_time && (
                    <p>Session ended: <span className="font-semibold">{fmtTime(data.session.end_time)}</span></p>
                  )}
                </div>
              )}

              {!data?.assignment && (
                <p className="mt-2 text-xs text-slate-400 text-center">No route assigned for this date.</p>
              )}
            </Section>

            {/* ── Daily Progress ───────────────────────────────────────── */}
            {data?.progress && (
              <Section title="Daily Progress">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-600">Route Progress</span>
                  <span className="text-sm font-bold text-brand-dark">{visitedPct}%</span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full bg-brand rounded-full transition-all"
                    style={{ width: `${visitedPct}%` }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat value={data.progress.visited}   label="Visited"   color="text-green-600" bg="bg-green-50"  />
                  <MiniStat value={data.progress.skipped}   label="Skipped"   color="text-amber-600" bg="bg-amber-50"  />
                  <MiniStat value={data.progress.remaining} label="Remaining" color="text-slate-500"  bg="bg-slate-50" />
                </div>
              </Section>
            )}

            {/* ── Live Location ────────────────────────────────────────── */}
            {data?.location ? (
              <Section title="Live Location">
                <LocationMiniMap location={data.location} name={sp.salesperson_name} />
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

            {/* ── Customers ────────────────────────────────────────────── */}
            {data?.customers?.length > 0 && (
              <Section title={`Customers · ${data.customers.length}`}>
                <div className="space-y-2">
                  {data.customers.map((c, i) => (
                    <CustomerRow key={c.customer} c={c} i={i} />
                  ))}
                </div>
              </Section>
            )}

            {/* ── Sales Today ──────────────────────────────────────────── */}
            {data?.sales && (
              <Section title="Sales Today">
                <div className="divide-y divide-slate-50">
                  <DataRow icon={Package}      iconBg="bg-orange-50"  iconColor="text-brand-dark"
                    label="Orders Taken"  value={`${data.sales.orders_count} orders`} />
                  <DataRow icon={TrendingUp}   iconBg="bg-orange-50"  iconColor="text-brand-dark"
                    label="Sales Amount"  value={`₹${fmt(data.sales.total_amount)}`} bold />
                  <DataRow icon={IndianRupee}  iconBg="bg-purple-50"  iconColor="text-purple-600"
                    label="Invoiced"      value={`₹${fmt(data.sales.invoiced_amount)}`} bold />
                </div>
              </Section>
            )}

            {/* ── Collections ──────────────────────────────────────────── */}
            {data?.collections && (
              <Section title="Collections Today">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-slate-600">Total Collected</span>
                  <span className="text-2xl font-extrabold text-brand-dark">₹{fmt(data.collections.total)}</span>
                </div>
                {Object.keys(data.collections.by_mode).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(data.collections.by_mode).map(([mode, amount]) => (
                      <div key={mode} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                        <span className="text-xs font-semibold text-slate-600">{mode}</span>
                        <span className="text-sm font-bold text-slate-800">₹{fmt(amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 text-center py-2">No collections yet</p>
                )}
              </Section>
            )}

            {/* ── Expenses ─────────────────────────────────────────────── */}
            <Section title="Expenses">
              {data?.expenses?.length > 0 ? (
                <>
                  <div className="space-y-2">
                    {data.expenses.map((e, i) => (
                      <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                        <div>
                          <p className="text-sm font-semibold text-slate-700">{e.type}</p>
                          {e.notes && <p className="text-xs text-slate-400 mt-0.5">{e.notes}</p>}
                          <p className="text-[10px] text-slate-400 mt-0.5">{fmtTime(e.time)}</p>
                        </div>
                        <p className="text-base font-bold text-slate-800">₹{fmt(e.amount)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-500">Total Expenses</span>
                    <span className="text-sm font-bold text-slate-700">
                      ₹{fmt(data.expenses.reduce((s, e) => s + (e.amount || 0), 0))}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">No expenses recorded</p>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

// ── Customer visit row ────────────────────────────────────────────────────────

function CustomerRow({ c, i }) {
  const icon =
    c.status === VISIT_STATUS.VISITED ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" /> :
    c.status === VISIT_STATUS.SKIPPED ? <AlertCircle  className="w-4 h-4 text-amber-400  flex-shrink-0 mt-0.5" /> :
                             <Clock        className="w-4 h-4 text-slate-300  flex-shrink-0 mt-0.5" />

  const duration = c.checkin_time && c.checkout_time
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
            {duration != null ? ` · ${duration} min` : ''}
          </p>
        )}
        {c.mobile_no && (
          <a
            href={`tel:${c.mobile_no}`}
            onClick={e => e.stopPropagation()}
            className="text-[10px] text-brand font-semibold mt-0.5 block"
          >
            {c.mobile_no}
          </a>
        )}
      </div>
      {icon}
    </div>
  )
}

// ── Location mini map ─────────────────────────────────────────────────────────

function LocationMiniMap({ location, name }) {
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_KEY })
  const center = { lat: location.lat, lng: location.lng }

  if (!MAPS_KEY || !isLoaded) {
    return (
      <div className="bg-slate-100 rounded-xl h-28 flex flex-col items-center justify-center gap-1.5">
        <MapPin className="w-5 h-5 text-brand" />
        <p className="text-xs text-slate-500">{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height: '200px' }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={15}
        options={{ disableDefaultUI: true }}
      >
        <Marker
          position={center}
          title={name}
          icon={{
            path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
            fillColor: BRAND.DEFAULT,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
            scale: 1.8,
            anchor: { x: 12, y: 22 },
          }}
        />
      </GoogleMap>
    </div>
  )
}

// ── Unassign modal ────────────────────────────────────────────────────────────

function UnassignConfirmModal({ target, saving, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
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
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel}
            className="flex-1 border border-slate-200 text-slate-600 font-semibold py-2.5 rounded-xl text-sm">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={saving}
            className="flex-1 bg-red-500 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-60">
            {saving ? 'Removing…' : 'Yes, Unassign'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
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
    <div className="flex items-center gap-3 py-2.5">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <span className="flex-1 text-sm text-slate-600">{label}</span>
      <span className={`text-sm flex-shrink-0 ${bold ? 'font-bold text-slate-800' : 'font-medium text-slate-700'}`}>
        {value}
      </span>
    </div>
  )
}
