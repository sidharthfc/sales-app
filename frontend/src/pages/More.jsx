import { useNavigate } from 'react-router-dom'
import { CalendarDays, Package, Users, User, ShieldCheck, ArrowLeft } from 'lucide-react'
import useAppStore from '@/store/useAppStore'

const baseModules = [
  {
    icon: CalendarDays,
    label: 'My Day',
    to: '/my-day',
    color: 'bg-orange-100 text-brand-dark',
    desc: "Today's progress & summary",
  },
  {
    icon: Package,
    label: 'Van Stock',
    to: '/van-stock',
    color: 'bg-amber-100 text-amber-600',
    desc: 'Loaded, sold & remaining',
  },
  {
    icon: Users,
    label: 'My Customers',
    to: '/my-customers',
    color: 'bg-green-100 text-green-600',
    desc: 'All assigned customers',
  },
  {
    icon: User,
    label: 'Profile',
    to: '/profile',
    color: 'bg-blue-100 text-blue-600',
    desc: 'Your account & sessions',
  },
]

export default function More() {
  const navigate = useNavigate()
  const user = useAppStore(s => s.user)
  const modules = user?.isAdmin
    ? [
        ...baseModules,
        {
          icon: ShieldCheck,
          label: 'Admin',
          to: '/admin',
          color: 'bg-slate-100 text-slate-700',
          desc: 'Manage routes & assignments',
        },
      ]
    : baseModules

  return (
    <div className="px-4 py-4">
      <button
        onClick={() => navigate(-1)}
        className="w-8 h-8 rounded-full border-2 border-slate-200 flex items-center justify-center mb-4"
      >
        <ArrowLeft className="w-4 h-4 text-slate-600" />
      </button>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">More</h2>
      <div className="grid grid-cols-2 gap-3">
        {modules.map(({ icon: Icon, label, to, color, desc }) => (
          <button
            key={label}
            onClick={() => navigate(to)}
            className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 text-left flex flex-col gap-3 active:scale-95 transition-transform"
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-sm">{label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
