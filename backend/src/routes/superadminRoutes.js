const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const { verificarToken, autorizarRoles } = require('../middleware/authMiddleware');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);
const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const capitalizarTexto = (texto) => {
  if (!texto) return '';
  return texto.trim().toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

const registrarAuditoria = async (usuarioId, accion, tabla, valoresPrevios = null, nuevosValores = null, ip = null) => {
  try {
    await db.query(
      `INSERT INTO public.audit_logs (usuario_id, accion, tabla, valores_previos, nuevos_valores, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuarioId, accion, tabla, valoresPrevios ? JSON.stringify(valoresPrevios) : null, nuevosValores ? JSON.stringify(nuevosValores) : null, ip]
    );
  } catch (error) { console.error('Error escribiendo en audit_logs:', error); }
};

router.use(verificarToken, autorizarRoles('Superadmin'));

router.post('/log-evento', async (req, res) => {
  const { accion, tabla, detalles } = req.body;
  try {
    await registrarAuditoria(req.usuario.id, accion || 'ACCION_SISTEMA', tabla || 'auth', null, detalles || null, req.ip);
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: 'Error registrando evento.' }); }
});

// ==========================================
// MÉTRICAS AMPLIADAS
// ==========================================
router.get('/metricas', async (req, res) => {
  try {
    const totalLigas = await db.query('SELECT COUNT(*) FROM public.organizaciones');
    const ligasActivas = await db.query('SELECT COUNT(*) FROM public.organizaciones WHERE estado_activa = true');
    const totalUsuarios = await db.query('SELECT COUNT(*) FROM public.usuarios');
    const totalEquipos = await db.query('SELECT COUNT(*) FROM public.equipos');
    const totalJugadores = await db.query('SELECT COUNT(*) FROM public.jugadores');
    const usuariosPorRol = await db.query('SELECT rol, COUNT(*) as cantidad FROM public.usuarios GROUP BY rol');

    const partidosActivos = await db.query(`SELECT p.id, p.fecha_partido, p.estado, o.nombre as liga_nombre, p.organizacion_id FROM public.partidos p LEFT JOIN public.organizaciones o ON p.organizacion_id = o.id WHERE p.estado IN ('en_curso', 'activo', 'en vivo') ORDER BY p.fecha_partido DESC`).catch(() => ({ rows: [] }));
    const partidosAgendados = await db.query(`SELECT p.id, p.fecha_partido, p.estado, o.nombre as liga_nombre, p.organizacion_id FROM public.partidos p LEFT JOIN public.organizaciones o ON p.organizacion_id = o.id WHERE p.estado = 'agendado' ORDER BY p.fecha_partido ASC`).catch(() => ({ rows: [] }));

    res.json({
      total_ligas: parseInt(totalLigas.rows[0].count), ligas_activas: parseInt(ligasActivas.rows[0].count), total_usuarios: parseInt(totalUsuarios.rows[0].count),
      total_equipos: parseInt(totalEquipos.rows[0].count), total_jugadores: parseInt(totalJugadores.rows[0].count), usuarios_por_rol: usuariosPorRol.rows,
      partidos_activos: partidosActivos.rows, partidos_agendados: partidosAgendados.rows
    });
  } catch (error) { res.status(500).json({ error: 'Error al consultar métricas.' }); }
});

// ==========================================
// GESTIÓN DE LIGAS
// ==========================================
router.get('/ligas', async (req, res) => {
  try {
    const resultado = await db.query(`SELECT id, nombre, estado_activa, logo_url, responsable_nombre, responsable_telefono, responsable_email, creado_en FROM public.organizaciones ORDER BY creado_en DESC`);
    res.json(resultado.rows);
  } catch (error) { res.status(500).json({ error: 'Error al consultar ligas.' }); }
});

router.get('/ligas/:id/detalle', async (req, res) => {
  const { id } = req.params;
  try {
    const liga = await db.query('SELECT * FROM public.organizaciones WHERE id = $1', [id]);
    if (liga.rows.length === 0) return res.status(404).json({ error: 'Liga no encontrada.' });

    const usuarios = await db.query('SELECT id, nombre, apellido, email, rol, cedula FROM public.usuarios WHERE organizacion_id = $1', [id]);
    const equipos = await db.query('SELECT * FROM public.equipos WHERE organizacion_id = $1', [id]);
    const sedes = await db.query('SELECT * FROM public.sedes WHERE organizacion_id = $1', [id]);
    const torneos = await db.query('SELECT * FROM public.torneos WHERE organizacion_id = $1', [id]);
    const jugadores = await db.query(`SELECT j.*, e.nombre as equipo_nombre FROM public.jugadores j JOIN public.equipos e ON j.equipo_id = e.id WHERE e.organizacion_id = $1`, [id]);
    const partidos = await db.query(`SELECT p.*, t.nombre as torneo_nombre, el.nombre as local_nombre, ev.nombre as visita_nombre FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id JOIN public.equipos el ON p.equipo_local_id = el.id JOIN public.equipos ev ON p.equipo_visita_id = ev.id WHERE t.organizacion_id = $1`, [id]);

    res.json({ liga: liga.rows[0], usuarios: usuarios.rows, equipos: equipos.rows, sedes: sedes.rows, torneos: torneos.rows, jugadores: jugadores.rows, partidos: partidos.rows });
  } catch (error) { res.status(500).json({ error: 'Error al consultar la información detallada.' }); }
});

router.post('/ligas', async (req, res) => {
  const { nombre, responsable_nombre, responsable_apellido, responsable_cedula, responsable_telefono, responsable_email, logo_url } = req.body;
  if (!nombre || !responsable_nombre || !responsable_apellido || !responsable_cedula || !responsable_email) return res.status(400).json({ error: 'Faltan datos obligatorios.' });
  
  const cedulaLimpia = responsable_cedula.trim();
  if (!/^\d{5,8}$/.test(cedulaLimpia)) return res.status(400).json({ error: 'La cédula debe ser de 5 a 8 dígitos numéricos.' });

  const nombreLigaCap = capitalizarTexto(nombre);
  const respNombreCap = capitalizarTexto(responsable_nombre);
  const respApellidoCap = capitalizarTexto(responsable_apellido);

  try {
    const resDb = await db.query(`INSERT INTO public.organizaciones (nombre, responsable_nombre, responsable_telefono, responsable_email, logo_url) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [nombreLigaCap, respNombreCap, responsable_telefono?.trim(), responsable_email.trim().toLowerCase(), logo_url || null]);
    const organizacionId = resDb.rows[0].id;

    const primerNombre = respNombreCap.split(' ')[0];
    const passwordInicial = `${primerNombre}${cedulaLimpia.substring(0, 5)}!`;

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: responsable_email.trim().toLowerCase(), password: passwordInicial, email_confirm: true,
      user_metadata: { rol: 'Administrador de Liga', nombre: respNombreCap, apellido: respApellidoCap, cedula: cedulaLimpia, debe_cambiar_password: true }
    });

    if (authError) {
      await db.query('DELETE FROM public.organizaciones WHERE id = $1', [organizacionId]);
      return res.status(400).json({ error: authError.message });
    }

    await db.query(`INSERT INTO public.usuarios (id, email, rol, nombre, apellido, cedula, organizacion_id, debe_cambiar_password) VALUES ($1, $2, 'Administrador de Liga', $3, $4, $5, $6, true)`, [authUser.user.id, responsable_email.trim().toLowerCase(), respNombreCap, respApellidoCap, cedulaLimpia, organizacionId]);
    await registrarAuditoria(req.usuario.id, 'CREAR_LIGA_Y_ADMIN', 'organizaciones', null, { ...resDb.rows[0], adminId: authUser.user.id }, req.ip);
    
    res.status(201).json({ mensaje: `Liga creada con éxito. Contraseña del Administrador: ${passwordInicial}`, liga: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error general al crear liga.' }); }
});

router.put('/ligas/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, responsable_nombre, responsable_telefono, responsable_email, estado_activa } = req.body;
  try {
    const previa = await db.query('SELECT * FROM public.organizaciones WHERE id = $1', [id]);
    const nombreLigaCap = capitalizarTexto(nombre);
    const respNombreCap = capitalizarTexto(responsable_nombre);

    const resDb = await db.query(`UPDATE public.organizaciones SET nombre = $1, responsable_nombre = $2, responsable_telefono = $3, responsable_email = $4, estado_activa = $5 WHERE id = $6 RETURNING *`, [nombreLigaCap, respNombreCap, responsable_telefono, responsable_email.trim().toLowerCase(), estado_activa, id]);
    
    if (estado_activa !== previa.rows[0].estado_activa) {
      const banStatus = estado_activa ? 'none' : '876000h'; 
      const usuariosLiga = await db.query('SELECT id FROM public.usuarios WHERE organizacion_id = $1', [id]);
      for (const u of usuariosLiga.rows) { await supabaseAdmin.auth.admin.updateUserById(u.id, { ban_duration: banStatus }); }
    }
    await registrarAuditoria(req.usuario.id, 'EDITAR_LIGA', 'organizaciones', previa.rows[0], resDb.rows[0], req.ip);
    res.json({ mensaje: `Liga actualizada.`, liga: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al actualizar la liga.' }); }
});

router.delete('/ligas/:id', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Contraseña requerida.' });
  const { error: authError } = await supabaseAuth.auth.signInWithPassword({ email: req.usuario.email, password });
  if (authError) return res.status(401).json({ error: 'Contraseña incorrecta.' });

  try {
    const previa = await db.query('SELECT * FROM public.organizaciones WHERE id = $1', [id]);
    await db.query('DELETE FROM public.organizaciones WHERE id = $1', [id]);
    await registrarAuditoria(req.usuario.id, 'ELIMINAR_LIGA', 'organizaciones', previa.rows[0], null, req.ip);
    res.json({ mensaje: 'Liga eliminada con éxito.' });
  } catch (error) { res.status(500).json({ error: 'Error al eliminar liga.' }); }
});

router.get('/equipos', async (req, res) => {
  const { liga_id } = req.query;
  try {
    let query = 'SELECT id, nombre, categoria FROM public.equipos';
    const params = [];
    if (liga_id) {
      query += ' WHERE organizacion_id = $1';
      params.push(liga_id);
    }
    query += ' ORDER BY nombre ASC';
    const resDb = await db.query(query, params);
    res.json(resDb.rows);
  } catch (error) { res.status(500).json({ error: 'Error obteniendo equipos.' }); }
});

// ==========================================
// GESTIÓN DE USUARIOS
// ==========================================
router.get('/usuarios', async (req, res) => {
  try {
    const resultado = await db.query(`SELECT u.id, u.email, u.rol, u.nombre, u.apellido, u.cedula, u.debe_cambiar_password, u.organizacion_id, o.nombre as organizacion_nombre FROM public.usuarios u LEFT JOIN public.organizaciones o ON u.organizacion_id = o.id ORDER BY u.email ASC`);
    res.json(resultado.rows);
  } catch (error) { res.status(500).json({ error: 'Error al obtener usuarios.' }); }
});

router.post('/usuarios', async (req, res) => {
  const { email, nombre, apellido, cedula, rol, organizacion_id, equipo_id } = req.body;
  if (!email || !nombre || !apellido || !cedula || !rol) return res.status(400).json({ error: 'Datos obligatorios faltantes.' });
  
  const cedulaLimpia = cedula.trim();
  if (!/^\d{5,8}$/.test(cedulaLimpia)) return res.status(400).json({ error: 'La cédula debe ser de 5 a 8 dígitos numéricos.' });

  const nombreCap = capitalizarTexto(nombre);
  const apellidoCap = capitalizarTexto(apellido);
  const passwordInicial = `${nombreCap.split(' ')[0]}${cedulaLimpia.substring(0, 5)}!`;

  try {
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim().toLowerCase(), password: passwordInicial, email_confirm: true,
      user_metadata: { rol, nombre: nombreCap, apellido: apellidoCap, cedula: cedulaLimpia, debe_cambiar_password: true },
    });
    if (authError) return res.status(400).json({ error: authError.message });

    const resDb = await db.query(`UPDATE public.usuarios SET rol = $1, nombre = $2, apellido = $3, cedula = $4, organizacion_id = $5, debe_cambiar_password = true WHERE id = $6 RETURNING *`, [rol, nombreCap, apellidoCap, cedulaLimpia, organizacion_id || null, authUser.user.id]);
    
    if (rol.toLowerCase() === 'delegado de equipo' && equipo_id) {
      await db.query('UPDATE public.equipos SET delegado_id = $1 WHERE id = $2', [authUser.user.id, equipo_id]);
    }

    await registrarAuditoria(req.usuario.id, 'CREAR_USUARIO', 'usuarios', null, resDb.rows[0], req.ip);
    res.status(201).json({ mensaje: `Usuario creado. Contraseña inicial: ${passwordInicial}`, usuario: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al registrar usuario.' }); }
});

router.put('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, apellido, cedula, rol, organizacion_id, debe_cambiar_password } = req.body;
  
  const cedulaLimpia = cedula.trim();
  if (!/^\d{5,8}$/.test(cedulaLimpia)) return res.status(400).json({ error: 'La cédula debe ser de 5 a 8 dígitos numéricos.' });

  const nombreCap = capitalizarTexto(nombre);
  const apellidoCap = capitalizarTexto(apellido);

  try {
    const previa = await db.query('SELECT * FROM public.usuarios WHERE id = $1', [id]);
    const resDb = await db.query(`UPDATE public.usuarios SET nombre = $1, apellido = $2, cedula = $3, rol = $4, organizacion_id = $5, debe_cambiar_password = $6 WHERE id = $7 RETURNING *`, [nombreCap, apellidoCap, cedulaLimpia, rol, organizacion_id || null, debe_cambiar_password ?? previa.rows[0].debe_cambiar_password, id]);
    await supabaseAdmin.auth.admin.updateUserById(id, { user_metadata: { rol, nombre: nombreCap, apellido: apellidoCap, cedula: cedulaLimpia, debe_cambiar_password } });
    await registrarAuditoria(req.usuario.id, 'EDITAR_USUARIO', 'usuarios', previa.rows[0], resDb.rows[0], req.ip);
    res.json({ mensaje: 'Usuario actualizado con éxito.', usuario: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al actualizar el usuario.' }); }
});

router.post('/usuarios/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  try {
    const userDb = await db.query('SELECT id, email, cedula, nombre FROM public.usuarios WHERE id = $1', [id]);
    const { cedula, nombre } = userDb.rows[0];
    const nuevaPassword = `${nombre ? nombre.trim().split(' ')[0] : 'User'}${cedula.trim().substring(0, 5)}!`;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password: nuevaPassword, user_metadata: { debe_cambiar_password: true } });
    if (error) return res.status(400).json({ error: error.message });

    await db.query('UPDATE public.usuarios SET debe_cambiar_password = true WHERE id = $1', [id]);
    await registrarAuditoria(req.usuario.id, 'RESET_PASSWORD', 'usuarios', { id }, { password_reset: true }, req.ip);
    res.json({ mensaje: `Contraseña restablecida correctamente. Nueva clave temporal: ${nuevaPassword}` });
  } catch (error) { res.status(500).json({ error: 'Error al restablecer contraseña.' }); }
});

// NUEVA RUTA: Endpoint para pre-validar en el frontend si se permite la eliminación (UX Fluida)
router.get('/usuarios/:id/verificar-eliminacion', async (req, res) => {
  const { id } = req.params;
  try {
    const previa = await db.query('SELECT * FROM public.usuarios WHERE id = $1', [id]);
    if (previa.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    
    const uEliminar = previa.rows[0];
    const rolNorm = uEliminar.rol.toLowerCase();

    if (rolNorm === 'administrador de liga' && uEliminar.organizacion_id) {
      const countAdmin = await db.query(`SELECT COUNT(*) FROM public.usuarios WHERE organizacion_id = $1 AND LOWER(rol) = 'administrador de liga'`, [uEliminar.organizacion_id]);
      if (parseInt(countAdmin.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'Acción bloqueada: Estás intentando eliminar al único Administrador de la Liga. Debes registrar uno nuevo en la organización antes de proceder.' });
      }
    }

    if (rolNorm === 'delegado de equipo') {
      const equipoDel = await db.query(`SELECT id, nombre FROM public.equipos WHERE delegado_id = $1`, [id]);
      if (equipoDel.rows.length > 0) {
        return res.status(400).json({ error: `Acción bloqueada: Este usuario es el único delegado asignado al equipo "${equipoDel.rows[0].nombre}". Debes asignarle un nuevo delegado a ese equipo antes de eliminar esta credencial.` });
      }
    }

    res.json({ permitida: true });
  } catch (error) { res.status(500).json({ error: 'Error interno al verificar usuario.' }); }
});

// ==========================================
// ELIMINAR USUARIO OPERATIVO (ÁRBITRO, ANOTADOR, DELEGADO)
// ==========================================
router.delete('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const orgId = await obtenerOrgId(req.usuario);

    // 1. Verificar que el usuario pertenezca a la liga del administrador
    const userQuery = await db.query(
      'SELECT * FROM public.usuarios WHERE id = $1 AND organizacion_id = $2',
      [id, orgId]
    );

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado o no pertenece a tu organización.' });
    }

    const usuarioAEliminar = userQuery.rows[0];

    // 2. Si es delegado, liberar el equipo para evitar conflictos de relación
    if (usuarioAEliminar.rol.toLowerCase() === 'delegado de equipo') {
      await db.query('UPDATE public.equipos SET delegado_id = NULL WHERE delegado_id = $1', [id]);
    }

    // 3. Eliminar obligatoriamente de Supabase Auth (Para que no pueda volver a iniciar sesión)
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (authError) {
      console.error('Error al eliminar de Supabase Auth:', authError);
      return res.status(400).json({ error: `No se pudo revocar el acceso en Supabase: ${authError.message}` });
    }

    // 4. Eliminar de la base de datos local
    await db.query('DELETE FROM public.usuarios WHERE id = $1', [id]);

    // 5. Registrar auditoría
    await registrarAuditoria(req.usuario.id, 'ELIMINAR_USUARIO', 'usuarios', usuarioAEliminar, null, req.ip);

    res.json({ mensaje: 'Usuario eliminado con éxito del sistema y de la autenticación.' });
  } catch (error) {
    console.error('Error crítico al eliminar usuario:', error);
    res.status(500).json({ error: 'Error interno al intentar eliminar el usuario.' });
  }
});

router.get('/bitacora', async (req, res) => {
  const { rol, usuario_id, busqueda } = req.query;
  try {
    let sql = `SELECT a.id, a.accion, a.tabla, a.valores_previos, a.nuevos_valores, a.ip, a.fecha, u.email as usuario_email, u.rol as usuario_rol, u.cedula as usuario_cedula FROM public.audit_logs a LEFT JOIN public.usuarios u ON a.usuario_id = u.id WHERE 1=1`;
    const params = [];
    if (rol) { params.push(rol); sql += ` AND LOWER(u.rol) = LOWER($${params.length})`; }
    if (usuario_id) { params.push(usuario_id); sql += ` AND a.usuario_id = $${params.length})`; }
    if (busqueda) { params.push(`%${busqueda.trim()}%`); sql += ` AND (u.email ILIKE $${params.length} OR u.cedula ILIKE $${params.length})`; }
    sql += ' ORDER BY a.fecha DESC LIMIT 150';

    const resultado = await db.query(sql, params);
    res.json(resultado.rows);
  } catch (error) { res.status(500).json({ error: 'Error al consultar auditoría.' }); }
});

// ==========================================
// RESPALDO GLOBAL DE LA BASE DE DATOS
// ==========================================
router.get('/respaldo-completo', async (req, res) => {
  try {
    const ligas = await db.query('SELECT * FROM public.organizaciones');
    
    // CORRECCIÓN: Eliminamos "creado_en" porque tu tabla de usuarios no posee esa columna.
    // Solo omitimos password_hash por seguridad.
    const usuarios = await db.query('SELECT id, organizacion_id, rol, email, nombre, apellido, cedula, debe_cambiar_password FROM public.usuarios');
    
    const equipos = await db.query('SELECT * FROM public.equipos');
    const torneos = await db.query('SELECT * FROM public.torneos');
    const partidos = await db.query('SELECT * FROM public.partidos');

    // Registramos en la bitácora que el Superadmin descargó la base de datos
    await registrarAuditoria(req.usuario.id, 'RESPALDO_GLOBAL', 'multiples_tablas', null, { formato: 'Descarga completa' }, req.ip);

    res.json({
      ligas: ligas.rows,
      usuarios: usuarios.rows,
      equipos: equipos.rows,
      torneos: torneos.rows,
      partidos: partidos.rows
    });
  } catch (error) {
    console.error('Error generando respaldo:', error);
    res.status(500).json({ error: 'Error interno generando el respaldo de la base de datos.' });
  }
});

module.exports = router;