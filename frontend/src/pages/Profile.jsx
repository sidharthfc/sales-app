import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Mail, MapPin, LogOut, Clock, TrendingUp, Award, ShieldCheck, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import axios from 'axios'
import useAppStore from '@/store/useAppStore'
import api, { BASE_URL, endpoints, revokeApiCredentials } from '@/api/client'

export default function Profile() {
  const navigate   = useNavigate()
  const user       = useAppStore(s => s.user)
  const session    = useAppStore(s => s.session)
  const clearUser  = useAppStore(s => s.clearUser)
  const clearSession = useAppStore(s => s.clearSession)
  const [recentSessions, setRecentSessions] = useState([])

  useEffect(() => {
    api.get(endpoints.getRecentSessions, { params: { limit: 3 } })
      .then((rows) => setRecentSessions(Array.isArray(rows) ? rows : []))
      .catch(() => setRecentSessions([]))
  }, [])

  const handleLogout = async () => {
    try {
      await axios.post(`${BASE_URL}/api/method/logout`, {}, { withCredentials: true })
    } catch (_) {
      // Ignore network errors — still clear local state
    }
    await revokeApiCredentials()
    clearUser()
    clearSession()

    toast.success('Signed out.')
    navigate('/login', { replace: true })
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-full border-2 border-slate-200 flex items-center justify-center">
        <ArrowLeft className="w-4 h-4 text-slate-600" />
      </button>

      {/* Profile Card */}
      <div className="brand-gradient rounded-2xl p-5 text-white shadow-[0_18px_40px_rgba(212,120,10,0.2)]">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold">
              {user?.fullName?.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase() || '?'}
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold truncate">{user?.fullName || '—'}</h2>
            <p className="text-white/80 text-sm">{user?.code || user?.salesperson || '—'}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mt-4 text-sm">
          {user?.territory && (
            <span className="flex items-center gap-1 text-white/80">
              <MapPin className="w-3.5 h-3.5" /> {user.territory}
            </span>
          )}
          <span className="flex items-center gap-1 text-white/80">
            <Award className="w-3.5 h-3.5" /> Route Sales
          </span>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-50">
        {user?.email && <InfoRow icon={Mail} label="Email" value={user.email} />}
        {user?.mobile && <InfoRow icon={Phone} label="Mobile" value={user.mobile} />}
      </div>

      {/* Active session */}
      {session && (
        <div className="bg-green-50 border border-green-100 rounded-2xl p-4">
          <p className="text-xs font-medium text-green-600 uppercase tracking-wide mb-1">Active Session</p>
          <p className="font-semibold text-green-800">{session.name}</p>
          <p className="text-xs text-green-600 flex items-center gap-1 mt-1">
            <Clock className="w-3 h-3" /> Started at {session.start_time}
          </p>
        </div>
      )}

      {/* Session History */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Recent Sessions</h3>
        <div className="space-y-2">
          {recentSessions.map((s) => (
            <div key={s.name} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-900 text-sm">{s.start_time ? new Date(s.start_time).toLocaleDateString('en-IN') : '—'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s.route_name || s.route || 'No Route'}</p>
                </div>
                <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  {s.end_time ? 'Closed' : 'Open'}
                </span>
              </div>
              <div className="flex gap-4 mt-2">
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> {s.salesperson || 'Salesperson'}
                </span>
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {s.start_time ? new Date(s.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Admin Panel link */}
      {user?.isAdmin && (
        <button
          onClick={() => navigate('/admin')}
          className="w-full bg-slate-100 text-slate-700 font-semibold py-3 rounded-2xl flex items-center justify-center gap-2 border border-slate-200 active:bg-slate-200 transition-colors"
        >
          <ShieldCheck className="w-4 h-4" /> Admin Panel
        </button>
      )}

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full bg-red-50 text-red-600 font-semibold py-3 rounded-2xl flex items-center justify-center gap-2 border border-red-100 active:bg-red-100 transition-colors"
      >
        <LogOut className="w-4 h-4" /> Sign Out
      </button>

      <p className="text-center text-xs text-slate-400 pb-2">
        Route Sales App v1.0.0 · LMNTRIX Pvt Ltd
      </p>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  )
}
