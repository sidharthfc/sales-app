import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import { PageLoader } from '@/components/shared/Spinner'
import GroupedCustomerList from '@/components/shared/GroupedCustomerList'
import { useGroupedByCustomer } from '@/lib/hooks'
import { fmt, fmtDate } from '@/lib/format'

const THEME = { header: 'bg-red-600', card: 'border-red-100', row: 'bg-red-50', total: 'text-red-600' }

export default function RouteOverdue() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])

  useEffect(() => {
    let cancelled = false
    api.get(endpoints.getRouteOverdueInvoices)
      .then((data) => { if (!cancelled) setRows(data) })
      .catch((err) => !cancelled && toast.error(err.message || 'Failed to load overdue invoices.'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  const { groups, total } = useGroupedByCustomer(rows, 'outstanding_amount')

  if (loading) return <PageLoader />

  return (
    <GroupedCustomerList
      title="Overdue Invoices"
      theme={THEME}
      groups={groups}
      summary={`${groups.length} customer${groups.length !== 1 ? 's' : ''} · Total ₹${fmt(total)} overdue`}
      emptyIcon={CheckCircle2}
      emptyTitle="No overdue invoices"
      emptyDescription="All customers in today's route are up to date."
      itemCountLabel="invoice"
      renderItem={(inv) => (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-700">{inv.name}</p>
            <p className="text-[10px] text-slate-400">Due {fmtDate(inv.due_date)}</p>
          </div>
          <p className="text-sm font-bold text-red-600 flex-shrink-0">
            ₹{fmt(inv.outstanding_amount)}
          </p>
        </>
      )}
    />
  )
}
