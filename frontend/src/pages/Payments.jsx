import { useState } from 'react'
import { Search, IndianRupee, Calendar, AlertCircle } from 'lucide-react'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import DataList from '@/components/ui/DataList'
import CollectPaymentModal from '@/components/delivery/CollectPaymentModal'
import { fmt } from '@/lib/format'
import { useActiveCustomer, useAsync } from '@/lib/hooks'

export default function Payments() {
  const activeCustomer = useActiveCustomer()
  const dataVersion = useAppStore(s => s.dataVersion)

  const [search,            setSearch]            = useState('')
  const [collectingInvoice, setCollectingInvoice] = useState(null)

  const { data, loading, reload: fetchOutstanding } = useAsync(
    () => api.get(endpoints.getCustomerOutstanding, { params: { customer: activeCustomer.customer } }),
    [activeCustomer?.customer, dataVersion],
    { enabled: !!activeCustomer?.customer, errorMessage: 'Failed to load pending payments.', resetOnError: true },
  )
  const invoices = data?.invoices || []

  const [prevCustomer, setPrevCustomer] = useState(activeCustomer?.customer)
  if (activeCustomer?.customer !== prevCustomer) {
    setPrevCustomer(activeCustomer?.customer)
    if (!activeCustomer?.customer) setCollectingInvoice(null)
  }

  const filtered = invoices.filter((invoice) => (
    (invoice.invoice || '').toLowerCase().includes(search.toLowerCase())
    || (invoice.due_date || '').toLowerCase().includes(search.toLowerCase())
  ))

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-24">
      <PageHeader title={activeCustomer?.customer_name || 'Payments'}>
        {activeCustomer?.customer && (
          <p className="mt-2 text-xs text-white/75">
            Pending invoice payments for the checked-in customer only
          </p>
        )}
        <div className="mt-4 bg-white rounded-xl flex items-center px-3 gap-2">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search invoice"
            className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
          />
        </div>
      </PageHeader>

      <div className="px-4 pt-4 space-y-3">
        {!activeCustomer?.customer ? (
          <EmptyState
            icon={IndianRupee}
            title="No checked-in customer"
            description="Check in a customer from the Routes page to collect invoice payments."
          />
        ) : (
          <DataList
            loading={loading}
            empty={filtered.length === 0}
            emptyIcon={IndianRupee}
            emptyTitle="No pending payments"
            emptyDescription="All invoice payments for this customer are already settled."
          >
            {filtered.map((invoice) => (
              <div key={invoice.invoice} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-slate-700">{invoice.invoice}</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">₹{fmt(invoice.outstanding_amount)}</p>
                  </div>
                  {invoice.overdue ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-600">
                      <AlertCircle className="h-3 w-3" /> Overdue
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                      Pending
                    </span>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-500">
                  <div>
                    <p className="font-semibold text-slate-700">Grand Total</p>
                    <p className="mt-0.5">₹{fmt(invoice.grand_total)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700">Due Date</p>
                    <p className="mt-0.5 inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {invoice.due_date || '—'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setCollectingInvoice(invoice)}
                  className="mt-4 w-full rounded-xl brand-gradient py-3 text-sm font-semibold text-white active:bg-brand-dark"
                >
                  Collect For This Invoice
                </button>
              </div>
            ))}
          </DataList>
        )}
      </div>

      {collectingInvoice && activeCustomer && (
        <CollectPaymentModal
          invoice={collectingInvoice}
          customer={activeCustomer}
          onClose={() => setCollectingInvoice(null)}
          onCollected={() => {
            setCollectingInvoice(null)
            fetchOutstanding()
          }}
        />
      )}
    </div>
  )
}
