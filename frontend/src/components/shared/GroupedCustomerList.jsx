import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import { fmt } from '@/lib/format'

// GroupedCustomerList — colored header + summary line + per-customer cards for
// route pages built on useGroupedByCustomer (RouteOverdue, RoutePendingOrders).
// `renderItem` returns the inner content of one row inside a customer's card
// (the wrapping key/li and layout classes are owned by this component); rows
// are otherwise page-specific (different fields, different pill/labels).
//
// Usage:
//   <GroupedCustomerList
//     title="Overdue Invoices"
//     theme={{ header: 'bg-red-600', card: 'border-red-100', row: 'bg-red-50', total: 'text-red-600' }}
//     groups={groups}
//     summary={`${groups.length} customer${groups.length !== 1 ? 's' : ''} · Total ₹${fmt(total)} overdue`}
//     emptyIcon={CheckCircle2}
//     emptyTitle="No overdue invoices"
//     emptyDescription="All customers in today's route are up to date."
//     itemCountLabel="invoice"
//     renderItem={(inv) => (...)}
//   />
export default function GroupedCustomerList({
  title,
  theme,
  groups,
  summary,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  itemCountLabel,
  renderItem,
}) {
  const navigate = useNavigate()

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-8">
      <div className={`${theme.header} px-4 pt-10 pb-6`}>
        <button onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <h1 className="text-white font-extrabold text-2xl">{title}</h1>
        <p className="text-white/80 text-xs mt-1">{summary}</p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <div className="px-4 pt-4 space-y-3">
          {groups.map((group) => (
            <div key={group.customer} className={`bg-white rounded-2xl border ${theme.card} overflow-hidden`}>
              <button
                onClick={() => navigate(`/customers/${encodeURIComponent(group.customer)}`)}
                className={`w-full flex items-center justify-between px-4 py-3 ${theme.row} text-left`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 text-sm truncate">{group.customer_name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{group.customer}</p>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <p className={`font-extrabold ${theme.total} text-base`}>₹{fmt(group.total)}</p>
                  <p className="text-[10px] text-slate-400">
                    {group.items.length} {itemCountLabel}{group.items.length !== 1 ? 's' : ''} →
                  </p>
                </div>
              </button>

              <div className="divide-y divide-slate-50">
                {group.items.map((item) => (
                  <div key={item.name} className="flex items-center justify-between px-4 py-2.5">
                    {renderItem(item)}
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
