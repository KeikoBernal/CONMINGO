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
const supabaseAuthSocket = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const app = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);

// ==========================================
// MIDDLEWARES DE SEGURIDAD Y RATE LIMITING
// ==========================================
app.use(helmet());
app.use(cors({
  origin: origenPermitido, // FIX #9: lista blanca de orígenes CORS, 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configuración del Rate Limiter: Máximo 100 peticiones por IP cada 10 minutos
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 100, // Límite de 100 peticiones por IP en esa ventana de tiempo
  message: { 
    error: '🚨 Hemos detectado un exceso de peticiones desde tu red. Por medidas de seguridad, por favor espera 10 minutos antes de volver a intentarlo.' 
  },
  standardHeaders: true, // Retorna la info del límite en los headers `RateLimit-*`
  legacyHeaders: false, // Deshabilita los headers obsoletos `X-RateLimit-*`
});

// Aplicamos el blindaje a TODAS las rutas de la API
app.use('/api', apiLimiter);

// ==========================================
// CONFIGURACIÓN DEL SERVIDOR HTTP Y SOCKETS
// ==========================================

// Crear el servidor HTTP vinculándolo con Express
const server = http.createServer(app);

// Inicializar Socket.io con el servidor HTTP
const io = new Server(server, {
  cors: {
    origin: origenPermitido, // FIX #9: lista blanca de orígenes CORS, 
    methods: ['GET', 'POST']
  }
});

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
// ESTADO EN MEMORIA PARA LA PLANILLA EN VIVO
// ==========================================
const partidosEnMemoria = {};

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
    const { rows } = await db.query(
      'SELECT id, email, nombre, apellido, rol, organizacion_id FROM public.usuarios WHERE id = $1',
      [data.user.id]
    );
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
  const puedeOperarPartido = () => !!usuario && ROLES_OPERATIVOS.includes(rolNorm);
  console.log(`🟢 Nuevo cliente conectado: ${socket.id} ${usuario ? `(usuario ${usuario.id} · ${usuario.rol})` : '(anónimo, solo lectura pública)'}`);

  // --- SISTEMA DE MENSAJERÍA JERÁRQUICA (FIX #6) ---
  // La identidad la resuelve el servidor a partir del token verificado en io.use().
  // El payload del cliente se ignora: nadie puede suplantar a otro usuario ni elegir su rol.
  socket.on('registrar_usuario_mensajeria', () => {
    if (!usuario) return;
    socket.join(`usuario_${usuario.id}`);
    socket.join(`rol_${rolNorm}`);
    console.log(`💬 Cliente ${socket.id} registrado en mensajería como: usuario_${usuario.id} y rol_${rolNorm}`);
  });

  socket.on('enviar_mensaje', (data) => {
    if (!usuario) return; // FIX #6: solo usuarios autenticados pueden enviar

    // FIX #6: el remitente lo construye el servidor desde la BD, nunca el cliente.
    const remitente = `${(usuario.nombre || '') + (usuario.apellido ? ' ' + usuario.apellido : '')} (${usuario.rol})`.trim();
    const mensaje = (typeof data.mensaje === 'string') ? data.mensaje.slice(0, 500) : undefined;
    const timestamp = data.timestamp || new Date().toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });

    const salas = Array.isArray(data.destinatario_sala)
      ? data.destinatario_sala
      : (data.destinatario_sala ? [data.destinatario_sala] : []);

    salas.forEach(sala => {
      const nombreSala = (String(sala).startsWith('rol_') || String(sala).startsWith('usuario_')) ? sala : `usuario_${sala}`;
      io.to(nombreSala).emit('nuevo_mensaje', {
        remitente, remitente_id: usuario.id, mensaje, timestamp,
        destinatario_sala: nombreSala, propio: false
      });
    });

    if (data.cc_admin) {
      io.to('rol_administrador de liga').emit('nuevo_mensaje', {
        remitente: remitente + ' (CC)',
        remitente_id: usuario.id,
        mensaje: mensaje,
        timestamp: timestamp,
        destinatario_sala: 'rol_administrador de liga',
        propio: false
      });
    }
  });

  socket.on('notificacion_oficiales_partido', (data) => {
    if (!usuario) return; // FIX #6: requiere sesión
    if (data.arbitro_id) {
      io.to(`usuario_${data.arbitro_id}`).emit('nuevo_mensaje', {
        remitente: 'Sistema',
        mensaje: data.mensaje,
        timestamp: new Date().toLocaleTimeString()
      });
    }
    if (data.anotador_id) {
      io.to(`usuario_${data.anotador_id}`).emit('nuevo_mensaje', {
        remitente: 'Sistema',
        mensaje: data.mensaje,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  });

  socket.on('sync_cronometro', (data) => {
    if (!puedeOperarPartido()) return; // FIX #6: solo roles operativos autenticados
      io.to(`partido_${data.partido_id}`).emit('sincronizacion_cronometro', data);
    });

  socket.on('enviar_notificacion_admin', (data) => {
    if (!esOficial()) return; // FIX #6: solo árbitros/anotadores autenticados
    io.to('rol_administrador de liga').emit('nuevo_mensaje', {
      remitente: 'Sistema de Alertas Oficiales',
      mensaje: data.mensaje,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  // 1. Salas por partido
  socket.on('unirse_partido', (partidoId) => {
    const sala = `partido_${partidoId}`;
    socket.join(sala);
    console.log(`👤 Cliente ${socket.id} se unió a la sala: ${sala}`);
    
    if (partidosEnMemoria[partidoId]) {
      socket.emit('actualizar_planilla', partidosEnMemoria[partidoId]);
    }
  });

  socket.on('presencia_oficial', (data) => {
    if (!puedeOperarPartido()) return; // FIX #6: solo roles operativos autenticados
    const { partidoId, rol, estado } = data;
    io.to(`partido_${partidoId}`).emit('presencia_actualizada', { rol, estado });
  });

  socket.on('proponer_jugada', (data) => {
    if (!puedeOperarPartido()) return; // FIX #6: solo roles operativos autenticados
    const { partido_id, jugador_id, mano_index, valor } = data;
    
    if (!partidosEnMemoria[partido_id]) partidosEnMemoria[partido_id] = { efectividad: {} };
    if (!partidosEnMemoria[partido_id].efectividad[jugador_id]) partidosEnMemoria[partido_id].efectividad[jugador_id] = {};
    
    partidosEnMemoria[partido_id].efectividad[jugador_id][mano_index] = { valor: valor, estado: 'validado' };
    
    io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]);
  });

  socket.on('sincronizar_planilla_completa', (data) => {
    if (!puedeOperarPartido()) return; // FIX #6: solo roles operativos autenticados
    const { partido_id, efectividad, manualStats, tantosLocal, tantosVisita } = data;
    if (!partidosEnMemoria[partido_id]) partidosEnMemoria[partido_id] = { efectividad: {} };
    
    partidosEnMemoria[partido_id].efectividad = efectividad || {};
    partidosEnMemoria[partido_id].manualStats = manualStats || {};
    partidosEnMemoria[partido_id].tantosLocal = tantosLocal || Array(20).fill('');
    partidosEnMemoria[partido_id].tantosVisita = tantosVisita || Array(20).fill('');
    
    io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]);
  });

  socket.on('solicitar_revision_jugada', (data) => {
    if (!esOficial()) return; // FIX #6: solo árbitros/anotadores autenticados
    const { partido_id, jugador_id, mano_index, mensaje } = data;
    
    if (partidosEnMemoria[partido_id]?.efectividad[jugador_id]?.[mano_index]) {
      partidosEnMemoria[partido_id].efectividad[jugador_id][mano_index].estado = 'rechazado';
      
      io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]);
      io.to(`partido_${partido_id}`).emit('alerta_revision', mensaje);
    }
  });

  socket.on('decision_arbitro', async (data) => {
    if (!esOficial()) return; // FIX #6: solo árbitros/anotadores autenticados
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
    if (!esOficial()) return; // FIX #6: solo árbitros/anotadores autenticados
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

  socket.on('actualizar_stats_manuales', (data) => {
    if (!puedeOperarPartido()) return; // FIX #6: solo roles operativos autenticados
    const { partido_id, manualStats } = data;
    if (!partidosEnMemoria[partido_id]) partidosEnMemoria[partido_id] = { efectividad: {} };
    partidosEnMemoria[partido_id].manualStats = manualStats;
    io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]);
  });

  socket.on('tantos_asignados', async (data) => {
    if (!puedeOperarPartido()) return; // FIX #6: solo roles operativos autenticados
    const { partido_id, tantosLocal, tantosVisita } = data;
    
    if (!partidosEnMemoria[partido_id]) partidosEnMemoria[partido_id] = { efectividad: {} };
    partidosEnMemoria[partido_id].tantosLocal = tantosLocal;
    partidosEnMemoria[partido_id].tantosVisita = tantosVisita;
    io.to(`partido_${partido_id}`).emit('actualizar_planilla', partidosEnMemoria[partido_id]);

    try {
      await db.query(
        `INSERT INTO public.manos (partido_id, numero_mano, equipo_ganador_id, tantos_anotados)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET equipo_ganador_id = $3, tantos_anotados = $4`,
        [data.partido_id, data.mano_id, data.equipo_ganador_id, data.tantos_anotados]
      );
    } catch (error) {
      console.error('Error al registrar tantos en BD:', error);
    }
  });

  socket.on('partido_iniciado', (data) => {
    if (!puedeOperarPartido()) return; // FIX #6: solo roles operativos autenticados
    if (!partidosEnMemoria[data.partidoId]) partidosEnMemoria[data.partidoId] = { efectividad: {} };
    partidosEnMemoria[data.partidoId].estadoPartido = 'En Curso';
    partidosEnMemoria[data.partidoId].hora_inicio = data.hora_inicio;
    io.to(`partido_${data.partidoId}`).emit('actualizar_planilla', { estadoPartido: 'En Curso', hora_inicio: data.hora_inicio });
  });

  socket.on('partido_finalizado', async (data) => {
    if (!puedeOperarPartido()) return; // FIX #6: solo roles operativos autenticados
    if (!partidosEnMemoria[data.partidoId]) partidosEnMemoria[data.partidoId] = { efectividad: {} };
    partidosEnMemoria[data.partidoId].estadoPartido = 'Finalizado';
    partidosEnMemoria[data.partidoId].hora_final = data.hora_final;
    io.to(`partido_${data.partidoId}`).emit('actualizar_planilla', { estadoPartido: 'Finalizado', hora_final: data.hora_final });
  });

  socket.on('partido_suspendido', async (data) => {
    if (!puedeOperarPartido()) return; // FIX #6: solo roles operativos autenticados
    if (!partidosEnMemoria[data.partidoId]) partidosEnMemoria[data.partidoId] = { efectividad: {} };
    partidosEnMemoria[data.partidoId].estadoPartido = 'Suspendido';
    io.to(`partido_${data.partidoId}`).emit('actualizar_planilla', { estadoPartido: 'Suspendido' });
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Cliente desconectado: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP y WebSockets corriendo en el puerto ${PORT}`);
});