const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit'); // <-- NUEVA IMPORTACIÓN
require('dotenv').config();
const http = require('http'); 
const { Server } = require('socket.io'); 

const db = require('./config/db');
const { createClient } = require('@supabase/supabase-js'); // FIX #6: validar tokens de sockets
const { origenPermitido } = require('./config/corsOrigenes'); // FIX #9: lista blanca de orígenes
const { manejarErroresIntegridad } = require('./middleware/errorHandlerMiddleware'); // LOTE 4B (M1): errores de integridad como respuestas amigables
const supabaseAuthSocket = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const app = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);

// ==========================================
// MIDDLEWARES DE SEGURIDAD Y RATE LIMITING
// ==========================================
// LOTE H: helmet con configuración explícita para un API que solo sirve JSON
app.use(helmet({
  contentSecurityPolicy: false, // el API no sirve HTML: la CSP no aplica aquí
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' }, // no filtrar URLs internas al navegador
  frameguard: { action: 'deny' }, // el API nunca debe embeberse en un iframe
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true } // HSTS: 1 año
}));
app.use(cors({
  origin: origenPermitido, // FIX #9: lista blanca de orígenes CORS, 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false, // LOTE H: el API autentica por Bearer token, nunca por cookies
  maxAge: 7200, // LOTE H: el navegador cachea los preflights 2 horas
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'] // LOTE H: el frontend puede leer el cupo restante
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// FIX #17: límite general ampliado (600 por IP / 10 min) para que un dashboard que carga
// varias peticiones no agote el cupo. El blindaje estricto contra fuerza bruta sigue en
// login-proxy (loginLimiter y otpLimiter), que es donde de verdad se necesita.
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 600, // FIX #17: 600 peticiones por IP / 10 min — frena abuso sin bloquear el uso normal
  message: { 
    error: 'Hemos detectado un exceso de peticiones desde tu red. Por medidas de seguridad, por favor espera 10 minutos antes de volver a intentarlo.' 
  },
  standardHeaders: true, // Retorna la info del límite en los headers `RateLimit-*`
  legacyHeaders: false, // Deshabilita los headers obsoletos `X-RateLimit-*`
});

// Aplicamos el blindaje a TODAS las rutas de la API
app.use('/api', apiLimiter);

// ==========================================
// LOTE H: LÍMITES ESTRICTOS POR FAMILIA DE RUTAS SENSIBLES
// ==========================================
// Complementan el límite general (600/10 min) y el blindaje de login-proxy.
// Los dashboards hacen ráfagas de GET al cargar, así que los límites de
// escritura solo se aplican a los métodos que modifican datos.
const soloEscrituras = (limiter) => (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  return limiter(req, res, next);
};

// Superadmin: crear usuarios, reset de passwords, borrar ligas (50 escrituras / 15 min)
const escriturasCriticasLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas operaciones sensibles en poco tiempo. Por seguridad, espera 15 minutos.' }
});

// Admin de liga: CRUD de sedes/equipos/jugadores y cambio de password (200 escrituras / 15 min)
const escriturasAdminLigaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas operaciones de administración. Espera unos minutos antes de continuar.' }
});

// Operativo (árbitro/anotador): manos y sanciones durante un partido (200 escrituras / 10 min)
const escriturasOperativoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas jugadas registradas en poco tiempo. Espera un momento.' }
});

// Mensajería: envío de mensajes/notificaciones, vector de spam (60 envíos / 5 min)
const escriturasMensajeriaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Estás enviando demasiados mensajes. Espera unos minutos.' }
});

// Delegado: cambio de password propio (30 escrituras / 15 min)
const escriturasDelegadoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas operaciones. Espera 15 minutos.' }
});

// Lecturas públicas sin autenticación: la superficie más expuesta, frenar scraping (120 / min)
const lecturasPublicasLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas consultas. Espera un momento antes de recargar.' }
});

app.use('/api/superadmin', soloEscrituras(escriturasCriticasLimiter));
app.use('/api/admin-liga', soloEscrituras(escriturasAdminLigaLimiter));
app.use('/api/operativo', soloEscrituras(escriturasOperativoLimiter));
app.use('/api/mensajeria', soloEscrituras(escriturasMensajeriaLimiter));
app.use('/api/delegado', soloEscrituras(escriturasDelegadoLimiter));
app.use('/api/publico', lecturasPublicasLimiter);

// ==========================================
// CONFIGURACIÓN DEL SERVIDOR HTTP Y SOCKETS
// ==========================================

// Crear el servidor HTTP vinculándolo con Express
const server = http.createServer(app);

// Inicializar Socket.io con el servidor HTTP
const io = new Server(server, {
  cors: {
    origin: origenPermitido, // FIX #9: lista blanca de orígenes CORS, 
    methods: ['GET', 'POST'],
    credentials: false // LOTE H: Socket.io tampoco usa cookies
  }
});

// LOTE B: exponer la instancia de Socket.io para que las rutas puedan emitir eventos
app.set('io', io);

// Ruta de prueba para verificar que el servidor y la BD responden
app.get('/api/health', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW()');
    res.json({
      status: 'success',
      mensaje: 'Servidor activo y conectado a Supabase con éxito',
      timestamp_db: result.rows[0].now
    });
  } catch (error) {
    console.error('Error al conectar con la base de datos:', error);
    res.status(500).json({ status: 'error', mensaje: 'No hay conexión con la base de datos' });
  }
});

// ==========================================
// RUTAS RESTFUL
// ==========================================
const authRoutes = require('./routes/authRoutes');
app.use('/api', authRoutes);

const superadminRoutes = require('./routes/superadminRoutes');
app.use('/api/superadmin', superadminRoutes);

const adminLigaRoutes = require('./routes/adminLigaRoutes');
app.use('/api/admin-liga', adminLigaRoutes);

const operativoRoutes = require('./routes/operativoRoutes');
app.use('/api/operativo', operativoRoutes);

const publicRoutes = require('./routes/publicRoutes');
app.use('/api/publico', publicRoutes); 

const mensajeriaRoutes = require('./routes/mensajeriaRoutes'); 
app.use('/api/mensajeria', mensajeriaRoutes);

const delegadoRoutes = require('./routes/delegadoRoutes');
app.use('/api/delegado', delegadoRoutes);

// ==========================================
// LOTE 4B (M1): MIDDLEWARE DE ERRORES DE INTEGRIDAD
// Red de seguridad global: convierte violaciones crudas de PostgreSQL
// (unique 23505 / CHECK 23514 / FK 23503) en respuestas amigables 409/400
// para cualquier error que las rutas no capturen antes.
// ==========================================
app.use(manejarErroresIntegridad);

// ==========================================
// ESTADO EN MEMORIA PARA LA PLANILLA EN VIVO
// ==========================================
const partidosEnMemoria = {};
const presenciaOficiales = {}; // LOTE T: partidoId -> { arbitro: bool, anotador: bool }; presencia verificada en servidor

// ============================================================
// LOTE C/D: verificación de asignación del oficial al partido.
// Un árbitro/anotador autenticado solo puede operar el partido que tiene
// asignado; el administrador de liga solo partidos de SU organización;
// el superadmin mantiene acceso global. Consulta a BD con caché corto.
// ============================================================
const cachePermisoPartido = new Map(); // clave usuarioId:partidoId -> { ts, ok }
const puedeOperarPartidoEnBD = async (usuario, rolNorm, partidoId) => {
  if (!usuario || !partidoId) return false;
  if (rolNorm === 'superadmin') return true;
  const pid = parseInt(partidoId, 10);
  if (isNaN(pid)) return false;
  const clave = `${usuario.id}:${pid}`;
  const enCache = cachePermisoPartido.get(clave);
  if (enCache && (Date.now() - enCache.ts) < 60000) return enCache.ok;
  let ok = false;
  try {
    const { rows } = await db.query(
      'SELECT p.arbitro_id, p.anotador_id, t.organizacion_id FROM public.partidos p LEFT JOIN public.torneos t ON p.torneo_id = t.id WHERE p.id = $1',
      [pid]
    );
    if (rows.length === 1) {
      if (rolNorm === 'administrador de liga') {
        ok = rows[0].organizacion_id === usuario.organizacion_id;
      } else if (rolNorm === 'arbitro' || rolNorm === 'anotador' || rolNorm === 'arbitro/anotador') {
        ok = rows[0].arbitro_id === usuario.id || rows[0].anotador_id === usuario.id;
      }
    }
  } catch (e) {
    console.error('Error al verificar la asignación del partido:', e?.message || e);
    return false;
  }
  if (cachePermisoPartido.size > 20000) cachePermisoPartido.clear();
  cachePermisoPartido.set(clave, { ts: Date.now(), ok });
  return ok;
};

// ============================================================
// LOTE F: mensajería multi-liga. Las salas de rol dejan de ser globales:
// ahora son "rol_<rol>__org_<uuid de la organización>" para que los
// mensajes de rol no crucen entre ligas (el superadmin mantiene las
// salas globales "rol_<rol>"). Helper con caché corta (60 s) que resuelve
// la organización y el estado de un usuario, para validar destinos.
// ============================================================
const cacheUsuarioMensajeria = new Map(); // clave usuarioId -> { ts, organizacion_id, activo }
const datosUsuarioMensajeria = async (usuarioId) => {
  if (!usuarioId) return null;
  const enCache = cacheUsuarioMensajeria.get(usuarioId);
  if (enCache && (Date.now() - enCache.ts) < 60000) return enCache;
  try {
    const { rows } = await db.query(
      'SELECT organizacion_id, estado FROM public.usuarios WHERE id = $1',
      [usuarioId]
    );
    if (!rows.length) return null;
    const info = {
      ts: Date.now(),
      organizacion_id: rows[0].organizacion_id,
      activo: (rows[0].estado || 'Activo') !== 'Inactivo'
    };
    if (cacheUsuarioMensajeria.size > 20000) cacheUsuarioMensajeria.clear();
    cacheUsuarioMensajeria.set(usuarioId, info);
    return info;
  } catch (e) {
    console.error('Error al resolver datos de mensajería:', e?.message || e);
    return null;
  }
};

// ============================================================
// FIX #16: persistencia del estado de la planilla en la base de datos.
// El backend corre en Render (proceso persistente), así que Socket.io funciona;
// pero cada reinicio/redeploy pierde partidosEnMemoria. Con esta persistencia
// el estado se recupera solo (tabla public.planilla_estado, ver migración SQL).
// Si la tabla todavía no existe, nada se rompe: solo queda un log.
// ============================================================
const persistirPlanilla = (partidoId) => {
  const estado = partidosEnMemoria[partidoId];
  if (!estado) return;
  db.query(
    'INSERT INTO public.planilla_estado (partido_id, datos) VALUES ($1, $2) ON CONFLICT (partido_id) DO UPDATE SET datos = EXCLUDED.datos, updated_at = now()',
    [partidoId, JSON.stringify(estado)]
  ).catch((e) => console.error('[planilla] No se pudo persistir el estado:', e?.message || e));
};

const cargarPlanilla = async (partidoId) => {
  try {
    const { rows } = await db.query('SELECT datos FROM public.planilla_estado WHERE partido_id = $1', [partidoId]);
    if (rows.length && rows[0].datos) {
      partidosEnMemoria[partidoId] = rows[0].datos;
      return rows[0].datos;
    }
  } catch (e) {
    console.warn('[planilla] Tabla planilla_estado no disponible (¿falta ejecutar la migración?):', e?.message || e);
  }
  return null;
};

// ============================================================
// FIX #6: Autenticación de WebSockets (io.use)
// Valida el token de Supabase Auth y resuelve el rol desde la BD.
// Sin token: conexión anónima (solo lectura de la planilla pública).
// ============================================================
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      socket.data.usuario = null; // Anónimo: solo puede unirse a salas de partido (planilla pública)
      return next();
    }
    const { data, error } = await supabaseAuthSocket.auth.getUser(token);
    if (error || !data || !data.user) return next(new Error('Token inválido o expirado.'));
    let { rows } = await db.query(
      'SELECT id, email, nombre, apellido, rol, organizacion_id FROM public.usuarios WHERE id = $1',
      [data.user.id]
    );
    // LOTE T: si el UUID de auth.users no coincide con public.usuarios.id (desajuste de cuentas,
    // mismo caso del 403 del Superadmin), se resuelve por email para no rechazar el socket en silencio.
    if (!rows.length && data.user.email) {
      ({ rows } = await db.query(
        'SELECT id, email, nombre, apellido, rol, organizacion_id FROM public.usuarios WHERE lower(email) = lower($1)',
        [data.user.email]
      ));
      if (rows.length) console.warn(`Socket resuelto por email (${data.user.email}) en lugar del id de auth.`);
    }
    if (!rows.length) return next(new Error('Usuario no registrado en el sistema.'));
    socket.data.usuario = rows[0];
    socket.data.rolNormalizado = (rows[0].rol || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    next();
  } catch (e) {
    next(new Error('Error de autenticación del socket.'));
  }
});

// ==========================================
// LÓGICA DE WEBSOCKETS (TIEMPO REAL)
// ==========================================
io.on('connection', (socket) => {
  const usuario = socket.data.usuario || null; // FIX #6: identidad resuelta en io.use, nunca desde el cliente
  const rolNorm = socket.data.rolNormalizado || null;
  const ROLES_OPERATIVOS = ['arbitro', 'anotador', 'arbitro/anotador', 'administrador de liga', 'superadmin'];
  const esOficial = () => !!usuario && ['arbitro', 'anotador', 'arbitro/anotador'].includes(rolNorm);
  // LOTE C/D: además del rol, se verifica en BD que el oficial esté asignado a ESTE
  // partido (o que el admin de liga pertenezca a la organización del partido).
  const puedeOperarPartido = async (partidoId) => {
    if (!usuario || !ROLES_OPERATIVOS.includes(rolNorm)) return false;
    return puedeOperarPartidoEnBD(usuario, rolNorm, partidoId);
  };
  console.log(`Nuevo cliente conectado: ${socket.id} ${usuario ? `(usuario ${usuario.id} · ${usuario.rol})` : '(anónimo, solo lectura pública)'}`);

  // --- SISTEMA DE MENSAJERÍA JERÁRQUICA (FIX #6) ---
  // La identidad la resuelve el servidor a partir del token verificado en io.use().
  // El payload del cliente se ignora: nadie puede suplantar a otro usuario ni elegir su rol.
  socket.on('registrar_usuario_mensajeria', () => {
    if (!usuario) return;
    socket.join(`usuario_${usuario.id}`);
    // LOTE F: salas de rol acotadas por organización (el superadmin mantiene la sala global)
    if (rolNorm === 'superadmin') {
      socket.join(`rol_${rolNorm}`);
      console.log(`Cliente ${socket.id} registrado en mensajería como: usuario_${usuario.id} y rol_${rolNorm}`);
    } else if (usuario.organizacion_id) {
      socket.join(`rol_${rolNorm}__org_${usuario.organizacion_id}`);
      console.log(`Cliente ${socket.id} registrado en mensajería como: usuario_${usuario.id} y rol_${rolNorm}__org_${usuario.organizacion_id}`);
    }
  });

  socket.on('enviar_mensaje', async (data) => { // LOTE F: validación de destinos en BD (async)
    if (!usuario) return; // FIX #6: solo usuarios autenticados pueden enviar
    const esSuperadminLocal = rolNorm === 'superadmin';
    const miOrg = usuario.organizacion_id || null;

    // FIX #6: el remitente lo construye el servidor desde la BD, nunca el cliente.
    const remitente = `${(usuario.nombre || '') + (usuario.apellido ? ' ' + usuario.apellido : '')} (${usuario.rol})`.trim();
    const mensaje = (typeof data.mensaje === 'string') ? data.mensaje.slice(0, 500) : undefined;
    const timestamp = data.timestamp || new Date().toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });

    const salas = Array.isArray(data.destinatario_sala)
      ? data.destinatario_sala
      : (data.destinatario_sala ? [data.destinatario_sala] : []);

    // LOTE F: el cliente ya no elige libremente la sala de destino:
    // - las salas de rol se remapean a la organización del remitente
    //   ("rol_<rol>__org_<uuid>"); el superadmin mantiene las salas globales;
    // - las salas de usuario se validan en BD: que el destinatario exista,
    //   esté activo y pertenezca a la misma organización del remitente.
    for (const sala of salas) {
      const nombreSala = (String(sala).startsWith('rol_') || String(sala).startsWith('usuario_')) ? sala : `usuario_${sala}`;
      if (String(nombreSala).startsWith('rol_')) {
        if (!esSuperadminLocal && !miOrg) continue;
        const salaDestino = esSuperadminLocal ? nombreSala : `${nombreSala}__org_${miOrg}`;
        io.to(salaDestino).emit('nuevo_mensaje', {
          remitente, remitente_id: usuario.id, mensaje, timestamp,
          destinatario_sala: nombreSala, propio: false
        });
        continue;
      }
      const otroId = String(nombreSala).slice('usuario_'.length);
      if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(otroId)) continue; // LOTE F: UUID estricto
      if (!esSuperadminLocal) {
        const otro = await datosUsuarioMensajeria(otroId);
        if (!otro || !otro.activo || !miOrg || otro.organizacion_id !== miOrg) continue;
      }
      io.to(nombreSala).emit('nuevo_mensaje', {
        remitente, remitente_id: usuario.id, mensaje, timestamp,
        destinatario_sala: nombreSala, propio: false
      });
    }

    if (data.cc_admin) {
      // LOTE F: el CC solo llega a los administradores de la liga del remitente
      if (!esSuperadminLocal && !miOrg) return;
      const salaAdmin = esSuperadminLocal ? 'rol_administrador de liga' : `rol_administrador de liga__org_${miOrg}`;
      io.to(salaAdmin).emit('nuevo_mensaje', {
        remitente: remitente + ' (CC)',
        remitente_id: usuario.id,
        mensaje: mensaje,
        timestamp: timestamp,
        destinatario_sala: 'rol_administrador de liga', // LOTE F: nombre original para compatibilidad del frontend
        propio: false
      });
    }
  });

  // LOTE F: antes cualquier usuario autenticado podía notificar a cualquier
  // oficial de cualquier liga suplantando al "Sistema". Ahora solo el
  // administrador de liga (o el superadmin) puede usarlo, y los oficiales
  // deben pertenecer a SU organización.
  socket.on('notificacion_oficiales_partido', async (data) => {
    if (!usuario) return; // FIX #6: requiere sesión
    const esSuperadminLocal = rolNorm === 'superadmin';
    if (!esSuperadminLocal && rolNorm !== 'administrador de liga') return;
    const miOrg = usuario.organizacion_id || null;
    const oficialPermitido = async (oficialId) => {
      if (!oficialId) return false;
      if (esSuperadminLocal) return true;
      if (!miOrg) return false;
      const otro = await datosUsuarioMensajeria(oficialId);
      return !!otro && otro.activo && otro.organizacion_id === miOrg;
    };
    if (await oficialPermitido(data.arbitro_id)) {
      io.to(`usuario_${data.arbitro_id}`).emit('nuevo_mensaje', {
        remitente: 'Sistema',
        mensaje: data.mensaje,
        timestamp: new Date().toLocaleTimeString()
      });
    }
    if (await oficialPermitido(data.anotador_id)) {
      io.to(`usuario_${data.anotador_id}`).emit('nuevo_mensaje', {
        remitente: 'Sistema',
        mensaje: data.mensaje,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  });

  socket.on('sync_cronometro', async (data) => {
    if (!(await puedeOperarPartido(data.partido_id))) return; // LOTE C/D: verificación de asignación al partido
      io.to(`partido_${data.partido_id}`).emit('sincronizacion_cronometro', data);
    });

  socket.on('enviar_notificacion_admin', (data) => {
    if (!esOficial()) return; // FIX #6: solo árbitros/anotadores autenticados
    // LOTE F: la alerta solo llega a los administradores de la liga del oficial
    const miOrg = usuario.organizacion_id || null;
    if (!miOrg) return;
    io.to(`rol_administrador de liga__org_${miOrg}`).emit('nuevo_mensaje', {
      remitente: 'Sistema de Alertas Oficiales',
      mensaje: data.mensaje,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  // 1. Salas por partido
    socket.on('unirse_partido', async (partidoId) => {
    const pid = parseInt(partidoId, 10); // FIX #16: normaliza el ID (antes llegaba mezclado como texto/número)
    const sala = `partido_${pid}`;
    socket.join(sala);
    console.log(`Cliente ${socket.id} se unió a la sala: ${sala}`);

    // FIX #16: si el servidor se reinició (redeploy de Render), el estado se recupera desde la BD.
    if (!isNaN(pid) && !partidosEnMemoria[pid]) {
      await cargarPlanilla(pid);
    }
    if (partidosEnMemoria[pid]) {
      socket.emit('actualizar_planilla', partidosEnMemoria[pid]);
    }

    // LOTE T: foto de presencia al unirse. Antes el anuncio de presencia se emitia una sola vez
    // al entrar al partido, asi que el oficial que entraba segundo nunca se enteraba de que el
    // primero ya estaba conectado (indicadores siempre en Ausente). El servidor es la fuente de verdad.
    const fotoPresencia = presenciaOficiales[pid] || {};
    socket.emit('presencia_actualizada', { rol: 'arbitro', estado: !!fotoPresencia.arbitro });
    socket.emit('presencia_actualizada', { rol: 'anotador', estado: !!fotoPresencia.anotador });
  });

  socket.on('presencia_oficial', async (data) => {
    if (!(await puedeOperarPartido(data.partidoId))) return; // LOTE C/D: verificación de asignación al partido
    const partidoId = parseInt(data.partidoId, 10);
    if (isNaN(partidoId)) return;
    // LOTE T: el rol lo determina el servidor a partir de la identidad verificada en io.use; el
    // cliente solo elige cuando su rol dual es 'arbitro/anotador' (en que modulo esta trabajando).
    let rol = rolNorm === 'arbitro/anotador' ? (data.rol === 'anotador' ? 'anotador' : 'arbitro') : rolNorm;
    if (rol !== 'arbitro' && rol !== 'anotador') return;
    const estado = !!data.estado;
    if (!presenciaOficiales[partidoId]) presenciaOficiales[partidoId] = { arbitro: false, anotador: false };
    presenciaOficiales[partidoId][rol] = estado;
    // LOTE T: se recuerda la presencia activa de este socket para liberarla en disconnect.
    socket.data.presenciaActiva = estado ? { pid: partidoId, rol } : null;
    io.to(`partido_${partidoId}`).emit('presencia_actualizada', { rol, estado });
  });

  socket.on('proponer_jugada', async (data) => {
    if (!(await puedeOperarPartido(data.partido_id))) return; // LOTE C/D: verificación de asignación al partido
    const { partido_id, jugador_id, mano_index, valor } = data;
    
    if (!partidosEnMemoria[partido_id]) partidosEnMemoria[partido_id] = { efectividad: {} };
    if (!partidosEnMemoria[partido_id].efectividad[jugador_id]) partidosEnMemoria[partido_id].efectividad[jugador_id] = {};
    
    partidosEnMemoria[partido_id].efectividad[jugador_id][mano_index] = { valor: valor, estado: 'validado' };
    
    io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]); persistirPlanilla(partido_id); // FIX #16
  });

  socket.on('sincronizar_planilla_completa', async (data) => {
    if (!(await puedeOperarPartido(data.partido_id))) return; // LOTE C/D: verificación de asignación al partido
    const { partido_id, efectividad, manualStats, tantosLocal, tantosVisita } = data;
    if (!partidosEnMemoria[partido_id]) partidosEnMemoria[partido_id] = { efectividad: {} };
    
    partidosEnMemoria[partido_id].efectividad = efectividad || {};
    partidosEnMemoria[partido_id].manualStats = manualStats || {};
    partidosEnMemoria[partido_id].tantosLocal = tantosLocal || Array(20).fill('');
    partidosEnMemoria[partido_id].tantosVisita = tantosVisita || Array(20).fill('');
    
    io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]); persistirPlanilla(partido_id); // FIX #16
  });

  socket.on('solicitar_revision_jugada', async (data) => {
    if (!esOficial() || !(await puedeOperarPartido(data.partido_id))) return; // LOTE C/D: debe ser oficial asignado a este partido
    const { partido_id, jugador_id, mano_index, mensaje } = data;
    
    if (partidosEnMemoria[partido_id]?.efectividad[jugador_id]?.[mano_index]) {
      partidosEnMemoria[partido_id].efectividad[jugador_id][mano_index].estado = 'rechazado';
      
      io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]); persistirPlanilla(partido_id); // FIX #16
      io.to(`partido_${partido_id}`).emit('alerta_revision', mensaje);
    }
  });

  socket.on('decision_arbitro', async (data) => {
    if (!esOficial() || !(await puedeOperarPartido(data.partido_id))) return; // LOTE C/D: debe ser oficial asignado a este partido
    try {
      await db.query(
        `INSERT INTO public.detalle_jugadas (mano_id, jugador_id, tipo_destreza, efectividad, minuto_registro)
         VALUES ($1, $2, $3, $4, $5)`,
        [data.mano_id, data.jugador_id, data.tipo_destreza, data.efectividad, data.minuto_registro]
      );
      io.to(`partido_${data.partido_id}`).emit('bola_jugada_notificacion', data);
    } catch (error) {
      console.error('Error al registrar decisión del árbitro:', error);
    }
  });

  socket.on('tarjeta_emitida', async (data) => {
    if (!esOficial() || !(await puedeOperarPartido(data.partido_id))) return; // LOTE C/D: debe ser oficial asignado a este partido
    try {
      await db.query(
        `INSERT INTO public.tarjetas (partido_id, jugador_id, color, minuto_registro)
         VALUES ($1, $2, $3, $4)`,
        [data.partido_id, data.jugador_id, data.color, data.minuto_registro]
      );
      io.to(`partido_${data.partido_id}`).emit('tarjeta_notificacion', data);
    } catch (error) {
      console.error('Error al emitir tarjeta:', error);
    }
  });

  socket.on('actualizar_stats_manuales', async (data) => {
    if (!(await puedeOperarPartido(data.partido_id))) return; // LOTE C/D: verificación de asignación al partido
    const { partido_id, manualStats } = data;
    if (!partidosEnMemoria[partido_id]) partidosEnMemoria[partido_id] = { efectividad: {} };
    partidosEnMemoria[partido_id].manualStats = manualStats;
    io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]); persistirPlanilla(partido_id); // FIX #16
  });

  socket.on('tantos_asignados', async (data) => {
    if (!(await puedeOperarPartido(data.partido_id))) return; // LOTE C/D: verificación de asignación al partido
    const { partido_id, tantosLocal, tantosVisita } = data;
    
    if (!partidosEnMemoria[partido_id]) partidosEnMemoria[partido_id] = { efectividad: {} };
    partidosEnMemoria[partido_id].tantosLocal = tantosLocal;
    partidosEnMemoria[partido_id].tantosVisita = tantosVisita;
    io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]); persistirPlanilla(partido_id); // FIX #16

    try {
      await db.query(
        `INSERT INTO public.manos (partido_id, numero_mano, equipo_ganador_id, tantos_anotados)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (partido_id, numero_mano) DO UPDATE SET equipo_ganador_id = $3, tantos_anotados = $4`,
        [data.partido_id, data.mano_id, data.equipo_ganador_id, data.tantos_anotados]
      );
    } catch (error) {
      console.error('Error al registrar tantos en BD:', error);
    }
  });

  socket.on('partido_iniciado', async (data) => {
    if (!(await puedeOperarPartido(data.partidoId))) return; // LOTE C/D: verificación de asignación al partido
    if (!partidosEnMemoria[data.partidoId]) partidosEnMemoria[data.partidoId] = { efectividad: {} };
    partidosEnMemoria[data.partidoId].estadoPartido = 'En Curso';
    partidosEnMemoria[data.partidoId].hora_inicio = data.hora_inicio;
    io.to(`partido_${data.partidoId}`).emit('actualizar_planilla', { estadoPartido: 'En Curso', hora_inicio: data.hora_inicio }); persistirPlanilla(data.partidoId); // FIX #16
  });

  socket.on('partido_finalizado', async (data) => {
    if (!(await puedeOperarPartido(data.partidoId))) return; // LOTE C/D: verificación de asignación al partido
    if (!partidosEnMemoria[data.partidoId]) partidosEnMemoria[data.partidoId] = { efectividad: {} };
    partidosEnMemoria[data.partidoId].estadoPartido = 'Finalizado';
    partidosEnMemoria[data.partidoId].hora_final = data.hora_final;
    io.to(`partido_${data.partidoId}`).emit('actualizar_planilla', { estadoPartido: 'Finalizado', hora_final: data.hora_final }); persistirPlanilla(data.partidoId); // FIX #16
  });

  socket.on('partido_suspendido', async (data) => {
    if (!(await puedeOperarPartido(data.partidoId))) return; // LOTE C/D: verificación de asignación al partido
    if (!partidosEnMemoria[data.partidoId]) partidosEnMemoria[data.partidoId] = { efectividad: {} };
    partidosEnMemoria[data.partidoId].estadoPartido = 'Suspendido';
    io.to(`partido_${data.partidoId}`).emit('actualizar_planilla', { estadoPartido: 'Suspendido' }); persistirPlanilla(data.partidoId); // FIX #16
  });

  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
    // LOTE T: si este socket tenia presencia activa en un partido, se libera y se avisa a la
    // sala, para que el otro oficial vea Ausente de inmediato y no quede con un estado viejo.
    const activa = socket.data.presenciaActiva;
    if (activa && presenciaOficiales[activa.pid]) {
      presenciaOficiales[activa.pid][activa.rol] = false;
      socket.data.presenciaActiva = null;
      io.to(`partido_${activa.pid}`).emit('presencia_actualizada', { rol: activa.rol, estado: false });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor HTTP y WebSockets corriendo en el puerto ${PORT}`);
});