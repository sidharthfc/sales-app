import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import { PageLoader } from '@/components/shared/Spinner'
import GroupedCustomerList from '@/components/shared/GroupedCustomerList'
import { useGroupedByCustomer } from '@/lib/hooks'
import { fmt, fmtDate } from '@/lib/format'

const THEME = { header: 'brand-gradient', card: 'border-orange-100', row: 'bg-orange-50', total: 'text-brand-dark' }

export default function RoutePendingOrders() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])

  useEffect(() => {
    let cancelled = false
    api.get(endpoints.getRoutePendingOrders)
      .then((data) => { if (!cancelled) setRows(data) })
      .catch((err) => !cancelled && toast.error(err.message || 'Failed to load pending orders.'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  const { groups, count } = useGroupedByCustomer(rows, 'grand_total')

  if (loading) return <PageLoader />

  return (
    <GroupedCustomerList
      title="Pending Deliveries"
      theme={THEME}
      groups={groups}
      summary={`${count} order${count !== 1 ? 's' : ''} across ${groups.length} customer${groups.length !== 1 ? 's' : ''}`}
      emptyIcon={CheckCircle2}
      emptyTitle="No pending deliveries"
      emptyDescription="All orders in today's route are delivered."
      itemCountLabel="order"
      renderItem={(order) => (
        <>
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
        </>
      )}
    />
  )
}
