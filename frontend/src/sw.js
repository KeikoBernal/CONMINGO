// LOTE 5 (N4): service worker propio de la PWA.
// Con la estrategia injectManifest de vite-plugin-pwa, el plugin inyecta el
// manifiesto de precaching en self.__WB_MANIFEST y este archivo conserva el
// modo offline del Lote M agregando los listeners de Web Push.
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';

precacheAndRoute(self.__WB_MANIFEST);

// LOTE M (PWA offline): una navegacion sin conexion responde con el
// index.html precacheado (el shell de la app) en vez del error del navegador.
registerRoute(
  ({ request }) => request.mode === 'navigate',
  createHandlerBoundToURL('index.html')
);

clientsClaim();
self.skipWaiting();

// Con registerType autoUpdate y un SW propio, el plugin espera que este
// archivo atienda el mensaje SKIP_WAITING para activar la nueva version.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// LOTE 5 (N4): notificacion push entrante enviada por el backend (web-push).
self.addEventListener('push', (event) => {
  let datos = {};
  try {
    if (event.data) datos = event.data.json();
  } catch (error) {
    datos = {};
  }
  event.waitUntil(
    self.registration.showNotification(datos.titulo || 'CONMINGO', {
      body: datos.mensaje || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: 'conmingo-notificacion',
      data: { url: datos.url || '/' }
    })
  );
});

// LOTE 5 (N4): al hacer click se enfoca la ventana abierta de la app o se abre.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlAbrir = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const cliente of lista) {
        if ('focus' in cliente) {
          return cliente.focus();
        }
      }
      return self.clients.openWindow(urlAbrir);
    })
  );
});
