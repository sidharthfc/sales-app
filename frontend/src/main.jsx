import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Registered explicitly (vite.config.js sets injectRegister: false) so the
// service worker's own URL -- and therefore its max scope -- is under
// /route_sales/ rather than the JS/CSS asset base. A scope that doesn't
// cover the manifest's start_url fails Chrome's install criteria silently:
// no error, the app just never offers "Install", webview only. The physical
// file this registers is copied into place by package.json's "build" script
// (see vite.config.js's comment above the VitePWA plugin) and served from
// there via the hooks.py website_route_rules entry ahead of the SPA wildcard.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // vite.config.js's skipWaiting/clientsClaim make a new SW take control of
  // this page as soon as it's ready, instead of waiting for a full app
  // close -- but "took control" and "the page is actually running the new
  // JS" are different things without this: reload once, exactly when
  // control genuinely hands over from an older SW to a newer one. Guarded
  // on hadController so this doesn't fire (and reload for no reason) on a
  // page's very first-ever activation, which also fires controllerchange.
  const hadController = !!navigator.serviceWorker.controller
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return
    reloaded = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/route_sales/sw.min.js', { scope: '/route_sales/' }).catch(() => {})
  })
}
