import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Servi sous https://<compte>.github.io/dokodoko/ — base, start_url et scope
// doivent tous pointer vers ce sous-chemin (spec v2 §13).
export default defineConfig({
  base: '/dokodoko/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'どこどこ',
        short_name: 'どこどこ',
        description: 'Suivi de stock — pilote',
        start_url: '/dokodoko/',
        scope: '/dokodoko/',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ja',
        background_color: '#ffffff',
        theme_color: '#111111',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Chaque build précache ses propres fichiers hashés ; les caches
        // d'un build précédent sont purgés à l'activation (spec v2 §13).
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
