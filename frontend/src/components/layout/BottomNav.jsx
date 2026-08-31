import { NavLink } from 'react-router-dom'
import { Home, MapPin, BarChart2 } from 'lucide-react'
import useAppStore from '@/store/useAppStore'

const navItems = [
  { to: '/dashboard', icon: Home,      label: 'Home'   },
  { to: '/routes',    icon: MapPin,    label: 'Routes', featureKey: 'enable_routes_tile' },
  { to: '/more',      icon: BarChart2, label: 'More',   featureKey: 'enable_more_tab'     },
]

export default function BottomNav() {
  const features = useAppStore(s => s.features)
  const items = navItems.filter(item => !item.featureKey || features[item.featureKey])

  return (
    <nav className="w-full bg-white border-t border-slate-100 flex-shrink-0">
      <div className="flex items-center h-16">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 h-full ${
                isActive ? 'text-brand' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={`w-6 h-6 ${isActive ? 'text-brand' : 'text-slate-400'}`}
                  strokeWidth={isActive ? 2.5 : 1.8}
                />
                <span className="text-[10px] font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
