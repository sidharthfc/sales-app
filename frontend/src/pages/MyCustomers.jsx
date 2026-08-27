import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, Users, Phone, AlertCircle, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import { PageLoader } from '@/components/shared/Spinner'
import { fmt } from '@/lib/format'

export default function MyCustomers() {
  const navigate = useNavigate()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.get(endpoints.getMyCustomers)
      .then(setData)
      .catch(err => toast.error(err.message || 'Failed to load customers.'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!data?.customers) return []
    const q = search.toLowerCase()
    if (!q) return data.customers
    return data.customers.filter(c =>
      (c.customer_name || '').toLowerCase().includes(q) ||
      (c.customer || '').toLowerCase().includes(q) ||
      (c.mobile_no || '').includes(q) ||
      (c.territory || '').toLowerCase().includes(q)
    )
  }, [data, search])

  if (loading) return <PageLoader />

  return (
    <div className="h-full flex flex-col bg-app-bg">

      {/* Header */}
      <div
        className="relative overflow-hidden px-4 pt-10 pb-5 flex-shrink-0 brand-gradient"
      >
        <div className="pointer-events-none absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10" />
        <button onClick={() => navigate(-1)}
          className="relative z-10 w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <h1 className="text-white font-extrabold text-2xl relative z-10">Route Customers</h1>
        {data && (
          <p className="text-white/75 text-xs mt-0.5 relative z-10">
            {data.route ? `${data.route} · ` : ''}{data.total} customers
          </p>
        )}
        {/* Search */}
        <div className="relative z-10 mt-3 bg-white rounded-xl flex items-center px-3 gap-2">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, phone, territory…"
            className="flex-1 py-2.5 text-sm bg-transparent outline-none text-slate-700 placeholder-slate-400"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
            <Users className="w-10 h-10 opacity-30" />
            <p className="text-sm">{search ? 'No customers match your search.' : 'No customers on this route.'}</p>
          </div>
        ) : filtered.map(c => (
          <div
            key={c.customer}
            className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
          >
            {/* Main row — tapping navigates */}
            <div
              onClick={() => navigate(`/customers/${c.customer}`)}
              className="flex items-center gap-3 p-4 active:bg-slate-50"
            >
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                <span className="text-base font-bold text-brand-dark">
                  {(c.customer_name || c.customer)?.[0]?.toUpperCase()}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{c.customer_name}</p>
                <p className="text-[10px] text-slate-400 font-mono">{c.customer}</p>
                {c.territory && (
                  <p className="text-[10px] text-slate-400 mt-0.5">{c.territory}</p>
                )}
              </div>

              <div className="text-right flex-shrink-0">
                {c.total_outstanding > 0 ? (
                  <>
                    <p className={`text-sm font-bold ${c.overdue_amount > 0 ? 'text-red-500' : 'text-brand-dark'}`}>
                      ₹{fmt(c.total_outstanding)}
                    </p>
                    {c.overdue_amount > 0 && (
                      <span className="flex items-center justify-end gap-0.5 text-[10px] font-semibold text-red-500 mt-0.5">
                        <AlertCircle className="w-3 h-3" /> Overdue
                      </span>
                    )}
                  </>
                ) : (
                  <p className="text-xs font-semibold text-green-600">Settled</p>
                )}
                {c.last_visit && (
                  <p className="text-[10px] text-slate-400 mt-1">Last: {c.last_visit}</p>
                )}
              </div>

              <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
            </div>

            {/* Call row — separate tap target, never triggers navigation */}
            {c.mobile_no && (
              <div
                onClick={() => { window.location.href = `tel:${c.mobile_no}` }}
                className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-50 bg-orange-50 active:bg-orange-100"
              >
                <Phone className="w-3.5 h-3.5 text-brand" />
                <span className="text-xs font-semibold text-brand-dark">{c.mobile_no}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
