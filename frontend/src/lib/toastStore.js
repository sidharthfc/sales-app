import { create } from 'zustand'

// A brief, centered "success" HUD -- not a corner toast, so it doesn't route
// through sonner's edge-positioned stacking system. Own tiny store instead:
// showSuccess() sets the message and auto-clears it after `duration`. See
// lib/toast.jsx's <SuccessPopup/> for the rendered component.
export const useSuccessPopupStore = create(() => ({ message: null, visible: false }))

let hideTimer
export const showSuccess = (message, duration = 1200) => {
  clearTimeout(hideTimer)
  useSuccessPopupStore.setState({ message, visible: true })
  hideTimer = setTimeout(() => useSuccessPopupStore.setState({ visible: false }), duration)
}
