import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, SlidersHorizontal, ChevronDown, ChevronUp, ShieldCheck, ArrowRight, Users, Navigation2, MapPin, LogIn, LogOut, SkipForward, Phone } from 'lucide-react'
import { toast } from 'sonner'
import { showSuccess } from '@/lib/toastStore'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import PageHeader from '@/components/shared/PageHeader'
import StartSessionCard from '@/components/sessions/StartSessionCard'
import EndSessionModal from '@/components/sessions/EndSessionModal'
import { ListSkeleton } from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import Spinner from '@/components/shared/Spinner'
import { startTracking, stopTracking } from '@/lib/locationService'
import { getActiveCheckedInCustomer, toSelectedCustomer } from '@/lib/customerContext'
import { VISIT_STATUS } from '@/lib/constants'
import { useSubmit } from '@/lib/hooks'

export default function RoutesPage() {
  const navigate     = useNavigate()
  const user         = useAppStore(s => s.user)
  const session      = useAppStore(s => s.session)
  const setSession   = useAppStore(s => s.setSession)
  const clearSession = useAppStore(s => s.clearSession)
  const customers    = useAppStore(s => s.customers)
  const setCustomers = useAppStore(s => s.setCustomers)
  const setSelectedCustomer = useAppStore(s => s.setSelectedCustomer)
  const clearSelectedCustomer = useAppStore(s => s.clearSelectedCustomer)

  const [loading,      setLoading]      = useState(true)
  const [routeData,    setRouteData]    = useState(null)
  const [search,       setSearch]       = useState('')
  const [showEndModal, setShowEndModal] = useState(false)
  const [expandedId,   setExpandedId]   = useState(null)
  const [adminAssignments, setAdminAssignments] = useState([])
  const [showFilters,  setShowFilters]  = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')

  const isAdminWithoutSalesperson = !!user?.isAdmin && !user?.salesperson

  const fetchRoute = useCallback(async () => {
    setLoading(true)
    try {
      if (isAdminWithoutSalesperson) {
        const data = await api.get(endpoints.adminGetAssignments)
        setAdminAssignments(data?.assignments || [])
        setRouteData(null)
        setCustomers([])
        clearSession()
      } else {
        const data = await api.get(endpoints.getTodayRoute)
        setRouteData(data)
        setAdminAssignments([])
        setCustomers(data?.customers || [])
        const activeCustomer = getActiveCheckedInCustomer(data?.customers || [])
        if (activeCustomer) setSelectedCustomer(toSelectedCustomer(activeCustomer))
        else clearSelectedCustomer()
        if (data?.session?.name && !data.session.end_time) {
          setSession({
            name: data.session.name,
            start_time: data.session.start_time,
            route: data.route?.name || data.assignment?.route || null,
            total_customers: data.customers?.length || 0,
          })
        } else {
          clearSession()
        }
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load customers.')
      setRouteData(null)
      setCustomers([])
      setAdminAssignments([])
      clearSession()
      clearSelectedCustomer()
    } finally {
      setLoading(false)
    }
  }, [clearSelectedCustomer, clearSession, isAdminWithoutSalesperson, setCustomers, setSelectedCustomer, setSession])

  useEffect(() => { fetchRoute() }, [fetchRoute])

  // Start/stop GPS tracking with session lifecycle
  useEffect(() => {
    if (session?.name) {
      startTracking(session.name)
    } else {
      stopTracking()
    }
    return () => stopTracking()
  }, [session?.name])

  const filtered = (customers || []).filter((c) => {
    const matchesSearch = (c.customer_name || c.customer || '').toLowerCase().includes(search.toLowerCase())
    if (!matchesSearch) return false
    if (statusFilter === 'all') return true

    const visitStatus = c.visit_status
    const checkoutTime = c.checkout_time

    if (statusFilter === 'pending') return !visitStatus
    if (statusFilter === 'checked_in') return visitStatus === VISIT_STATUS.VISITED && !checkoutTime
    if (statusFilter === 'checked_out') return visitStatus === VISIT_STATUS.VISITED && !!checkoutTime
    if (statusFilter === 'skipped') return visitStatus === VISIT_STATUS.SKIPPED
    return true
  })

  const updateCustomerVisit = useCallback((customerId, patch) => {
    const nextCustomers = (customers || []).map((c) => (
      c.customer === customerId ? { ...c, ...patch } : c
    ))
    setCustomers(nextCustomers)
  }, [customers, setCustomers])

  return (
    <div className="h-full flex flex-col bg-app-bg">

      {/* Header — fixed at top */}
      <PageHeader title="Route Sales">
        <div className="mt-4 flex gap-2">
          <div className="flex-1 bg-white rounded-xl flex items-center px-3 gap-2">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="search by name"
              className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
              showFilters || statusFilter !== 'all'
                ? 'bg-[#FFF3E1] border border-brand/20'
                : 'bg-white'
            }`}
          >
            <SlidersHorizontal className={`w-4 h-4 ${showFilters || statusFilter !== 'all' ? 'text-brand' : 'text-slate-500'}`} />
          </button>
        </div>
        {showFilters && !isAdminWithoutSalesperson && (
          <div className="mt-3 flex flex-wrap gap-2">
            {ROUTE_FILTERS.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setStatusFilter(filter.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  statusFilter === filter.key
                    ? 'border-brand bg-white text-brand-dark'
                    : 'border-white/40 bg-white/15 text-white'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        )}
      </PageHeader>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto px-4 pt-4 pb-4 space-y-3"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {!isAdminWithoutSalesperson && !session && (
          <StartSessionCard assignment={routeData?.assignment} onStarted={fetchRoute} />
        )}

        {loading ? (
          <ListSkeleton count={5} />
        ) : isAdminWithoutSalesperson ? (
          <AdminRouteOverview
            assignments={adminAssignments}
            onOpenAdmin={() => navigate('/admin')}
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={MapPin} title="No customers" description="Your route customers will appear here." />
        ) : (
          filtered.map((c) => (
            <CustomerAccordion
              key={c.customer}
              customer={c}
              session={session}
              expanded={expandedId === c.customer}
              onToggle={() => setExpandedId(expandedId === c.customer ? null : c.customer)}
              onVisitChange={(patch) => updateCustomerVisit(c.customer, patch)}
            />
          ))
        )}

        {session && (
          <button
            onClick={() => setShowEndModal(true)}
            className="w-full border-2 border-brand text-brand font-semibold py-3 rounded-2xl text-sm mt-2"
          >
            End Day
          </button>
        )}
      </div>

      {showEndModal && (
        <EndSessionModal
          session={session}
          onClose={() => setShowEndModal(false)}
          onEnded={() => { setShowEndModal(false); fetchRoute() }}
        />
      )}
    </div>
  )
}

const ROUTE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'checked_in', label: 'Checked In' },
  { key: 'checked_out', label: 'Checked Out' },
  { key: 'skipped', label: 'Skipped' },
]

function AdminRouteOverview({ assignments, onOpenAdmin }) {
  const assigned = assignments.filter(row => row.route).length
  const active = assignments.filter(row => row.session_active).length

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand">Admin View</p>
            <h3 className="text-slate-900 font-bold mt-1">All Route Assignments</h3>
            <p className="text-sm text-slate-500 mt-1">
              You are signed in as an admin, so this page shows today&apos;s route coverage across the team.
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-[#FFF3E1] flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-brand" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <AdminStat label="Assigned" value={assigned} icon={Users} />
          <AdminStat label="Active" value={active} icon={MapPin} />
        </div>
        <button
          onClick={onOpenAdmin}
          className="w-full mt-4 brand-gradient text-white font-semibold py-3 rounded-2xl flex items-center justify-center gap-2"
        >
          Open Admin Panel <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {assignments.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No assignments today"
          description="Route assignments will appear here once they are created."
        />
      ) : (
        assignments.map((row) => (
          <div key={row.salesperson} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-slate-900 truncate">{row.salesperson_name || row.salesperson}</p>
                <p className="text-sm text-slate-500 mt-0.5">{row.route_name || 'Unassigned route'}</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${row.session_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                {row.session_active ? 'Active' : 'Idle'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mt-3 text-xs text-slate-500">
              <span className="bg-slate-50 px-2.5 py-1 rounded-full">{row.travel_mode || 'No travel mode'}</span>
              <span className="bg-slate-50 px-2.5 py-1 rounded-full">{row.vehicle || 'No vehicle'}</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function AdminStat({ label, value, icon: Icon }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <Icon className="w-4 h-4 text-slate-400" />
      </div>
      <p className="text-2xl font-extrabold text-slate-900 mt-2">{value}</p>
    </div>
  )
}

function CustomerAccordion({ customer, session, expanded, onToggle, onVisitChange }) {
  const navigate = useNavigate()
  const setSelectedCustomer    = useAppStore(s => s.setSelectedCustomer)
  const clearSelectedCustomer  = useAppStore(s => s.clearSelectedCustomer)
  const name = customer.customer_name || customer.customer || 'Unknown'

  const [visitStatus,  setVisitStatus]  = useState(customer.visit_status || null)
  const [checkinTime,  setCheckinTime]  = useState(customer.checkin_time  || null)
  const [checkoutTime, setCheckoutTime] = useState(customer.checkout_time || null)
  const [checkingIn,   submitCheckin]   = useSubmit()
  const [checkingOut,  submitCheckout]  = useSubmit()
  const [skipping,     submitSkip]      = useSubmit()

  const statusBadge =
    visitStatus === VISIT_STATUS.VISITED && checkoutTime ? { label: 'Done',       cls: 'bg-blue-100 text-blue-700'   } :
    visitStatus === VISIT_STATUS.VISITED                 ? { label: 'Checked In', cls: 'bg-green-100 text-green-700' } :
    visitStatus === VISIT_STATUS.SKIPPED                 ? { label: 'Skipped',    cls: 'bg-amber-100 text-amber-700' } :
    null

  const handleCheckin = async () => {
    if (!session?.name) return
    try {
      await submitCheckin(async () => {
        const res = await api.post(endpoints.checkin, {
          route_session: session.name,
          customer:      customer.customer,
        })
        setVisitStatus(res.visit.visit_status)
        setCheckinTime(res.visit.checkin_time)
        setSelectedCustomer(toSelectedCustomer(customer))
        onVisitChange?.({ visit_status: res.visit.visit_status, checkin_time: res.visit.checkin_time, checkout_time: null })
        showSuccess('Checked in.')
      })
    } catch {
      // toasted in useSubmit
    }
  }

  const handleCheckout = async () => {
    if (!session?.name) return
    try {
      await submitCheckout(async () => {
        const res = await api.post(endpoints.checkout, {
          route_session: session.name,
          customer:      customer.customer,
          visit_status:  VISIT_STATUS.VISITED,
        })
        setVisitStatus(res.visit.visit_status)
        setCheckoutTime(res.visit.checkout_time)
        clearSelectedCustomer()
        onVisitChange?.({ visit_status: res.visit.visit_status, checkout_time: res.visit.checkout_time })
        showSuccess('Checked out.')
      })
    } catch {
      // toasted in useSubmit
    }
  }

  const handleSkip = async () => {
    if (!session?.name) return
    try {
      await submitSkip(async () => {
        const res = await api.post(endpoints.skipCustomer, {
          route_session: session.name,
          customer:      customer.customer,
        })
        setVisitStatus(res.visit.visit_status)
        clearSelectedCustomer()
        onVisitChange?.({ visit_status: res.visit.visit_status, checkin_time: null, checkout_time: null })
        showSuccess('Customer skipped.')
      })
    } catch {
      // toasted in useSubmit
    }
  }

  const handleCall = () => {
    if (!customer?.mobile_no) { toast.error('No phone number available.'); return }
    window.location.href = `tel:${customer.mobile_no}`
  }

  const checkinLabel = checkinTime
    ? `In at ${new Date(checkinTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
    : 'Checked in'
  const checkoutLabel = checkoutTime
    ? new Date(checkoutTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className={`bg-white rounded-2xl shadow-sm overflow-hidden border transition-colors ${
      visitStatus === VISIT_STATUS.VISITED && checkoutTime ? 'border-blue-100'
      : visitStatus === VISIT_STATUS.VISITED               ? 'border-green-100'
      : visitStatus === VISIT_STATUS.SKIPPED               ? 'border-amber-100'
      : 'border-slate-100'
    }`}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-4"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-slate-800 text-sm text-left truncate">{name}</span>
          {statusBadge && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0" />
          : <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />
        }
      </button>

      {/* ── Expanded body ──────────────────────────────────────────────── */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-50">

          {/* Contact / territory row */}
          {(customer.mobile_no || customer.territory) && (
            <div className="flex items-center gap-4 pt-3 text-xs text-slate-500">
              {customer.mobile_no && (
                <span className="flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-slate-400" />
                  {customer.mobile_no}
                </span>
              )}
              {customer.territory && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  {customer.territory}
                </span>
              )}
            </div>
          )}

          {/* ── Visit section (only when session active) ─────────────── */}
          {session?.name && (
            <div className="rounded-xl bg-slate-50 p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Visit</p>

              {!visitStatus && (
                <div className="flex gap-2">
                  <VisitBtn icon={LogIn}      label="Check In" color="green" loading={checkingIn}  onClick={handleCheckin} />
                  <VisitBtn icon={SkipForward} label="Skip"    color="amber" loading={skipping}     onClick={handleSkip}    />
                </div>
              )}

              {visitStatus === VISIT_STATUS.VISITED && !checkoutTime && (
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-xs font-medium text-green-700">
                    <LogIn className="w-3.5 h-3.5" /> {checkinLabel}
                  </div>
                  <VisitBtn icon={LogOut} label="Check Out" color="blue" loading={checkingOut} onClick={handleCheckout} />
                </div>
              )}

              {visitStatus === VISIT_STATUS.VISITED && checkoutTime && (
                <div className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                  <LogOut className="w-3.5 h-3.5" />
                  Visit complete · {checkoutLabel}
                </div>
              )}

              {visitStatus === VISIT_STATUS.SKIPPED && (
                <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  <SkipForward className="w-3.5 h-3.5" /> Customer skipped
                </div>
              )}
            </div>
          )}

          {/* ── Action bar ───────────────────────────────────────────── */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => navigate(`/customers/${customer.customer}`)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl brand-gradient py-3 text-xs font-bold text-white shadow-sm active:bg-brand-dark"
            >
              View Full Profile
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            {customer?.mobile_no && (
              <IconActionBtn icon={Phone} label="Call customer" tone="amber" onClick={handleCall} />
            )}
            <NavigateBtn customer={customer} compact />
          </div>

        </div>
      )}
    </div>
  )
}

function VisitBtn({ icon: Icon, label, color, loading, onClick }) {
  const colors = {
    green: 'bg-green-600 active:bg-green-700',
    blue:  'bg-blue-600 active:bg-blue-700',
    amber: 'bg-amber-500 active:bg-amber-600',
  }
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-60 ${colors[color]}`}
    >
      {loading ? <Spinner size="xs" className="border-white border-t-transparent" /> : <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  )
}

function NavigateBtn({ customer, compact = false }) {
  const destination = (customer.lat && customer.lng)
    ? `${customer.lat},${customer.lng}`
    : customer.address
      ? encodeURIComponent(customer.address)
      : encodeURIComponent(customer.customer_name || customer.customer)

  const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`

  if (customer?.lat == null && customer?.lng == null && !customer?.address && !customer?.customer_name && !customer?.customer) {
    return null
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open navigation"
      title="Open navigation"
      className={compact
        ? 'h-11 w-11 flex items-center justify-center rounded-xl border border-brand/20 bg-brand-50 text-brand-dark shadow-sm active:bg-brand-100'
        : 'w-full flex items-center justify-center gap-2 brand-gradient text-white font-semibold py-2.5 rounded-xl text-sm active:bg-brand-dark'}
    >
      {compact ? (
        <Navigation2 className="w-4 h-4" />
      ) : (
        <>
          <Navigation2 className="w-4 h-4" />
          Navigate with Google Maps
        </>
      )}
    </a>
  )
}

function IconActionBtn({ icon: Icon, label, tone = 'amber', onClick }) {
  const tones = {
    amber: 'border-brand/20 bg-brand-50 text-brand-dark active:bg-brand-100',
    slate: 'border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-100',
  }

  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`h-11 w-11 flex items-center justify-center rounded-xl border shadow-sm ${tones[tone] || tones.amber}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}
