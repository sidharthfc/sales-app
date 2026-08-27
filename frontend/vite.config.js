import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// Frappe serves each app's public/ folder at /assets/<app_name>/ (this is
// why hooks.py's app_include_js etc. reference "/assets/route_sales/...").
// Built here, this app's assets land at /assets/route_sales/frontend/, and
// the SPA itself is mounted at /route_sales (see hooks.py website_route_rules
// + route_sales/www/route_sales.py). Only apply that base path for the
// production build — local `vite dev` keeps serving from "/".
const FRAPPE_ASSET_BASE = '/assets/route_sales/frontend/'
const MOUNT_PATH = '/route_sales/'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? FRAPPE_ASSET_BASE : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Route Sales',
        short_name: 'Route Sales',
        description: 'Route Sales field app — orders, deliveries, payments, and admin.',
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
