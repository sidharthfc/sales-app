import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import axios from 'axios'
import useAppStore from '@/store/useAppStore'
import Spinner from '@/components/shared/Spinner'
import { BASE_URL } from '@/api/client'
import { AUTH_STORAGE_KEYS } from '@/lib/constants'

export default function Login() {
  const navigate   = useNavigate()
  const setUser    = useAppStore(s => s.setUser)

  const [form, setForm]       = useState({ usr: '', pwd: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!form.usr || !form.pwd) {
      toast.error('Please enter your email and password.')
      return
    }
    setLoading(true)
    try {
      // Single call: authenticate + get API token (no cookies needed)
      const res = await axios.post(
        `${BASE_URL}/api/method/route_sales.api.auth.mobile_login`,
        { usr: form.usr, pwd: form.pwd },
        { headers: { 'bypass-tunnel-reminder': 'true', 'Content-Type': 'application/json' } }
      )

      const data = res.data?.message
      if (!data?.api_key || !data?.api_secret) {
        throw new Error('Login failed. No token received.')
      }

      // Store token — all API calls will use this from now on
      localStorage.setItem(AUTH_STORAGE_KEYS.API_KEY, data.api_key)
      localStorage.setItem(AUTH_STORAGE_KEYS.API_SECRET, data.api_secret)

      setUser({
        email:       data.email,
        fullName:    data.full_name,
        salesperson: data.salesperson || null,
        code:        data.code || null,
        territory:   data.territory || null,
        roles:       data.roles || [],
        isAdmin:     !!data.is_admin,
      })

      toast.success(`Welcome back, ${(data.full_name || data.email).split(' ')[0]}!`)
      navigate(data.is_admin ? '/admin' : '/dashboard', { replace: true })
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Login failed. Check your credentials.'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-brand max-w-[430px] mx-auto flex flex-col">

      {/* Logo area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6">
        <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center mb-5 shadow-lg">
          <span className="text-brand font-extrabold text-3xl">LX</span>
        </div>
        <h1 className="text-3xl font-bold text-white">Route Sales</h1>
        <p className="text-white/70 text-sm mt-1">LMNTRIX Pvt Ltd</p>
      </div>

      {/* Form card */}
      <div className="bg-white rounded-t-3xl px-6 pt-8 pb-10">
        <h2 className="text-xl font-bold text-slate-800 mb-6">Sign In</h2>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">Email / Username</label>
            <input
              type="text"
              placeholder="you@lmntrix.co"
              value={form.usr}
              onChange={e => update('usr', e.target.value)}
              className="w-full border border-slate-200 rounded-2xl px-4 py-3.5 text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-orange-100 bg-slate-50"
              autoComplete="username"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="••••••••"
                value={form.pwd}
                onChange={e => update('pwd', e.target.value)}
                className="w-full border border-slate-200 rounded-2xl px-4 py-3.5 pr-11 text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-orange-100 bg-slate-50"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand text-white font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity mt-2"
          >
            {loading ? <Spinner size="sm" className="border-white border-t-orange-300" /> : <LogIn className="w-4 h-4" />}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          Route Sales App v1.0.0 · LMNTRIX Pvt Ltd
        </p>
      </div>
    </div>
  )
}
