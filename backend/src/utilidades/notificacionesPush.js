// ============================================================
// LOTE 5 (N4): NOTIFICACIONES WEB PUSH
// Envio de notificaciones push (RFC 8030) a los navegadores con
// suscripcion activa, usando las claves VAPID del entorno
// (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT en Render).
// Ninguna funcion de este archivo lanza errores hacia el flujo
// principal: los fallos solo se registran en consola.
// ============================================================
const webpush = require('web-push');
const db = require('../config/db');

let vapidInicializado = false;

// true solo si el entorno define las claves VAPID.
const pushDisponible = () => {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  if (!vapidInicializado) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:conmingo@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    vapidInicializado = true;
  }
  return true;
};

// Envia push a los usuarios indicados (deduplicados). Si el push
// service responde 404/410 la suscripcion murio y se limpia la fila.
const enviarPush = async (usuarioIds, titulo, mensaje, datos = {}) => {
  try {
    if (!pushDisponible() || !Array.isArray(usuarioIds)) return;
    const ids = [...new Set(usuarioIds.filter(Boolean).map(String))];
    if (ids.length === 0) return;
    const { rows } = await db.query(
      'SELECT id, endpoint, p256dh, auth FROM public.suscripciones_push WHERE usuario_id::text = ANY($1::text[])',
      [ids]
    );
    const envios = rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ titulo, mensaje, url: datos.url || '/' })
        );
      } catch (error) {
        if (error && (error.statusCode === 404 || error.statusCode === 410)) {
          await db.query('DELETE FROM public.suscripciones_push WHERE id = $1', [sub.id]);
        } else {
          console.error('[push] No se pudo enviar la notificacion:', { endpoint: sub.endpoint, error: error?.message || error });
        }
      }
    });
    await Promise.all(envios);
  } catch (error) {
    console.error('[push] Error preparando el envio:', error?.message || error);
  }
};

// Registra la notificacion interna (tabla notificaciones) y ademas
// envia push a los destinatarios con suscripcion activa.
const notificarUsuarios = async ({ organizacionId = null, remitenteId = null, destinatarios = [], titulo, mensaje }) => {
  try {
    const ids = [...new Set((destinatarios || []).filter(Boolean).map(String))];
    if (ids.length === 0) return;
    for (const uid of ids) {
      try {
        await db.query(
          'INSERT INTO public.notificaciones (organizacion_id, remitente_id, destinatario_id, titulo, mensaje) VALUES ($1, $2, $3, $4, $5)',
          [organizacionId, remitenteId, uid, titulo, mensaje]
        );
      } catch (error) {
        console.error('[push] No se pudo registrar la notificacion interna:', error?.message || error);
      }
    }
    await enviarPush(ids, titulo, mensaje);
  } catch (error) {
    console.error('[push] Error al notificar usuarios:', error?.message || error);
  }
};

module.exports = { pushDisponible, enviarPush, notificarUsuarios };
