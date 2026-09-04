import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function MobileLayout() {
  // 600px, not 430 -- 430 (iPhone 16 Pro Max's own width) was too tight a
  // ceiling: some real Android phones (confirmed live on a Nothing Phone)
  // report a CSS viewport width past 430px depending on the manufacturer's
  // display-scaling default, so that cap was clipping real phones down to
  // a narrow centered column instead of filling their screen -- the exact
  // full-bleed-on-desktop problem this was meant to solve, just at the
  // opposite width. No mainstream phone gets anywhere near 600px even at
  // its most zoomed-out display setting, so this still only kicks in for
  // genuine tablet/desktop widths.
  return (
    <div className="h-dvh w-full max-w-[600px] mx-auto flex flex-col bg-app-bg overflow-hidden">
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
