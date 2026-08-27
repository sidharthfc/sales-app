import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import { PageLoader } from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
import { fmt, fmtDate } from '@/lib/format'

export default function RouteOverdue() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])

  useEffect(() => {
    let cancelled = false
    api.get(endpoints.getRouteOverdueInvoices)
      .then((rows) => {
        if (cancelled) return
        const map = {}
        for (const inv of rows || []) {
          if (!map[inv.customer]) {
            map[inv.customer] = {
              customer: inv.customer,
              customer_name: inv.customer_name || inv.customer,
              total: 0,
              invoices: [],
            }
          }
          map[inv.customer].invoices.push(inv)
          map[inv.customer].total += inv.outstanding_amount || 0
        }
        setGroups(Object.values(map))
      })
      .catch((err) => !cancelled && toast.error(err.message || 'Failed to load overdue invoices.'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  if (loading) return <PageLoader />

  const routeTotal = groups.reduce((s, g) => s + g.total, 0)

  return (
    <div className="h-full overflow-y-auto bg-[#FFF8F0] pb-8">
      <div className="bg-red-600 px-4 pt-10 pb-6">
        <button onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <h1 className="text-white font-extrabold text-2xl">Overdue Invoices</h1>
        <p className="text-white/80 text-xs mt-1">
          {groups.length} customer{groups.length !== 1 ? 's' : ''} · Total ₹{fmt(routeTotal)} overdue
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No overdue invoices"
          description="All customers in today's route are up to date."
        />
      ) : (
        <div className="px-4 pt-4 space-y-3">
          {groups.map((group) => (
            <div key={group.customer} className="bg-white rounded-2xl border border-red-100 overflow-hidden">
              <button
                onClick={() => navigate(`/customers/${encodeURIComponent(group.customer)}`)}
                className="w-full flex items-center justify-between px-4 py-3 bg-red-50 text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 text-sm truncate">{group.customer_name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{group.customer}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className="font-extrabold text-red-600 text-base">₹{fmt(group.total)}</p>
                  <p className="text-[10px] text-slate-400">
                    {group.invoices.length} invoice{group.invoices.length !== 1 ? 's' : ''} →
                  </p>
                </div>
              </button>

              <div className="divide-y divide-slate-50">
                {group.invoices.map((inv) => (
                  <div key={inv.name} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700">{inv.name}</p>
                      <p className="text-[10px] text-slate-400">Due {fmtDate(inv.due_date)}</p>
                    </div>
                    <p className="text-sm font-bold text-red-600 flex-shrink-0">
                      ₹{fmt(inv.outstanding_amount)}
                    </p>
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
