// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs'); // LOTE 6H: hash local de la clave establecida desde el enlace
const { verificarToken } = require('../middleware/authMiddleware'); // FIX #12: rol resuelto siempre en el servidor

// FIX #4: se eliminó el endpoint POST /login (JWT propio + fallback 'secreto_desarrollo').
// Era código muerto e inseguro: el frontend autentica con Supabase Auth y
// authMiddleware.verificarToken valida ese token contra Supabase.

// Ruta para obtener partidos activos o agendados con nombres de equipos y sedes
// LOTE 7C: incluye p.uuid_publico para que la landing genere links opacos a la pizarra.
router.get('/partidos-activos', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.id, p.uuid_publico, p.estado, p.fase, p.torneo_id, p.equipo_local_id, p.equipo_visita_id, p.sede_id, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora, el.nombre as local_nombre, ev.nombre as visita_nombre, t.nombre as torneo_nombre,
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
// verifica credenciales y aplica bloqueo persistente por (correo, IP):
// 5 intentos fallidos desde una misma IP → 15 minutos para esa combinacion
// (tabla public.login_intentos, unicidad email+ip; migracion 020).
// ============================================================
const rateLimit = require('express-rate-limit');
// LOTE 6C: ipKeyGenerator normaliza la IP (una IPv6 se trunca a su subred
// /64). Sin esto, express-rate-limit v8 emite ERR_ERL_KEY_GEN_IPV6 con cada
// peticion desde una IPv6 (lo que salia en el log de Render) y, peor, un
// cliente con IPv6 podia rotar direcciones para burlar los limiters.
const { ipKeyGenerator } = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdminProxy = require('../config/supabaseAdmin'); // FIX #8: sin fallback silencioso a la anon key
// LOTE 6G: utilidad de correo saliente y tokens de verificacion
const { consumirTokenCorreo, crearTokenCorreo, reenviarVerificacion, enviarRestablecerPassword } = require('../utilidades/correo'); // LOTE 6K: enlace de recuperacion pedido por la propia persona

const MAX_INTENTOS_LOGIN = 5;
const MINUTOS_BLOQUEO_LOGIN = 15;

const normalizarEmailLogin = (e) => String(e || '').trim().toLowerCase();
const REGEX_EMAIL_LOGIN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const claveLoginLimiter = (req) => `${ipKeyGenerator(req.ip)}|${normalizarEmailLogin(req.body?.email)}`; // LOTE 6C: IP normalizada

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

// LOTE 6G: limite para reenvios del correo de verificacion (5 cada 15 minutos)
const reenvioLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: claveLoginLimiter,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de reenvío. Espera 15 minutos antes de pedir otro.' }
});

// LOTE 6H: limite del endpoint publico de restablecimiento (10 cada 15 minutos)
const restablecerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: claveLoginLimiter,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de restablecer la contraseña. Espera unos minutos antes de reintentar.' }
});

// LOTE 6K: limite del acceso publico de recuperacion de contrasena
// (5 cada 15 minutos por IP y correo). Dentro de la ventana, un atacante
// no puede escanear correos del sistema ni bombardear peticiones.
const olvideLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: claveLoginLimiter,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de restablecimiento. Espera unos minutos antes de reintentar.' }
});

// Paso 1: verificación de email + contraseña (bloqueo persistente por correo e IP)
// FIX #12: el dashboard ya NO consulta la tabla usuarios desde el navegador (eso dependía
// del RLS de Supabase y exponía la lectura al cliente). El rol se resuelve aquí,
// con el token verificado, igual que en el resto de la API.
router.get('/mi-perfil', verificarToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, nombre, apellido, rol, organizacion_id FROM public.usuarios WHERE id = $1',
      [req.usuario.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no registrado en el sistema.' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el perfil.' });
  }
});

router.post('/login-proxy', loginLimiter, async (req, res) => {
  const email = normalizarEmailLogin(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  // FIX (revision de seguridad): el bloqueo persistente se cuenta por (correo, IP)
  // en vez de solo por correo. Antes, cualquiera podia bloquear la cuenta de un
  // oficial con 5 claves erradas (DoS el dia de un partido); ahora los intentos
  // fallidos de una IP no afectan a la persona que entra desde otra IP.
  const ipLogin = ipKeyGenerator(req.ip || 'desconocida');

  if (!REGEX_EMAIL_LOGIN.test(email) || password.length < 6) {
    return res.status(400).json({ error: 'Correo o contraseña con formato inválido.' });
  }

  try {
    // 1) Bloqueo persistente por correo (5 intentos → 15 minutos)
    const estadoRes = await db.query(
      'SELECT intentos, bloqueado_hasta FROM public.login_intentos WHERE email = $1 AND ip = $2',
      [email, ipLogin]
    );
    let estado = estadoRes.rows[0] || null;

    if (estado?.bloqueado_hasta) {
      const hasta = new Date(estado.bloqueado_hasta);
      if (hasta > new Date()) {
        const minutos = Math.max(1, Math.ceil((hasta - new Date()) / 60000));
        return res.status(429).json({
          error: `Acceso temporalmente bloqueado por seguridad desde esta conexión. Intenta de nuevo en ${minutos} minuto(s).`,
          bloqueado_hasta: hasta.toISOString()
        });
      }
      // Bloqueo expirado: reiniciar el contador
      await db.query('UPDATE public.login_intentos SET intentos = 0, bloqueado_hasta = NULL WHERE email = $1 AND ip = $2', [email, ipLogin]);
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
         ON CONFLICT (email, ip) DO UPDATE SET
           ip = EXCLUDED.ip,
           intentos = EXCLUDED.intentos,
           ultimo_intento = now(),
           bloqueado_hasta = CASE WHEN $4 THEN now() + ($5 || ' minutes')::interval ELSE NULL END,
           updated_at = now()`,
        [email, ipLogin, nuevosIntentos, excede, MINUTOS_BLOQUEO_LOGIN]
      );

      if (excede) {
        return res.status(429).json({
          error: `Demasiados intentos fallidos desde esta conexión. Por seguridad, los accesos desde esta conexión quedan bloqueados por ${MINUTOS_BLOQUEO_LOGIN} minutos.`,
          bloqueado_hasta: new Date(Date.now() + MINUTOS_BLOQUEO_LOGIN * 60000).toISOString()
        });
      }

      return res.status(401).json({
        error: 'Credenciales incorrectas.',
        intentos_restantes: MAX_INTENTOS_LOGIN - nuevosIntentos
      });
    }

    // 3) Credenciales válidas: limpiar el historial de intentos de esta IP
    await db.query('DELETE FROM public.login_intentos WHERE email = $1 AND ip = $2', [email, ipLogin]);

    // 4) Validar registro y estado en la tabla usuarios
    // LOTE 6G: incluye correo_verificado para bloquear el acceso sin verificar
    const usuarioRes = await db.query('SELECT id, rol, estado, correo_verificado FROM public.usuarios WHERE email = $1', [email]);
    const usuarioBD = usuarioRes.rows[0];

    if (!usuarioBD) {
      return res.status(403).json({ error: 'Usuario autenticado pero no registrado en el sistema. Contacta al administrador.' });
    }
    if (usuarioBD.estado === 'Inactivo') {
      return res.status(403).json({ error: 'Tu cuenta está desactivada. Contacta al administrador de tu liga.' });
    }

    // LOTE 6G: login bloqueado hasta verificar el correo. La sesion que Supabase
    // entrega aqui no se devuelve y se revoca (best-effort) para no dejarla viva.
    if (usuarioBD.correo_verificado === false) {
      try { await supabaseAdminProxy.auth.admin.signOut(data.session.access_token); } catch (_) { /* best-effort */ }
      try {
        await db.query(
          'INSERT INTO public.audit_logs (usuario_id, accion, tabla, nuevos_valores, ip) VALUES ($1, $2, $3, $4, $5)',
          [usuarioBD.id, 'LOGIN_BLOQUEADO_NO_VERIFICADO', 'usuarios', JSON.stringify({ email }), req.ip]
        );
      } catch (_) { /* la auditoria no debe romper el login */ }
      return res.status(403).json({
        error: 'Tu correo aún no ha sido verificado. Revisa tu bandeja de entrada (también la carpeta de spam) y confirma tu correo para activar la cuenta.',
        requiere_verificacion: true
      });
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

// ============================================================
// LOTE 6G: VERIFICACION DE CORREO
// ============================================================

// Aterriza el enlace de verificacion que llega por correo (?verificar=token)
router.post('/verificar-correo', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Enlace de verificación inválido.' });
  try {
    // LOTE 6G: el mismo enlace aterriza aqui tanto para la verificacion inicial
    // como para la confirmacion del cambio de correo; se distingue por el tipo del token.
    let fila = await consumirTokenCorreo(token, 'verificacion');
    let esCambio = false;
    if (!fila) {
      fila = await consumirTokenCorreo(token, 'cambio_correo');
      esCambio = true;
    }
    if (!fila) {
      return res.status(400).json({ error: 'El enlace de verificación es inválido o ya expiró. Solicita uno nuevo desde la pantalla de acceso.' });
    }
    if (esCambio) {
      const nuevoEmail = fila.email_pendiente;
      if (!nuevoEmail) {
        return res.status(400).json({ error: 'El enlace de confirmación es inválido o ya expiró.' });
      }
      const { error: errorAuth } = await supabaseAdminProxy.auth.admin.updateUserById(fila.usuario_id, { email: nuevoEmail, email_confirm: true });
      if (errorAuth) {
        return res.status(400).json({ error: 'No se pudo actualizar el correo en el sistema de autenticación: ' + errorAuth.message });
      }
      await db.query('UPDATE public.usuarios SET email = $1, email_pendiente = NULL, correo_verificado = true, verificado_en = now() WHERE id = $2', [nuevoEmail, fila.usuario_id]);
      try {
        await db.query(
          'INSERT INTO public.audit_logs (usuario_id, accion, tabla, valores_previos, nuevos_valores, ip) VALUES ($1, $2, $3, $4, $5, $6)',
          [fila.usuario_id, 'CORREO_CAMBIADO', 'usuarios', JSON.stringify({ email: fila.email }), JSON.stringify({ email: nuevoEmail }), req.ip]
        );
      } catch (_) { /* no bloquea */ }
      return res.json({ mensaje: 'Correo actualizado. A partir de ahora inicia sesión con tu nuevo correo.' });
    }
    await db.query('UPDATE public.usuarios SET correo_verificado = true, verificado_en = now() WHERE id = $1', [fila.usuario_id]);
    // Sincroniza el estado en Supabase Auth (best-effort: la columna propia es la puerta)
    try { await supabaseAdminProxy.auth.admin.updateUserById(fila.usuario_id, { email_confirm: true }); } catch (_) { /* no bloquea */ }
    try {
      await db.query(
        'INSERT INTO public.audit_logs (usuario_id, accion, tabla, nuevos_valores, ip) VALUES ($1, $2, $3, $4, $5)',
        [fila.usuario_id, 'CORREO_VERIFICADO', 'usuarios', JSON.stringify({ email: fila.email }), req.ip]
      );
    } catch (_) { /* no bloquea */ }
    return res.json({ mensaje: 'Correo verificado. Tu cuenta quedó activada; ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Error verificando correo:', error);
    return res.status(500).json({ error: 'Error interno al verificar el correo.' });
  }
});

// Reenvia el enlace de verificacion (pantalla de login, sin sesion)
router.post('/reenviar-verificacion', reenvioLimiter, async (req, res) => {
  const email = normalizarEmailLogin(req.body?.email);
  if (!REGEX_EMAIL_LOGIN.test(email)) return res.status(400).json({ error: 'Correo con formato inválido.' });
  try {
    const usuarioRes = await db.query('SELECT id, nombre, correo_verificado FROM public.usuarios WHERE email = $1 AND estado <> $2', [email, 'Inactivo']);
    const usuarioBD = usuarioRes.rows[0];
    if (usuarioBD && usuarioBD.correo_verificado === false) {
      await reenviarVerificacion({ usuarioId: usuarioBD.id, para: email, nombre: usuarioBD.nombre });
      try {
        await db.query(
          'INSERT INTO public.audit_logs (usuario_id, accion, tabla, nuevos_valores, ip) VALUES ($1, $2, $3, $4, $5)',
          [usuarioBD.id, 'REENVIAR_VERIFICACION', 'usuarios', JSON.stringify({ email }), req.ip]
        );
      } catch (_) { /* no bloquea */ }
    }
    // Respuesta generica: no revela si el correo existe en el sistema
    return res.json({ mensaje: 'Si el correo está registrado y pendiente de verificación, se envió un nuevo enlace.' });
  } catch (error) {
    console.error('Error reenviando verificación:', error);
    return res.status(500).json({ error: 'Error interno al reenviar el correo de verificación.' });
  }
});

// Aterriza la confirmacion del cambio de correo (?verificar=token de cambio)
router.post('/confirmar-cambio-correo', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Enlace de confirmación inválido.' });
  try {
    const fila = await consumirTokenCorreo(token, 'cambio_correo');
    if (!fila || !fila.email_pendiente) {
      return res.status(400).json({ error: 'El enlace de confirmación es inválido o ya expiró.' });
    }
    const nuevoEmail = fila.email_pendiente;
    const { error: errorAuth } = await supabaseAdminProxy.auth.admin.updateUserById(fila.usuario_id, { email: nuevoEmail, email_confirm: true });
    if (errorAuth) {
      return res.status(400).json({ error: 'No se pudo actualizar el correo en el sistema de autenticación: ' + errorAuth.message });
    }
    await db.query('UPDATE public.usuarios SET email = $1, email_pendiente = NULL, correo_verificado = true, verificado_en = now() WHERE id = $2', [nuevoEmail, fila.usuario_id]);
    try {
      await db.query(
        'INSERT INTO public.audit_logs (usuario_id, accion, tabla, valores_previos, nuevos_valores, ip) VALUES ($1, $2, $3, $4, $5, $6)',
        [fila.usuario_id, 'CORREO_CAMBIADO', 'usuarios', JSON.stringify({ email: fila.email }), JSON.stringify({ email: nuevoEmail }), req.ip]
      );
    } catch (_) { /* no bloquea */ }
    return res.json({ mensaje: 'Correo actualizado. A partir de ahora inicia sesión con tu nuevo correo.' });
  } catch (error) {
    console.error('Error confirmando cambio de correo:', error);
    return res.status(500).json({ error: 'Error interno al confirmar el cambio de correo.' });
  }
});

// ============================================================
// LOTE 6H: RESTABLECER CONTRASENA DESDE EL ENLACE DEL CORREO
// (?restablecer=token de 'recuperacion'). El administrador pide el reset
// desde el panel y la persona establece su propia clave con la misma
// politica de la clave provisional: letras + numeros + caracter especial.
// ============================================================
router.post('/restablecer-password', restablecerLimiter, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const nuevaPassword = typeof req.body?.nueva_password === 'string' ? req.body.nueva_password : '';
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Enlace de restablecimiento inválido.' });
  if (!/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/.test(nuevaPassword.trim())) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres e incluir letras, números y al menos un carácter especial.' });
  }
  try {
    const fila = await consumirTokenCorreo(token, 'recuperacion');
    if (!fila) {
      return res.status(400).json({ error: 'El enlace de restablecimiento es inválido o ya expiró. Puedes pedir uno nuevo con ¿Olvidó tu contraseña? en la pantalla de acceso.' });
    }
    const { error: errorAuth } = await supabaseAdminProxy.auth.admin.updateUserById(fila.usuario_id, {
      password: nuevaPassword.trim(),
      user_metadata: { debe_cambiar_password: false }
    });
    if (errorAuth) {
      return res.status(400).json({ error: 'No se pudo actualizar la contraseña: ' + errorAuth.message });
    }
    const hashedPwd = await bcrypt.hash(nuevaPassword.trim(), 10);
    await db.query('UPDATE public.usuarios SET password_hash = $2, debe_cambiar_password = false WHERE id = $1', [fila.usuario_id, hashedPwd]);
    try {
      await db.query(
        'INSERT INTO public.audit_logs (usuario_id, accion, tabla, nuevos_valores, ip) VALUES ($1, $2, $3, $4, $5)',
        [fila.usuario_id, 'PASSWORD_RESTABLECIDO', 'usuarios', JSON.stringify({ via: 'enlace_correo' }), req.ip]
      );
    } catch (_) { /* no bloquea */ }
    return res.json({ mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.' });
  } catch (error) {
    console.error('Error restableciendo contraseña:', error);
    return res.status(500).json({ error: 'Error interno al restablecer la contraseña.' });
  }
});

// ============================================================
// LOTE 6K: ¿OLVIDÓ SU CONTRASEÑA? (acceso publico, sin sesion)
// ============================================================
// La persona pide por si misma el enlace de restablecimiento con su correo.
// Medidas anti-abuso de un endpoint expuesto al publico:
//   1. Rate limit por IP y correo (5 cada 15 minutos).
//   2. Respuesta SIEMPRE identica y generica: no revela si el correo existe
//      en el sistema (evita el enumerado de cuentas).
//   3. El control anti-reenvio de la utilidad de correo (ventana de 2 minutos
//      por usuario y tipo) impide inundar la bandeja de una victima aunque
//      el atacante rote IPs o repita el mismo correo.
//   4. El enlace usa el token de recuperacion: 24 horas, de un solo uso y
//      guardado como hash sha256; cada pedido nuevo invalida el anterior.
//   5. La contrasena nunca viaja en el correo: la persona la establece en la
//      pantalla del enlace con la politica completa del sistema.
//   6. A una cuenta sin verificar no se le manda enlace de clave (seguiria
//      bloqueada igual): recibe el correo de verificacion pendiente.
// ============================================================
router.post('/solicitar-restablecer', olvideLimiter, async (req, res) => {
  const email = normalizarEmailLogin(req.body?.email);
  if (!REGEX_EMAIL_LOGIN.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Correo con formato inválido.' });
  }
  try {
    const usuarioRes = await db.query('SELECT id, nombre, correo_verificado FROM public.usuarios WHERE email = $1 AND estado <> $2', [email, 'Inactivo']);
    const usuarioBD = usuarioRes.rows[0];
    if (usuarioBD) {
      // El resultado del envio se ignora a proposito: la respuesta es generica
      // tanto si el correo no existe como si el envio fallo.
      if (usuarioBD.correo_verificado === false) {
        await reenviarVerificacion({ usuarioId: usuarioBD.id, para: email, nombre: usuarioBD.nombre });
      } else {
        await enviarRestablecerPassword({ usuarioId: usuarioBD.id, para: email, nombre: usuarioBD.nombre });
      }
      try {
        await db.query(
          'INSERT INTO public.audit_logs (usuario_id, accion, tabla, nuevos_valores, ip) VALUES ($1, $2, $3, $4, $5)',
          [usuarioBD.id, 'SOLICITAR_RESTABLECER', 'usuarios', JSON.stringify({ email, motivo: usuarioBD.correo_verificado === false ? 'verificacion_pendiente' : 'recuperacion' }), req.ip]
        );
      } catch (_) { /* no bloquea y no revela nada */ }
    }
    // Respuesta generica: no revela si el correo existe en el sistema
    return res.json({ mensaje: 'Si el correo está registrado, enviamos un enlace para restablecer la contraseña. Revisa tu bandeja de entrada y la carpeta de correo no deseado.' });
  } catch (error) {
    console.error('Error solicitando restablecimiento:', error);
    return res.status(500).json({ error: 'Error interno al procesar la solicitud.' });
  }
});

module.exports = router;