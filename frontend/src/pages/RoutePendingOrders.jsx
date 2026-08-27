import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import { PageLoader } from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
import { fmt, fmtDate } from '@/lib/format'

export default function RoutePendingOrders() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])

  useEffect(() => {
    let cancelled = false
    api.get(endpoints.getRoutePendingOrders)
      .then((rows) => {
        if (cancelled) return
        const map = {}
        for (const order of rows || []) {
          if (!map[order.customer]) {
            map[order.customer] = {
              customer: order.customer,
              customer_name: order.customer_name || order.customer,
              total: 0,
              orders: [],
            }
          }
          map[order.customer].orders.push(order)
          map[order.customer].total += order.grand_total || 0
        }
        setGroups(Object.values(map))
      })
      .catch((err) => !cancelled && toast.error(err.message || 'Failed to load pending orders.'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  if (loading) return <PageLoader />

  const totalOrders = groups.reduce((s, g) => s + g.orders.length, 0)

  return (
    <div className="h-full overflow-y-auto bg-[#FFF8F0] pb-8">
      <div className="brand-gradient px-4 pt-10 pb-6">
        <button onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <h1 className="text-white font-extrabold text-2xl">Pending Deliveries</h1>
        <p className="text-white/80 text-xs mt-1">
          {totalOrders} order{totalOrders !== 1 ? 's' : ''} across {groups.length} customer{groups.length !== 1 ? 's' : ''}
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No pending deliveries"
          description="All orders in today's route are delivered."
        />
      ) : (
        <div className="px-4 pt-4 space-y-3">
          {groups.map((group) => (
            <div key={group.customer} className="bg-white rounded-2xl border border-orange-100 overflow-hidden">
              <button
                onClick={() => navigate(`/customers/${encodeURIComponent(group.customer)}`)}
                className="w-full flex items-center justify-between px-4 py-3 bg-orange-50 text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 text-sm truncate">{group.customer_name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{group.customer}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="font-extrabold text-brand-dark text-base">₹{fmt(group.total)}</p>
                  <p className="text-[10px] text-slate-400">
                    {group.orders.length} order{group.orders.length !== 1 ? 's' : ''} →
                  </p>
                </div>
              </button>

              <div className="divide-y divide-slate-50">
                {group.orders.map((order) => (
                  <div key={order.name} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700">{order.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {fmtDate(order.transaction_date)}
                        {order.delivery_date ? ` · Deliver by ${fmtDate(order.delivery_date)}` : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <p className="text-sm font-bold text-brand-dark">₹{fmt(order.grand_total)}</p>
                      <span className="inline-block bg-orange-50 px-2 py-0.5 rounded-full text-[9px] font-semibold text-orange-700 mt-0.5">
                        {order.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
