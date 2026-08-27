import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Phone, MapPin, ArrowLeft, Package, IndianRupee,
  Truck, AlertCircle, LogIn, LogOut, SkipForward,
} from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { PageLoader } from '@/components/shared/Spinner'
import Spinner from '@/components/shared/Spinner'
import DeliverOrderModal from '@/components/delivery/DeliverOrderModal'
import CollectPaymentModal from '@/components/delivery/CollectPaymentModal'
import { fmt } from '@/lib/format'
import { isCustomerCheckedIn } from '@/lib/customerContext'

export default function CustomerDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const customers = useAppStore(s => s.customers)
  const transactionVersion = useAppStore(s => s.transactionVersion)
  const isEditable = isCustomerCheckedIn(customers, id)

  const [cust,     setCust]     = useState(null)
  const [loading,  setLoading]  = useState(true)

  // Pending orders
  const [orders,       setOrders]       = useState(null)
  const [ordersLoading, setOrdersLoading] = useState(true)

  // Outstanding invoices
  const [outstanding,       setOutstanding]       = useState(null)
  const [outstandingLoading, setOutstandingLoading] = useState(true)

  // Active tab
  const [tab, setTab] = useState('orders')  // 'orders' | 'outstanding'

  // Modals
  const [deliveringOrder,   setDeliveringOrder]   = useState(null)
  const [collectingInvoice, setCollectingInvoice] = useState(null)

  useEffect(() => {
    let cancelled = false

    api.get(endpoints.getCustomer, { params: { customer: id } })
      .then(data => {
        if (cancelled) return
        setCust(data)
      })
      .catch(err => {
        if (!cancelled) toast.error(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    if (!id) return undefined

    api.get(endpoints.getPendingOrders, { params: { customer: id } })
      .then(data => {
        if (!cancelled) setOrders(Array.isArray(data) ? data : (data?.orders || []))
      })
      .catch(() => {
        if (!cancelled) setOrders([])
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id, transactionVersion])

  useEffect(() => {
    let cancelled = false
    if (!id) return undefined

    api.get(endpoints.getCustomerOutstanding, { params: { customer: id } })
      .then(data => {
        if (!cancelled) setOutstanding(data?.invoices || [])
      })
      .catch(() => {
        if (!cancelled) setOutstanding([])
      })
      .finally(() => {
        if (!cancelled) setOutstandingLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) return <PageLoader />
  if (!cust)   return <div className="p-4 text-slate-500">Customer not found.</div>

  const fin             = cust.financials || {}
  const pendingCount    = orders?.length || 0
  const outstandingCount = outstanding?.length || 0
  const customer        = { customer: id, customer_name: cust.customer_name }

  return (
    <div className="flex flex-col h-full bg-[#FFF8F0]">

      {/* Header */}
      <div
        className="relative overflow-hidden px-4 pt-4 pb-16 brand-gradient"
      >
        <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute top-16 -right-6 h-24 w-24 rounded-full bg-white/10" />
        <button onClick={() => navigate(-1)}
          className="relative z-10 w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-bold text-white">{cust.customer_name?.[0]}</span>
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{cust.customer_name}</h2>
            <div className="flex items-center gap-2 text-white/75 text-xs mt-0.5">
              {cust.territory && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{cust.territory}</span>}
              {cust.mobile_no && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{cust.mobile_no}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Financial summary cards */}
      <div className="px-4 -mt-10 mb-3 relative z-10">
        <div className="grid grid-cols-2 gap-2">
          <FinCard
            label="Outstanding"
            value={`₹${fmt(fin.total_outstanding)}`}
            sub={fin.overdue_amount > 0 ? `₹${fmt(fin.overdue_amount)} overdue` : 'No overdue'}
            accent={fin.total_outstanding > 0 ? 'amber' : 'green'}
          />
          <FinCard
            label="Total Billed"
            value={`₹${fmt(fin.total_billed)}`}
            sub={`₹${fmt(fin.total_paid)} paid`}
            accent="orange"
          />
        </div>
      </div>

      {/* Visit stats */}
      <div className="px-4 mb-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Visit History</p>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-green-50 rounded-lg flex items-center justify-center">
                <LogIn className="w-3.5 h-3.5 text-green-600" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-800">{cust.total_visits ?? 0}</p>
                <p className="text-[10px] text-slate-400">Check-ins</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 bg-amber-50 rounded-lg flex items-center justify-center">
                <SkipForward className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-800">{cust.total_skipped ?? 0}</p>
                <p className="text-[10px] text-slate-400">Skipped</p>
              </div>
            </div>
            {cust.last_visit && (
              <div className="flex-1 text-right">
                {cust.last_visit.checkout_time ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-orange-50 text-brand-dark px-2 py-1 rounded-full">
                    <LogOut className="w-3 h-3" /> Checked Out
                  </span>
                ) : cust.last_visit.visit_status === 'Visited' ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-green-50 text-green-700 px-2 py-1 rounded-full">
                    <LogIn className="w-3 h-3" /> Checked In
                  </span>
                ) : null}
                <p className="text-[10px] text-slate-400 mt-0.5">Last: {cust.last_visit.date || '—'}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 flex gap-2 mb-3">
        <TabBtn
          active={tab === 'orders'}
          onClick={() => setTab('orders')}
          icon={Package}
          label="Pending Orders"
          count={pendingCount}
          activeColor="orange"
        />
        <TabBtn
          active={tab === 'outstanding'}
          onClick={() => setTab('outstanding')}
          icon={IndianRupee}
          label="Outstanding"
          count={outstandingCount}
          activeColor="amber"
        />
      </div>

      {!isEditable && (
        <div className="px-4 mb-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
            This customer is checked out. Dealings are now read-only.
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">

        {tab === 'orders' && (
          ordersLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : !orders || orders.length === 0 ? (
            <EmptyCard icon={Package} text="No pending orders" />
          ) : (
            orders.map(so => (
              <div key={so.sales_order} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-xs font-mono font-semibold text-slate-700">{so.sales_order}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{so.date}{so.delivery_date ? ` · Due ${so.delivery_date}` : ''}</p>
                  </div>
                  <span className="text-xs font-semibold bg-orange-50 text-brand-dark px-2 py-0.5 rounded-full flex-shrink-0">
                    {so.status}
                  </span>
                </div>
                <div className="space-y-1 mb-3">
                  {so.items.map(item => (
                    <div key={item.item_code} className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 truncate flex-1">{item.item_name}</span>
                      <span className="text-slate-400 ml-2 flex-shrink-0">{item.pending_qty} {item.uom}</span>
                      <span className="text-slate-700 font-semibold ml-3 flex-shrink-0">₹{fmt(item.pending_qty * item.rate)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <p className="text-sm font-bold text-slate-800">₹{fmt(so.grand_total)}</p>
                  {isEditable ? (
                    <button
                      onClick={() => setDeliveringOrder(so)}
                      className="flex items-center gap-1.5 bg-brand text-white text-xs font-semibold px-4 py-2 rounded-xl active:bg-brand-dark"
                    >
                      <Truck className="w-3.5 h-3.5" /> Deliver
                    </button>
                  ) : (
                    <span className="text-[11px] font-semibold text-slate-400">Read only</span>
                  )}
                </div>
              </div>
            ))
          )
        )}

        {tab === 'outstanding' && (
          outstandingLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : !outstanding || outstanding.length === 0 ? (
            <EmptyCard icon={IndianRupee} text="No outstanding invoices" />
          ) : (
            outstanding.map(inv => (
              <div key={inv.invoice} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-xs font-mono font-semibold text-slate-700">{inv.invoice}</p>
                  {inv.overdue && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex-shrink-0">
                      <AlertCircle className="w-3 h-3" /> Overdue
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  Due {inv.due_date || '—'} · Invoice date {inv.date || '—'}
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-bold text-slate-900">₹{fmt(inv.outstanding_amount)}</p>
                    {inv.grand_total && inv.grand_total !== inv.outstanding_amount && (
                      <p className="text-xs text-slate-400">of ₹{fmt(inv.grand_total)} total</p>
                    )}
                  </div>
                  {isEditable ? (
                    <button
                      onClick={() => setCollectingInvoice(inv)}
                      className="flex items-center gap-1.5 bg-amber-500 text-white text-xs font-semibold px-4 py-2 rounded-xl active:bg-amber-600"
                    >
                      <IndianRupee className="w-3.5 h-3.5" /> Collect
                    </button>
                  ) : (
                    <span className="text-[11px] font-semibold text-slate-400">Read only</span>
                  )}
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* Modals */}
      {isEditable && deliveringOrder && (
        <DeliverOrderModal
          order={deliveringOrder}
          onClose={() => setDeliveringOrder(null)}
          onDelivered={() => {
            setOrders(null)
            setOutstanding(null)
            setDeliveringOrder(null)
            setOrdersLoading(true)
            setOutstandingLoading(true)
            api.get(endpoints.getPendingOrders, { params: { customer: id } })
              .then(data => setOrders(Array.isArray(data) ? data : (data?.orders || [])))
              .catch(() => setOrders([]))
              .finally(() => setOrdersLoading(false))
            api.get(endpoints.getCustomerOutstanding, { params: { customer: id } })
              .then(data => setOutstanding(data?.invoices || []))
              .catch(() => setOutstanding([]))
              .finally(() => setOutstandingLoading(false))
          }}
        />
      )}

      {isEditable && collectingInvoice && (
        <CollectPaymentModal
          invoice={collectingInvoice}
          customer={customer}
          onClose={() => setCollectingInvoice(null)}
          onCollected={() => {
            setOutstanding(null)
            setCollectingInvoice(null)
            // Reload
            setOutstandingLoading(true)
            api.get(endpoints.getCustomerOutstanding, { params: { customer: id } })
              .then(data => setOutstanding(data?.invoices || []))
              .catch(() => setOutstanding([]))
              .finally(() => setOutstandingLoading(false))
          }}
        />
      )}
    </div>
  )
}

function FinCard({ label, value, sub, accent }) {
  const colors = {
    orange:{ val: 'text-brand-dark', bg: 'bg-orange-50', sub: 'text-brand' },
    amber: { val: 'text-amber-600', bg: 'bg-amber-50', sub: 'text-amber-500' },
    green: { val: 'text-green-600', bg: 'bg-green-50', sub: 'text-green-500' },
  }
  const c = colors[accent] || colors.orange
  return (
    <div className={`${c.bg} rounded-2xl p-3 shadow-sm`}>
      <p className={`text-lg font-bold ${c.val}`}>{value}</p>
      <p className="text-xs font-medium text-slate-600 mt-0.5">{label}</p>
      <p className={`text-[11px] mt-0.5 ${c.sub}`}>{sub}</p>
    </div>
  )
}

function TabBtn({ active, onClick, icon: Icon, label, count, activeColor }) {
  const active_cls = activeColor === 'amber'
    ? 'border-amber-500 bg-amber-50 text-amber-700'
    : 'border-brand bg-orange-50 text-brand-dark'
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 text-xs font-semibold transition-colors ${
        active ? active_cls : 'border-slate-200 bg-white text-slate-500'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {count > 0 && (
        <span className={`ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/60' : 'bg-slate-100'}`}>
          {count}
        </span>
      )}
    </button>
  )
}

function EmptyCard({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
      <Icon className="w-8 h-8 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  )
}
