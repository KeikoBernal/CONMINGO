const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const { verificarToken, autorizarRoles } = require('../middleware/authMiddleware');
const crypto = require('crypto'); // FIX seguridad: comparacion en tiempo constante del secret del respaldo

const supabaseAdmin = require('../config/supabaseAdmin'); // FIX #8: sin fallback silencioso a la anon key
// LOTE 6G: utilidad de correo saliente (SMTP) y tokens de verificacion
const { enviarBienvenidaConVerificacion, reenviarVerificacion, solicitarCambioCorreo, enviarRestablecerPassword } = require('../utilidades/correo');
const { notificarUsuarios } = require('../utilidades/notificacionesPush'); // LOTE 8D: avisos de activacion (bandeja interna + web push)
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // LOTE 6G
const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const capitalizarTexto = (texto) => {
  if (!texto) return '';
  return texto.trim().toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

const { registrarAuditoria } = require('../utilidades/auditoria');

// ==========================================
// LOTE O: RESPALDO PROGRAMADO (lo llama el GitHub Action .github/workflows/respaldo.yml)
// OJO: se declara ANTES del router.use(verificarToken...) de abajo a propósito:
// no hay usuario con sesión; se autentica con el header x-backup-secret,
// que debe coincidir con la variable de entorno BACKUP_SECRET del backend.
// ==========================================
// FIX (revision de seguridad): el secret del respaldo se compara en tiempo constante.
// Se comparan los sha256 de ambos valores para que la longitud del secret no
// filtre informacion por el tiempo de ejecucion de la comparacion.
const secretRespaldosValido = (recibido) => {
  const esperado = process.env.BACKUP_SECRET;
  if (!esperado || !recibido || typeof recibido !== 'string') return false;
  const hashRecibido = crypto.createHash('sha256').update(recibido, 'utf8').digest();
  const hashEsperado = crypto.createHash('sha256').update(esperado, 'utf8').digest();
  return crypto.timingSafeEqual(hashRecibido, hashEsperado);
};

router.post('/respaldo-programado', async (req, res) => {
  try {
    // FIX (revision de seguridad): el secret solo se acepta en el header
    // x-backup-secret (nunca en el body) y la comparacion es de tiempo constante.
    const secret = req.get('x-backup-secret') || null;
    if (!secretRespaldosValido(secret)) {
      console.warn('Intento de respaldo programado rechazado: secret inválido.');
      return res.status(401).json({ error: 'No autorizado: secret de respaldo inválido.' });
    }
    // FIX (revision de seguridad): aviso accionable si el secret es corto. No
    // bloquea el respaldo, pero debe ser aleatorio y de al menos 32 caracteres.
    if ((process.env.BACKUP_SECRET || '').length < 32) {
      console.warn('BACKUP_SECRET es corto: genera uno aleatorio de al menos 32 caracteres (ej. openssl rand -hex 32) y actualizalo en Render y en los secrets del repositorio.');
    }

    // Cada tabla se lee de forma independiente: si una falla, el respaldo se
    // genera igual con el resto y la tabla problemática queda como arreglo vacío.
    const leerTabla = (nombre, sql) => db.query(sql).catch((e) => {
      console.error('Respaldo programado: tabla omitida (' + nombre + '):', e.message);
      return { rows: [] };
    });

    const ligas = await db.query('SELECT * FROM public.organizaciones');
    const usuarios = await db.query('SELECT id, organizacion_id, rol, email, nombre, apellido, cedula, estado, debe_cambiar_password FROM public.usuarios');
    const equipos = await leerTabla('equipos', 'SELECT * FROM public.equipos');
    const sedes = await leerTabla('sedes', 'SELECT * FROM public.sedes');
    const torneos = await leerTabla('torneos', 'SELECT * FROM public.torneos');
    const partidos = await leerTabla('partidos', 'SELECT * FROM public.partidos');
    const jugadores = await leerTabla('jugadores', 'SELECT * FROM public.jugadores');
    const incidencias = await leerTabla('incidencias_partido', 'SELECT * FROM public.incidencias_partido');
    const auditoria = await leerTabla('audit_logs', 'SELECT * FROM public.audit_logs ORDER BY created_at DESC LIMIT 5000');

    // Sin usuario con sesión: la bitácora lo registra como acción del sistema
    // (usuario_id NULL). El CASE de GET /bitacora ya lo describe como
    // "Se ejecutó un respaldo programado del sistema."
    await registrarAuditoria(null, 'RESPALDO_PROGRAMADO', 'multiples_tablas', null, { formato: 'JSON programado', origen: 'GitHub Actions' }, req.ip, null);

    res.json({
      generado_en: new Date().toISOString(),
      ligas: ligas.rows,
      usuarios: usuarios.rows,
      equipos: equipos.rows,
      sedes: sedes.rows,
      torneos: torneos.rows,
      partidos: partidos.rows,
      jugadores: jugadores.rows,
      incidencias: incidencias.rows,
      auditoria: auditoria.rows
    });
  } catch (error) {
    console.error('Error generando respaldo programado:', error);
    res.status(500).json({ error: 'Error interno generando el respaldo programado.' });
  }
});

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
    // LOTE 8B: las ligas eliminadas (baja logica) salen de las metricas: sus
    // usuarios, equipos y jugadores tampoco cuentan mientras este eliminada
    // (todo se restaura junto a la liga).
    const totalLigas = await db.query('SELECT COUNT(*) FROM public.organizaciones WHERE eliminado_en IS NULL');
    const ligasActivas = await db.query('SELECT COUNT(*) FROM public.organizaciones WHERE estado_activa = true AND eliminado_en IS NULL');
    const totalUsuarios = await db.query(`SELECT COUNT(*) FROM public.usuarios u LEFT JOIN public.organizaciones o ON u.organizacion_id = o.id WHERE u.organizacion_id IS NULL OR o.eliminado_en IS NULL`);
    const totalEquipos = await db.query('SELECT COUNT(*) FROM public.equipos e JOIN public.organizaciones o ON e.organizacion_id = o.id WHERE o.eliminado_en IS NULL');
    const totalJugadores = await db.query('SELECT COUNT(*) FROM public.jugadores j JOIN public.equipos e ON j.equipo_id = e.id JOIN public.organizaciones o ON e.organizacion_id = o.id WHERE o.eliminado_en IS NULL');
    const usuariosPorRol = await db.query(`SELECT u.rol, COUNT(*) as cantidad FROM public.usuarios u LEFT JOIN public.organizaciones o ON u.organizacion_id = o.id WHERE u.organizacion_id IS NULL OR o.eliminado_en IS NULL GROUP BY u.rol`);

    const partidosActivos = await db.query(`
      SELECT p.id, p.fecha_hora, p.estado, o.nombre as liga_nombre, t.organizacion_id 
      FROM public.partidos p 
      LEFT JOIN public.torneos t ON p.torneo_id = t.id 
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id 
      WHERE (o.eliminado_en IS NULL) AND LOWER(TRIM(p.estado)) IN ('en_curso', 'activo', 'en vivo', 'en curso') 
      ORDER BY p.fecha_hora DESC
    `).catch((e) => { console.error('Error en partidosActivos:', e); return { rows: [] }; });

    const partidosAgendados = await db.query(`
      SELECT p.id, p.fecha_hora, p.estado, o.nombre as liga_nombre, t.organizacion_id 
      FROM public.partidos p 
      LEFT JOIN public.torneos t ON p.torneo_id = t.id 
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id 
      WHERE (o.eliminado_en IS NULL) AND (p.estado IS NULL OR LOWER(TRIM(p.estado)) IN ('agendado', 'pendiente'))
      ORDER BY p.fecha_hora ASC
    `).catch((e) => { console.error('Error en partidosAgendados:', e); return { rows: [] }; });

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
    // LOTE 8B: las ligas eliminadas (baja logica) salen del directorio; se
    // gestionan y restauran desde GET /ligas/eliminadas.
    const resultado = await db.query(`SELECT id, nombre, estado_activa, logo_url, responsable_nombre, responsable_telefono, responsable_email, created_at AS creado_en FROM public.organizaciones WHERE eliminado_en IS NULL ORDER BY created_at DESC`);
    res.json(resultado.rows);
  } catch (error) { res.status(500).json({ error: 'Error al consultar ligas.' }); }
});

// LOTE 8B: directorio de ligas eliminadas (baja logica), para restaurarlas.
router.get('/ligas/eliminadas', async (req, res) => {
  try {
    const resultado = await db.query(`SELECT id, nombre, estado_activa, logo_url, responsable_nombre, responsable_telefono, responsable_email, created_at AS creado_en, eliminado_en FROM public.organizaciones WHERE eliminado_en IS NOT NULL ORDER BY eliminado_en DESC`);
    res.json(resultado.rows);
  } catch (error) { res.status(500).json({ error: 'Error al consultar ligas eliminadas.' }); }
});

router.get('/ligas/:id/detalle', async (req, res) => {
  const { id } = req.params;
  try {
    const liga = await db.query('SELECT * FROM public.organizaciones WHERE id = $1', [id]);
    if (liga.rows.length === 0) return res.status(404).json({ error: 'Liga no encontrada.' });
    // LOTE 8B: el detalle de una liga eliminada no se expone; se consulta de
    // nuevo cuando se restaura.
    if (liga.rows[0].eliminado_en) return res.status(404).json({ error: 'Liga eliminada. Restaúrala para consultar su información.' });

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

    // LOTE 6G FIX: el trigger on_auth_user_created de auth.users ya inserto la fila
    // en usuarios (sin organizacion); el upsert la completa en vez de reventar.
    await db.query(`INSERT INTO public.usuarios (id, email, rol, nombre, apellido, cedula, organizacion_id, debe_cambiar_password) VALUES ($1, $2, 'Administrador de Liga', $3, $4, $5, $6, true) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, rol = 'Administrador de Liga', nombre = EXCLUDED.nombre, apellido = EXCLUDED.apellido, cedula = EXCLUDED.cedula, organizacion_id = COALESCE(public.usuarios.organizacion_id, EXCLUDED.organizacion_id), debe_cambiar_password = true`, [authUser.user.id, responsable_email.trim().toLowerCase(), respNombreCap, respApellidoCap, cedulaLimpia, organizacionId]);
    await registrarAuditoria(req.usuario.id, 'CREAR_LIGA_Y_ADMIN', 'organizaciones', null, { ...resDb.rows[0], adminId: authUser.user.id }, req.ip, resDb.rows[0].id);
    
    // LOTE 6G: bienvenida con clave temporal + enlace de verificacion
    const envioLiga = await enviarBienvenidaConVerificacion({
      usuarioId: authUser.user.id,
      para: responsable_email.trim().toLowerCase(),
      nombre: respNombreCap,
      usuario: responsable_email.trim().toLowerCase(),
      claveTemporal: passwordInicial
    });
    if (envioLiga.enviado) {
      res.status(201).json({ mensaje: `Liga creada con éxito. Se envió un correo con las credenciales y el enlace de verificación a ${responsable_email.trim().toLowerCase()}.`, liga: resDb.rows[0] });
    } else {
      // Modo degradado (SMTP sin configurar o fallo de envio): la cuenta queda
      // activa sin verificacion y la clave se entrega a mano, como antes del lote 6g.
      await db.query('UPDATE public.usuarios SET correo_verificado = true, verificado_en = now() WHERE id = $1', [authUser.user.id]);
      res.status(201).json({ mensaje: `Liga creada con éxito. No se pudo enviar el correo (${envioLiga.motivo}). Entrega esta contraseña al Administrador de Liga: ${passwordInicial}`, liga: resDb.rows[0] });
    }
  } catch (error) { res.status(500).json({ error: 'Error general al crear liga.' }); }
});

router.put('/ligas/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, responsable_nombre, responsable_telefono, responsable_email, estado_activa } = req.body;
  try {
    const previa = await db.query('SELECT * FROM public.organizaciones WHERE id = $1', [id]);
    if (previa.rows.length === 0) return res.status(404).json({ error: 'Liga no encontrada.' }); // FIX (hallazgo #5): un id inexistente causaba TypeError y 500
    // LOTE 8B: una liga eliminada no se edita ni se reactiva desde aqui (asi
    // el toggle de estado_activa no puede desbanear a usuarios de una liga
    // eliminada); primero debe restaurarse.
    if (previa.rows[0].eliminado_en) return res.status(400).json({ error: 'Esta liga está eliminada. Restaúrala primero desde la sección de ligas eliminadas.' });
    const nombreLigaCap = capitalizarTexto(nombre);
    const respNombreCap = capitalizarTexto(responsable_nombre);

    const resDb = await db.query(`UPDATE public.organizaciones SET nombre = $1, responsable_nombre = $2, responsable_telefono = $3, responsable_email = $4, estado_activa = $5 WHERE id = $6 RETURNING *`, [nombreLigaCap, respNombreCap, responsable_telefono, responsable_email.trim().toLowerCase(), estado_activa, id]);
    
    if (estado_activa !== previa.rows[0].estado_activa) {
      const banStatus = estado_activa ? 'none' : '876000h'; 
      const usuariosLiga = await db.query('SELECT id FROM public.usuarios WHERE organizacion_id = $1', [id]);
      for (const u of usuariosLiga.rows) { await supabaseAdmin.auth.admin.updateUserById(u.id, { ban_duration: banStatus }); }
    }
    await registrarAuditoria(req.usuario.id, 'EDITAR_LIGA', 'organizaciones', previa.rows[0], resDb.rows[0], req.ip, previa.rows[0].id);
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
    if (previa.rows.length === 0) return res.status(404).json({ error: 'Liga no encontrada.' });

    // LOTE 8B: soft delete real — la fila nunca se borra y nada se pierde en
    // cascada. Se estampa eliminado_en (marca de eliminacion): la liga sale del
    // directorio, de las metricas y del sitio publico, y sus usuarios quedan
    // bloqueados en Supabase Auth. El login-proxy tambien rechaza a quienes
    // pertenezcan a una liga eliminada (doble puerta). Se restaura con
    // POST /ligas/:id/restaurar.
    if (previa.rows[0].eliminado_en) return res.status(400).json({ error: 'Esta liga ya está eliminada.' });
    const resDb = await db.query(`UPDATE public.organizaciones SET estado_activa = false, eliminado_en = now() WHERE id = $1 AND eliminado_en IS NULL RETURNING *`, [id]);
    if (resDb.rows.length === 0) return res.status(409).json({ error: 'La liga acaba de ser eliminada en otra sesión. Refresca el directorio.' });
    const usuariosLiga = await db.query('SELECT id FROM public.usuarios WHERE organizacion_id = $1', [id]);
    for (const u of usuariosLiga.rows) { await supabaseAdmin.auth.admin.updateUserById(u.id, { ban_duration: '876000h' }); }
    await registrarAuditoria(req.usuario.id, 'ELIMINAR_LIGA', 'organizaciones', previa.rows[0], resDb.rows[0], req.ip, previa.rows[0].id);
    res.json({ mensaje: 'Liga eliminada con éxito. Sus usuarios pierden acceso y sus datos históricos se preservan. Puedes restaurarla desde la sección de ligas eliminadas.' });
  } catch (error) { res.status(500).json({ error: 'Error al eliminar la liga.' }); }
});

// LOTE 8B: restaurar una liga eliminada (inverso del soft delete). Vuelve al
// directorio con estado activa y sus usuarios (los que no estaban desactivados
// por su cuenta) recuperan el acceso.
router.post('/ligas/:id/restaurar', async (req, res) => {
  const { id } = req.params;
  try {
    const previa = await db.query('SELECT * FROM public.organizaciones WHERE id = $1', [id]);
    if (previa.rows.length === 0) return res.status(404).json({ error: 'Liga no encontrada.' });
    if (!previa.rows[0].eliminado_en) return res.status(400).json({ error: 'Esta liga no está eliminada.' });

    const resDb = await db.query(`UPDATE public.organizaciones SET estado_activa = true, eliminado_en = NULL WHERE id = $1 RETURNING *`, [id]);
    // Solo se desbloquea a los usuarios activos: quien estaba desactivado de
    // forma individual (DESACTIVAR_USUARIO) sigue desactivado tras restaurar.
    const usuariosLiga = await db.query("SELECT id FROM public.usuarios WHERE organizacion_id = $1 AND estado IS DISTINCT FROM 'Inactivo'", [id]);
    for (const u of usuariosLiga.rows) { await supabaseAdmin.auth.admin.updateUserById(u.id, { ban_duration: 'none' }); }
    await registrarAuditoria(req.usuario.id, 'RESTAURAR_LIGA', 'organizaciones', previa.rows[0], resDb.rows[0], req.ip, previa.rows[0].id);
    res.json({ mensaje: 'Liga restaurada con éxito. Volvió al directorio con estado Activa y sus usuarios recuperan el acceso.' });
  } catch (error) { res.status(500).json({ error: 'Error al restaurar la liga.' }); }
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
    const resultado = await db.query(`SELECT u.id, u.email, u.rol, u.nombre, u.apellido, u.cedula, u.estado, u.debe_cambiar_password, u.correo_verificado, u.email_pendiente, u.organizacion_id, o.nombre as organizacion_nombre FROM public.usuarios u LEFT JOIN public.organizaciones o ON u.organizacion_id = o.id ORDER BY u.email ASC`);
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

    const resDb = await db.query(
      `INSERT INTO public.usuarios (id, email, rol, nombre, apellido, cedula, organizacion_id, debe_cambiar_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (id) DO UPDATE SET rol = $3, nombre = $4, apellido = $5, cedula = $6, organizacion_id = $7, debe_cambiar_password = true
       RETURNING *`,
      [authUser.user.id, email.trim().toLowerCase(), rol, nombreCap, apellidoCap, cedulaLimpia, organizacion_id || null]
    );

    if (organizacion_id) {
      await db.query(
        `INSERT INTO public.usuario_organizaciones (usuario_id, organizacion_id, rol) VALUES ($1, $2, $3)
         ON CONFLICT (usuario_id, organizacion_id) DO UPDATE SET rol = $3`,
        [authUser.user.id, organizacion_id, rol]
      );
    }
    
    if (rol.toLowerCase() === 'delegado de equipo' && equipo_id) {
      await db.query('UPDATE public.equipos SET delegado_id = $1 WHERE id = $2', [authUser.user.id, equipo_id]);
    }

    await registrarAuditoria(req.usuario.id, 'CREAR_USUARIO', 'usuarios', null, resDb.rows[0], req.ip, resDb.rows[0].organizacion_id || null);
    // LOTE 6G: bienvenida con clave temporal + enlace de verificacion
    const envioUsuario = await enviarBienvenidaConVerificacion({
      usuarioId: authUser.user.id,
      para: email.trim().toLowerCase(),
      nombre: nombreCap,
      usuario: email.trim().toLowerCase(),
      claveTemporal: passwordInicial
    });
    if (envioUsuario.enviado) {
      res.status(201).json({ mensaje: `Usuario creado. Se envió un correo con las credenciales y el enlace de verificación a ${email.trim().toLowerCase()}.`, usuario: resDb.rows[0] });
    } else {
      // Modo degradado: sin correo la cuenta queda activa sin verificacion
      await db.query('UPDATE public.usuarios SET correo_verificado = true, verificado_en = now() WHERE id = $1', [authUser.user.id]);
      res.status(201).json({ mensaje: `Usuario creado. No se pudo enviar el correo (${envioUsuario.motivo}). Contraseña inicial: ${passwordInicial}`, usuario: resDb.rows[0] });
    }
  } catch (error) {
    if (error && error.code === '23505') {
      return res.status(400).json({ error: 'Ya existe otro usuario con ese correo o cédula.' });
    }
    res.status(500).json({ error: 'Error al registrar usuario.' });
  }
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
    if (previa.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' }); // FIX (hallazgo #5, mismo patron): un id inexistente causaba TypeError y 500
    const resDb = await db.query(`UPDATE public.usuarios SET nombre = $1, apellido = $2, cedula = $3, rol = $4, organizacion_id = $5, debe_cambiar_password = $6 WHERE id = $7 RETURNING *`, [nombreCap, apellidoCap, cedulaLimpia, rol, organizacion_id || null, debe_cambiar_password ?? previa.rows[0].debe_cambiar_password, id]);
    await supabaseAdmin.auth.admin.updateUserById(id, { user_metadata: { rol, nombre: nombreCap, apellido: apellidoCap, cedula: cedulaLimpia, debe_cambiar_password } });
    await registrarAuditoria(req.usuario.id, 'EDITAR_USUARIO', 'usuarios', previa.rows[0], resDb.rows[0], req.ip, resDb.rows[0].organizacion_id || null);
    res.json({ mensaje: 'Usuario actualizado con éxito.', usuario: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al actualizar el usuario.' }); }
});

router.post('/usuarios/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  try {
    const userDb = await db.query('SELECT id, email, cedula, nombre, organizacion_id FROM public.usuarios WHERE id = $1', [id]);
    if (userDb.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const usuarioSup = userDb.rows[0];

    // LOTE 6H: se envia a la persona un enlace para que establezca su propia
    // clave (politica: 8+ caracteres con letras, numeros y caracter especial).
    // Mientras no lo use, su clave actual sigue funcionando.
    const envioReset = await enviarRestablecerPassword({ usuarioId: id, para: usuarioSup.email, nombre: usuarioSup.nombre });
    // LOTE 6J: pedido repetido dentro de la ventana anti-reenvio (2 minutos):
    // no sale otro correo, pero el enlace anterior sigue siendo valido.
    if (envioReset.enviado) {
      await registrarAuditoria(req.usuario.id, 'RESET_PASSWORD', 'usuarios', { id }, { reset_via: 'enlace_correo' }, req.ip, usuarioSup.organizacion_id || null);
      return res.json({ mensaje: `Se envió a ${usuarioSup.email} un enlace para establecer una nueva contraseña. Es válido por 24 horas y la clave actual sigue funcionando hasta entonces. El correo puede tardar unos minutos en llegar; revisa también el correo no deseado.` });
    }

    if (envioReset.motivo === 'reenvio_reciente') return res.json({ mensaje: envioReset.mensaje });

    // Modo degradado (SMTP caido): clave temporal de siempre, entregada a mano.
    const nuevaPassword = `${usuarioSup.nombre ? usuarioSup.nombre.trim().split(' ')[0] : 'User'}${String(usuarioSup.cedula || '').trim().substring(0, 5)}!`;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password: nuevaPassword, user_metadata: { debe_cambiar_password: true } });
    if (error) return res.status(400).json({ error: error.message });

    await db.query('UPDATE public.usuarios SET debe_cambiar_password = true WHERE id = $1', [id]);
    await registrarAuditoria(req.usuario.id, 'RESET_PASSWORD', 'usuarios', { id }, { password_reset: true, motivo_correo: envioReset.motivo }, req.ip, usuarioSup.organizacion_id || null);
    res.json({ mensaje: `No se pudo enviar el correo (${envioReset.motivo}${envioReset.error ? ' - ' + envioReset.error : ''}). Contraseña restablecida con clave temporal: ${nuevaPassword}` });
  } catch (error) { res.status(500).json({ error: 'Error al restablecer contraseña.' }); }
});

// ==========================================
// LOTE 6G: CAMBIO DE CORREO Y REENVIO DE VERIFICACION
// ==========================================
router.post('/usuarios/:id/cambiar-correo', async (req, res) => {
  const { id } = req.params;
  const nuevoEmail = String(req.body?.nuevo_email || '').trim().toLowerCase();
  if (!REGEX_EMAIL.test(nuevoEmail)) return res.status(400).json({ error: 'El nuevo correo tiene un formato inválido.' });
  try {
    const previa = await db.query('SELECT id, email, nombre, organizacion_id, email_pendiente FROM public.usuarios WHERE id = $1', [id]);
    if (previa.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const usuario = previa.rows[0];
    if (String(usuario.email).toLowerCase() === nuevoEmail) return res.status(400).json({ error: 'El nuevo correo es el mismo que el actual.' });

    const existe = await db.query('SELECT id FROM public.usuarios WHERE LOWER(email) = $1 AND id <> $2', [nuevoEmail, id]);
    if (existe.rows.length > 0) return res.status(400).json({ error: 'Ya existe otro usuario con ese correo.' });

    // LOTE 6H: solo la confirmacion al correo NUEVO es bloqueante. El aviso al
    // correo antiguo es best-effort: muchos correos legados no existen
    // (por ejemplo @liga.local) y no deben trabar el cambio para siempre.
    const resultado = await solicitarCambioCorreo({ usuarioId: id, nombre: usuario.nombre, paraAntiguo: usuario.email, paraNuevo: nuevoEmail });
    // LOTE 6J: pedido repetido dentro de la ventana anti-reenvio (2 minutos).
    if (resultado.motivoNuevo === 'reenvio_reciente') return res.json({ mensaje: resultado.mensajeNuevo });
    if (!resultado.enviadoNuevo) {
      const motivo = resultado.motivoNuevo || 'error_envio';
      const detalle = motivo === 'smtp_no_configurado'
        ? 'el servidor de correo no está configurado: faltan las variables SMTP_HOST, SMTP_USER y SMTP_PASS en Render'
        : 'el servidor de correo rechazó el envío: revisa el log de Render (linea [correo] No se pudo enviar) o SMTP_USER y SMTP_PASS (contraseña de aplicación de Gmail) en Render' + (resultado.errorNuevo ? ' [detalle tecnico: ' + resultado.errorNuevo + ']' : '');
      return res.status(503).json({ error: `No se pudo enviar el correo de confirmación (${detalle}). El correo del usuario no fue modificado.` });
    }
    await db.query('UPDATE public.usuarios SET email_pendiente = $1 WHERE id = $2', [nuevoEmail, id]);
    await registrarAuditoria(req.usuario.id, 'SOLICITAR_CAMBIO_CORREO', 'usuarios', { email: usuario.email, email_pendiente: usuario.email_pendiente || null }, { email_pendiente: nuevoEmail, aviso_antiguo_enviado: resultado.enviadoAntiguo }, req.ip, usuario.organizacion_id || null);
    res.json({ mensaje: resultado.enviadoAntiguo
      ? `Se envió la confirmación a ${nuevoEmail} y un aviso a ${usuario.email}. El cambio se aplicará cuando el nuevo correo lo confirme.`
      : `Se envió la confirmación a ${nuevoEmail}. No se pudo avisar al correo anterior (${usuario.email}), pero el cambio se aplicará cuando el nuevo correo lo confirme.` });
  } catch (error) {
    console.error('Error solicitando cambio de correo:', error);
    res.status(500).json({ error: 'Error al solicitar el cambio de correo.' });
  }
});

router.post('/usuarios/:id/reenviar-verificacion', async (req, res) => {
  const { id } = req.params;
  try {
    const userDb = await db.query('SELECT id, email, nombre, correo_verificado, email_pendiente, organizacion_id FROM public.usuarios WHERE id = $1', [id]);
    if (userDb.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const usuario = userDb.rows[0];

    if (usuario.email_pendiente) {
      // Hay un cambio de correo pendiente: reenvia la confirmacion al correo nuevo
      const resultado = await solicitarCambioCorreo({ usuarioId: id, nombre: usuario.nombre, paraAntiguo: usuario.email, paraNuevo: usuario.email_pendiente });
      // LOTE 6J: pedido repetido dentro de la ventana anti-reenvio (2 minutos).
      if (resultado.motivoNuevo === 'reenvio_reciente') return res.json({ mensaje: resultado.mensajeNuevo });
      if (!resultado.enviadoNuevo) {
        const motivo = resultado.motivoNuevo || 'error_envio';
        const detalle = motivo === 'smtp_no_configurado'
          ? 'el servidor de correo no está configurado: faltan las variables SMTP en Render'
          : 'el servidor de correo rechazó el envío: revisa SMTP_USER y SMTP_PASS en Render' + (resultado.errorNuevo ? ' [detalle tecnico: ' + resultado.errorNuevo + ']' : '');
        return res.status(503).json({ error: `No se pudo reenviar el correo de confirmación (${detalle}).` });
      }
      await registrarAuditoria(req.usuario.id, 'REENVIAR_CAMBIO_CORREO', 'usuarios', null, { email_pendiente: usuario.email_pendiente, aviso_antiguo_enviado: resultado.enviadoAntiguo }, req.ip, usuario.organizacion_id || null);
      const mensajeReenvio = resultado.enviadoAntiguo
        ? `Se reenvió la confirmación a ${usuario.email_pendiente}.`
        : `Se reenvió la confirmación a ${usuario.email_pendiente}. No se pudo avisar al correo anterior (${usuario.email}).`;
      return res.json({ mensaje: mensajeReenvio });
    }

    if (usuario.correo_verificado) {
      return res.status(400).json({ error: 'El correo de este usuario ya está verificado.' });
    }

    const envio = await reenviarVerificacion({ usuarioId: id, para: usuario.email, nombre: usuario.nombre });
    // LOTE 6J: pedido repetido dentro de la ventana anti-reenvio (2 minutos).
    if (envio.motivo === 'reenvio_reciente') return res.json({ mensaje: envio.mensaje });
    if (!envio.enviado) {
      const detalle = envio.motivo === 'smtp_no_configurado'
        ? 'el servidor de correo no está configurado: faltan las variables SMTP en Render'
        : 'el servidor de correo rechazó el envío: revisa SMTP_USER y SMTP_PASS en Render' + (envio.error ? ' [detalle tecnico: ' + envio.error + ']' : '');
      return res.status(503).json({ error: `No se pudo enviar el correo de verificación (${detalle}).` });
    }
    await registrarAuditoria(req.usuario.id, 'REENVIAR_VERIFICACION', 'usuarios', null, { email: usuario.email }, req.ip, usuario.organizacion_id || null);
    res.json({ mensaje: `Se reenvió el enlace de verificación a ${usuario.email}.` });
  } catch (error) {
    console.error('Error reenviando verificación:', error);
    res.status(500).json({ error: 'Error al reenviar la verificación.' });
  }
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
// DESACTIVAR USUARIO (SOFT DELETE)
// ==========================================
router.delete('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.usuario.id) {
    return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
  }
  try {
    // 1. Verificar que el usuario exista (el Superadmin gestiona todas las ligas)
    const userQuery = await db.query(
      'SELECT * FROM public.usuarios WHERE id = $1',
      [id]
    );

    if (userQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const usuarioAEliminar = userQuery.rows[0];

    // 2. Si es delegado, liberar el equipo para evitar conflictos de relación
    if (usuarioAEliminar.rol.toLowerCase() === 'delegado de equipo') {
      await db.query('UPDATE public.equipos SET delegado_id = NULL WHERE delegado_id = $1', [id]);
    }

    // 3. Inactivar y bloquear obligatoriamente de Supabase Auth (Pierde validez)
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
    if (authError) {
      console.error('Error al bloquear en Supabase Auth:', authError);
      return res.status(400).json({ error: `No se pudo revocar el acceso en Supabase: ${authError.message}` });
    }

    // 4. Soft Delete en la base de datos local (NO SE ELIMINA)
    await db.query("UPDATE public.usuarios SET estado = 'Inactivo' WHERE id = $1", [id]);

    // 5. Registrar auditoría
    await registrarAuditoria(req.usuario.id, 'DESACTIVAR_USUARIO', 'usuarios', usuarioAEliminar, { estado: 'Inactivo' }, req.ip, usuarioAEliminar.organizacion_id || null);

    res.json({ mensaje: 'Usuario desactivado con éxito. Sus credenciales han perdido validez.' });
  } catch (error) {
    console.error('Error crítico al desactivar usuario:', error);
    res.status(500).json({ error: 'Error interno al intentar desactivar el usuario.' });
  }
});

// ==========================================
// LOTE N: REACTIVAR USUARIO (inverso del soft delete)
// ==========================================
router.post('/usuarios/:id/reactivar', async (req, res) => {
  const { id } = req.params;
  try {
    const userQuery = await db.query('SELECT * FROM public.usuarios WHERE id = $1', [id]);
    if (userQuery.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const usuarioAReactivar = userQuery.rows[0];
    if (usuarioAReactivar.estado !== 'Inactivo') {
      return res.status(400).json({ error: 'El usuario ya se encuentra activo.' });
    }
    // LOTE 8B: si la liga principal del usuario esta eliminada, no se reactiva
    // el acceso suelto (su ban fue por eliminacion de la liga); primero debe
    // restaurarse la liga.
    if (usuarioAReactivar.organizacion_id) {
      const ligaUsuario = await db.query('SELECT eliminado_en FROM public.organizaciones WHERE id = $1', [usuarioAReactivar.organizacion_id]);
      if (ligaUsuario.rows.length > 0 && ligaUsuario.rows[0].eliminado_en) {
        return res.status(400).json({ error: 'La liga de este usuario está eliminada. Restaura la liga primero (sección de ligas eliminadas).' });
      }
    }

    // 1. Desbloquear en Supabase Auth (levantar el ban aplicado al desactivar)
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: 'none' });
    if (authError) {
      console.error('Error al desbloquear en Supabase Auth:', authError);
      return res.status(400).json({ error: 'No se pudo restaurar el acceso en Supabase: ' + authError.message });
    }

    // 2. Reactivar en la base de datos
    await db.query("UPDATE public.usuarios SET estado = 'Activo' WHERE id = $1", [id]);

    // 3. Registrar auditoría
    await registrarAuditoria(req.usuario.id, 'REACTIVAR_USUARIO', 'usuarios', usuarioAReactivar, { estado: 'Activo' }, req.ip, usuarioAReactivar.organizacion_id || null);

    // LOTE 8D: cierre del ciclo de la solicitud. Se marcan como leidas las
    // notificaciones pendientes de 'Solicitud de Activación' de este usuario
    // y se avisa de vuelta a los AdminLigas de su organizacion y al propio
    // usuario reactivado (bandeja interna + web push).
    await db.query(`UPDATE public.notificaciones SET hora_lectura = now() WHERE titulo = 'Solicitud de Activación' AND mensaje LIKE '%' || $1 || '%' AND hora_lectura IS NULL`, [id]);
    try {
      const avisados = await db.query(`SELECT id FROM public.usuarios WHERE id = $1 OR (organizacion_id = $2 AND LOWER(rol) = 'administrador de liga' AND (estado IS NULL OR estado <> 'Inactivo'))`, [id, usuarioAReactivar.organizacion_id]);
      if (avisados.rows.length > 0) {
        const mensajeReactivado = 'Se reactivó el acceso de ' + usuarioAReactivar.nombre + ' ' + usuarioAReactivar.apellido + ' (' + usuarioAReactivar.email + '). Sus credenciales vuelven a ser válidas.';
        await notificarUsuarios({ organizacionId: usuarioAReactivar.organizacion_id || null, remitenteId: req.usuario.id, destinatarios: avisados.rows.map(r => r.id), titulo: 'Usuario Reactivado', mensaje: mensajeReactivado });
      }
    } catch (eNotif) {
      console.error('LOTE 8D: no se pudo notificar la reactivación:', eNotif?.message || eNotif);
    }

    res.json({ mensaje: 'Usuario reactivado con éxito. Sus credenciales vuelven a ser válidas.' });
  } catch (error) {
    console.error('Error crítico al reactivar usuario:', error);
    res.status(500).json({ error: 'Error interno al intentar reactivar el usuario.' });
  }
});

// ==========================================
// LOTE 8D: RECHAZAR SOLICITUD DE ACTIVACION
// Inverso administrativo de reactivar: el usuario sigue Inactivo y el
// AdminLiga que pidio la activacion recibe el aviso de vuelta.
// ==========================================
router.post('/usuarios/:id/rechazar-activacion', async (req, res) => {
  const { id } = req.params;
  try {
    const userQuery = await db.query('SELECT id, nombre, apellido, email, estado, organizacion_id FROM public.usuarios WHERE id = $1', [id]);
    if (userQuery.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const usuario = userQuery.rows[0];
    if (usuario.estado !== 'Inactivo') return res.status(400).json({ error: 'El usuario ya se encuentra activo; no hay solicitud que rechazar.' });

    // Cierre de las notificaciones pendientes de este usuario (LOTE 8D)
    // y aviso de vuelta a los AdminLigas de su organizacion.
    await db.query(`UPDATE public.notificaciones SET hora_lectura = now() WHERE titulo = 'Solicitud de Activación' AND mensaje LIKE '%' || $1 || '%' AND hora_lectura IS NULL`, [id]);
    const adminLigas = await db.query(`SELECT id FROM public.usuarios WHERE organizacion_id = $1 AND LOWER(rol) = 'administrador de liga' AND (estado IS NULL OR estado <> 'Inactivo')`, [usuario.organizacion_id]);
    if (adminLigas.rows.length > 0) {
      const mensajeRechazo = 'El superadmin rechazó reactivar el acceso de ' + usuario.nombre + ' ' + usuario.apellido + ' (' + usuario.email + '). El usuario sigue desactivado.';
      await notificarUsuarios({ organizacionId: usuario.organizacion_id || null, remitenteId: req.usuario.id, destinatarios: adminLigas.rows.map(r => r.id), titulo: 'Solicitud Rechazada', mensaje: mensajeRechazo });
    }

    await registrarAuditoria(req.usuario.id, 'RECHAZAR_ACTIVACION', 'usuarios', { id }, { estado: 'Inactivo' }, req.ip, usuario.organizacion_id || null);
    res.json({ mensaje: 'Solicitud rechazada. El administrador de la liga recibirá el aviso en sus notificaciones.' });
  } catch (error) {
    console.error('Error al rechazar solicitud de activación:', error);
    res.status(500).json({ error: 'Error interno al rechazar la solicitud.' });
  }
});

router.get('/bitacora', async (req, res) => {
  const { rol, usuario_id, organizacion_id, accion, busqueda, fecha_desde, fecha_hasta } = req.query;
  try {
    let sql = `SELECT a.id, a.accion,
      CASE
        WHEN a.accion = 'CREAR_LIGA_Y_ADMIN' THEN 'Creó una liga nueva junto a su administrador.'
        WHEN a.accion = 'EDITAR_LIGA' THEN 'Actualizó los datos de una liga.'
        WHEN a.accion = 'DESACTIVAR_LIGA' THEN 'Desactivó una liga (sus usuarios pierden acceso).'
        WHEN a.accion = 'ELIMINAR_LIGA' THEN 'Eliminó una liga (baja lógica; sus usuarios pierden acceso).'
        WHEN a.accion = 'RESTAURAR_LIGA' THEN 'Restauró una liga eliminada (vuelve con estado Activa).'
        WHEN a.accion = 'CREAR_USUARIO' THEN 'Creó un usuario nuevo.'
        WHEN a.accion = 'EDITAR_USUARIO' THEN 'Actualizó un usuario.'
        WHEN a.accion = 'RESET_PASSWORD' THEN 'Restableció la contraseña de un usuario.'
        WHEN a.accion = 'DESACTIVAR_USUARIO' THEN 'Desactivó un usuario (baja lógica).'
        WHEN a.accion = 'REACTIVAR_USUARIO' THEN 'Reactivó un usuario.'
        WHEN a.accion = 'SOLICITAR_ACTIVACION' THEN 'Un administrador de liga solicitó reactivar a un usuario desactivado.'
        WHEN a.accion = 'RECHAZAR_ACTIVACION' THEN 'Rechazó una solicitud de reactivación de usuario.'
        WHEN a.accion = 'RESPALDO_GLOBAL' THEN 'Descargó un respaldo completo de la base de datos.'
        WHEN a.accion = 'RESPALDO_PROGRAMADO' THEN 'Se ejecutó un respaldo programado del sistema.'
        WHEN a.accion = 'INICIAR_PARTIDO' THEN 'Inició un partido.'
        WHEN a.accion = 'FINALIZAR_PARTIDO' THEN 'Finalizó un partido.'
        WHEN a.accion = 'SUSPENDER_PARTIDO' THEN 'Suspendió un partido.'
        WHEN a.accion = 'SORTEO_PARTIDO' THEN 'Registró el sorteo de un partido.'
        WHEN a.accion = 'EMITIR_SANCION' THEN 'Emitió una sanción (tarjeta) a un jugador.'
        WHEN a.accion = 'REGISTRAR_INCIDENCIA' THEN 'Registró una incidencia de partido.'
        WHEN a.accion = 'CAMBIAR_PASSWORD_PROPIO' THEN 'Cambió su propia contraseña.'
        WHEN a.accion = 'CORREO_VERIFICADO' THEN 'Verificó su correo y activó su cuenta.'
        WHEN a.accion = 'REENVIAR_VERIFICACION' THEN 'Reenvió el enlace de verificación de un usuario.'
        WHEN a.accion = 'SOLICITAR_CAMBIO_CORREO' THEN 'Solicitó el cambio de correo de un usuario.'
        WHEN a.accion = 'REENVIAR_CAMBIO_CORREO' THEN 'Reenvió la confirmación del cambio de correo de un usuario.'
        WHEN a.accion = 'CORREO_CAMBIADO' THEN 'Confirmación recibida: cambió el correo de una cuenta.'
        WHEN a.accion = 'LOGIN_BLOQUEADO_NO_VERIFICADO' THEN 'Intento de acceso con un correo sin verificar.'
        WHEN a.accion = 'CREAR_TORNEO_FLASH' THEN 'Creó un torneo flash (asistentes, sorteo de equipos y calendario todos contra todos).'
        WHEN a.accion LIKE 'GET /%' THEN 'Consultó información del sistema.'
        ELSE REPLACE(a.accion, '_', ' ')
      END AS accion_descripcion,
      a.tabla, a.valores_previos, a.nuevos_valores, a.ip, a.created_at AS fecha,
      u.email as usuario_email, u.nombre as usuario_nombre, u.apellido as usuario_apellido, u.rol as usuario_rol, u.cedula as usuario_cedula,
      o.nombre as organizacion_nombre
      FROM public.audit_logs a
      LEFT JOIN public.usuarios u ON a.usuario_id = u.id
      LEFT JOIN public.organizaciones o ON a.organizacion_id = o.id
      WHERE 1=1`;
    const params = [];
    if (rol) { params.push(rol); sql += ` AND LOWER(u.rol) = LOWER($${params.length})`; }
    if (usuario_id) { params.push(usuario_id); sql += ` AND a.usuario_id = $${params.length}`; }
    if (organizacion_id) { params.push(organizacion_id); sql += ` AND (a.organizacion_id = $${params.length} OR u.organizacion_id = $${params.length})`; }
    if (accion) { params.push(accion); sql += ` AND a.accion = $${params.length}`; }
    if (busqueda) { params.push(`%${busqueda.trim()}%`); sql += ` AND (a.accion ILIKE $${params.length} OR a.tabla ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.cedula ILIKE $${params.length} OR o.nombre ILIKE $${params.length})`; }
    if (fecha_desde) { params.push(fecha_desde); sql += ` AND a.created_at >= $${params.length}::date`; }
    if (fecha_hasta) { params.push(fecha_hasta); sql += ` AND a.created_at < ($${params.length}::date + INTERVAL '1 day')`; }
    sql += ' ORDER BY a.created_at DESC LIMIT 500';

    const resultado = await db.query(sql, params);
    res.json(resultado.rows);
  } catch (error) { console.error('Error al consultar bitácora global:', error); res.status(500).json({ error: 'Error al consultar auditoría.' }); }
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


/**
 * ========================================================
 * LOTE 3B+: DOCUMENTOS GLOBALES COMPARTIDOS CON TODAS LAS LIGAS
 * Bucket privado "documentos", carpeta reservada __global:
 * __global/{uuid}.{ext}  ->  organizacion_id NULL en la tabla.
 * ========================================================
 */
const TIPOS_DOCUMENTO_GLOBAL = ['Reglamento', 'Convocatoria', 'Acta', 'Inscripcion', 'Comunicado', 'Otro'];

const construirUrlFirmadaDocGlobal = async (archivoPath) => {
  try {
    const { data, error } = await supabaseAdmin.storage.from('documentos').createSignedUrl(archivoPath, 3600);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (error) {
    console.error('[documentos] No se pudo firmar la URL de descarga:', { archivoPath, error: error?.message || error });
    return null;
  }
};

router.get('/documentos', async (req, res) => {
  try {
    const resultado = await db.query(`
      SELECT d.id, d.titulo, d.tipo, d.archivo_path, d.tamano_bytes, d.mime_type,
             TO_CHAR(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS creado_en,
             TRIM(COALESCE(u.nombre || ' ' || u.apellido, u.email, '')) AS subido_por_nombre
      FROM public.documentos d
      LEFT JOIN public.usuarios u ON d.subido_por = u.id
      WHERE d.organizacion_id IS NULL
      ORDER BY d.created_at DESC
    `);
    const documentos = await Promise.all(resultado.rows.map(async (doc) => {
      const url = await construirUrlFirmadaDocGlobal(doc.archivo_path);
      delete doc.archivo_path;
      return { ...doc, url_firmada: url };
    }));
    res.json({ documentos });
  } catch (error) {
    console.error('Error al listar documentos globales:', error);
    res.status(500).json({ error: 'Error al obtener los documentos globales.' });
  }
});

router.post('/documentos', async (req, res) => {
  const { titulo, tipo, archivo_path, tamano_bytes, mime_type } = req.body;
  try {
    const tituloLimpio = String(titulo || '').trim();
    if (!tituloLimpio) return res.status(400).json({ error: 'El titulo del documento es obligatorio.' });
    if (tituloLimpio.length > 200) return res.status(400).json({ error: 'El titulo no puede superar los 200 caracteres.' });
    const tipoDoc = TIPOS_DOCUMENTO_GLOBAL.includes(tipo) ? tipo : 'Otro';
    if (!archivo_path || typeof archivo_path !== 'string') return res.status(400).json({ error: 'Falta la ruta del archivo subido.' });
    const ruta = archivo_path.trim();
    if (!ruta.startsWith('__global/')) {
      return res.status(403).json({ error: 'El archivo no pertenece a la carpeta global de documentos.' });
    }
    const tamano = parseInt(tamano_bytes, 10);
    if (!tamano || tamano <= 0) return res.status(400).json({ error: 'Tamano de archivo invalido.' });
    if (tamano > 10 * 1024 * 1024) return res.status(400).json({ error: 'El archivo supera los 10MB permitidos.' });
    const resDb = await db.query(
      `INSERT INTO public.documentos (organizacion_id, subido_por, titulo, tipo, torneo_id, archivo_path, tamano_bytes, mime_type)
       VALUES (NULL, $1, $2, $3, NULL, $4, $5, $6) RETURNING *`,
      [req.usuario.id, tituloLimpio, tipoDoc, ruta, tamano, mime_type || null]
    );
    await registrarAuditoria(req.usuario.id, 'CREAR_DOCUMENTO_GLOBAL', 'documentos', null, resDb.rows[0], req.ip, null);
    res.status(201).json({ mensaje: 'Documento global registrado con exito.', documento: resDb.rows[0] });
  } catch (error) {
    console.error('Error al registrar documento global:', error);
    res.status(500).json({ error: 'Error registrando el documento global.' });
  }
});

router.delete('/documentos/:id', async (req, res) => {
  try {
    const chk = await db.query('SELECT * FROM public.documentos WHERE id = $1::uuid AND organizacion_id IS NULL', [req.params.id]);
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Documento global no encontrado.' });
    const doc = chk.rows[0];
    try {
      const { error: errorStorage } = await supabaseAdmin.storage.from('documentos').remove([doc.archivo_path]);
      if (errorStorage) console.error('[documentos] No se pudo borrar el objeto de Storage:', errorStorage?.message || errorStorage);
    } catch (errorStorage) {
      console.error('[documentos] No se pudo borrar el objeto de Storage:', errorStorage?.message || errorStorage);
    }
    await db.query('DELETE FROM public.documentos WHERE id = $1::uuid', [doc.id]);
    await registrarAuditoria(req.usuario.id, 'ELIMINAR_DOCUMENTO_GLOBAL', 'documentos', doc, null, req.ip, null);
    res.json({ mensaje: 'Documento global eliminado con exito.' });
  } catch (error) {
    console.error('Error al eliminar documento global:', error);
    res.status(500).json({ error: 'Error al eliminar el documento global.' });
  }
});

module.exports = router;