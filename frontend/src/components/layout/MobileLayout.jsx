import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function MobileLayout() {
  return (
    <div className="h-screen w-full flex flex-col bg-app-bg overflow-hidden">
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
