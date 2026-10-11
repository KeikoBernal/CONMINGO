// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');

// FIX #4: se eliminó el endpoint POST /login (JWT propio + fallback 'secreto_desarrollo').
// Era código muerto e inseguro: el frontend autentica con Supabase Auth y
// authMiddleware.verificarToken valida ese token contra Supabase.

// Ruta para obtener partidos activos o agendados con nombres de equipos y sedes
router.get('/partidos-activos', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.id, p.estado, p.fase, p.torneo_id, p.equipo_local_id, p.equipo_visita_id, p.sede_id, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora, el.nombre as local_nombre, ev.nombre as visita_nombre, t.nombre as torneo_nombre,
             s.nombre as sede_nombre, o.nombre as organizacion_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id
      WHERE p.estado != 'Finalizado'
      ORDER BY p.fecha_hora ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al buscar partidos:', error);
    res.status(500).json({ error: 'Error al buscar partidos' });
  }
});

// Ruta para obtener un partido específico por su ID con toda su información relacionada
router.get('/partidos/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.id, p.estado, p.fase, p.torneo_id, p.equipo_local_id, p.equipo_visita_id, p.sede_id, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora, el.nombre as local_nombre, ev.nombre as visita_nombre, t.nombre as torneo_nombre,
             s.nombre as sede_nombre, o.nombre as organizacion_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id
      WHERE p.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Partido no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al buscar el partido:', error);
    res.status(500).json({ error: 'Error al buscar el partido' });
  }
});

router.get('/partidos/:id/nomina-publica', async (req, res) => {
  try {
    const resDb = await db.query(`
      SELECT j.id, j.equipo_id, j.numero_dorsal, j.nombre, j.apellido, j.foto_url, e.nombre AS equipo_nombre FROM public.jugadores j
      JOIN public.equipos e ON j.equipo_id = e.id
      JOIN public.partidos p ON (p.equipo_local_id = e.id OR p.equipo_visita_id = e.id)
      WHERE p.id = $1 AND j.estado = 'Activo' ORDER BY e.nombre, j.numero_dorsal ASC
    `, [req.params.id]);
    res.json(resDb.rows);
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

// ============================================================
// LOGIN PROXY (hallazgo #18): el frontend ya NO llama a Supabase
// Auth directamente para iniciar sesión. Este es el único punto que
// verifica credenciales y aplica bloqueo persistente:
// 5 intentos fallidos → 15 minutos (tabla public.login_intentos).
// ============================================================
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdminProxy = require('../config/supabaseAdmin'); // FIX #8: sin fallback silencioso a la anon key

const MAX_INTENTOS_LOGIN = 5;
const MINUTOS_BLOQUEO_LOGIN = 15;

const normalizarEmailLogin = (e) => String(e || '').trim().toLowerCase();
const REGEX_EMAIL_LOGIN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const claveLoginLimiter = (req) => `${req.ip}|${normalizarEmailLogin(req.body?.email)}`;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: claveLoginLimiter,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones de inicio de sesión. Espera unos minutos antes de reintentar.' }
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: claveLoginLimiter,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de código. Espera 15 minutos antes de pedir otro.' }
});

// Paso 1: verificación de email + contraseña (bloqueo persistente por correo)
router.post('/login-proxy', loginLimiter, async (req, res) => {
  const email = normalizarEmailLogin(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!REGEX_EMAIL_LOGIN.test(email) || password.length < 6) {
    return res.status(400).json({ error: 'Correo o contraseña con formato inválido.' });
  }

  try {
    // 1) Bloqueo persistente por correo (5 intentos → 15 minutos)
    const estadoRes = await db.query(
      'SELECT intentos, bloqueado_hasta FROM public.login_intentos WHERE email = $1',
      [email]
    );
    let estado = estadoRes.rows[0] || null;

    if (estado?.bloqueado_hasta) {
      const hasta = new Date(estado.bloqueado_hasta);
      if (hasta > new Date()) {
        const minutos = Math.max(1, Math.ceil((hasta - new Date()) / 60000));
        return res.status(429).json({
          error: `Cuenta temporalmente bloqueada por seguridad. Intenta de nuevo en ${minutos} minuto(s).`,
          bloqueado_hasta: hasta.toISOString()
        });
      }
      // Bloqueo expirado: reiniciar el contador
      await db.query('UPDATE public.login_intentos SET intentos = 0, bloqueado_hasta = NULL WHERE email = $1', [email]);
      estado = { ...estado, intentos: 0, bloqueado_hasta: null };
    }

    // 2) Único punto que verifica credenciales contra Supabase Auth
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

    if (error || !data?.session) {
      const nuevosIntentos = (estado?.intentos || 0) + 1;
      const excede = nuevosIntentos >= MAX_INTENTOS_LOGIN;

      await db.query(
        `INSERT INTO public.login_intentos (email, ip, intentos, ultimo_intento, bloqueado_hasta)
         VALUES ($1, $2, $3, now(), CASE WHEN $4 THEN now() + ($5 || ' minutes')::interval ELSE NULL END)
         ON CONFLICT (email) DO UPDATE SET
           ip = EXCLUDED.ip,
           intentos = EXCLUDED.intentos,
           ultimo_intento = now(),
           bloqueado_hasta = CASE WHEN $4 THEN now() + ($5 || ' minutes')::interval ELSE NULL END,
           updated_at = now()`,
        [email, req.ip || 'desconocida', nuevosIntentos, excede, MINUTOS_BLOQUEO_LOGIN]
      );

      if (excede) {
        return res.status(429).json({
          error: `Demasiados intentos fallidos. Por seguridad, la cuenta queda bloqueada por ${MINUTOS_BLOQUEO_LOGIN} minutos.`,
          bloqueado_hasta: new Date(Date.now() + MINUTOS_BLOQUEO_LOGIN * 60000).toISOString()
        });
      }

      return res.status(401).json({
        error: 'Credenciales incorrectas.',
        intentos_restantes: MAX_INTENTOS_LOGIN - nuevosIntentos
      });
    }

    // 3) Credenciales válidas: limpiar el historial de intentos
    await db.query('DELETE FROM public.login_intentos WHERE email = $1', [email]);

    // 4) Validar registro y estado en la tabla usuarios
    const usuarioRes = await db.query('SELECT rol, estado FROM public.usuarios WHERE email = $1', [email]);
    const usuarioBD = usuarioRes.rows[0];

    if (!usuarioBD) {
      return res.status(403).json({ error: 'Usuario autenticado pero no registrado en el sistema. Contacta al administrador.' });
    }
    if (usuarioBD.estado === 'Inactivo') {
      return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta al administrador de tu liga.' });
    }

    // 5) Superadmin requiere segundo factor (OTP); la sesión NO se entrega aquí
    if ((usuarioBD.rol || '').toLowerCase() === 'superadmin') {
      try {
        await supabaseAdminProxy.auth.admin.signOut(data.session.access_token);
      } catch (_) { /* best-effort: la sesión expira sola */ }
      return res.json({ requiere_otp: true });
    }

    return res.json({ session: data.session });
  } catch (err) {
    console.error('Error en login-proxy:', err);
    return res.status(500).json({ error: 'Error interno al procesar el inicio de sesión.' });
  }
});

// Paso 2 (solo superadmin): solicitar el código OTP, canalizado por el backend
router.post('/login-proxy/otp', otpLimiter, async (req, res) => {
  const email = normalizarEmailLogin(req.body?.email);
  if (!REGEX_EMAIL_LOGIN.test(email)) {
    return res.status(400).json({ error: 'Correo con formato inválido.' });
  }

  try {
    const usuarioRes = await db.query(
      'SELECT rol FROM public.usuarios WHERE email = $1 AND LOWER(rol) = $2',
      [email, 'superadmin']
    );
    if (usuarioRes.rows.length === 0) {
      return res.status(400).json({ error: 'Este correo no requiere verificación por código.' });
    }

    const { error } = await supabaseAuth.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) {
      return res.status(400).json({ error: `Error al enviar el código: ${error.message}` });
    }
    return res.json({ mensaje: 'Código enviado.' });
  } catch (err) {
    console.error('Error en login-proxy/otp:', err);
    return res.status(500).json({ error: 'Error interno al enviar el código.' });
  }
});

// Paso 3 (solo superadmin): verificar el código OTP y entregar la sesión
router.post('/login-proxy/verificar-otp', otpLimiter, async (req, res) => {
  const email = normalizarEmailLogin(req.body?.email);
  const token = String(req.body?.token || '').trim();

  if (!REGEX_EMAIL_LOGIN.test(email) || !/^\d{6}$/.test(token)) {
    return res.status(400).json({ error: 'Datos inválidos para verificar el código.' });
  }

  try {
    const { data, error } = await supabaseAuth.auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data?.session) {
      return res.status(401).json({ error: `Código inválido: ${error?.message || 'intenta de nuevo'}` });
    }
    return res.json({ session: data.session });
  } catch (err) {
    console.error('Error en login-proxy/verificar-otp:', err);
    return res.status(500).json({ error: 'Error interno al verificar el código.' });
  }
});

module.exports = router;