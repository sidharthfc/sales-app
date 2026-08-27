import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Package, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { PageLoader } from '@/components/shared/Spinner'

export default function VanStock() {
  const navigate = useNavigate()
  const session             = useAppStore(s => s.session)
  const transactionVersion  = useAppStore(s => s.transactionVersion)
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadSessionStock = async () => {
      if (!session?.name) {
        if (!cancelled) {
          setData(null)
          setLoading(false)
        }
        return
      }

      setLoading(true)
      try {
        const nextData = await api.get(endpoints.getSessionStock, { params: { route_session: session.name } })
        if (!cancelled) setData(nextData)
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load van stock.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadSessionStock()
    return () => {
      cancelled = true
    }
  }, [session?.name, transactionVersion])

  if (loading) return <PageLoader />

  return (
    <div className="h-full overflow-y-auto bg-app-bg pb-8">

      {/* Header */}
      <div
        className="relative overflow-hidden px-4 pt-10 pb-6 brand-gradient"
      >
        <div className="pointer-events-none absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10" />
        <button onClick={() => navigate(-1)}
          className="relative z-10 w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </button>
        <h1 className="text-white font-extrabold text-2xl relative z-10">Van Stock</h1>
        {session?.name && (
          <p className="text-white/75 text-xs mt-1 relative z-10">{session.name}</p>
        )}
      </div>

      <div className="px-4 pt-4 space-y-3">
        {!session?.name ? (
          <EmptyBlock icon={Package} text="No active session" sub="Start a route session to see van stock." />
        ) : !data?.has_stock ? (
          <EmptyBlock icon={Package} text="No stock recorded" sub="Stock is entered when starting your route session." />
        ) : (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-2">
              <SummaryCard label="Loaded"    value={data.items.reduce((s, i) => s + i.qty_loaded, 0)}    color="text-slate-800" />
              <SummaryCard label="Delivered" value={data.items.reduce((s, i) => s + i.qty_delivered, 0)} color="text-brand-dark" />
              <SummaryCard label="Remaining" value={data.items.reduce((s, i) => s + i.qty_remaining, 0)} color="text-green-600" />
            </div>

            {/* Item list */}
            <div className="space-y-2">
              {data.items.map(item => {
                const deliveredPct = item.qty_loaded > 0 ? (item.qty_delivered / item.qty_loaded) * 100 : 0
                const isLow        = item.qty_remaining > 0 && item.qty_remaining / item.qty_loaded < 0.2
                const isDepleted   = item.qty_remaining === 0 && item.qty_loaded > 0

                return (
                  <div key={item.item_code} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{item.item_name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{item.item_code}</p>
                      </div>
                      {isDepleted ? (
                        <span className="flex items-center gap-1 text-[10px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full flex-shrink-0">
                          All Delivered
                        </span>
                      ) : isLow ? (
                        <span className="flex items-center gap-1 text-[10px] font-semibold bg-red-50 text-red-600 px-2 py-0.5 rounded-full flex-shrink-0">
                          <AlertCircle className="w-3 h-3" /> Low
                        </span>
                      ) : null}
                    </div>

                    {/* Progress bar — shows delivered vs loaded */}
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-brand rounded-full transition-all"
                        style={{ width: `${Math.min(deliveredPct, 100)}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-xs text-slate-400">Loaded</p>
                        <p className="text-base font-bold text-slate-700">{item.qty_loaded}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Delivered</p>
                        <p className="text-base font-bold text-brand-dark">{item.qty_delivered}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Remaining</p>
                        <p className={`text-base font-bold ${isDepleted ? 'text-slate-400' : isLow ? 'text-red-500' : 'text-green-600'}`}>
                          {item.qty_remaining}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-3 py-3 text-center">
      <p className="text-[11px] text-slate-400 font-semibold">{label}</p>
      <p className={`text-xl font-extrabold mt-0.5 ${color}`}>{value}</p>
    </div>
  )
}

function EmptyBlock({ icon: Icon, text, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
      <Icon className="w-10 h-10 opacity-30" />
      <p className="text-sm font-semibold">{text}</p>
      {sub && <p className="text-xs text-center px-8">{sub}</p>}
    </div>
  )
}
