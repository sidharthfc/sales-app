import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Receipt, Calendar, IndianRupee, CircleAlert, CircleCheck } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import OrangeHeader from '@/components/shared/OrangeHeader'
import EmptyState from '@/components/shared/EmptyState'
import StatCard from '@/components/ui/StatCard'
import FilterTabs from '@/components/ui/FilterTabs'
import DataList from '@/components/ui/DataList'
import { fmt } from '@/lib/format'
import { useActiveCustomer } from '@/lib/hooks'
import { PAGE_SIZE } from '@/lib/constants'

const STATUS_FILTERS = [
  { key: 'all',          label: 'All' },
  { key: 'Paid',         label: 'Paid' },
  { key: 'Unpaid',       label: 'Pending' },
  { key: 'Partly Paid',  label: 'Partly Paid' },
  { key: 'Overdue',      label: 'Overdue' },
]

function statusTone(invoice) {
  if (invoice.is_return) return 'bg-slate-100 text-slate-700'
  if ((invoice.outstanding_amount || 0) <= 0) return 'bg-green-50 text-green-700'
  if (invoice.status === 'Overdue') return 'bg-red-50 text-red-700'
  if ((invoice.paid_amount || 0) > 0) return 'bg-amber-50 text-amber-700'
  return 'bg-orange-50 text-brand-dark'
}

export default function Invoices() {
  const navigate       = useNavigate()
  const activeCustomer = useActiveCustomer()
  const transactionVersion = useAppStore(s => s.transactionVersion)

  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading,      setLoading]      = useState(true)
  const [invoices,     setInvoices]     = useState([])
  const [summary,      setSummary]      = useState(null)

  const fetchInvoices = useCallback(async () => {
    if (!activeCustomer?.customer) {
      setInvoices([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await api.get(endpoints.getInvoices, {
        params: {
          customer:    activeCustomer.customer,
          page_length: PAGE_SIZE,
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        },
      })
      setInvoices(result?.invoices || [])
      setSummary(result?.summary || null)
    } catch (err) {
      toast.error(err.message || 'Failed to load invoices.')
      setInvoices([])
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [activeCustomer?.customer, statusFilter])

  useEffect(() => { fetchInvoices() }, [fetchInvoices, transactionVersion])

  const filtered = invoices.filter((invoice) => (
    (invoice.name || '').toLowerCase().includes(search.toLowerCase())
    || invoice.items?.some((item) => (item.item_name || '').toLowerCase().includes(search.toLowerCase()))
  ))

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-24">
      <OrangeHeader title={activeCustomer?.customer_name || 'Invoices'} onBack={() => navigate('/dashboard')}>
        {activeCustomer?.customer && (
          <p className="mt-2 text-xs text-white/75">Invoice details for the checked-in customer only</p>
        )}
        <div className="mt-4 bg-white rounded-xl flex items-center px-3 gap-2">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search invoice or item"
            className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
          />
        </div>
      </OrangeHeader>

      <div className="px-4 pt-4 space-y-3">
        {!activeCustomer?.customer ? (
          <EmptyState
            icon={Receipt}
            title="No checked-in customer"
            description="Check in a customer from the Routes page to see invoice details."
          />
        ) : (
          <>
            {summary && (
              <div className="grid grid-cols-3 gap-2">
                <StatCard label="Invoices"     value={summary.total_invoices || 0} />
                <StatCard label="Paid"         value={`₹${fmt(summary.total_paid)}`}        valueClass="text-green-600" />
                <StatCard label="Outstanding"  value={`₹${fmt(summary.total_outstanding)}`} valueClass="text-brand-dark" />
              </div>
            )}

            <FilterTabs tabs={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />

            <DataList
              loading={loading}
              empty={filtered.length === 0}
              emptyIcon={Receipt}
              emptyTitle="No invoices found"
              emptyDescription="Try another filter or search term for this checked-in customer."
            >
              {filtered.map((invoice) => (
                <div key={invoice.name} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-slate-700">{invoice.name}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(invoice)}`}>
                          {(invoice.outstanding_amount || 0) <= 0
                            ? <CircleCheck className="h-3.5 w-3.5" />
                            : <CircleAlert className="h-3.5 w-3.5" />
                          }
                          {invoice.is_return ? 'Return' : invoice.status}
                        </span>
                        {invoice.return_against && (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                            Against {invoice.return_against}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400">
                        <Calendar className="h-3 w-3" /> {invoice.posting_date}
                        {invoice.due_date ? ` · Due ${invoice.due_date}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-brand-dark">₹{fmt(invoice.grand_total)}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        Outstanding ₹{fmt(invoice.outstanding_amount)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 px-3 py-3 text-xs">
                    <div>
                      <p className="font-semibold text-slate-700">Paid</p>
                      <p className="mt-0.5 text-slate-500">₹{fmt(invoice.paid_amount)}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700">Outstanding</p>
                      <p className="mt-0.5 text-slate-500">₹{fmt(invoice.outstanding_amount)}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Items</p>
                    <div className="mt-2 space-y-2">
                      {invoice.items?.map((item) => (
                        <div key={`${invoice.name}-${item.item_code}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800">{item.item_name}</p>
                            <p className="text-xs text-slate-400">{item.item_code}</p>
                          </div>
                          <div className="text-right text-xs text-slate-500">
                            <p>{item.qty} {item.uom}</p>
                            <p className="mt-0.5 font-semibold text-slate-700">₹{fmt(item.amount)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Payments</p>
                    {invoice.payments?.length ? (
                      <div className="mt-2 space-y-2">
                        {invoice.payments.map((payment) => (
                          <div key={`${invoice.name}-${payment.payment_entry}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-xs">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-700">{payment.payment_entry}</p>
                              <p className="text-slate-400">{payment.mode_of_payment} · {payment.posting_date}</p>
                            </div>
                            <p className="font-semibold text-green-600 inline-flex items-center gap-1">
                              <IndianRupee className="h-3 w-3" />
                              {fmt(payment.paid_amount)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">No payments recorded for this invoice.</p>
                    )}
                  </div>
                </div>
              ))}
            </DataList>
          </>
        )}
      </div>
    </div>
  )
}
