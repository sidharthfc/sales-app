import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import pkg from './package.json' with { type: 'json' }

// Frappe serves each app's public/ folder at /assets/<app_name>/ (this is
// why hooks.py's app_include_js etc. reference "/assets/route_sales/...").
// Built here, this app's assets land at /assets/route_sales/frontend/, and
// the SPA itself is mounted at /route_sales (see hooks.py website_route_rules
// + route_sales/www/route_sales.py). Only apply that base path for the
// production build — local `vite dev` keeps serving from "/".
const FRAPPE_ASSET_BASE = '/assets/route_sales/frontend/'
const MOUNT_PATH = '/route_sales/'

// A service worker's install-time max scope is "the directory it's served
// from" -- and it was being registered from /assets/route_sales/frontend/
// (via the plugin's default, base-derived registration), which can never
// cover /route_sales/ (a sibling path, not a parent of it). That silently
// failed Chrome's installability check (the SW must control start_url) with
// no visible error -- the app just never offered "Install", webview only.
//
// Fix: serve the SW itself from within /route_sales/ instead. hooks.py adds
// a route so /route_sales/sw.min.js resolves to a physical copy of the same
// built file. That copy is made by package.json's "build" script (a plain
// `cp` chained *after* `vite build` finishes) rather than a Vite plugin hook
// here -- vite-plugin-pwa writes sw.min.js during its own post-bundle
// generateSW step, which runs after every ordinary plugin's closeBundle, so
// a closeBundle-based copy here would run too early and silently copy
// nothing.

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? FRAPPE_ASSET_BASE : '/',
  // Exposes package.json's version as a build-time constant (see the
  // "Powered by Faircode" footer in Login.jsx/Profile.jsx) so it's read
  // from one place instead of being hand-typed into each footer string.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // The plugin's own auto-injected registerSW.js always registers from
      // Vite's asset `base`, which can't be fixed via the `scope` option
      // alone (see the comment above copySwToWww) -- disabled in favor of
      // the explicit registration in src/main.jsx.
      injectRegister: false,
      // Rename away from the default sw.js: Frappe's TemplatePage renders
      // any www/*.py-adjacent file through Jinja by default, which would
      // mangle a Workbox-generated file full of {}-heavy JS -- *.min.js is
      // the one filename pattern Frappe's own renderer treats as opaque
      // static content instead (see template_page.py:render_template).
      filename: 'sw.min.js',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'FCTrail',
        short_name: 'FCTrail',
        description: 'FCTrail field sales app — orders, deliveries, payments, and admin.',
        theme_color: '#009DFD',
        background_color: '#141922',
        display: 'standalone',
        start_url: MOUNT_PATH,
        scope: MOUNT_PATH,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Bundles the Workbox runtime straight into sw.min.js instead of a
        // second workbox-<hash>.js file -- that hash changes every build,
        // which would mean re-wiring a matching hooks.py route each time.
        // One self-contained file is the only way to keep the /route_sales/
        // route static.
        inlineWorkboxRuntime: true,
        // Without these, a newly-deployed SW sits in "waiting" until every
        // open tab/instance of the app is fully closed -- normally a minor
        // delay, but this app has no way to prompt that closure: native
        // pull-to-refresh can't reach the document (index.css locks
        // html/body/#root to overflow:hidden so per-page containers can
        // scroll instead), so a phone with the PWA installed had no route
        // to a new build short of force-quitting it. skipWaiting has the
        // new SW activate the moment it finishes installing; clientsClaim
        // has it take control of already-open pages instead of waiting for
        // their next navigation. Paired with the controllerchange reload in
        // main.jsx, a deploy now actually reaches an already-open instance.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallbackDenylist: [/^\/api/, /^\/assets\/(?!route_sales\/frontend\/)/, /^\/files\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    // Output straight into the Frappe app's own public/ folder so
    // `bench build` (what Frappe Cloud runs on deploy) picks it up as
    // this app's static assets — no separate hosting step.
    outDir: path.resolve(import.meta.dirname, '../route_sales/public/frontend'),
    emptyOutDir: true,
    // Vite's default assetsDir ('assets') would otherwise land JS/CSS at
    // /assets/route_sales/frontend/assets/ — harmless once nested under
    // the app's own asset namespace, kept for clarity/consistency with
    // the standalone route-sales-web build.
    assetsDir: '_pwa',
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward cookies for Frappe session auth
            if (req.headers.cookie) {
              proxyReq.setHeader('Cookie', req.headers.cookie)
            }
          })
        },
      },
      '/assets': { target: 'http://localhost:8000', changeOrigin: true },
      '/files': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  // Read by `vitest` (it loads this same file) — not used by `vite` itself.
  // globals is left off deliberately: test files import describe/it/expect
  // explicitly from 'vitest' instead, so eslint doesn't need a separate
  // globals allowlist for them.
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
  },
}))
