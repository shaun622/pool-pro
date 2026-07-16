import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'PoolPro',
        short_name: 'PoolPro',
        description: 'Pool maintenance management for professionals',
        theme_color: '#0EA5E9',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,ico,png,svg,html}'],
        // SPA offline boot: serve the precached index.html for any in-app
        // navigation that fails (no network), so /tech etc. load offline and
        // the router + cached data layer take over. Assets are precached
        // separately and aren't navigations, but denylist /assets/ as insurance.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/assets\//],
        runtimeCaching: [
          {
            // Service photos: cache-first so a just-captured / recently-viewed
            // photo renders offline. Must come BEFORE the general supabase rule
            // (Workbox uses the first matching route). statuses [0,200] covers
            // opaque cross-origin responses from the public bucket.
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/service-photos\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'service-photos',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
          // NOTE: a general `*.supabase.co/*` NetworkFirst rule was removed here.
          // It intercepted the REST data API AND the Auth API and, with no
          // networkTimeoutSeconds, NetworkFirst waits for the network forever —
          // so a single stalled request (flaky network / tab waking from idle)
          // left the awaited supabase query hanging and pages stuck on an
          // infinite spinner (a reload "fixed" it). API + auth calls now go
          // straight to the network; offline DATA is served by the IndexedDB
          // layer (src/lib/offlineStore.js), which is independent of the SW.
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'recharts': ['recharts'],
          'supabase': ['@supabase/supabase-js'],
        }
      }
    }
  },
  server: {
    host: true,
    port: Number(process.env.PORT) || 5173,
    strictPort: true
  }
})
