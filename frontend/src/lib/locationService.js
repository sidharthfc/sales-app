/**
 * locationService.js
 * ------------------
 * Tracks the salesperson's GPS position and pushes it to the backend
 * every 30 seconds while a session is active.
 */

import api, { endpoints } from '@/api/client'

let watchId    = null
let intervalId = null
let lastPos    = null

export function startTracking(sessionName) {
  if (!navigator.geolocation) return

  // Continuously watch GPS position
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPos = {
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }
    },
    () => { /* silently ignore GPS errors */ },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
  )

  // Push to backend every 30 seconds
  intervalId = setInterval(async () => {
    if (!lastPos) return
    try {
      await api.post(endpoints.updateLocation, {
        lat:          lastPos.lat,
        lng:          lastPos.lng,
        accuracy:     lastPos.accuracy,
        session_name: sessionName,
      })
    } catch (_) {
      // Fail silently — don't interrupt the field user
    }
  }, 30000)
}

export function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  lastPos = null
}

export function getCurrentPosition() {
  return lastPos
}
