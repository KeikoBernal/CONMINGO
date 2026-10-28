import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // LOTE 5 (N4): pasamos de generateSW a injectManifest para usar un
      // service worker propio (frontend/src/sw.js) que conserva el precaching
      // offline del Lote M y agrega los listeners de Web Push.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'conmingo',
        short_name: 'conmingo',
        description: 'Gestión deportiva de bolas criollas',
        theme_color: '#F2EBE0', 
        background_color: '#F2EBE0',
        display: 'standalone', 
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // LOTE M (PWA offline): una navegación sin conexión responde con el
        // index.html precacheado (el shell de la app) en vez del error del navegador.
        // LOTE M: Workbox no cachea archivos mayores a 2 MiB por defecto; el bundle
        // principal (jsPDF + FullCalendar) puede superar ese límite y romper el modo
        // offline, así que lo subimos a 5 MiB.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ],
});