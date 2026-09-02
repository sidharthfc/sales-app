import { io } from 'socket.io-client'
import useAppStore from '@/store/useAppStore'
import { AUTH_STORAGE_KEYS } from '@/lib/constants'

// Doctypes whose changes should make the app refetch -- anything a
// salesperson or admin page reads. A save to any of these (from this
// device, another device, or the desk) fires Frappe's own automatic
// `list_update` event; we don't need doctype-specific hooks for that,
// core already publishes it on every save.
const WATCHED_DOCTYPES = [
  'Lead', 'Quotation', 'Sales Invoice', 'Sales Order', 'Payment Entry',
  'Delivery Note', 'Salesperson Expense', 'Route Session',
  'Route Sales Settings', 'Customer',
]

let socket = null

function apiOrigin() {
  const base = import.meta.env.VITE_API_BASE_URL || window.location.origin
  return new URL(base, window.location.origin)
}

export function connectRealtime() {
  if (socket) return socket

  const key    = localStorage.getItem(AUTH_STORAGE_KEYS.API_KEY)
  const secret = localStorage.getItem(AUTH_STORAGE_KEYS.API_SECRET)
  const port   = useAppStore.getState().socketioPort
  if (!key || !secret || !port) return null

  // Deliberately NOT `${siteName}:${port}` -- that reaches Frappe's
  // socketio process directly on its own port, which only exists on
  // whatever host is running gunicorn. Behind a single-port tunnel
  // (cloudflared, ngrok) or a real single-domain HTTPS deploy, that port
  // was never forwarded, so the client hung retrying a connection that
  // could never succeed (confirmed live: a permanently-pending GET to
  // <tunnel-host>:9000/socket.io/...). Connecting to the SAME origin the
  // page loaded from instead relies on a reverse proxy multiplexing
  // /socket.io/ onto that one port -- see scratchpad/proxy/proxy.js for
  // the dev-tunnel stand-in; a real deploy would do this in nginx.
  const origin   = apiOrigin()
  const siteName = origin.hostname
  const socketUrl = `${origin.protocol}//${origin.host}/${siteName}`

  socket = io(socketUrl, {
    withCredentials: false,
    extraHeaders: { Authorization: `token ${key}:${secret}` },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  })

  const bump = () => useAppStore.getState().invalidateData()

  socket.on('connect', () => {
    WATCHED_DOCTYPES.forEach((doctype) => socket.emit('doctype_subscribe', doctype))
    // Catch up on anything that happened while disconnected/reconnecting.
    bump()
  })
  socket.on('list_update', bump)
  socket.on('doc_update', bump)

  return socket
}

export function disconnectRealtime() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
