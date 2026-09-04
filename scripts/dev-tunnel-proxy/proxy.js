// Dev-tunnel stand-in for what nginx does in a real deploy: multiplex the
// main Frappe web server and the separate socketio.js process onto one
// port, so a single-port tunnel (cloudflared, ngrok) can expose both.
//
// Frappe's bare `frappe serve` (webserver_port, here :8000) has no route
// for /socket.io/ at all -- that's served by a totally separate Node
// process (socketio_port, here :9000). The frontend's realtime.js
// deliberately connects same-origin (see its own comment) expecting a
// proxy exactly like this one in front of it; without it, every
// /socket.io/ request 404s from the webserver, confirmed live.
//
// Usage: node proxy.js [proxyPort] [webserverPort] [socketioPort]
const http = require('http')
const httpProxy = require('http-proxy')

const PROXY_PORT     = Number(process.argv[2]) || 8090
const WEBSERVER_PORT = Number(process.argv[3]) || 8000
const SOCKETIO_PORT  = Number(process.argv[4]) || 9000

const proxy = httpProxy.createProxyServer({})
proxy.on('error', (err, req, res) => {
  console.error('[proxy] error:', err.message)
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('Bad gateway (proxy.js -> backend)')
  }
})

function targetFor(url) {
  return url.startsWith('/socket.io')
    ? `http://127.0.0.1:${SOCKETIO_PORT}`
    : `http://127.0.0.1:${WEBSERVER_PORT}`
}

const server = http.createServer((req, res) => {
  proxy.web(req, res, { target: targetFor(req.url), changeOrigin: true })
})

// WebSocket upgrade (socket.io's real transport once polling hands off)
server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head, { target: targetFor(req.url), changeOrigin: true })
})

server.listen(PROXY_PORT, () => {
  console.log(`[proxy] listening on :${PROXY_PORT} -> web::${WEBSERVER_PORT}, /socket.io -> :${SOCKETIO_PORT}`)
})
