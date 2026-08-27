import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, TrendingUp, Banknote, Package, AlertCircle,
  SkipForward, CheckCircle2, Clock, IndianRupee, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import { PageLoader } from '@/components/shared/Spinner'
import { fmt } from '@/lib/format'

function ModeChip({ mode, amount }) {
  const colors = {
    Cash:   'bg-green-50 text-green-700',
    UPI:    'bg-blue-50 text-blue-700',
    Credit: 'bg-amber-50 text-amber-700',
  }
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-xl ${colors[mode] || 'bg-slate-50 text-slate-700'}`}>
      <span className="text-xs font-semibold">{mode}</span>
      <span className="text-sm font-bold">₹{fmt(amount)}</span>
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">{title}</p>
  )
}

export default function MyDay() {
  const navigate = useNavigate()
  const transactionVersion = useAppStore(s => s.transactionVersion)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadMyDay = async () => {
      setLoading(true)
      try {
        const nextData = await api.get(endpoints.getMyDay)
        if (!cancelled) setData(nextData)
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load day summary.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadMyDay()
    return () => {
      cancelled = true
    }
  }, [transactionVersion])

  if (loading) return <PageLoader />

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 px-8 text-center">
        <AlertCircle className="w-10 h-10 opacity-40" />
        <p className="text-sm">Could not load your day summary.</p>
        <button onClick={() => navigate(-1)} className="text-xs text-brand font-semibold mt-1">Go back</button>
      </div>
    )
  }

  const { progress, sales_today, collections_today, pending, month } = data
  const visitedPct = progress.total_customers > 0
    ? Math.round((progress.visited / progress.total_customers) * 100)
    : 0

  return (
    <div className="h-full overflow-y-auto bg-[#FFF8F0] pb-8">

      {/* Header */}
      <div
        className="relative overflow-hidden px-4 pt-10 pb-6 brand-gradient"
      >
        <div className="pointer-events-none absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10" />
        <div className="relative z-10 flex items-center justify-between mb-3">
          <button onClick={() => navigate(-1)}
            className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center">
            <ArrowLeft className="w-4 h-4 text-white" />
          </button>
          <button onClick={() => { setLoading(true); api.get(endpoints.getMyDay).then(setData).catch(err => toast.error(err.message || 'Failed to refresh.')).finally(() => setLoading(false)) }}
            className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-white" />
          </button>
        </div>
        <p className="text-white/75 text-xs font-medium relative z-10">{data.date}</p>
        <h1 className="text-white font-extrabold text-2xl relative z-10">My Day</h1>
        {data.route && (
          <p className="text-white/80 text-xs mt-1 relative z-10">Route: {data.route}</p>
        )}

        {/* Progress pill */}
        <div className="relative z-10 mt-4 bg-white/20 rounded-2xl px-4 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-white text-xs font-semibold">Route Progress</span>
              <span className="text-white font-bold text-sm">{visitedPct}%</span>
            </div>
            <div className="h-2 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all"
                style={{ width: `${visitedPct}%` }}
              />
            </div>
          </div>
          <div className="text-center flex-shrink-0">
            <p className="text-white font-extrabold text-xl leading-none">{progress.visited}</p>
            <p className="text-white/70 text-[10px]">of {progress.total_customers}</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-5">

        {/* Visit stats row */}
        <div className="grid grid-cols-3 gap-2">
          <StatBox icon={CheckCircle2} iconColor="text-green-500" bg="bg-green-50"
            value={progress.visited} label="Visited" />
          <StatBox icon={SkipForward} iconColor="text-amber-500" bg="bg-amber-50"
            value={progress.skipped} label="Skipped" />
          <StatBox icon={Clock} iconColor="text-slate-400" bg="bg-slate-50"
            value={progress.remaining} label="Remaining" />
        </div>

        {/* Today's Sales */}
        <div>
          <SectionHeader title="Today's Sales" />
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
            <Row icon={Package} iconBg="bg-orange-50" iconColor="text-brand-dark"
              label="Orders Taken" value={`${sales_today.orders_count} orders`} />
            <Row icon={TrendingUp} iconBg="bg-orange-50" iconColor="text-brand-dark"
              label="Sales Amount" value={`₹${fmt(sales_today.total_amount)}`} bold />
            <Row icon={IndianRupee} iconBg="bg-purple-50" iconColor="text-purple-600"
              label="Invoiced" value={`₹${fmt(sales_today.invoiced_amount)}`} bold />
          </div>
        </div>

        {/* Today's Collections */}
        <div>
          <SectionHeader title="Today's Collections" />
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-slate-700">Total Collected</span>
              <span className="text-xl font-extrabold text-brand-dark">₹{fmt(collections_today.total)}</span>
            </div>
            {Object.keys(collections_today.by_mode).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(collections_today.by_mode).map(([mode, amount]) => (
                  <ModeChip key={mode} mode={mode} amount={amount} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center py-2">No collections yet today</p>
            )}
          </div>
        </div>

        {/* Pending */}
        <div>
          <SectionHeader title="Pending" />
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
            <Row icon={Package} iconBg="bg-orange-50" iconColor="text-brand-dark"
              label="Pending Deliveries"
              value={pending.deliveries > 0 ? `${pending.deliveries} orders` : 'All clear'}
              valueColor={pending.deliveries > 0 ? 'text-brand-dark' : 'text-green-600'}
              onClick={() => navigate('/route-pending-orders')}
            />
            <Row icon={AlertCircle} iconBg="bg-red-50" iconColor="text-red-500"
              label="Overdue Invoices"
              value={pending.overdue_invoices > 0 ? `${pending.overdue_invoices} invoices` : 'None'}
              valueColor={pending.overdue_invoices > 0 ? 'text-red-500' : 'text-green-600'}
              onClick={() => navigate('/route-overdue')}
            />
          </div>

          {pending.skipped_customers.length > 0 && (
            <div className="mt-2 bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <SkipForward className="w-4 h-4 text-amber-500" />
                <p className="text-xs font-bold text-amber-700">Skipped Today — Follow Up</p>
              </div>
              <div className="space-y-1.5">
                {pending.skipped_customers.map(c => (
                  <div key={c.customer}
                    className="flex items-center justify-between bg-white rounded-xl px-3 py-2">
                    <p className="text-sm font-medium text-slate-800">{c.customer_name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{c.customer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Month summary */}
        <div>
          <SectionHeader title="This Month" />
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
            <Row icon={TrendingUp} iconBg="bg-orange-50" iconColor="text-brand-dark"
              label="Sales" value={`₹${fmt(month.sales_amount)}`} bold
              sub={`${month.sales_orders} orders`} />
            <Row icon={Banknote} iconBg="bg-green-50" iconColor="text-green-600"
              label="Collections" value={`₹${fmt(month.collections_amount)}`} bold />
          </div>
        </div>

      </div>
    </div>
  )
}

function StatBox({ icon: Icon, iconColor, bg, value, label }) {
  return (
    <div className={`${bg} rounded-2xl p-3 flex flex-col items-center gap-1`}>
      <Icon className={`w-5 h-5 ${iconColor}`} />
      <p className="text-xl font-extrabold text-slate-800">{value}</p>
      <p className="text-[10px] font-semibold text-slate-500">{label}</p>
    </div>
  )
}

function Row({ icon: Icon, iconBg, iconColor, label, value, bold, sub, valueColor, onClick }) {
  const content = (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-700">{label}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </div>
      <p className={`text-sm flex-shrink-0 ${bold ? 'font-bold' : 'font-medium'} ${valueColor || 'text-slate-800'}`}>
        {value}
      </p>
    </div>
  )
  if (onClick) {
    return <button onClick={onClick} className="w-full text-left active:bg-slate-50">{content}</button>
  }
  return <div>{content}</div>
}
