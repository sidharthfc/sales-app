import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function MobileLayout() {
  // app-shell-width (index.css): full width on any touch device, capped
  // and centered only for a real mouse-driven desktop -- see that class's
  // own comment. A guessed pixel threshold (430, then 600) kept getting
  // invalidated by real phones reporting a wider CSS viewport than
  // expected; input capability is the signal that's actually correct
  // regardless of a device's reported width.
  return (
    <div className="h-dvh app-shell-width flex flex-col bg-app-bg overflow-hidden">
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
