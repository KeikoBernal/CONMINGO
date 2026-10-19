import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
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
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // LOTE M (PWA offline): una navegación sin conexión responde con el
        // index.html precacheado (el shell de la app) en vez del error del navegador.
        navigateFallback: 'index.html',
        // LOTE M: Workbox no cachea archivos mayores a 2 MiB por defecto; el bundle
        // principal (jsPDF + FullCalendar) puede superar ese límite y romper el modo
        // offline, así que lo subimos a 5 MiB.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ],
});