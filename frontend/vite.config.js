import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'], // Agrega aquí tus assets estáticos
      manifest: {
        name: 'Sistema de Gestión de Ligas',
        short_name: 'LigasApp',
        description: 'Gestión de estadísticas y planillas para anotadores y árbitros',
        theme_color: '#ffffff', // Cambia esto al color principal de tu UI
        background_color: '#ffffff',
        display: 'standalone', // Esto oculta la barra del navegador (look de app nativa)
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
        // Configuración para el caché offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
});