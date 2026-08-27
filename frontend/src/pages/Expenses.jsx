import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Fuel, UtensilsCrossed, CarFront, ParkingCircle, X, ArrowLeft, Camera } from 'lucide-react'
import { toast } from 'sonner'
import api, { endpoints, uploadReceiptPhoto, BASE_URL } from '@/api/client'
import useAppStore from '@/store/useAppStore'
import Spinner from '@/components/shared/Spinner'
import { fmt, fieldCls as fc } from '@/lib/format'
import { PAGE_SIZE } from '@/lib/constants'

const typeConfig = {
  Fuel:    { icon: Fuel,            color: 'bg-orange-100 text-orange-600' },
  Food:    { icon: UtensilsCrossed, color: 'bg-yellow-100 text-yellow-600' },
  Toll:    { icon: CarFront,        color: 'bg-blue-100 text-blue-600'     },
  Parking: { icon: ParkingCircle,   color: 'bg-slate-100 text-slate-600'   },
}
const TYPES = ['Fuel', 'Food', 'Toll', 'Parking']

export default function Expenses() {
  const navigate = useNavigate()
  const user    = useAppStore(s => s.user)
  const session = useAppStore(s => s.session)

  const [showForm,  setShowForm]  = useState(false)
  const [expenses, setExpenses]   = useState([])

  useEffect(() => {
    const load = async () => {
      if (!user?.code) return
      try {
        const rows = await api.get(endpoints.getExpenses, {
          params: { employee: user.code, route_session: session?.name || undefined, limit: PAGE_SIZE },
        })
        setExpenses(Array.isArray(rows) ? rows : [])
      } catch (_) {
        setExpenses([])
      }
    }
    load()
  }, [session?.name, user?.code])

  const total = expenses.reduce((s, e) => s + e.amount, 0)

  return (
    <div className="pb-4">
      {!showForm ? (
        <>
          <div className="bg-amber-500 px-4 pt-4 pb-6">
            <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-full border-2 border-white/50 flex items-center justify-center mb-3">
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <p className="text-amber-100 text-sm">Today's Expenses</p>
            <p className="text-3xl font-bold text-white mt-1">₹{fmt(total)}</p>
            <div className="flex gap-2 mt-3 flex-wrap">
              {TYPES.map(t => {
                const amt = expenses.filter(e => e.type === t).reduce((s, e) => s + e.amount, 0)
                if (!amt) return null
                return (
                  <div key={t} className="bg-white/20 rounded-xl px-3 py-1.5">
                    <p className="text-white text-xs font-medium">{t}: ₹{fmt(amt)}</p>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="px-4 -mt-3 space-y-3">
            <button onClick={() => setShowForm(true)}
              className="w-full bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <Plus className="w-5 h-5 text-amber-600" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-slate-900 text-sm">Log Expense</p>
                <p className="text-xs text-slate-400">Fuel, food, toll, parking</p>
              </div>
            </button>

            <div className="space-y-2">
              {expenses.map(exp => {
                const { icon: Icon, color } = typeConfig[exp.type] || typeConfig.Fuel
                return (
                  <div key={exp.name} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{exp.type}</p>
                      <p className="text-xs text-slate-400 truncate">{exp.notes}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {exp.receipt && (
                        <a href={BASE_URL + exp.receipt} target="_blank" rel="noopener noreferrer">
                          <img src={BASE_URL + exp.receipt} alt="receipt" className="w-9 h-9 rounded-lg object-cover border border-slate-200" />
                        </a>
                      )}
                      <div className="text-right">
                        <p className="font-bold text-slate-900 text-sm">₹{fmt(exp.amount)}</p>
                        <p className="text-xs text-slate-400">{exp.time ? new Date(exp.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <LogExpenseForm
          user={user}
          session={session}
          onClose={() => setShowForm(false)}
          onSuccess={(exp) => {
            setExpenses(prev => [exp, ...prev])
            setShowForm(false)
          }}
        />
      )}
    </div>
  )
}

function LogExpenseForm({ user, session, onClose, onSuccess }) {
  const [form, setForm]           = useState({ type: 'Fuel', amount: '', notes: '' })
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptPreview, setReceiptPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef(null)
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleReceiptCapture = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setReceiptFile(file)
    const reader = new FileReader()
    reader.onload = () => setReceiptPreview(reader.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const clearReceipt = () => {
    setReceiptFile(null)
    setReceiptPreview(null)
  }

  const handleSubmit = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error('Enter a valid amount.'); return }
    if (!user?.code) { toast.error('Employee ID not found. Please re-login.'); return }

    let receiptUrl = null
    if (receiptFile) {
      setUploading(true)
      try {
        receiptUrl = await uploadReceiptPhoto(receiptFile)
      } catch (err) {
        toast.error('Receipt upload failed: ' + (err.message || 'Unknown error'))
        setUploading(false)
        return
      }
      setUploading(false)
    }

    setSubmitting(true)
    try {
      const result = await api.post(endpoints.submitExpense, {
        employee:      user.code,
        expense_type:  form.type,
        amount:        parseFloat(form.amount),
        route_session: session?.name || null,
        notes:         form.notes || null,
        receipt:       receiptUrl || null,
      })
      toast.success('Expense logged!')
      onSuccess({
        name:    result.expense,
        type:    form.type,
        amount:  parseFloat(form.amount),
        time:    new Date().toISOString(),
        notes:   form.notes,
        receipt: result.receipt,
      })
    } catch (err) {
      toast.error(err.message || 'Failed to log expense.')
    } finally {
      setSubmitting(false)
    }
  }

  const busy = uploading || submitting

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-900">Log Expense</h2>
        <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
      </div>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-2">Expense Type</label>
          <div className="grid grid-cols-4 gap-2">
            {TYPES.map(t => {
              const { icon: Icon, color } = typeConfig[t]
              return (
                <button key={t} onClick={() => update('type', t)}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all ${
                    form.type === t ? 'border-amber-500 bg-amber-50' : 'border-slate-100 bg-white'
                  }`}>
                  <div className={`p-1.5 rounded-lg ${form.type === t ? 'bg-amber-100 text-amber-600' : color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-medium text-slate-600">{t}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Amount (₹)</label>
          <input type="number" placeholder="0.00" className={fc} value={form.amount} onChange={e => update('amount', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Notes</label>
          <input placeholder="Brief description…" className={fc} value={form.notes} onChange={e => update('notes', e.target.value)} />
        </div>

        {/* Receipt capture */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Receipt <span className="text-slate-400">(optional)</span></label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleReceiptCapture}
          />
          {receiptPreview ? (
            <div className="relative w-full">
              <img src={receiptPreview} alt="Receipt" className="w-full h-36 object-cover rounded-xl border border-slate-200" />
              <button
                onClick={clearReceipt}
                className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center"
              >
                <X className="w-4 h-4 text-white" />
              </button>
              <p className="text-xs text-slate-500 mt-1 text-center">Receipt captured</p>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-200 rounded-xl p-4 flex items-center justify-center gap-2 text-sm text-slate-500 active:bg-slate-50"
            >
              <Camera className="w-4 h-4" />
              Capture Receipt Photo
            </button>
          )}
        </div>

        <button disabled={busy} onClick={handleSubmit}
          className="w-full bg-amber-500 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">
          {busy ? <Spinner size="sm" className="border-white border-t-amber-300" /> : <Plus className="w-4 h-4" />}
          {uploading ? 'Uploading receipt…' : submitting ? 'Logging…' : 'Submit Expense'}
        </button>
      </div>
    </div>
  )
}
