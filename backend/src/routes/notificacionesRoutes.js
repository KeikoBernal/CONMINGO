const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarToken } = require('../middleware/authMiddleware');
const { pushDisponible } = require('../utilidades/notificacionesPush');

// LOTE O: TRAZABILIDAD — bitacora de acciones sobre las suscripciones push
const registrarAuditoria = async (usuarioId, accion, tabla, valoresPrevios = null, nuevosValores = null, ip = null, organizacionId = null) => {
  try {
    await db.query(
      `INSERT INTO public.audit_logs (usuario_id, accion, tabla, valores_previos, nuevos_valores, ip, organizacion_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuarioId, accion, tabla, valoresPrevios ? JSON.stringify(valoresPrevios) : null, nuevosValores ? JSON.stringify(nuevosValores) : null, ip, organizacionId]
    );
  } catch (error) {
    console.error('[auditoría] No se pudo registrar en la bitácora:', { usuarioId, accion, tabla, error: error?.message || error });
  }
};

// LOTE 5 (N4): cualquier rol autenticado puede gestionar sus suscripciones push.
router.use(verificarToken);

// Clave publica VAPID para que el navegador cree la suscripcion push.
router.get('/vapid-public-key', (req, res) => {
  res.json({ disponible: pushDisponible(), publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// Registra (o refresca) la suscripcion push del navegador actual.
router.post('/suscripcion', async (req, res) => {
  const { endpoint, keys = {} } = req.body;
  const endpointLimpio = String(endpoint || '').trim();
  const p256dh = String(keys.p256dh || '').trim();
  const auth = String(keys.auth || '').trim();
  if (!endpointLimpio || !p256dh || !auth) {
    return res.status(400).json({ error: 'La suscripción debe incluir el endpoint y las claves p256dh y auth.' });
  }
  try {
    await db.query(
      `INSERT INTO public.suscripciones_push (usuario_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [req.usuario.id, endpointLimpio, p256dh, auth]
    );
    await registrarAuditoria(req.usuario.id, 'SUSCRIBIR_PUSH', 'suscripciones_push', null, { endpoint: endpointLimpio }, req.ip, req.usuario?.organizacion_id || null);
    res.status(201).json({ mensaje: 'Notificaciones activadas en este dispositivo.' });
  } catch (error) {
    console.error('Error al registrar la suscripción push:', error);
    res.status(500).json({ error: 'Error al activar las notificaciones.' });
  }
});

// Elimina la suscripcion del dispositivo (solo la propia del usuario).
router.delete('/suscripcion', async (req, res) => {
  const { endpoint } = req.body;
  const endpointLimpio = String(endpoint || '').trim();
  if (!endpointLimpio) return res.status(400).json({ error: 'Indica el endpoint de la suscripción.' });
  try {
    await db.query('DELETE FROM public.suscripciones_push WHERE endpoint = $1 AND usuario_id = $2', [endpointLimpio, req.usuario.id]);
    await registrarAuditoria(req.usuario.id, 'DESUSCRIBIR_PUSH', 'suscripciones_push', { endpoint: endpointLimpio }, null, req.ip, req.usuario?.organizacion_id || null);
    res.json({ mensaje: 'Notificaciones desactivadas en este dispositivo.' });
  } catch (error) {
    console.error('Error al eliminar la suscripción push:', error);
    res.status(500).json({ error: 'Error al desactivar las notificaciones.' });
  }
});

// Bandeja interna: ultimas 50 notificaciones del usuario.
router.get('/mias', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, titulo, mensaje, hora_envio, hora_lectura FROM public.notificaciones WHERE destinatario_id = $1 ORDER BY hora_envio DESC LIMIT 50',
      [req.usuario.id]
    );
    res.json({ notificaciones: rows });
  } catch (error) {
    console.error('Error al listar notificaciones:', error);
    res.status(500).json({ error: 'Error al obtener tus notificaciones.' });
  }
});

// Marca como leidas todas las notificaciones pendientes del usuario.
router.put('/marcar-leidas', async (req, res) => {
  try {
    await db.query('UPDATE public.notificaciones SET hora_lectura = now() WHERE destinatario_id = $1 AND hora_lectura IS NULL', [req.usuario.id]);
    res.json({ mensaje: 'Notificaciones marcadas como leídas.' });
  } catch (error) {
    console.error('Error al marcar notificaciones:', error);
    res.status(500).json({ error: 'Error al marcar las notificaciones.' });
  }
});

module.exports = router;
