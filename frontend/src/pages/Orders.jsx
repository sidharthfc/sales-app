import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Package, Truck, CircleCheck, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import OrangeHeader from '@/components/shared/OrangeHeader'
import EmptyState from '@/components/shared/EmptyState'
import StatCard from '@/components/ui/StatCard'
import FilterTabs from '@/components/ui/FilterTabs'
import DataList from '@/components/ui/DataList'
import DeliverOrderModal from '@/components/delivery/DeliverOrderModal'
import { fmt } from '@/lib/format'
import { useActiveCustomer } from '@/lib/hooks'
import { PAGE_SIZE } from '@/lib/constants'

const STATUS_FILTERS = [
  { key: 'all',              label: 'All Orders' },
  { key: 'pending_delivery', label: 'Pending Delivery' },
  { key: 'completed_order',  label: 'Completed' },
]

export default function Orders() {
  const navigate       = useNavigate()
  const activeCustomer = useActiveCustomer()
  const transactionVersion = useAppStore(s => s.transactionVersion)

  const [search,          setSearch]          = useState('')
  const [statusFilter,    setStatusFilter]    = useState('all')
  const [loading,         setLoading]         = useState(true)
  const [orders,          setOrders]          = useState([])
  const [deliveringOrder, setDeliveringOrder] = useState(null)
  const [summary,         setSummary]         = useState(null)

  const fetchOrders = useCallback(async () => {
    if (!activeCustomer?.customer) {
      setOrders([])
      setSummary(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await api.get(endpoints.getOrders, {
        params: {
          customer:    activeCustomer.customer,
          page_length: PAGE_SIZE,
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        },
      })
      setOrders(result?.orders || [])
      setSummary(result?.summary || null)
    } catch (err) {
      toast.error(err.message || 'Failed to load orders.')
      setOrders([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [activeCustomer?.customer, statusFilter])

  useEffect(() => { fetchOrders() }, [fetchOrders, transactionVersion])
  useEffect(() => { if (!activeCustomer?.customer) setDeliveringOrder(null) }, [activeCustomer?.customer])

  const filtered = useMemo(() => orders.filter((order) => (
    (order.sales_order || '').toLowerCase().includes(search.toLowerCase())
    || order.items?.some((item) => (item.item_name || '').toLowerCase().includes(search.toLowerCase()))
  )), [orders, search])

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-24">
      <OrangeHeader title={activeCustomer?.customer_name || 'Orders'} onBack={() => navigate('/dashboard')}>
        {activeCustomer?.customer && (
          <p className="mt-2 text-xs text-white/75">Order details for the checked-in customer</p>
        )}
        <div className="mt-4 bg-white rounded-xl flex items-center px-3 gap-2">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search order or item"
            className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
          />
        </div>
      </OrangeHeader>

      <div className="px-4 pt-4 space-y-3">
        {!activeCustomer?.customer ? (
          <EmptyState
            icon={Package}
            title="No checked-in customer"
            description="Check in a customer from the Routes page to see order details."
          />
        ) : (
          <>
            {summary && (
              <div className="grid grid-cols-3 gap-2">
                <StatCard label="Orders"    value={summary.total_orders || 0} />
                <StatCard label="Pending"   value={summary.pending_delivery || 0}   valueClass="text-brand-dark" />
                <StatCard label="Completed" value={summary.completed_orders || 0}   valueClass="text-green-600" />
              </div>
            )}

            <FilterTabs tabs={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

            <DataList
              loading={loading}
              empty={filtered.length === 0}
              emptyIcon={Package}
              emptyTitle="No orders found"
              emptyDescription="Try another filter or search term for this checked-in customer."
            >
              {filtered.map((order) => (
                <div key={order.sales_order} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-slate-700">{order.sales_order}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          order.has_pending_delivery ? 'bg-orange-50 text-brand-dark' : 'bg-green-50 text-green-700'
                        }`}>
                          {order.has_pending_delivery
                            ? <ClipboardList className="h-3.5 w-3.5" />
                            : <CircleCheck className="h-3.5 w-3.5" />
                          }
                          {order.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        Order date {order.date} {order.delivery_date ? `· Delivery ${order.delivery_date}` : ''}
                      </p>
                    </div>
                    <p className="text-lg font-bold text-brand-dark">₹{fmt(order.grand_total)}</p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 px-3 py-3 text-xs">
                    <div>
                      <p className="font-semibold text-slate-700">Delivered</p>
                      <p className="mt-0.5 text-slate-500">₹{fmt(order.delivered_value)}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700">Pending Delivery</p>
                      <p className="mt-0.5 text-slate-500">₹{fmt(order.pending_delivery_value)}</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                    {order.items?.map((item) => (
                      <div key={`${order.sales_order}-${item.item_code}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">{item.item_name}</p>
                          <p className="text-xs text-slate-400">{item.item_code}</p>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          <p>
                            {item.pending_qty > 0 ? `${item.pending_qty} pending` : `${item.qty} delivered`} {item.uom}
                          </p>
                          <p className="mt-0.5 font-semibold text-slate-700">₹{fmt(item.amount)}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {order.has_pending_delivery ? (
                    <button
                      onClick={() => setDeliveringOrder(order)}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white active:bg-brand-dark"
                    >
                      <Truck className="h-4 w-4" />
                      Deliver
                    </button>
                  ) : (
                    <div className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-center text-sm font-semibold text-green-700">
                      Order completed
                    </div>
                  )}
                </div>
              ))}
            </DataList>
          </>
        )}
      </div>

      {deliveringOrder && (
        <DeliverOrderModal
          order={deliveringOrder}
          onClose={() => setDeliveringOrder(null)}
          onDelivered={() => { setDeliveringOrder(null); fetchOrders() }}
        />
      )}
    </div>
  )
}
