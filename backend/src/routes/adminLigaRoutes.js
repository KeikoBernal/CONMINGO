const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs'); // FIX #18: unificado a bcryptjs (misma API, sin compilación nativa) // IMPORTACIÓN AÑADIDA PARA VALIDACIÓN DE ADMIN
const { createClient } = require('@supabase/supabase-js');
const { verificarToken, autorizarRoles } = require('../middleware/authMiddleware');

const supabaseAdmin = require('../config/supabaseAdmin'); // FIX #8: sin fallback silencioso a la anon key

const registrarAuditoria = async (usuarioId, accion, tabla, valoresPrevios = null, nuevosValores = null, ip = null, organizacionId = null) => {
  try {
    await db.query(
      `INSERT INTO public.audit_logs (usuario_id, accion, tabla, valores_previos, nuevos_valores, ip, organizacion_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuarioId, accion, tabla, valoresPrevios ? JSON.stringify(valoresPrevios) : null, nuevosValores ? JSON.stringify(nuevosValores) : null, ip, organizacionId]
    );
  } catch (error) {
    // FIX #15: la auditoría no debe fallar en silencio; se registra el error con contexto.
    console.error('[auditoría] No se pudo registrar en la bitácora:', { usuarioId, accion, tabla, error: error?.message || error });
  }
};

const formatearTexto = (texto) => {
  if (!texto) return '';
  return texto.trim().toLowerCase().split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
};

const obtenerOrgId = async (usuario) => {
  if (usuario.organizacion_id) return usuario.organizacion_id;
  const res = await db.query('SELECT organizacion_id FROM public.usuarios WHERE id = $1', [usuario.id]);
  return res.rows[0]?.organizacion_id || null;
};

const obtenerHoraCaracas = () => {
  // FIX #1: se reemplazó la interpolación rota por Intl.DateTimeFormat con zona horaria explícita.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const partes = Object.fromEntries(
    formatter.formatToParts(new Date()).map(p => [p.type, p.value])
  );
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
};

// Devuelve la fecha/hora guardada (hora de Venezuela, sin zona horaria) formateada tal cual,
// sin pasar por new Date(): eso provoca conversión UTC -> Caracas que desplaza la hora 4 horas.
const formatearFechaLocal = (fechaStr) => {
  if (!fechaStr) return 'fecha por confirmar';
  const m = String(fechaStr).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return String(fechaStr);
  let hh = parseInt(m[4], 10);
  const sufijo = hh >= 12 ? 'pm' : 'am';
  hh = hh % 12 || 12;
  return `${m[3]}/${m[2]}/${m[1]}, ${hh}:${m[5]} ${sufijo}`;
};

const validarConflictos = async (fecha_hora, eqLocal, eqVisita, arbitro, anotador, partidoIgnorado = null) => {
  // Buscamos jugadores de los equipos local y visitante para verificar que no jueguen en paralelo
  const obtenerJugadores = async (eId) => {
    if (!eId) return [];
    const r = await db.query('SELECT id FROM public.jugadores WHERE equipo_id = $1 AND estado = $2', [eId, 'Activo']);
    return r.rows.map(x => x.id);
  };

  const jugLocal = await obtenerJugadores(eqLocal);
  const jugVisita = await obtenerJugadores(eqVisita);
  const todosJugadores = [...jugLocal, ...jugVisita];

  const query = `
    SELECT p.id FROM public.partidos p
    LEFT JOIN public.jugadores j_loc ON p.equipo_local_id = j_loc.equipo_id
    LEFT JOIN public.jugadores j_vis ON p.equipo_visita_id = j_vis.equipo_id
    WHERE p.estado IN ('Agendado', 'En Curso')
    AND p.id::text != $1
    AND ABS(EXTRACT(EPOCH FROM (p.fecha_hora::timestamp - $2::timestamp))) < 7200
    AND (
      p.equipo_local_id::text = $3 OR p.equipo_visita_id::text = $3 OR
      p.equipo_local_id::text = $4 OR p.equipo_visita_id::text = $4 OR
      p.arbitro_id::text = $5 OR p.anotador_id::text = $5 OR
      p.arbitro_id::text = $6 OR p.anotador_id::text = $6 OR
      j_loc.id = ANY($7::int[]) OR j_vis.id = ANY($7::int[])
    ) LIMIT 1
  `;
  const params = [
    partidoIgnorado || '00000000-0000-0000-0000-000000000000',
    fecha_hora,
    eqLocal ? String(eqLocal) : 'N/A',
    eqVisita ? String(eqVisita) : 'N/A',
    arbitro ? String(arbitro) : 'N/A',
    anotador ? String(anotador) : 'N/A',
    todosJugadores.length > 0 ? todosJugadores : [0]
  ];
  const res = await db.query(query, params);
  return res.rows.length > 0;
};

const suspenderPartidosPasados = async (orgId) => {
  try {
    await db.query(`
      UPDATE public.partidos p
      SET estado = 'Suspendido'
      FROM public.torneos t
      WHERE p.torneo_id = t.id 
      AND t.organizacion_id = $1 
      AND p.estado = 'Agendado' 
      AND p.fecha_hora::timestamp < (NOW() AT TIME ZONE 'America/Caracas' - INTERVAL '1 hour')
    `, [orgId]);
  } catch (error) { console.error('Error al auto-suspender partidos:', error); }
};

router.use(verificarToken, autorizarRoles('Administrador de Liga', 'Superadmin'));

router.use((req, res, next) => {
  if (req.path === '/bitacora') return next();
  res.on('finish', async () => {
    if (res.statusCode < 400) {
      await registrarAuditoria(req.usuario?.id, `${req.method} ${req.path}`, 'admin-liga', null, { status: res.statusCode, parametros: req.params }, req.ip, req.usuario?.organizacion_id || null);
    }
  });
  next();
});

router.get('/bitacora', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const { busqueda, accion, fecha_desde, fecha_hasta } = req.query;
    const params = [orgId];
    let sql = `SELECT a.id, a.accion, a.tabla, a.valores_previos, a.nuevos_valores, a.ip, a.fecha,
      CASE
        WHEN a.accion = 'GET /mi-organizacion' THEN 'Consultó la información de la organización y su membrete.'
        WHEN a.accion = 'GET /partidos-finalizados' THEN 'Consultó el historial de partidos finalizados y sus actas.'
        WHEN a.accion = 'GET /bitacora' THEN 'Consultó la bitácora de actividad de la organización.'
        WHEN a.accion LIKE 'GET /%' THEN 'Consultó información de ' || REPLACE(REPLACE(SUBSTRING(a.accion FROM 6), '/', ' '), '-', ' ') || '.'
        WHEN a.accion = 'CREAR_SEDE' THEN 'Registró una nueva sede deportiva.'
        WHEN a.accion = 'EDITAR_SEDE' THEN 'Actualizó los datos de una sede deportiva.'
        WHEN a.accion = 'ELIMINAR_SEDE' THEN 'Eliminó una sede deportiva.'
        WHEN a.accion = 'TRANSFERIR_JUGADOR' THEN 'Transfirió un jugador entre equipos de la organización.'
        WHEN a.accion = 'ACTUALIZAR_LOGO' THEN 'Actualizó el logo de la organización.'
        WHEN a.accion = 'CREAR_EQUIPO' THEN 'Registró un equipo nuevo.'
        WHEN a.accion = 'ELIMINAR_EQUIPO' THEN 'Eliminó un equipo y su nómina (baja lógica).'
        WHEN a.accion = 'CREAR_JUGADOR' THEN 'Registró un jugador nuevo.'
        WHEN a.accion = 'EDITAR_JUGADOR' THEN 'Actualizó los datos de un jugador.'
        WHEN a.accion = 'CAMBIAR_ESTADO_JUGADOR' THEN 'Cambió el estado de un jugador.'
        WHEN a.accion = 'CAMBIAR_PASSWORD_PROPIO' THEN 'Cambió su propia contraseña.'
        WHEN a.accion = 'ASOCIAR_CREDENCIAL' THEN 'Asoció un usuario existente a su liga.'
        WHEN a.accion = 'CREAR_CREDENCIAL' THEN 'Creó una credencial de usuario operativo.'
        WHEN a.accion = 'DESACTIVAR_CREDENCIAL' THEN 'Desactivó permanentemente una credencial.'
        WHEN a.accion = 'REVOCAR_CREDENCIAL' THEN 'Revocó el acceso de un usuario a su liga.'
        WHEN a.accion = 'RESET_PASSWORD_OPERATIVO' THEN 'Restableció la contraseña de un usuario operativo.'
        WHEN a.accion = 'ASIGNAR_DELEGADO' THEN 'Reasignó el delegado de un equipo.'
        WHEN a.accion = 'GUARDAR_PLANTILLAS' THEN 'Guardó una plantilla de reglas.'
        WHEN a.accion = 'CREAR_TORNEO' THEN 'Creó un torneo con su calendario de partidos.'
        WHEN a.accion = 'EDITAR_TORNEO' THEN 'Actualizó un torneo.'
        WHEN a.accion = 'CREAR_PARTIDO_SUELTO' THEN 'Agendó un partido suelto.'
        WHEN a.accion = 'REAGENDAR_PARTIDO' THEN 'Reagendó un partido.'
        WHEN a.accion = 'EDITAR_OFICIALES_PARTIDO' THEN 'Modificó los oficiales o la sede de un partido.'
        WHEN a.accion = 'CANCELAR_PARTIDO' THEN 'Canceló un partido.'
        WHEN a.accion = 'FORZAR_RESULTADO' THEN 'Forzó el resultado de un partido.'
        WHEN a.accion = 'CREAR_TORNEO_FLASH' THEN 'Creó un torneo flash: sorteó a los asistentes, armó los equipos y generó el calendario todos contra todos.'
        WHEN a.accion = 'POST /torneos-flash' THEN 'Creó un torneo flash (asistentes, sorteo de equipos y calendario en un paso).'
        WHEN a.accion LIKE 'CREAR_%' THEN 'Creó un registro de ' || LOWER(REPLACE(SUBSTRING(a.accion FROM 7), '_', ' ')) || '.'
        WHEN a.accion LIKE 'EDITAR_%' OR a.accion LIKE 'ACTUALIZAR_%' THEN 'Actualizó un registro de ' || LOWER(REPLACE(REPLACE(SUBSTRING(a.accion FROM 7), '_', ' '), 'actualizar ', '')) || '.'
        WHEN a.accion LIKE 'ELIMINAR_%' THEN 'Eliminó un registro de ' || LOWER(REPLACE(SUBSTRING(a.accion FROM 9), '_', ' ')) || '.'
        ELSE 'Realizó la acción: ' || REPLACE(a.accion, '_', ' ') || '.'
      END AS accion_descripcion,
      u.email AS usuario_email, u.nombre AS usuario_nombre, u.apellido AS usuario_apellido, u.rol AS usuario_rol
      FROM public.audit_logs a
      LEFT JOIN public.usuarios u ON a.usuario_id = u.id
      WHERE (a.organizacion_id = $1 OR (a.organizacion_id IS NULL AND u.organizacion_id = $1))`;
    if (busqueda) { params.push(`%${busqueda.trim()}%`); sql += ` AND (a.accion ILIKE $${params.length} OR a.tabla ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.nombre ILIKE $${params.length} OR u.apellido ILIKE $${params.length})`; }
    if (accion) { params.push(accion); sql += ` AND a.accion = $${params.length}`; }
    if (fecha_desde) { params.push(fecha_desde); sql += ` AND a.fecha >= $${params.length}::date`; }
    if (fecha_hasta) { params.push(fecha_hasta); sql += ` AND a.fecha < ($${params.length}::date + INTERVAL '1 day')`; }
    sql += ' ORDER BY a.fecha DESC LIMIT 500';
    const resultado = await db.query(sql, params);
    res.json(resultado.rows);
  } catch (error) {
    console.error('Error al consultar bitácora de la organización:', error);
    res.status(500).json({ error: 'Error al consultar la bitácora.' });
  }
});

router.put('/mi-organizacion/logo', async (req, res) => {
  const { logo_url } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    await db.query(`UPDATE public.organizaciones SET logo_url = $1 WHERE id = $2`, [logo_url, orgId]);
    await registrarAuditoria(req.usuario.id, 'ACTUALIZAR_LOGO', 'organizaciones', null, { logo_url }, req.ip, orgId);
    res.json({ mensaje: 'Logo de la organización actualizado exitosamente.' });
  } catch (error) { res.status(500).json({ error: 'Error al actualizar el logo.' }); }
});

router.get('/mi-organizacion', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resultado = await db.query('SELECT nombre, logo_url FROM public.organizaciones WHERE id = $1', [orgId]);
    
    if (resultado.rows.length > 0) {
      res.json(resultado.rows[0]);
    } else {
      res.status(404).json({ error: 'Organización no encontrada' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener la organización' });
  }
});

router.post('/cambiar-password-obligatorio', async (req, res) => {
  const { nueva_password } = req.body;
  if (!nueva_password || nueva_password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  try {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.usuario.id, {
      password: nueva_password,
      user_metadata: { debe_cambiar_password: false }
    });
    if (error) return res.status(400).json({ error: error.message });
    
    // Si estás manejando un hash dual, idealmente guardarías el bcrypt hash aquí.
    // Para simplificar según la arquitectura, lo dejamos como en tu original.
    await db.query('UPDATE public.usuarios SET debe_cambiar_password = false WHERE id = $1', [req.usuario.id]);
    await registrarAuditoria(req.usuario.id, 'CAMBIAR_PASSWORD_PROPIO', 'usuarios', null, { id: req.usuario.id }, req.ip, req.usuario?.organizacion_id || null);
    res.json({ mensaje: 'Contraseña actualizada con éxito.' });
  } catch (error) {
    res.status(500).json({ error: 'Error al cambiar la contraseña.' });
  }
});

const notificarInvolucrados = async (partidos, orgId, adminId) => {
  try {
    const notificaciones = [];
    for (const p of partidos) {
      const usuariosAnotificar = new Set();
      if (p.arbitro_id) usuariosAnotificar.add(p.arbitro_id);
      if (p.anotador_id) usuariosAnotificar.add(p.anotador_id);
      
      // Obtener delegados de los equipos involucrados
      const delDb = await db.query(
        'SELECT delegado_id FROM public.equipos WHERE id IN ($1, $2)', 
        [p.local_id || p.equipo_local_id, p.visita_id || p.equipo_visita_id]
      );
      delDb.rows.forEach(r => { if(r.delegado_id) usuariosAnotificar.add(r.delegado_id) });

      const msj = `Has sido programado para un encuentro el ${formatearFechaLocal(p.fecha_hora)}. Fase: ${p.fase || 'Regular'}`;
      
      for(let uid of usuariosAnotificar) {
        notificaciones.push(
          db.query(
            `INSERT INTO public.notificaciones (organizacion_id, remitente_id, destinatario_id, titulo, mensaje) VALUES ($1, $2, $3, 'Aviso de Programación', $4)`,
            [orgId, adminId, uid, msj]
          )
        );
      }
    }
    await Promise.all(notificaciones);
  } catch (error) { console.error("Error al enviar notificaciones:", error); }
};

// ==========================================
// GESTIÓN DE SEDES
// ==========================================
router.get('/sedes', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
const resultado = await db.query(`SELECT * FROM public.sedes WHERE organizacion_id = $1 AND estado = 'Activo' ORDER BY nombre ASC`, [orgId]);
    res.json(resultado.rows);
  } catch (error) { res.status(500).json({ error: 'Error al obtener sedes.' }); }
});

router.post('/sedes', async (req, res) => {
  const { nombre, direccion } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resDb = await db.query(
      `INSERT INTO public.sedes (organizacion_id, nombre, direccion) VALUES ($1, $2, $3) RETURNING *`,
      [orgId, formatearTexto(nombre), direccion ? direccion.trim() : null]
    );
    await registrarAuditoria(req.usuario.id, 'CREAR_SEDE', 'sedes', null, resDb.rows[0], req.ip, orgId);
    res.status(201).json({ mensaje: 'Sede registrada con éxito.', sede: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error registrando sede.' }); }
});

router.put('/sedes/:id', async (req, res) => {
  const { nombre, direccion } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resDb = await db.query(
      `UPDATE public.sedes SET nombre = $1, direccion = $2 WHERE id = $3 AND ($4::uuid IS NULL OR organizacion_id = $4) RETURNING *`,
      [formatearTexto(nombre), direccion ? direccion.trim() : null, req.params.id, orgId]
    );
    if (resDb.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada en tu organización.' });
    await registrarAuditoria(req.usuario.id, 'EDITAR_SEDE', 'sedes', null, resDb.rows[0], req.ip, orgId);
    res.json({ mensaje: 'Sede actualizada con éxito.', sede: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al actualizar sede.' }); }
});

router.delete('/sedes/:id', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    // LOTE E: soft-delete — una sede referenciada por partidos no se borra físicamente
    // (rompería el FK y el historial); una sede vigente no se puede desactivar.
    const enUso = await db.query(`SELECT id FROM public.partidos WHERE sede_id = $1 AND estado IN ('Agendado', 'En Curso') LIMIT 1`, [req.params.id]);
    if (enUso.rows.length > 0) {
      return res.status(400).json({ error: 'No se puede eliminar una sede con partidos agendados o en curso. Reasigna esos partidos primero.' });
    }
    const resDb = await db.query(`UPDATE public.sedes SET estado = 'Inactivo' WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2) RETURNING id`, [req.params.id, orgId]);
    if (resDb.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada en tu organización.' });
    await registrarAuditoria(req.usuario.id, 'ELIMINAR_SEDE', 'sedes', { id: req.params.id }, null, req.ip, orgId);
    res.json({ mensaje: 'Sede eliminada con éxito.' });
  } catch (error) { res.status(500).json({ error: 'Error al eliminar sede.' }); }
});

// ==========================================
// EQUIPOS Y JUGADORES
// ==========================================
router.get('/equipos', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resultado = await db.query(
      `SELECT e.*, u.email as delegado_email, u.id as delegado_id_usuario, j.nombre as capitan_nombre, j.apellido as capitan_apellido, j.cedula as capitan_cedula, j.correo as capitan_correo,
              COUNT(j_todos.id) as total_jugadores
       FROM public.equipos e
       LEFT JOIN public.usuarios u ON e.delegado_id = u.id
       LEFT JOIN public.jugadores j ON e.capitan_id = j.id
       LEFT JOIN public.jugadores j_todos ON j_todos.equipo_id = e.id AND j_todos.estado = 'Activo'
WHERE (e.organizacion_id = $1 OR $1 IS NULL) AND e.estado = 'Activo'
       GROUP BY e.id, u.email, u.id, j.nombre, j.apellido, j.cedula, j.correo ORDER BY e.nombre ASC`,
      [orgId]
    );
    res.json(resultado.rows);
  } catch (error) { res.status(500).json({ error: 'Error al obtener equipos.' }); }
});

router.post('/equipos', async (req, res) => {
  const { nombre, categoria, tipo_genero, logo_url } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resDb = await db.query(
      `INSERT INTO public.equipos (nombre, categoria, tipo_genero, logo_url, organizacion_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [formatearTexto(nombre), categoria, tipo_genero || 'Mixto', logo_url || null, orgId]
    );
    await registrarAuditoria(req.usuario.id, 'CREAR_EQUIPO', 'equipos', null, resDb.rows[0], req.ip, orgId);
    res.status(201).json({ mensaje: 'Equipo registrado.', equipo: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error registrando equipo.' }); }
});

router.delete('/equipos/:id', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const equipoId = req.params.id;

    // 1. Verificamos que el equipo no esté atado a partidos existentes
    const matches = await db.query(
      'SELECT id FROM public.partidos WHERE equipo_local_id = $1 OR equipo_visita_id = $1 LIMIT 1', 
      [equipoId]
    );

    if (matches.rows.length > 0) {
      return res.status(400).json({ 
        error: 'No se puede eliminar este equipo porque ya cuenta con partidos agendados o finalizados en el historial.' 
      });
    }

    // 2. LOTE E: soft-delete — se inactiva la nómina; NO se borra ninguna fila
    //    (se preserva el historial deportivo y las relaciones de los equipos).
    await db.query(`UPDATE public.jugadores SET estado = 'Inactivo' WHERE equipo_id = $1`, [equipoId]);

    // 3. Finalmente inactivamos el equipo (soft delete con filtro de organización)
    const resDel = await db.query(`UPDATE public.equipos SET estado = 'Inactivo' WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2) RETURNING id`, [equipoId, orgId]);
    if (resDel.rows.length === 0) return res.status(404).json({ error: 'Equipo no encontrado en tu organización.' });

    await registrarAuditoria(req.usuario.id, 'ELIMINAR_EQUIPO', 'equipos', { id: equipoId }, { estado: 'Inactivo' }, req.ip, orgId);
    res.json({ mensaje: 'Equipo y su nómina han sido eliminados con éxito.' });
  } catch (error) {
    console.error('Error al eliminar equipo:', error);
    res.status(500).json({ error: 'Error al intentar eliminar el equipo.' });
  }
});

router.get('/equipos/:equipo_id/jugadores', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const eqRes = await db.query('SELECT id FROM public.equipos WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2)', [req.params.equipo_id, orgId]);
    if (eqRes.rows.length === 0) return res.status(404).json({ error: 'Equipo no encontrado en tu organización.' });
    const resDb = await db.query(
      `SELECT * FROM public.jugadores WHERE equipo_id = $1 ORDER BY CASE WHEN estado = 'Activo' THEN 1 ELSE 2 END, numero_dorsal ASC`,
      [req.params.equipo_id]
    );
    res.json(resDb.rows);
  } catch (error) { res.status(500).json({ error: 'Error consultando jugadores.' }); }
});

router.post('/jugadores', async (req, res) => {
  const { equipo_id, cedula, nombre, apellido, fecha_nacimiento, correo, telefono, numero_dorsal, foto_url, es_capitan } = req.body;
  if (!/^\d{5,8}$/.test(cedula?.trim())) {
    return res.status(400).json({ error: 'La cédula debe ser numérica de 5 a 8 dígitos.' });
  }
  const dorsalNum = parseInt(numero_dorsal);
  if (isNaN(dorsalNum) || dorsalNum <= 0 || dorsalNum > 99) {
    return res.status(400).json({ error: 'El número dorsal debe ser un entero entre 1 y 99.' });
  }
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const eqRes = await db.query('SELECT id, categoria FROM public.equipos WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2)', [equipo_id, orgId]);
    if (eqRes.rows.length === 0) return res.status(404).json({ error: 'El equipo indicado no existe en tu organización.' });

    if (eqRes.rows.length > 0) {
      const categoriaEq = eqRes.rows[0].categoria;
      const edad = Math.floor((new Date() - new Date(fecha_nacimiento).getTime()) / 3.15576e+10);
      
      if (categoriaEq === 'Pre-Infantil (<8)' && edad >= 8) 
        return res.status(400).json({ error: 'Categoría Pre-Infantil: El jugador debe ser menor de 8 años.' });
      if (categoriaEq === 'Infantil (8-13)' && (edad < 8 || edad > 13)) 
        return res.status(400).json({ error: 'Categoría Infantil: El jugador debe tener entre 8 y 13 años.' });
      if (categoriaEq === 'Adulto 22+' && edad < 22) 
        return res.status(400).json({ error: 'Categoría Adulto 22+: El jugador debe tener al menos 22 años.' });
    }

    const dorsalCheck = await db.query(`SELECT id FROM public.jugadores WHERE equipo_id = $1 AND numero_dorsal = $2 AND estado = 'Activo'`, [equipo_id, dorsalNum]);
    if (dorsalCheck.rows.length > 0) {
      return res.status(400).json({ error: `El número dorsal #${dorsalNum} ya está asignado a otro jugador activo.` });
    }
    const resDb = await db.query(
      `INSERT INTO public.jugadores (equipo_id, cedula, nombre, apellido, fecha_nacimiento, correo, telefono, numero_dorsal, foto_url, estado) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Activo') RETURNING *`,
      [equipo_id, cedula.trim(), formatearTexto(nombre), formatearTexto(apellido), fecha_nacimiento, correo.trim(), telefono.trim(), dorsalNum, foto_url || null]
    );
    let mensajeDelegado = '';
    if (es_capitan) {
      const jugadorId = resDb.rows[0].id;
      await db.query(`UPDATE public.equipos SET capitan_id = $1 WHERE id = $2`, [jugadorId, equipo_id]);
      mensajeDelegado = await gestionarDelegadoPorCapitan(equipo_id, jugadorId, orgId);
    }
    await registrarAuditoria(req.usuario.id, 'CREAR_JUGADOR', 'jugadores', null, resDb.rows[0], req.ip, orgId);
    res.status(201).json({ mensaje: `Jugador registrado.${mensajeDelegado || ''}`, jugador: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al registrar el jugador.' }); }
});

router.post('/jugadores/batch-fotos', async (req, res) => {
  const { batch, equipo_id } = req.body; 
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const eqRes = await db.query('SELECT id FROM public.equipos WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2)', [equipo_id, orgId]);
    if (eqRes.rows.length === 0) return res.status(404).json({ error: 'El equipo indicado no existe en tu organización.' });
    let actualizados = 0;
    for(let item of batch) {
      const resp = await db.query(`UPDATE public.jugadores SET foto_url = $1 WHERE cedula = $2 AND equipo_id = $3 RETURNING id`, [item.foto_url, item.cedula, equipo_id]);
      if(resp.rows.length > 0) actualizados++;
    }
    res.json({ mensaje: `Proceso completado. Se actualizaron las fotos de ${actualizados} jugador(es).` });
  } catch(e) { res.status(500).json({ error: 'Error en la actualización masiva de fotos.' }); }
});

router.put('/jugadores/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, apellido, cedula, fecha_nacimiento, correo, telefono, numero_dorsal, foto_url, es_capitan } = req.body;
  
  if (cedula && !/^\d{5,8}$/.test(cedula.trim())) {
    return res.status(400).json({ error: 'La cédula debe ser numérica de 5 a 8 dígitos.' });
  }
  
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const jugadorPrevio = await db.query(`SELECT j.equipo_id FROM public.jugadores j JOIN public.equipos e ON j.equipo_id = e.id WHERE j.id = $1 AND ($2::uuid IS NULL OR e.organizacion_id = $2)`, [id, orgId]);
    if (jugadorPrevio.rows.length === 0) return res.status(404).json({ error: 'Jugador no encontrado en tu organización.' });
    
    const equipoId = jugadorPrevio.rows[0].equipo_id;
    
    if (fecha_nacimiento) {
      const eqRes = await db.query('SELECT categoria FROM public.equipos WHERE id = $1', [equipoId]);
      if (eqRes.rows.length > 0) {
        const categoriaEq = eqRes.rows[0].categoria;
        const edad = Math.floor((new Date() - new Date(fecha_nacimiento).getTime()) / 3.15576e+10);
        
        if (categoriaEq === 'Pre-Infantil (<8)' && edad >= 8) 
          return res.status(400).json({ error: 'Categoría Pre-Infantil: El jugador debe ser menor de 8 años.' });
        if (categoriaEq === 'Infantil (8-13)' && (edad < 8 || edad > 13)) 
          return res.status(400).json({ error: 'Categoría Infantil: El jugador debe tener entre 8 y 13 años.' });
        if (categoriaEq === 'Adulto 22+' && edad < 22) 
          return res.status(400).json({ error: 'Categoría Adulto 22+: El jugador debe tener al menos 22 años.' });
      }
    }
    
    if (numero_dorsal) {
      const dorsalNum = parseInt(numero_dorsal);
      
      if (isNaN(dorsalNum) || dorsalNum <= 0 || dorsalNum > 99) {
        return res.status(400).json({ error: 'El número dorsal debe ser un entero entre 1 y 99.' });
      }

      const dorsalCheck = await db.query(
        `SELECT id FROM public.jugadores WHERE equipo_id = $1 AND numero_dorsal = $2 AND id != $3 AND estado = 'Activo'`, 
        [equipoId, dorsalNum, id]
      );
      if (dorsalCheck.rows.length > 0) {
        return res.status(400).json({ error: `El dorsal #${dorsalNum} ya está en uso por otro jugador activo.` });
      }
    }

    const resDb = await db.query(
      `UPDATE public.jugadores 
       SET nombre = COALESCE($1, nombre), apellido = COALESCE($2, apellido), cedula = COALESCE($3, cedula), 
           fecha_nacimiento = COALESCE($4, fecha_nacimiento), correo = COALESCE($5, correo), 
           telefono = COALESCE($6, telefono), numero_dorsal = COALESCE($7, numero_dorsal), foto_url = COALESCE($8, foto_url)
       WHERE id = $9 RETURNING *`,
      [
        nombre ? formatearTexto(nombre) : null, 
        apellido ? formatearTexto(apellido) : null, 
        cedula?.trim(), 
        fecha_nacimiento, 
        correo?.trim(), 
        telefono?.trim(), 
        numero_dorsal ? parseInt(numero_dorsal) : null, 
        foto_url, 
        id
      ]
    );

    let mensajeDelegado = '';
    if (es_capitan) {
      await db.query(`UPDATE public.equipos SET capitan_id = $1 WHERE id = $2`, [id, equipoId]);
      mensajeDelegado = await gestionarDelegadoPorCapitan(equipoId, id, orgId);
    } else {
      await db.query(`UPDATE public.equipos SET capitan_id = NULL WHERE id = $1 AND capitan_id = $2`, [equipoId, id]);
    }
    await registrarAuditoria(req.usuario.id, 'EDITAR_JUGADOR', 'jugadores', { id: parseInt(id) }, resDb.rows[0], req.ip, orgId);
    res.json({ mensaje: `Jugador y capitanía actualizados con éxito.${mensajeDelegado || ''}`, jugador: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error actualizando jugador.' }); }
});

router.put('/jugadores/:id/estado', async (req, res) => {
  const { estado, nuevo_capitan_id, equipo_id } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resDb = await db.query(`UPDATE public.jugadores j SET estado = $1 FROM public.equipos e WHERE j.equipo_id = e.id AND ($2::uuid IS NULL OR e.organizacion_id = $2) AND j.id = $3 RETURNING j.*`, [estado, orgId, req.params.id]);
    if (resDb.rows.length === 0) return res.status(404).json({ error: 'Jugador no encontrado en tu organización.' });
    if (estado !== 'Activo') {
      await db.query(`UPDATE public.equipos SET capitan_id = NULL WHERE capitan_id = $1`, [req.params.id]);
    }
    let mensajeDelegado = '';
    if (nuevo_capitan_id && equipo_id) {
      await db.query(`UPDATE public.equipos SET capitan_id = $1 WHERE id = $2`, [nuevo_capitan_id, equipo_id]);
      mensajeDelegado = await gestionarDelegadoPorCapitan(equipo_id, nuevo_capitan_id, orgId);
    }
    
    await registrarAuditoria(req.usuario.id, 'CAMBIAR_ESTADO_JUGADOR', 'jugadores', { id: req.params.id }, { estado }, req.ip, orgId);
    res.json({ mensaje: `Jugador ${estado.toLowerCase()} con éxito.${mensajeDelegado || ''}`, jugador: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al cambiar estado del jugador.' }); }
});

// ==========================================
// LOTE N: TRANSFERENCIA DE JUGADOR ENTRE EQUIPOS
// ==========================================
router.post('/jugadores/:id/transferencia', async (req, res) => {
  const { id } = req.params;
  const { equipo_destino_id, numero_dorsal, motivo } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);

    // 1. Jugador a transferir (debe pertenecer a la organización)
    const jugadorRes = await db.query(
      `SELECT j.*, e.nombre AS equipo_nombre
       FROM public.jugadores j JOIN public.equipos e ON j.equipo_id = e.id
       WHERE j.id = $1 AND ($2::uuid IS NULL OR e.organizacion_id = $2)`,
      [id, orgId]
    );
    if (jugadorRes.rows.length === 0) return res.status(404).json({ error: 'Jugador no encontrado en tu organización.' });
    const jugador = jugadorRes.rows[0];

    // 2. Equipo destino (misma organización, estado Activo)
    const destinoRes = await db.query(
      `SELECT id, nombre, categoria, estado FROM public.equipos
       WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2)`,
      [equipo_destino_id, orgId]
    );
    if (destinoRes.rows.length === 0) return res.status(404).json({ error: 'Equipo destino no encontrado en tu organización.' });
    const destino = destinoRes.rows[0];
    if (destino.estado !== 'Activo') return res.status(400).json({ error: 'El equipo destino está inactivo.' });
    if (String(destino.id) === String(jugador.equipo_id)) {
      return res.status(400).json({ error: 'El jugador ya pertenece a ese equipo.' });
    }

    // 3. Dorsal obligatorio, 1-99, libre en el destino entre jugadores activos
    const dorsalNum = parseInt(numero_dorsal);
    if (isNaN(dorsalNum) || dorsalNum <= 0 || dorsalNum > 99) {
      return res.status(400).json({ error: 'El número dorsal debe ser un entero entre 1 y 99.' });
    }
    const dorsalCheck = await db.query(
      `SELECT id FROM public.jugadores WHERE equipo_id = $1 AND numero_dorsal = $2 AND id != $3 AND estado = 'Activo'`,
      [destino.id, dorsalNum, id]
    );
    if (dorsalCheck.rows.length > 0) {
      return res.status(400).json({ error: 'El dorsal #' + dorsalNum + ' ya está en uso en el equipo destino.' });
    }

    // 4. Validar edad vs categoría del destino (mismas reglas de alta/edición)
    if (jugador.fecha_nacimiento) {
      const edad = Math.floor((new Date() - new Date(jugador.fecha_nacimiento).getTime()) / 3.15576e+10);
      if (destino.categoria === 'Pre-Infantil (<8)' && edad >= 8)
        return res.status(400).json({ error: 'Categoría Pre-Infantil: El jugador debe ser menor de 8 años.' });
      if (destino.categoria === 'Infantil (8-13)' && (edad < 8 || edad > 13))
        return res.status(400).json({ error: 'Categoría Infantil: El jugador debe tener entre 8 y 13 años.' });
      if (destino.categoria === 'Adulto 22+' && edad < 22)
        return res.status(400).json({ error: 'Categoría Adulto 22+: El jugador debe tener al menos 22 años.' });
    }

    // 5. Si es capitán del equipo de origen, liberar la capitanía
    await db.query('UPDATE public.equipos SET capitan_id = NULL WHERE capitan_id = $1', [id]);

    // 6. Ejecutar la transferencia
    const resDb = await db.query(
      'UPDATE public.jugadores SET equipo_id = $1, numero_dorsal = $2 WHERE id = $3 RETURNING *',
      [destino.id, dorsalNum, id]
    );

    // 7. Bitácora (audit_logs): trazabilidad de la transferencia
    await registrarAuditoria(
      req.usuario.id, 'TRANSFERIR_JUGADOR', 'jugadores',
      { jugador_id: parseInt(id), equipo_origen_id: jugador.equipo_id, equipo_origen_nombre: jugador.equipo_nombre, dorsal_anterior: jugador.numero_dorsal },
      { equipo_destino_id: destino.id, equipo_destino_nombre: destino.nombre, dorsal_nuevo: dorsalNum, motivo: motivo ? String(motivo).trim().slice(0, 255) : null },
      req.ip, orgId
    );

    res.json({ mensaje: 'Jugador transferido a ' + destino.nombre + ' con éxito.', jugador: resDb.rows[0] });
  } catch (error) {
    console.error('Error al transferir jugador:', error);
    res.status(500).json({ error: 'Error interno al transferir el jugador.' });
  }
});

// ==========================================
// CREDENCIALES Y USUARIOS OPERATIVOS
// ==========================================
// Ruta para verificar si la cédula ya existe en todo el sistema
router.get('/verificar-cedula/:cedula', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const user = await db.query(`SELECT id, nombre, apellido, email FROM public.usuarios WHERE cedula = $1 AND ($2::uuid IS NULL OR organizacion_id = $2 OR EXISTS (SELECT 1 FROM public.usuario_organizaciones uo WHERE uo.usuario_id = usuarios.id AND uo.organizacion_id = $2))`, [req.params.cedula, orgId]);
    if (user.rows.length > 0) res.json({ existe: true, usuario: user.rows[0] });
    else res.json({ existe: false });
  } catch (e) { res.status(500).json({ error: 'Error verificando cédula' }); }
});

// Listar usuarios operativos basándose en la nueva tabla de relaciones
router.get('/usuarios-operativos', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resDb = await db.query(
      `SELECT u.id, u.nombre, u.apellido, u.email, u.cedula, uo.rol 
       FROM public.usuarios u
       JOIN public.usuario_organizaciones uo ON u.id = uo.usuario_id
       WHERE uo.organizacion_id = $1 
         AND LOWER(uo.rol) IN ('delegado de equipo', 'arbitro', 'árbitro', 'anotador')`, 
      [orgId]
    );
    res.json(resDb.rows);
  } catch (e) { res.status(500).json({ error: 'Error consultando usuarios operativos.' }); }
});

// Crear Credencial
router.post('/crear-credencial', async (req, res) => {
  const { nombre, apellido, cedula, email, rol, equipo_id } = req.body;
  const orgId = await obtenerOrgId(req.usuario);
  
  if (!/^\d{5,8}$/.test(cedula?.trim())) return res.status(400).json({ error: 'La cédula debe ser numérica de 5 a 8 dígitos.' });
  const emailLimpio = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpio)) { // LOTE J: validar correo antes de tocar Auth/BD
    return res.status(400).json({ error: 'El correo es obligatorio y debe tener un formato válido.' });
  }

  try {
    const existe = await db.query('SELECT id FROM public.usuarios WHERE cedula = $1', [cedula.trim()]);
    const emailExistente = await db.query('SELECT id, cedula FROM public.usuarios WHERE email = $1', [emailLimpio]);
    if (emailExistente.rows.length > 0 && String(emailExistente.rows[0].cedula || '').trim() !== cedula.trim()) {
      return res.status(400).json({ error: 'Ese correo ya pertenece a otro usuario. Usa un correo distinto o ubica a la persona por su cédula.' });
    }
    
    if (existe.rows.length > 0) {
      const usuarioId = existe.rows[0].id;
      await db.query(
        `INSERT INTO public.usuario_organizaciones (usuario_id, organizacion_id, rol) VALUES ($1, $2, $3) 
         ON CONFLICT (usuario_id, organizacion_id) DO UPDATE SET rol = $3`,
        [usuarioId, orgId, rol]
      );
      if (rol.toLowerCase() === 'delegado de equipo' && equipo_id) {
        await db.query(`UPDATE public.equipos SET delegado_id = $1 WHERE id = $2 AND ($3::uuid IS NULL OR organizacion_id = $3)`, [usuarioId, equipo_id, orgId]);
      }
      // LOTE O: FIX DELEGADOS — al asociar un usuario existente, consolidar su organizacion_id
      // si quedó nulo (delegados creados antes de este lote no tenían organización asignada).
      await db.query('UPDATE public.usuarios SET organizacion_id = $1 WHERE id = $2 AND organizacion_id IS NULL', [orgId, usuarioId]);
      await registrarAuditoria(req.usuario.id, 'ASOCIAR_CREDENCIAL', 'usuario_organizaciones', { usuario_id: usuarioId }, { organizacion_id: orgId, rol }, req.ip, orgId);
      return res.status(200).json({ mensaje: 'El usuario ya existía y ha sido asociado a tu liga exitosamente.' });
    }

    const nombreFmt = formatearTexto(nombre);
    const apellidoFmt = formatearTexto(apellido);
    const emailReal = emailLimpio; // LOTE J: ya normalizado y validado arriba
    const passwordInicial = `${nombreFmt.split(' ')[0]}${cedula.trim().substring(0, 5)}!`;
    const hashedPwd = await bcrypt.hash(passwordInicial, 10);

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: emailReal, password: passwordInicial, email_confirm: true,
      user_metadata: { rol, nombre: nombreFmt, apellido: apellidoFmt, cedula: cedula.trim(), debe_cambiar_password: true }
    });

    if (authError) return res.status(400).json({ error: authError.message });

    const resDb = await db.query(
      `INSERT INTO public.usuarios (id, email, rol, nombre, apellido, cedula, organizacion_id, password_hash, debe_cambiar_password) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING *`,
      [authUser.user.id, emailReal, rol, nombreFmt, apellidoFmt, cedula.trim(), orgId, hashedPwd]
    );

    await db.query(`INSERT INTO public.usuario_organizaciones (usuario_id, organizacion_id, rol) VALUES ($1, $2, $3)`, [authUser.user.id, orgId, rol]);

    if (rol.toLowerCase() === 'delegado de equipo' && equipo_id) {
      await db.query(`UPDATE public.equipos SET delegado_id = $1 WHERE id = $2 AND ($3::uuid IS NULL OR organizacion_id = $3)`, [authUser.user.id, equipo_id, orgId]);
    }

    await registrarAuditoria(req.usuario.id, 'CREAR_CREDENCIAL', 'usuarios', null, { id: authUser.user.id, rol, email: emailReal }, req.ip, orgId);
    res.status(201).json({ mensaje: `Credencial creada con éxito. Clave temporal: ${passwordInicial}` });
  } catch (error) {
    // LOTE J: sin este log, la causa real del 500 era invisible en Render.
    console.error('Error creando credencial:', error);
    res.status(500).json({ error: 'Error registrando credencial.' });
  }
});

// Eliminar o revocar credencial de un oficial de liga con validación de delegado único
router.delete('/remover-credencial/:id', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const usuarioId = req.params.id;
    
    // Validar si el usuario es delegado de algún equipo en esta organización
    const equiposDelDelegado = await db.query(
      'SELECT id, nombre FROM public.equipos WHERE delegado_id = $1 AND organizacion_id = $2',
      [usuarioId, orgId]
    );

    if (equiposDelDelegado.rows.length > 0) {
      const nombresEquipos = equiposDelDelegado.rows.map(e => e.nombre).join(', ');
      return res.status(400).json({ 
        error: `Acción denegada: Un equipo nunca puede quedar sin delegado. Este usuario es el delegado actual del/los equipo(s): [${nombresEquipos}]. Debe asignar otro delegado a dicho(s) equipo(s) antes de poder eliminar sus credenciales.` 
      });
    }
    
    // Lo removemos de la tabla de relaciones (pierde acceso a la liga actual)
    await db.query('DELETE FROM public.usuario_organizaciones WHERE usuario_id = $1 AND organizacion_id = $2', [usuarioId, orgId]);
    
    // Verificamos si el usuario aún pertenece a otras ligas
    const ligasRestantes = await db.query('SELECT count(*) FROM public.usuario_organizaciones WHERE usuario_id = $1', [usuarioId]);
    
    if (parseInt(ligasRestantes.rows[0].count) === 0) {
      // SOFT DELETE: El usuario ya no está en ninguna liga. Lo inactivamos y bloqueamos su acceso.
      await db.query("UPDATE public.usuarios SET estado = 'Inactivo' WHERE id = $1", [usuarioId]);
      
      // Supabase ban (876000h = 100 años), el usuario pierde validez para iniciar sesión
      await supabaseAdmin.auth.admin.updateUserById(usuarioId, { ban_duration: '876000h' });
      
      await registrarAuditoria(req.usuario.id, 'DESACTIVAR_CREDENCIAL', 'usuarios', { id: usuarioId }, { estado: 'Inactivo' }, req.ip, orgId);
      return res.json({ mensaje: 'Credencial desactivada permanentemente (el usuario fue inactivado en el sistema global).' });
    }
    
    await registrarAuditoria(req.usuario.id, 'REVOCAR_CREDENCIAL', 'usuario_organizaciones', { usuario_id: usuarioId }, { organizacion_id: orgId }, req.ip, orgId);
    res.json({ mensaje: 'Acceso revocado para tu liga con éxito. (El usuario conserva sus credenciales en sus otras ligas).' });
  } catch (error) { 
    console.error('Error al remover credencial:', error);
    res.status(500).json({ error: 'Error al remover credencial.' }); 
  }
});

router.post('/usuarios/:id/reset-password', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const userDb = await db.query(`SELECT email, cedula, nombre FROM public.usuarios WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2 OR EXISTS (SELECT 1 FROM public.usuario_organizaciones uo WHERE uo.usuario_id = usuarios.id AND uo.organizacion_id = $2))`, [req.params.id, orgId]);
    if (userDb.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado en tu organización.' });
    
    const { cedula, nombre } = userDb.rows[0];
    const primerNombre = nombre ? nombre.trim().split(' ')[0] : 'User';
    const nuevaPassword = `${primerNombre}${cedula.trim().substring(0, 5)}!`;
    
    const hashedPwd = await bcrypt.hash(nuevaPassword, 10);

    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
      password: nuevaPassword, user_metadata: { debe_cambiar_password: true }
    });
    if (error) return res.status(400).json({ error: error.message });
    
    await db.query('UPDATE public.usuarios SET debe_cambiar_password = true, password_hash = $2 WHERE id = $1', [req.params.id, hashedPwd]);
    await registrarAuditoria(req.usuario.id, 'RESET_PASSWORD_OPERATIVO', 'usuarios', { id: req.params.id }, { password_reset: true }, req.ip, orgId);
    res.json({ mensaje: `Contraseña restablecida. Nueva clave temporal: ${nuevaPassword}` });
  } catch (error) { res.status(500).json({ error: 'Error al restablecer contraseña.' }); }
});

router.put('/equipos/:id/delegado', async (req, res) => {
  const { delegado_id } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resDb = await db.query(`UPDATE public.equipos SET delegado_id = $1 WHERE id = $2 AND ($3::uuid IS NULL OR organizacion_id = $3) RETURNING *`, [delegado_id, req.params.id, orgId]);
    if (resDb.rows.length === 0) return res.status(404).json({ error: 'Equipo no encontrado en tu organización.' });
    await registrarAuditoria(req.usuario.id, 'ASIGNAR_DELEGADO', 'equipos', { id: req.params.id }, resDb.rows[0], req.ip, orgId);
    res.json({ mensaje: 'Delegado reasignado con éxito.' });
  } catch (error) { res.status(500).json({ error: 'Error al reasignar delegado.' }); }
});

// ==========================================
// PLANTILLAS DE REGLAS
// ==========================================
router.get('/plantillas-reglas', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resDb = await db.query(`SELECT * FROM public.plantillas_reglas WHERE organizacion_id = $1 OR organizacion_id IS NULL ORDER BY id DESC`, [orgId]);
    res.json(resDb.rows);
  } catch (error) { res.status(500).json({ error: 'Error obteniendo reglas.' }); }
});

router.post('/plantillas-reglas', async (req, res) => {
  const { nombre, descripcion, reglas } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const reglasParseadas = typeof reglas === 'object' ? reglas : JSON.parse(reglas || '{}');
    if (!reglasParseadas.esferas_por_equipo) reglasParseadas.esferas_por_equipo = 8;
    const resDb = await db.query(
      `INSERT INTO public.plantillas_reglas (organizacion_id, nombre, descripcion, reglas) VALUES ($1, $2, $3, $4) RETURNING *`,
      [orgId, formatearTexto(nombre), descripcion ? descripcion.trim() : null, JSON.stringify(reglasParseadas)]
    );
    await registrarAuditoria(req.usuario.id, 'GUARDAR_PLANTILLAS', 'plantillas_reglas', null, resDb.rows[0], req.ip, orgId);
    res.status(201).json({ mensaje: 'Plantilla de reglas guardada con éxito.', plantilla: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error guardando reglas.' }); }
});

// Función auxiliar modificada para retornar el mensaje de credenciales
const gestionarDelegadoPorCapitan = async (equipoId, jugadorId, orgId) => {
  try {
    const jugRes = await db.query('SELECT cedula, nombre, apellido, correo FROM public.jugadores WHERE id = $1', [jugadorId]);
    if (jugRes.rows.length === 0) return null;
    const { cedula, nombre, apellido, correo } = jugRes.rows[0];
    if (!cedula) return null;

    const userRes = await db.query('SELECT id FROM public.usuarios WHERE cedula = $1', [cedula.trim()]);
    let usuarioId;
    let mensajeResultado = '';

    if (userRes.rows.length > 0) {
      usuarioId = userRes.rows[0].id;
      await db.query(
        `INSERT INTO public.usuario_organizaciones (usuario_id, organizacion_id, rol) VALUES ($1, $2, 'delegado de equipo')
         ON CONFLICT (usuario_id, organizacion_id) DO UPDATE SET rol = 'delegado de equipo'`,
        [usuarioId, orgId]
      );
      mensajeResultado = ` El capitán ${nombre} ya poseía cuenta; se le asoció como delegado de equipo en la liga.`;
    } else {
      const emailReal = (correo || `${cedula.trim()}@liga.local`).toLowerCase();
      const passwordInicial = `${nombre.split(' ')[0]}${cedula.trim().substring(0, 5)}!`;
      const hashedPwd = await bcrypt.hash(passwordInicial, 10);

      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: emailReal, password: passwordInicial, email_confirm: true,
        user_metadata: { rol: 'delegado de equipo', nombre, apellido, cedula: cedula.trim(), debe_cambiar_password: true }
      });

      if (authError) {
        const existingEmail = await db.query('SELECT id FROM public.usuarios WHERE email = $1', [emailReal]);
        if (existingEmail.rows.length > 0) {
          usuarioId = existingEmail.rows[0].id;
          mensajeResultado = ` El capitán fue asociado como delegado (el correo ya estaba registrado).`;
        } else {
          console.error('Error creando usuario en Auth para capitán:', authError);
          return null;
        }
      } else {
        usuarioId = authUser.user.id;
      }

      if (usuarioId) {
        await db.query(
          `INSERT INTO public.usuarios (id, email, rol, nombre, apellido, cedula, organizacion_id, password_hash, debe_cambiar_password) 
           VALUES ($1, $2, 'delegado de equipo', $3, $4, $5, $6, $7, true)
           ON CONFLICT (id) DO UPDATE SET rol = 'delegado de equipo'`,
          [usuarioId, emailReal, nombre, apellido, cedula.trim(), orgId, hashedPwd]
        );
        await db.query(
          `INSERT INTO public.usuario_organizaciones (usuario_id, organizacion_id, rol) VALUES ($1, $2, 'delegado de equipo')
           ON CONFLICT (usuario_id, organizacion_id) DO UPDATE SET rol = 'delegado de equipo'`,
          [usuarioId, orgId]
        );
        mensajeResultado = ` Credencial de delegado creada automáticamente. Contraseña inicial temporal: ${passwordInicial}`;
      }
    }

    if (usuarioId) {
      await db.query(`UPDATE public.equipos SET delegado_id = $1 WHERE id = $2`, [usuarioId, equipoId]);
    }
    return mensajeResultado;
  } catch (err) {
    console.error('Error en gestionarDelegadoPorCapitan:', err);
    return null;
  }
};

// ==========================================
// LOTE J: VALIDACIONES REGLAMENTARIAS Y DEPORTIVAS AL AGENDAR
// ==========================================
// Aplica en POST /torneos y POST /partidos-sueltos lo que exige la plantilla
// de reglas seleccionada (antes solo lo sugería el frontend):
//  - Quórum: cada equipo debe tener al menos limite_jugadores activos.
//  - Categorías: en torneos, cada equipo debe estar en las categorías permitidas.
// Devuelve { ok, equipos } con la fila de cada equipo (incluye capitan_id para
// el snapshot de capitanes de la tabla partidos).
const validarEquiposPartido = async (idsEquipos, reglasJson, categoriasPermitidas) => {
  const ids = [...new Set(idsEquipos.filter(Boolean))];
  const equipos = {};
  if (ids.length === 0) return { ok: true, equipos };

  const eqRes = await db.query(
    'SELECT id, nombre, categoria, tipo_genero, capitan_id, estado FROM public.equipos WHERE id::text = ANY($1::text[])',
    [ids.map(String)]
  );
  for (const fila of eqRes.rows) equipos[String(fila.id)] = fila;

  for (const idEq of ids) {
    const eq = equipos[String(idEq)];
    if (!eq || eq.estado !== 'Activo') {
      return { ok: false, error: 'Uno o más equipos indicados no existen o están inactivos.' };
    }
    if (Array.isArray(categoriasPermitidas) && categoriasPermitidas.length > 0) {
      const catEquipo = eq.categoria + ' - ' + eq.tipo_genero;
      if (!categoriasPermitidas.includes(catEquipo)) {
        return { ok: false, error: 'El equipo ' + eq.nombre + ' no pertenece a las categorías permitidas del torneo (' + catEquipo + ').' };
      }
    }
  }

  const minimo = parseInt(reglasJson && reglasJson.limite_jugadores) || 4; // mismo default que el frontend
  const nomina = await db.query(
    "SELECT equipo_id, COUNT(*) as activos FROM public.jugadores WHERE equipo_id::text = ANY($1::text[]) AND estado = 'Activo' GROUP BY equipo_id",
    [ids.map(String)]
  );
  const activos = {};
  for (const fila of nomina.rows) activos[String(fila.equipo_id)] = parseInt(fila.activos);
  for (const idEq of ids) {
    const eq = equipos[String(idEq)];
    const total = activos[String(idEq)] || 0;
    if (total < minimo) {
      return { ok: false, error: 'El equipo ' + eq.nombre + ' no cumple el quórum de la plantilla: exige ' + minimo + ' jugadores activos y solo tiene ' + total + '.' };
    }
  }

  return { ok: true, equipos };
};

// ==========================================
// LOTE P: TORNEOS FLASH (sorteo Fisher-Yates + todos contra todos)
// ==========================================
// Un torneo flash se arma en un solo paso: registro rápido de equipos y
// jugadores (opcional), sorteo aleatorio Fisher-Yates del orden, fixture
// round-robin (método del círculo) y horarios secuenciales con el intervalo
// elegido. Pensado para jornadas de un día.

// Autocompletado de personas por cédula para el formulario rápido: devuelve
// datos mínimos (nada sensible) de jugadores y usuarios ya registrados en el
// sistema, con los de la propia liga primero.
router.get('/autocomplete/cedula', async (req, res) => {
  const q = String(req.query.q || '').replace(/\D/g, '');
  if (q.length < 3) return res.json({ resultados: [] });
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const prefijo = q + '%';
    const jugadoresRes = await db.query(
      'SELECT DISTINCT j.cedula, j.nombre, j.apellido, TO_CHAR(j.fecha_nacimiento, \'YYYY-MM-DD\') AS fecha_nacimiento, j.correo, j.telefono, \'jugador\' AS origen, (e.organizacion_id = $2::uuid) AS propia FROM public.jugadores j JOIN public.equipos e ON j.equipo_id = e.id WHERE j.cedula LIKE $1 AND j.estado = \'Activo\' ORDER BY propia DESC, j.cedula ASC LIMIT 10',
      [prefijo, orgId]
    );
    const usuariosRes = await db.query(
      'SELECT u.cedula, u.nombre, u.apellido, NULL AS fecha_nacimiento, u.email AS correo, NULL AS telefono, \'usuario\' AS origen, (u.organizacion_id = $2::uuid) AS propia FROM public.usuarios u WHERE u.cedula LIKE $1 AND u.estado = \'Activo\' ORDER BY propia DESC, u.cedula ASC LIMIT 10',
      [prefijo, orgId]
    );
    const vistas = new Set();
    const resultados = [];
    for (const fila of [...jugadoresRes.rows, ...usuariosRes.rows]) {
      if (vistas.has(fila.cedula)) continue;
      vistas.add(fila.cedula);
      resultados.push({
        cedula: fila.cedula, nombre: fila.nombre, apellido: fila.apellido,
        fecha_nacimiento: fila.fecha_nacimiento, correo: fila.correo, telefono: fila.telefono,
        origen: fila.origen, de_mi_liga: fila.propia === true
      });
    }
    res.json({ resultados: resultados.slice(0, 10) });
  } catch (error) {
    console.error('Error en autocomplete de cédula:', error);
    res.status(500).json({ error: 'Error buscando personas.' });
  }
});

// POST /torneos-flash — recibe a los asistentes del día, los sortea con
// Fisher-Yates para armar los equipos (el sistema calcula cuántos), sortea
// el orden de los equipos para los cruces y genera el calendario todos
// contra todos con horarios secuenciales. Pensado para jornadas de un día.
router.post('/torneos-flash', async (req, res) => {
  const { nombre, sede_id, fecha_hora_inicio, minutos_entre_partidos, plantilla_id, arbitro_id, anotador_id, ida_y_vuelta, jugadores } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const ahoraLocalIso = obtenerHoraCaracas();

    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(fecha_hora_inicio || ''))) return res.status(400).json({ error: 'La fecha y hora de inicio tiene un formato inválido.' });
    if (fecha_hora_inicio < ahoraLocalIso) return res.status(400).json({ error: 'La fecha y hora de inicio no puede estar en el pasado.' });
    const minutos = parseInt(minutos_entre_partidos) || 45;
    if (minutos < 10 || minutos > 240) return res.status(400).json({ error: 'Los minutos entre partidos deben estar entre 10 y 240.' });

    // Sede y oficiales (opcionales): deben pertenecer a la organización.
    if (sede_id) {
      const sedeChk = await db.query('SELECT id FROM public.sedes WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2) AND estado = \'Activo\'', [sede_id, orgId]);
      if (sedeChk.rows.length === 0) return res.status(400).json({ error: 'La sede indicada no pertenece a tu organización.' });
    }
    const idsOf = [arbitro_id, anotador_id].filter(Boolean);
    if (idsOf.length > 0) {
      const ofChk = await db.query('SELECT COUNT(*) AS n FROM public.usuarios WHERE id::text = ANY($1::text[]) AND ($2::uuid IS NULL OR organizacion_id = $2 OR EXISTS (SELECT 1 FROM public.usuario_organizaciones uo WHERE uo.usuario_id = usuarios.id AND uo.organizacion_id = $2))', [idsOf.map(String), orgId]);
      if (parseInt(ofChk.rows[0].n) !== idsOf.length) return res.status(400).json({ error: 'Uno o más oficiales indicados no pertenecen a tu organización.' });
    }

    // 1. ASISTENTES: la lista de personas se arma en el momento (la cédula
    // autocompleta los datos de quien ya esté registrado en el sistema).
    if (!Array.isArray(jugadores) || jugadores.length < 4) return res.status(400).json({ error: 'Se necesitan al menos 4 asistentes para armar el torneo flash.' });
    if (jugadores.length > 48) return res.status(400).json({ error: 'Un torneo flash admite como máximo 48 asistentes.' });
    const cedulasVistas = new Set();
    for (const jug of jugadores) {
      const ced = String(jug.cedula || '').trim();
      if (!/^\d{5,8}$/.test(ced)) return res.status(400).json({ error: 'La cédula ' + (ced || 'vacía') + ' debe ser numérica de 5 a 8 dígitos.' });
      if (!String(jug.nombre || '').trim()) return res.status(400).json({ error: 'El asistente con cédula ' + ced + ' necesita su nombre.' });
      if (cedulasVistas.has(ced)) return res.status(400).json({ error: 'La cédula ' + ced + ' está repetida en la lista de asistentes.' });
      cedulasVistas.add(ced);
    }
    const totalAsistentes = jugadores.length;
    const nombrePersona = (jug) => formatearTexto(jug.nombre) + (String(jug.apellido || '').trim() ? ' ' + formatearTexto(jug.apellido) : '');

    // 2. NÚMERO DE EQUIPOS: lo calcula el sistema según los asistentes,
    // apuntando a 4 jugadores por equipo.
    const numEquipos = Math.max(2, Math.round(totalAsistentes / 4));

    // 3. SORTEO FISHER-YATES: mezcla imparcial de los asistentes; el orden
    // resultante define quién queda en cada equipo.
    const sorteo = [...jugadores];
    for (let i = sorteo.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sorteo[i], sorteo[j]] = [sorteo[j], sorteo[i]];
    }

    // 4. ARMADO DE EQUIPOS: reparto parejo (los primeros equipos reciben el
    // sobrante cuando la cuenta no es exacta). Se crean al vuelo con
    // categoría Flash y el primer jugador sorteado de cada uno queda de capitán.
    const prefijoEquipos = formatearTexto(nombre || 'Flash');
    const base = Math.floor(totalAsistentes / numEquipos);
    const sobrante = totalAsistentes % numEquipos;
    const equiposFinales = [];
    let cursor = 0;
    for (let e = 0; e < numEquipos; e++) {
      const tam = base + (e < sobrante ? 1 : 0);
      const miembros = sorteo.slice(cursor, cursor + tam);
      cursor += tam;
      const nuevoEq = await db.query(
        'INSERT INTO public.equipos (nombre, categoria, tipo_genero, organizacion_id) VALUES ($1, \'Flash\', \'Mixto\', $2) RETURNING id, nombre',
        [prefijoEquipos + ' · Equipo ' + (e + 1), orgId]
      );
      let capitanId = null;
      let dorsalAuto = 1;
      for (const jug of miembros) {
        const jugRes = await db.query(
          'INSERT INTO public.jugadores (equipo_id, cedula, nombre, apellido, fecha_nacimiento, correo, telefono, numero_dorsal, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, \'Activo\') RETURNING id',
          [nuevoEq.rows[0].id, String(jug.cedula || '').trim(), formatearTexto(jug.nombre), formatearTexto(jug.apellido), jug.fecha_nacimiento || null, jug.correo || null, jug.telefono || null, dorsalAuto++]
        );
        if (capitanId === null) capitanId = jugRes.rows[0].id;
      }
      equiposFinales.push({ id: nuevoEq.rows[0].id, nombre: nuevoEq.rows[0].nombre, capitan_id: capitanId, jugadores: miembros.map(nombrePersona) });
    }

    // 5. SORTEO DE ENFRENTAMIENTOS: segunda mezcla Fisher-Yates sobre los
    // equipos; el orden define las parejas del todos contra todos.
    const ordenEquipos = [...equiposFinales];
    for (let i = ordenEquipos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordenEquipos[i], ordenEquipos[j]] = [ordenEquipos[j], ordenEquipos[i]];
    }

    // 6. TODOS CONTRA TODOS (método del círculo). Con número impar de equipos,
    // un "LIBRE" rota para que cada jornada descanse un equipo distinto.
    const lista = [...ordenEquipos];
    if (lista.length % 2 === 1) lista.push({ id: null, nombre: 'LIBRE', capitan_id: null, jugadores: [] });
    const jornadasIda = lista.length - 1;
    const mitad = lista.length / 2;
    const rotacion = [...lista];
    const encuentros = [];
    for (let r = 0; r < jornadasIda; r++) {
      for (let i = 0; i < mitad; i++) {
        const a = rotacion[i];
        const b = rotacion[rotacion.length - 1 - i];
        if (a.id && b.id) {
          // Alterna local/visita según jornada y posición para equidad.
          const local = (r + i) % 2 === 0 ? a : b;
          const visita = local === a ? b : a;
          encuentros.push({ jornada: r + 1, local, visita });
        }
      }
      const fijo = rotacion[0];
      const resto = rotacion.slice(1);
      resto.unshift(resto.pop());
      rotacion.length = 0;
      rotacion.push(fijo, ...resto);
    }
    if (ida_y_vuelta) {
      const vuelta = encuentros.map(e => ({ jornada: e.jornada + jornadasIda, local: e.visita, visita: e.local }));
      encuentros.push(...vuelta);
    }

    // 7. HORARIOS SECUENCIALES (una cancha): un partido tras otro, sin
    // aritmética de zonas horarias (las fechas son hora de Venezuela naive).
    const [fechaStr, horaStr] = String(fecha_hora_inicio).split('T');
    const [hh, mi] = horaStr.split(':').map(Number);
    const [y, mo, da] = fechaStr.split('-').map(Number);
    const pad = (x) => String(x).padStart(2, '0');
    const fechaDeMinutos = (minutosTotales) => {
      const dias = Math.floor(minutosTotales / 1440);
      const resto = ((minutosTotales % 1440) + 1440) % 1440;
      const d = new Date(Date.UTC(y, mo - 1, da + dias));
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(Math.floor(resto / 60)) + ':' + pad(resto % 60);
    };
    const inicioMinutos = hh * 60 + mi;
    const fechasEncuentros = encuentros.map((e, idx) => fechaDeMinutos(inicioMinutos + idx * minutos));
    const fechaFin = fechasEncuentros[fechasEncuentros.length - 1].split('T')[0];

    // 8. PLANTILLA DE REGLAS (opcional en flash; por defecto reglas estándar).
    let reglasJson = { estado: 'Activo', esferas_por_equipo: 8, limite_jugadores: 4 };
    if (plantilla_id) {
      const reglaDb = await db.query('SELECT reglas FROM public.plantillas_reglas WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2 OR organizacion_id IS NULL)', [plantilla_id, orgId]);
      if (reglaDb.rows.length === 0) return res.status(400).json({ error: 'La plantilla seleccionada no existe.' });
      reglasJson = reglaDb.rows[0].reglas || reglasJson;
      reglasJson.estado = 'Activo';
    }

    const resTorneo = await db.query(
      'INSERT INTO public.torneos (organizacion_id, nombre, fecha_inicio, fecha_fin, reglas, categorias_permitidas, temporada, tipo) VALUES ($1, $2, $3, $4, $5, $6, $7, \'Flash\') RETURNING id, nombre, tipo',
      [orgId, formatearTexto(nombre || 'Torneo Flash ' + fechaStr), fechaStr, fechaFin, JSON.stringify(reglasJson), JSON.stringify([]), String(new Date().getFullYear())]
    );
    const torneoId = resTorneo.rows[0].id;

    const fixture = [];
    for (let idx = 0; idx < encuentros.length; idx++) {
      const e = encuentros[idx];
      const fase = 'Jornada ' + e.jornada;
      await db.query(
        'INSERT INTO public.partidos (torneo_id, equipo_local_id, equipo_visita_id, sede_id, arbitro_id, anotador_id, fecha_hora, fase, estado, capitan_local_id, capitan_visita_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, \'Agendado\', $9, $10)',
        [torneoId, e.local.id, e.visita.id, sede_id || null, arbitro_id || null, anotador_id || null, fechasEncuentros[idx], fase, e.local.capitan_id || null, e.visita.capitan_id || null]
      );
      fixture.push({ jornada: e.jornada, fecha_hora: fechasEncuentros[idx], local: e.local.nombre, visita: e.visita.nombre });
    }

    for (const eq of equiposFinales) {
      try { await db.query('INSERT INTO public.torneo_equipos (torneo_id, equipo_id) VALUES ($1, $2)', [torneoId, eq.id]); }
      catch (e) { console.error('No se pudo inscribir equipo en torneo_equipos:', e?.message || e); }
    }

    await notificarInvolucrados(encuentros.map((e, idx) => ({ local_id: e.local.id, visita_id: e.visita.id, arbitro_id: arbitro_id || null, anotador_id: anotador_id || null, fecha_hora: fechasEncuentros[idx], fase: 'Jornada ' + e.jornada })), orgId, req.usuario.id);

    await registrarAuditoria(req.usuario.id, 'CREAR_TORNEO_FLASH', 'torneos', null, { id: torneoId, nombre: resTorneo.rows[0].nombre, asistentes: totalAsistentes, equipos: numEquipos, partidos: encuentros.length, orden_sorteo: sorteo.map(nombrePersona) }, req.ip, orgId);

    res.status(201).json({
      mensaje: 'Torneo flash creado: ' + totalAsistentes + ' asistentes repartidos en ' + numEquipos + ' equipos, ' + encuentros.length + ' partidos agendados.',
      torneo: resTorneo.rows[0],
      sorteo: sorteo.map((p, i) => ({ posicion: i + 1, persona: nombrePersona(p) })),
      equipos: ordenEquipos.map(eq => ({ nombre: eq.nombre, jugadores: eq.jugadores })),
      fixture
    });
  } catch (error) {
    console.error('Error creando torneo flash:', error);
    res.status(500).json({ error: 'Error interno creando el torneo flash.' });
  }
});

// ==========================================
// TORNEOS Y RECURSOS
// ==========================================
router.get('/torneos', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    await suspenderPartidosPasados(orgId);
    const torneosRes = await db.query('SELECT * FROM public.torneos WHERE organizacion_id = $1 ORDER BY fecha_inicio DESC', [orgId]);
    
    const torneosConPartidos = [];
    for (let t of torneosRes.rows) {
      const partidosRes = await db.query(`
        SELECT p.*, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora, 
               el.nombre as local_nombre, ev.nombre as visita_nombre, s.nombre as sede_nombre 
        FROM public.partidos p
        LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
        LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
        LEFT JOIN public.sedes s ON p.sede_id = s.id
        WHERE p.torneo_id = $1
        ORDER BY p.fecha_hora ASC
      `, [t.id]);
      torneosConPartidos.push({ ...t, partidos: partidosRes.rows });
    }
    res.json(torneosConPartidos);
  } catch (error) { res.status(500).json({ error: 'Error al obtener torneos.' }); }
});

router.get('/torneos/recursos', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    await suspenderPartidosPasados(orgId);
const sedes = await db.query(`SELECT * FROM public.sedes WHERE organizacion_id = $1 AND estado = 'Activo'`, [orgId]);
    const arbitros = await db.query(`SELECT id, nombre, apellido FROM public.usuarios WHERE (LOWER(rol) = 'arbitro' OR LOWER(rol) = 'árbitro') AND organizacion_id = $1`, [orgId]);
    const anotadores = await db.query(`SELECT id, nombre, apellido FROM public.usuarios WHERE LOWER(rol) = 'anotador' AND organizacion_id = $1`, [orgId]);
    
    const equipos = await db.query(`
      SELECT e.id, e.nombre, e.categoria, e.tipo_genero, 
             COUNT(j.id) as total_jugadores_activos
      FROM public.equipos e
      LEFT JOIN public.jugadores j ON j.equipo_id = e.id AND j.estado = 'Activo'
WHERE e.organizacion_id = $1 AND e.estado = 'Activo'
      GROUP BY e.id, e.nombre, e.categoria, e.tipo_genero
    `, [orgId]);

    res.json({ sedes: sedes.rows, arbitros: arbitros.rows, anotadores: anotadores.rows, equipos: equipos.rows });
  } catch (e) { res.status(500).json({ error: 'Error obteniendo recursos.' }); }
});

router.post('/torneos', async (req, res) => {
  const { nombre, fecha_inicio, fecha_fin, plantilla_id, categorias_permitidas, partidos_iniciales } = req.body;
  const orgId = await obtenerOrgId(req.usuario);

  if (!nombre || !fecha_inicio || !fecha_fin || !plantilla_id || !partidos_iniciales || partidos_iniciales.length === 0) {
    return res.status(400).json({ error: 'Faltan datos obligatorios para crear el torneo o no hay partidos configurados.' });
  }

if (fecha_fin < fecha_inicio) {
    return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la fecha de inicio del torneo.' });
  }

  const hoyStr = new Date().toISOString().split('T')[0];
  if (fecha_inicio < hoyStr) {

    return res.status(400).json({ error: 'La fecha de inicio del torneo no puede ser una fecha pasada.' });
  }

  try {
    // LOTE C: validar que equipos, sedes y oficiales pertenezcan a la organización del admin.
    const idsEquiposT = [...new Set(partidos_iniciales.flatMap(p => [p.local_id, p.visita_id]).filter(Boolean))];
    const idsSedesT = [...new Set(partidos_iniciales.flatMap(p => [p.sede_id]).filter(Boolean))];
    const idsOficialesT = [...new Set(partidos_iniciales.flatMap(p => [p.arbitro_id, p.anotador_id]).filter(Boolean))];

    if (idsEquiposT.length > 0) {
const eqChk = await db.query(`SELECT COUNT(*) as n FROM public.equipos WHERE id::text = ANY($1::text[]) AND ($2::uuid IS NULL OR organizacion_id = $2) AND estado = 'Activo'`, [idsEquiposT.map(String), orgId]);
      if (parseInt(eqChk.rows[0].n) !== idsEquiposT.length) return res.status(400).json({ error: 'Uno o más equipos indicados no pertenecen a tu organización.' });
    }
    if (idsSedesT.length > 0) {
const sedeChk = await db.query(`SELECT COUNT(*) as n FROM public.sedes WHERE id::text = ANY($1::text[]) AND ($2::uuid IS NULL OR organizacion_id = $2) AND estado = 'Activo'`, [idsSedesT.map(String), orgId]);
      if (parseInt(sedeChk.rows[0].n) !== idsSedesT.length) return res.status(400).json({ error: 'Una o más sedes indicadas no pertenecen a tu organización.' });
    }
    if (idsOficialesT.length > 0) {
      const ofChk = await db.query('SELECT COUNT(*) as n FROM public.usuarios WHERE id::text = ANY($1::text[]) AND ($2::uuid IS NULL OR organizacion_id = $2 OR EXISTS (SELECT 1 FROM public.usuario_organizaciones uo WHERE uo.usuario_id = usuarios.id AND uo.organizacion_id = $2))', [idsOficialesT.map(String), orgId]);
      if (parseInt(ofChk.rows[0].n) !== idsOficialesT.length) return res.status(400).json({ error: 'Uno o más oficiales indicados no pertenecen a tu organización.' });
    }

    for (const p of partidos_iniciales) {
      // LOTE G: un partido no puede enfrentar a un equipo contra sí mismo
      if (p.local_id && String(p.local_id) === String(p.visita_id)) {
        return res.status(400).json({ error: 'Un partido no puede enfrentar a un equipo contra sí mismo.' });
      }
      if (await validarConflictos(p.fecha_hora, p.local_id, p.visita_id, p.arbitro_id, p.anotador_id)) {
        return res.status(400).json({ error: `Conflicto de Horario: Existen personas u equipos ocupados cerca de la fecha ${formatearFechaLocal(p.fecha_hora)} (±2 horas).` });
      }
    }

const reglaDb = await db.query('SELECT reglas FROM public.plantillas_reglas WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2 OR organizacion_id IS NULL)', [plantilla_id, orgId]);
    let reglasJson = reglaDb.rows.length > 0 ? reglaDb.rows[0].reglas : {};
    if (reglaDb.rows.length === 0) return res.status(400).json({ error: 'La plantilla de reglas seleccionada no existe o no pertenece a tu organización.' });
    reglasJson.estado = 'Activo';

    // LOTE J: validaciones reglamentarias y deportivas del calendario
    // (quórum de jugadores activos exigido por la plantilla + categorías permitidas del torneo).
    const valEquiposT = await validarEquiposPartido(idsEquiposT, reglasJson, categorias_permitidas);
    if (!valEquiposT.ok) return res.status(400).json({ error: valEquiposT.error });
    const equiposInfoT = valEquiposT.equipos;

    const ahoraLocalIso = obtenerHoraCaracas(); // <-- Corrección de zona horaria
    for (const p of partidos_iniciales) {
      if (!p.fecha_hora) return res.status(400).json({ error: 'Todos los partidos agendados deben tener fecha y hora.' });
      const fechaPartidoSolo = p.fecha_hora.split('T')[0];
      if (fechaPartidoSolo < fecha_inicio || fechaPartidoSolo > fecha_fin) {
        return res.status(400).json({ error: `La fecha del partido (${fechaPartidoSolo}) está fuera del rango del torneo.` });
      }
      if (p.fecha_hora < ahoraLocalIso) {
        return res.status(400).json({ error: 'No se puede programar un partido en una fecha y hora que ya pasó.' });
      }
    }

    const resTorneo = await db.query(
      `INSERT INTO public.torneos (organizacion_id, nombre, fecha_inicio, fecha_fin, reglas, categorias_permitidas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [orgId, formatearTexto(nombre), fecha_inicio, fecha_fin, JSON.stringify(reglasJson), JSON.stringify(categorias_permitidas || [])]
    );
    const torneoId = resTorneo.rows[0].id;

    for (const p of partidos_iniciales) {
      // LOTE J: snapshot de capitanes al agendar (las columnas existían sin usarse).
      const capitanLocal = p.local_id ? (equiposInfoT[String(p.local_id)]?.capitan_id || null) : null;
      const capitanVisita = p.visita_id ? (equiposInfoT[String(p.visita_id)]?.capitan_id || null) : null;
      await db.query(
        `INSERT INTO public.partidos (torneo_id, equipo_local_id, equipo_visita_id, sede_id, arbitro_id, anotador_id, fecha_hora, fase, es_local_siguiente, capitan_local_id, capitan_visita_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [torneoId, p.local_id || null, p.visita_id || null, p.sede_id, p.arbitro_id || null, p.anotador_id || null, p.fecha_hora, p.fase || 'Primera Ronda', p.es_local_siguiente ?? true, capitanLocal, capitanVisita]
      );
    }
    // LOTE J: inscribir los equipos del calendario en torneo_equipos, la tabla que
    // alimenta las posiciones (nadie la poblaba y por eso salía vacía).
    for (const idEq of idsEquiposT) {
      try {
        await db.query('INSERT INTO public.torneo_equipos (torneo_id, equipo_id) VALUES ($1, $2)', [torneoId, idEq]);
      } catch (e) { console.error('No se pudo inscribir equipo en torneo_equipos:', e?.message || e); }
    }
    await notificarInvolucrados(partidos_iniciales, orgId, req.usuario.id);
    await registrarAuditoria(req.usuario.id, 'CREAR_TORNEO', 'torneos', null, { id: torneoId, partidos: partidos_iniciales.length }, req.ip, orgId);
    res.status(201).json({ mensaje: 'Torneo y partidos agendados con éxito.' });
  } catch (error) { 
    console.error('Error creando torneo:', error);
    res.status(500).json({ error: 'Error creando torneo y partidos.' }); 
  }
});

router.put('/torneos/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, fecha_inicio, fecha_fin, estado } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const torPrevia = await db.query(`SELECT reglas FROM public.torneos WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2)`, [id, orgId]);
    if (torPrevia.rows.length === 0) return res.status(404).json({ error: 'Torneo no encontrado en tu organización.' });

    // LOTE G: validar coherencia de fechas combinando valores previos y nuevos
    const chkFechas = await db.query(`SELECT (COALESCE($1::date, fecha_inicio) > COALESCE($2::date, fecha_fin)) as invalido FROM public.torneos WHERE id = $3`, [fecha_inicio || null, fecha_fin || null, id]);
    if (chkFechas.rows.length > 0 && chkFechas.rows[0].invalido === true) {
      return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la fecha de inicio del torneo.' });
    }
    let reglasActuales = torPrevia.rows[0].reglas || {};
    if (estado) reglasActuales.estado = estado;

    const resDb = await db.query(
      `UPDATE public.torneos SET nombre = COALESCE($1, nombre), fecha_inicio = COALESCE($2, fecha_inicio), fecha_fin = COALESCE($3, fecha_fin), reglas = $4 WHERE id = $5 AND ($6::uuid IS NULL OR organizacion_id = $6) RETURNING *`,
      [nombre ? formatearTexto(nombre) : null, fecha_inicio, fecha_fin, JSON.stringify(reglasActuales), id, orgId]
    );
    await registrarAuditoria(req.usuario.id, 'EDITAR_TORNEO', 'torneos', { id: parseInt(id) }, resDb.rows[0], req.ip, orgId);
    res.json({ mensaje: 'Torneo actualizado con éxito.', torneo: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al actualizar torneo.' }); }
});

router.get('/estadisticas', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const partidosJugados = await db.query(`SELECT COUNT(*) FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id WHERE t.organizacion_id = $1 AND p.estado = 'Finalizado'`, [orgId]);
    const totalTorneos = await db.query(`SELECT COUNT(*) FROM public.torneos WHERE organizacion_id = $1`, [orgId]);
const totalEquipos = await db.query(`SELECT COUNT(*) FROM public.equipos WHERE organizacion_id = $1 AND estado = 'Activo'`, [orgId]);
const totalJugadores = await db.query(`SELECT COUNT(j.id) FROM public.jugadores j JOIN public.equipos e ON j.equipo_id = e.id WHERE e.organizacion_id = $1 AND e.estado = 'Activo' AND j.estado = 'Activo'`, [orgId]);
    const totalTarjetas = await db.query(`SELECT COUNT(tr.id) FROM public.tarjetas tr JOIN public.partidos p ON tr.partido_id = p.id JOIN public.torneos t ON p.torneo_id = t.id WHERE t.organizacion_id = $1`, [orgId]);

    const mejoresJugadores = await db.query(`
      SELECT j.nombre, j.apellido, e.nombre as equipo, COUNT(dj.id) as efectivas
      FROM public.detalle_jugadas dj
      JOIN public.jugadores j ON dj.jugador_id = j.id
      JOIN public.equipos e ON j.equipo_id = e.id
      WHERE dj.efectividad = true AND e.organizacion_id = $1
      GROUP BY j.id, j.nombre, j.apellido, e.nombre ORDER BY efectivas DESC LIMIT 5
    `, [orgId]);

    res.json({
      partidos_jugados: parseInt(partidosJugados.rows[0].count),
      total_torneos: parseInt(totalTorneos.rows[0].count),
      total_equipos: parseInt(totalEquipos.rows[0].count),
      total_jugadores: parseInt(totalJugadores.rows[0].count),
      total_tarjetas: parseInt(totalTarjetas.rows[0].count),
      mejores_jugadores: mejoresJugadores.rows
    });
  } catch (error) { res.status(500).json({ error: 'Error estadísticas.' }); }
});

// N2: agregados para las graficas del panel de estadisticas global.
router.get('/estadisticas/graficos', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);

    // Partidos finalizados por mes (ultimos 6, en orden cronologico)
    const partidosPorMes = await db.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', p.fecha_hora::timestamp), 'YYYY-MM') AS mes, COUNT(*) AS partidos
      FROM public.partidos p
      JOIN public.torneos t ON p.torneo_id = t.id
      WHERE t.organizacion_id = $1 AND p.estado = 'Finalizado'
      GROUP BY mes ORDER BY mes DESC LIMIT 6
    `, [orgId]);

    // Tarjetas por color (la tabla usa color: Amarilla / Azul / Roja)
    const tarjetasPorColor = await db.query(`
      SELECT tr.color AS color, COUNT(tr.id) AS total
      FROM public.tarjetas tr
      JOIN public.partidos p ON tr.partido_id = p.id
      JOIN public.torneos t ON p.torneo_id = t.id
      WHERE t.organizacion_id = $1
      GROUP BY tr.color ORDER BY total DESC
    `, [orgId]);

    // Victorias por equipo (Top 8) segun resultados.equipos_ganador_id
    const victoriasPorEquipo = await db.query(`
      SELECT e.nombre AS equipo, COUNT(r.id) AS victorias
      FROM public.resultados r
      JOIN public.partidos p ON r.partido_id = p.id
      JOIN public.torneos t ON p.torneo_id = t.id
      JOIN public.equipos e ON r.equipo_ganador_id = e.id
      WHERE t.organizacion_id = $1 AND r.equipo_ganador_id IS NOT NULL
      GROUP BY e.nombre ORDER BY victorias DESC LIMIT 8
    `, [orgId]);

    res.json({
      partidos_por_mes: partidosPorMes.rows.slice().reverse(),
      tarjetas_por_color: tarjetasPorColor.rows,
      victorias_por_equipo: victoriasPorEquipo.rows
    });
  } catch (error) { res.status(500).json({ error: 'Error estadisticas para graficos.' }); }
});

router.get('/partidos-finalizados', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    await suspenderPartidosPasados(orgId);
    const resultado = await db.query(`
      SELECT p.id, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora, 
             p.estado, t.nombre as torneo_nombre, el.nombre as local_nombre, ev.nombre as visita_nombre, 
             r.marcador_local, r.marcador_visita, p.equipo_local_id, p.equipo_visita_id, p.arbitro_id, p.anotador_id
      FROM public.partidos p
      JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.resultados r ON r.partido_id = p.id
      WHERE t.organizacion_id = $1 ORDER BY p.fecha_hora DESC
    `, [orgId]);
    res.json(resultado.rows);
  } catch (error) { res.status(500).json({ error: 'Error historial.' }); }
});

// ==========================================
// CONSULTAS DE POSICIONES Y ACUMULADOS
// ==========================================
router.get('/torneos/:torneo_id/posiciones', async (req, res) => {
  const { torneo_id } = req.params;
  const { grupo } = req.query;

  try {
    const orgId = await obtenerOrgId(req.usuario);
    const torneoChk = await db.query('SELECT id FROM public.torneos WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2)', [torneo_id, orgId]);
    if (torneoChk.rows.length === 0) return res.status(404).json({ error: 'Torneo no encontrado en tu organización.' });
    const query = `
      WITH ResultadosEquipos AS (
          SELECT 
              p.torneo_id,
              CASE 
                  WHEN p.equipo_local_id = r.equipo_ganador_id THEN p.equipo_local_id
                  WHEN p.equipo_visita_id = r.equipo_ganador_id THEN p.equipo_visita_id
              END AS equipo_id,
              CASE 
                  WHEN r.equipo_ganador_id IS NOT NULL THEN 3
                  ELSE 0
              END AS puntos,
              CASE 
                  WHEN p.equipo_local_id = r.equipo_ganador_id THEN (r.marcador_local - r.marcador_visita)
                  ELSE (r.marcador_visita - r.marcador_local)
              END AS diferencia_tantos
          FROM public.partidos p
          JOIN public.resultados r ON p.id = r.partido_id
          WHERE p.torneo_id = $1 AND p.estado = 'Finalizado'
      )
      SELECT 
          e.id as equipo_id,
          e.nombre as equipo_nombre,
          e.categoria,
          e.tipo_genero,
          COALESCE(SUM(re.puntos), 0) AS total_puntos,
          COALESCE(SUM(re.diferencia_tantos), 0) AS diff_tantos
      FROM public.torneo_equipos te
      JOIN public.equipos e ON te.equipo_id = e.id
      LEFT JOIN ResultadosEquipos re ON re.equipo_id = e.id
WHERE te.torneo_id = $1 AND ($2::VARCHAR IS NULL OR te.grupo = $2) AND e.estado = 'Activo'
      GROUP BY e.id, e.nombre
      ORDER BY total_puntos DESC, diff_tantos DESC;
    `;

    const resultado = await db.query(query, [torneo_id, grupo || null]);
    res.json(resultado.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al calcular la tabla de posiciones.' });
  }
});

router.get('/acumulado-temporada', async (req, res) => {
  const { temporada } = req.query;
  try {
    const organizacion_id = await obtenerOrgId(req.usuario);
    const query = `
      WITH TorneosTemporada AS (
          SELECT id FROM public.torneos WHERE organizacion_id = $1 AND temporada = $2
      ),
      TotalTorneos AS (
          SELECT COUNT(id) as total FROM TorneosTemporada
      ),
      ParticipacionEquipos AS (
          SELECT te.equipo_id, COUNT(te.torneo_id) as torneos_jugados
          FROM public.torneo_equipos te
          JOIN TorneosTemporada tt ON te.torneo_id = tt.id
          GROUP BY te.equipo_id
      ),
      PuntosAcumulados AS (
          SELECT pe.equipo_id, COALESCE(g.total_puntos, 0) as total_puntos
          FROM ParticipacionEquipos pe
          LEFT JOIN (
              SELECT r.equipo_ganador_id AS equipo_id, COUNT(*) * 3 as total_puntos
              FROM public.partidos p
              JOIN TorneosTemporada tt ON p.torneo_id = tt.id
              JOIN public.resultados r ON r.partido_id = p.id
              WHERE r.equipo_ganador_id IS NOT NULL
              GROUP BY r.equipo_ganador_id
          ) g ON g.equipo_id = pe.equipo_id
      )
      SELECT e.nombre, pa.total_puntos, pe.torneos_jugados, tt.total as total_torneos_temporada
      FROM PuntosAcumulados pa
      JOIN public.equipos e ON pa.equipo_id = e.id
      JOIN ParticipacionEquipos pe ON pa.equipo_id = pe.equipo_id
      CROSS JOIN TotalTorneos tt
      WHERE pe.torneos_jugados >= (tt.total * 0.60)
      ORDER BY pa.total_puntos DESC
      LIMIT 8;
    `;
    const resultado = await db.query(query, [organizacion_id, temporada || '2026']);
    res.json(resultado.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al procesar la acumulación de puntos.' });
  }
});


router.post('/partidos-sueltos', async (req, res) => {
  const { equipo_local_id, equipo_visita_id, sede_id, arbitro_id, anotador_id, fecha_hora, plantilla_id } = req.body;
  try {
    const ahoraLocalIso = obtenerHoraCaracas();

    if (fecha_hora < ahoraLocalIso) {
      return res.status(400).json({ error: 'No se puede programar un partido en una fecha y hora que ya pasó.' });
    }
    if (!plantilla_id) {
      return res.status(400).json({ error: 'Es obligatorio seleccionar una plantilla de reglas para el partido.' });
    }

    // LOTE G: un partido no puede enfrentar a un equipo contra sí mismo
    if (equipo_local_id && String(equipo_local_id) === String(equipo_visita_id)) {
      return res.status(400).json({ error: 'Un partido no puede enfrentar a un equipo contra sí mismo.' });
    }

    const orgId = await obtenerOrgId(req.usuario);

    // LOTE C: validar que equipos, sede y oficiales pertenezcan a la organización del admin.
    const idsEq = [equipo_local_id, equipo_visita_id].filter(Boolean);
    if (idsEq.length > 0) {
const eqChk = await db.query(`SELECT COUNT(*) as n FROM public.equipos WHERE id::text = ANY($1::text[]) AND ($2::uuid IS NULL OR organizacion_id = $2) AND estado = 'Activo'`, [idsEq.map(String), orgId]);
      if (parseInt(eqChk.rows[0].n) !== idsEq.length) return res.status(400).json({ error: 'Uno o más equipos indicados no pertenecen a tu organización.' });
    }
    if (sede_id) {
const sedeChk = await db.query(`SELECT id FROM public.sedes WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2) AND estado = 'Activo'`, [sede_id, orgId]);
      if (sedeChk.rows.length === 0) return res.status(400).json({ error: 'La sede indicada no pertenece a tu organización.' });
    }
    const idsOf = [arbitro_id, anotador_id].filter(Boolean);
    if (idsOf.length > 0) {
      const ofChk = await db.query('SELECT COUNT(*) as n FROM public.usuarios WHERE id::text = ANY($1::text[]) AND ($2::uuid IS NULL OR organizacion_id = $2 OR EXISTS (SELECT 1 FROM public.usuario_organizaciones uo WHERE uo.usuario_id = usuarios.id AND uo.organizacion_id = $2))', [idsOf.map(String), orgId]);
      if (parseInt(ofChk.rows[0].n) !== idsOf.length) return res.status(400).json({ error: 'Uno o más oficiales indicados no pertenecen a tu organización.' });
    }

    const reglaDb = await db.query('SELECT reglas FROM public.plantillas_reglas WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2 OR organizacion_id IS NULL)', [plantilla_id, orgId]);
    if (reglaDb.rows.length === 0) return res.status(400).json({ error: 'La plantilla seleccionada no existe.' });
    
    let reglasJson = reglaDb.rows[0].reglas;
    reglasJson.estado = 'Activo';

    // LOTE J: validaciones reglamentarias y deportivas del partido suelto
    // (quórum de la plantilla + misma categoría y género entre ambos equipos).
    const valEquiposS = await validarEquiposPartido(idsEq, reglasJson, null);
    if (!valEquiposS.ok) return res.status(400).json({ error: valEquiposS.error });
    const equiposInfoS = valEquiposS.equipos;
    if (equipo_local_id && equipo_visita_id) {
      const eqL = equiposInfoS[String(equipo_local_id)];
      const eqV = equiposInfoS[String(equipo_visita_id)];
      const catLocal = String(eqL?.categoria || '') + ' - ' + String(eqL?.tipo_genero || '');
      const catVisita = String(eqV?.categoria || '') + ' - ' + String(eqV?.tipo_genero || '');
      if (catLocal !== catVisita) {
        return res.status(400).json({ error: 'Partido inválido: los equipos pertenecen a categorías distintas (' + catLocal + ' vs ' + catVisita + ').' });
      }
    }

    let torneoIndep = await db.query(
      `SELECT id FROM public.torneos WHERE organizacion_id = $1 AND nombre = 'Partidos Independientes' LIMIT 1`,
      [orgId]
    );

    let torneoId;
    if (torneoIndep.rows.length === 0) {
      const fechaActual = ahoraLocalIso.split('T')[0];
      const fechaFutura = '2099-12-31';
      const temporadaActual = new Date(ahoraLocalIso).getFullYear().toString();

      const nuevoTorneo = await db.query(
        `INSERT INTO public.torneos (organizacion_id, nombre, fecha_inicio, fecha_fin, reglas, categorias_permitidas, temporada) 
         VALUES ($1, 'Partidos Independientes', $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, fechaActual, fechaFutura, JSON.stringify(reglasJson), JSON.stringify([]), temporadaActual]
      );
      torneoId = nuevoTorneo.rows[0].id;
    } else {
      torneoId = torneoIndep.rows[0].id;
      await db.query(`UPDATE public.torneos SET reglas = $1 WHERE id = $2`, [JSON.stringify(reglasJson), torneoId]);
    }

    // LOTE J: snapshot de capitanes al agendar (las columnas existían sin usarse).
    const capitanLocalS = equipo_local_id ? (equiposInfoS[String(equipo_local_id)]?.capitan_id || null) : null;
    const capitanVisitaS = equipo_visita_id ? (equiposInfoS[String(equipo_visita_id)]?.capitan_id || null) : null;
    const resDb = await db.query(
      `INSERT INTO public.partidos (torneo_id, equipo_local_id, equipo_visita_id, sede_id, arbitro_id, anotador_id, fecha_hora, fase, estado, snapshot_data, capitan_local_id, capitan_visita_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Partido Suelto', 'Agendado', $8, $9, $10) RETURNING *`,
      [torneoId, equipo_local_id, equipo_visita_id, sede_id, arbitro_id || null, anotador_id || null, fecha_hora, JSON.stringify({ reglas_especificas: reglasJson }), capitanLocalS, capitanVisitaS]
    );

    await notificarInvolucrados([resDb.rows[0]], orgId, req.usuario.id);
    await registrarAuditoria(req.usuario.id, 'CREAR_PARTIDO_SUELTO', 'partidos', null, resDb.rows[0], req.ip, orgId);
    res.status(201).json({ mensaje: 'Partido suelto agendado con éxito.', partido: resDb.rows[0] });
  } catch (error) { 
    // LOTE J: log del error real (antes se filtraba error.message al cliente).
    console.error('Error agendando partido suelto:', error);
    res.status(500).json({ error: 'Error al agendar partido suelto.' }); 
  }
});

router.put('/partidos/:id/reagendar', async (req, res) => {
  const { nueva_fecha_hora } = req.body;
  const { id } = req.params;
  try {
    const ahoraLocalIso = obtenerHoraCaracas(); // <-- Validación agregada
    if (nueva_fecha_hora < ahoraLocalIso) {
      return res.status(400).json({ error: 'No se puede reagendar el partido a una fecha y hora que ya pasó.' });
    }

    const orgId = await obtenerOrgId(req.usuario);
    const permChk = await db.query('SELECT p.id, p.estado FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id WHERE p.id = $1 AND ($2::uuid IS NULL OR t.organizacion_id = $2)', [id, orgId]);
    if (permChk.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado en tu organización.' });
    // LOTE G: no reagendar partidos finalizados o cancelados
    if (permChk.rows[0].estado === 'Finalizado' || permChk.rows[0].estado === 'Cancelado') {
      return res.status(400).json({ error: 'No se puede reagendar un partido finalizado o cancelado.' });
    }
    const partidoInfo = await db.query('SELECT equipo_local_id, equipo_visita_id, arbitro_id, anotador_id FROM public.partidos WHERE id = $1', [id]);
    const pInfo = partidoInfo.rows[0];

    if (await validarConflictos(nueva_fecha_hora, pInfo.equipo_local_id, pInfo.equipo_visita_id, pInfo.arbitro_id, pInfo.anotador_id, id)) {
      return res.status(400).json({ error: `Conflicto: No se puede reagendar. Equipos u oficiales ocupados en ese bloque horario.` });
    }

    await db.query(`UPDATE public.partidos SET fecha_hora = $1, estado = 'Agendado' WHERE id = $2`, [nueva_fecha_hora, id]);
    await registrarAuditoria(req.usuario.id, 'REAGENDAR_PARTIDO', 'partidos', { id: parseInt(id) }, { fecha_hora: nueva_fecha_hora }, req.ip, orgId);
    res.json({ mensaje: 'Partido reagendado exitosamente.' });
  } catch (error) { res.status(500).json({ error: 'Error al reagendar.' }); }
});

router.put('/partidos/:id/editar-oficiales', async (req, res) => {
  const { id } = req.params;
  const { fecha_hora, arbitro_id, anotador_id, sede_id } = req.body;
  try {
    const ahoraLocalIso = obtenerHoraCaracas(); // <-- Validación agregada
    if (fecha_hora && fecha_hora < ahoraLocalIso) {
      return res.status(400).json({ error: 'No se puede modificar la fecha del partido hacia el pasado.' });
    }

    const orgId = await obtenerOrgId(req.usuario);
    const permChk = await db.query('SELECT p.id, p.estado FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id WHERE p.id = $1 AND ($2::uuid IS NULL OR t.organizacion_id = $2)', [id, orgId]);
    if (permChk.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado en tu organización.' });
    // LOTE G: no modificar oficiales de partidos finalizados o cancelados
    if (permChk.rows[0].estado === 'Finalizado' || permChk.rows[0].estado === 'Cancelado') {
      return res.status(400).json({ error: 'No se pueden modificar los oficiales de un partido finalizado o cancelado.' });
    }
    if (sede_id) {
const sedeChk = await db.query(`SELECT id FROM public.sedes WHERE id = $1 AND ($2::uuid IS NULL OR organizacion_id = $2) AND estado = 'Activo'`, [sede_id, orgId]);
      if (sedeChk.rows.length === 0) return res.status(400).json({ error: 'La sede indicada no pertenece a tu organización.' });
    }
    const idsOf = [arbitro_id, anotador_id].filter(Boolean);
    if (idsOf.length > 0) {
      const ofChk = await db.query('SELECT COUNT(*) as n FROM public.usuarios WHERE id::text = ANY($1::text[]) AND ($2::uuid IS NULL OR organizacion_id = $2 OR EXISTS (SELECT 1 FROM public.usuario_organizaciones uo WHERE uo.usuario_id = usuarios.id AND uo.organizacion_id = $2))', [idsOf.map(String), orgId]);
      if (parseInt(ofChk.rows[0].n) !== idsOf.length) return res.status(400).json({ error: 'Uno o más oficiales indicados no pertenecen a tu organización.' });
    }
    const partidoInfo = await db.query('SELECT equipo_local_id, equipo_visita_id FROM public.partidos WHERE id = $1', [id]);
    const pInfo = partidoInfo.rows[0];

    if (await validarConflictos(fecha_hora, pInfo.equipo_local_id, pInfo.equipo_visita_id, arbitro_id, anotador_id, id)) {
      return res.status(400).json({ error: `Conflicto: Entidades ocupadas en esa nueva fecha/hora.` });
    }

    await db.query(`UPDATE public.partidos SET fecha_hora = COALESCE($1, fecha_hora), arbitro_id = $2, anotador_id = $3, sede_id = COALESCE($4, sede_id) WHERE id = $5`, [fecha_hora, arbitro_id || null, anotador_id || null, sede_id, id]);
    await registrarAuditoria(req.usuario.id, 'EDITAR_OFICIALES_PARTIDO', 'partidos', { id: parseInt(id) }, { arbitro_id: arbitro_id || null, anotador_id: anotador_id || null, sede_id: sede_id || null }, req.ip, await obtenerOrgId(req.usuario));
    res.json({ mensaje: 'Partido modificado exitosamente.' });
  } catch (error) { res.status(500).json({ error: 'Error al modificar partido.' }); }
});

router.put('/partidos/:id/cancelar', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const existe = await db.query(`SELECT p.id, p.estado FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id WHERE p.id = $1 AND ($2::uuid IS NULL OR t.organizacion_id = $2)`, [req.params.id, orgId]);
    if (existe.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado en tu organización.' });
    // LOTE G: solo se pueden cancelar partidos agendados o suspendidos
    if (existe.rows[0].estado !== 'Agendado' && existe.rows[0].estado !== 'Suspendido') {
      return res.status(400).json({ error: `No se puede cancelar el partido porque su estado actual es '${existe.rows[0].estado}'.` });
    }
    const resDb = await db.query(`UPDATE public.partidos p SET estado = 'Cancelado' FROM public.torneos t WHERE p.torneo_id = t.id AND p.id = $1 AND ($2::uuid IS NULL OR t.organizacion_id = $2) RETURNING p.id`, [req.params.id, orgId]);
    if (resDb.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado en tu organización.' });
    await registrarAuditoria(req.usuario.id, 'CANCELAR_PARTIDO', 'partidos', { id: resDb.rows[0].id }, { estado: 'Cancelado' }, req.ip, orgId);
    res.json({ mensaje: 'Partido cancelado exitosamente.' });
  } catch (error) { res.status(500).json({ error: 'Error al cancelar partido.' }); }
})

router.post('/partidos/:id/forzar-ganador', async (req, res) => {
  const { id: partidoId } = req.params;
  const { ganador_id, motivo, admin_password } = req.body;
  const adminId = req.usuario.id; 

  try {
    // LOTE C: el partido debe pertenecer a la organización del administrador.
    const orgId = await obtenerOrgId(req.usuario);
    const permChk = await db.query('SELECT p.id, p.estado, p.equipo_local_id, p.equipo_visita_id FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id WHERE p.id = $1 AND ($2::uuid IS NULL OR t.organizacion_id = $2)', [partidoId, orgId]);
    if (permChk.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado en tu organización.' });
    // LOTE G: bloquear partidos cancelados y validar que el ganador pertenezca al partido
    if (permChk.rows[0].estado === 'Cancelado') {
      return res.status(400).json({ error: 'No se puede forzar el resultado de un partido cancelado.' });
    }
    if (ganador_id) {
      const ganadorNorm = String(ganador_id).trim().toLowerCase();
      if (ganadorNorm !== String(permChk.rows[0].equipo_local_id) && ganadorNorm !== String(permChk.rows[0].equipo_visita_id)) {
        return res.status(400).json({ error: 'El equipo ganador indicado no participa en este partido.' });
      }
    }

    // 1. Obtener el hash de la contraseña del administrador desde la base de datos
    const resultAdmin = await db.query(
      'SELECT password_hash FROM public.usuarios WHERE id = $1',
      [adminId]
    );

    if (resultAdmin.rows.length === 0) {
      return res.status(404).json({ error: 'Administrador no encontrado en la base de datos.' });
    }

    const adminHash = resultAdmin.rows[0].password_hash;

    // Validación por si la plataforma se implementó 100% sobre Supabase Auth y la columna de hash está vacía.
    if (!adminHash) {
      return res.status(500).json({ error: 'Tu cuenta de administrador no tiene un Hash de seguridad configurado en la BD. Contacta a soporte o resetea tu contraseña.' });
    }

    // 2. Verificar la contraseña cruda contra el hash de la BD usando bcrypt
    const passwordValida = await bcrypt.compare(admin_password, adminHash);
    
    if (!passwordValida) {
      return res.status(401).json({ error: 'Contraseña de administrador incorrecta. Acción denegada.' });
    }

    const oficialesRes = await db.query('SELECT arbitro_id, anotador_id FROM public.partidos WHERE id = $1', [partidoId]);
    if (oficialesRes.rows.length > 0 && (!oficialesRes.rows[0].arbitro_id || !oficialesRes.rows[0].anotador_id)) {
       return res.status(400).json({ error: 'No se puede finalizar el partido: faltan oficiales asignados (Árbitro y/o Anotador).' });
    }

    await db.query(`UPDATE public.partidos SET estado = 'Finalizado' WHERE id = $1`, [partidoId]);

    // Usamos Upsert sobre la tabla resultados, que es la que tiene la columna equipo_ganador_id
    await db.query(
      `INSERT INTO public.resultados (partido_id, marcador_local, marcador_visita, equipo_ganador_id, tipo_resolucion, aprobado_por, observaciones)
       VALUES ($1, 0, 0, $2, 'Forzado por Admin', $3, $4)
       ON CONFLICT (partido_id) DO UPDATE
       SET equipo_ganador_id = $2, 
           tipo_resolucion = 'Forzado por Admin', 
           aprobado_por = $3, 
           observaciones = COALESCE(public.resultados.observaciones, '') || ' | Resultado Forzado: ' || $4`,
      [partidoId, ganador_id, adminId, motivo]
    );

    await registrarAuditoria(req.usuario.id, 'FORZAR_RESULTADO', 'resultados', { partido_id: parseInt(partidoId) }, { equipo_ganador_id: ganador_id, motivo }, req.ip, orgId);
    res.status(200).json({ mensaje: 'Resultado forzado y registrado con éxito en el sistema.' });

  } catch (error) {
    console.error('Error crítico al forzar ganador:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar la solicitud de forzado de resultado.' });
  }
});



/**
 * ========================================================
 * LOTE 3B: REPOSITORIO DE DOCUMENTOS (SUPABASE STORAGE + RLS)
 * Bucket privado "documentos", carpeta por organizacion:
 * {organizacion_id}/{uuid}.{ext}
 * ========================================================
 */
const TIPOS_DOCUMENTO = ['Reglamento', 'Convocatoria', 'Acta', 'Inscripcion', 'Comunicado', 'Otro'];

const construirUrlFirmadaDoc = async (archivoPath) => {
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
    const orgId = await obtenerOrgId(req.usuario);
    const resultado = await db.query(`
      SELECT d.id, d.titulo, d.tipo, d.torneo_id, d.archivo_path, d.tamano_bytes, d.mime_type,
             (d.organizacion_id IS NULL) AS es_global,
             TO_CHAR(d.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS creado_en,
             t.nombre AS torneo_nombre,
             TRIM(COALESCE(u.nombre || ' ' || u.apellido, u.email, '')) AS subido_por_nombre
      FROM public.documentos d
      LEFT JOIN public.torneos t ON d.torneo_id = t.id
      LEFT JOIN public.usuarios u ON d.subido_por = u.id
      WHERE (d.organizacion_id IS NULL OR d.organizacion_id = $1)
      ORDER BY d.creado_en DESC
    `, [orgId || null]);
    const documentos = await Promise.all(resultado.rows.map(async (doc) => ({
      ...doc,
      url_firmada: await construirUrlFirmadaDoc(doc.archivo_path)
    })));
    res.json({ organizacion_id: orgId, documentos });
  } catch (error) {
    console.error('Error al listar documentos:', error);
    res.status(500).json({ error: 'Error al obtener los documentos.' });
  }
});

router.post('/documentos', async (req, res) => {
  const { titulo, tipo, torneo_id, archivo_path, tamano_bytes, mime_type } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const tituloLimpio = String(titulo || '').trim();
    if (!tituloLimpio) return res.status(400).json({ error: 'El titulo del documento es obligatorio.' });
    if (tituloLimpio.length > 200) return res.status(400).json({ error: 'El titulo no puede superar los 200 caracteres.' });
    const tipoDoc = TIPOS_DOCUMENTO.includes(tipo) ? tipo : 'Otro';
    if (!archivo_path || typeof archivo_path !== 'string') return res.status(400).json({ error: 'Falta la ruta del archivo subido.' });
    const ruta = archivo_path.trim();
    if (!ruta.toLowerCase().startsWith(String(orgId).toLowerCase() + '/')) {
      return res.status(403).json({ error: 'El archivo no pertenece a la carpeta de tu organizacion.' });
    }
    const tamano = parseInt(tamano_bytes, 10);
    if (!tamano || tamano <= 0) return res.status(400).json({ error: 'Tamano de archivo invalido.' });
    if (tamano > 10 * 1024 * 1024) return res.status(400).json({ error: 'El archivo supera los 10MB permitidos.' });
    if (torneo_id) {
      const torneoChk = await db.query('SELECT id FROM public.torneos WHERE id = $1 AND organizacion_id = $2', [parseInt(torneo_id, 10), orgId]);
      if (torneoChk.rows.length === 0) return res.status(400).json({ error: 'El torneo indicado no pertenece a tu organizacion.' });
    }
    const resDb = await db.query(
      `INSERT INTO public.documentos (organizacion_id, subido_por, titulo, tipo, torneo_id, archivo_path, tamano_bytes, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [orgId, req.usuario.id, tituloLimpio, tipoDoc, torneo_id ? parseInt(torneo_id, 10) : null, ruta, tamano, mime_type || null]
    );
    await registrarAuditoria(req.usuario.id, 'CREAR_DOCUMENTO', 'documentos', null, resDb.rows[0], req.ip, orgId);
    res.status(201).json({ mensaje: 'Documento registrado con exito.', documento: resDb.rows[0] });
  } catch (error) {
    console.error('Error al registrar documento:', error);
    res.status(500).json({ error: 'Error registrando el documento.' });
  }
});

router.delete('/documentos/:id', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const chk = await db.query('SELECT * FROM public.documentos WHERE id = $1::uuid AND (organizacion_id = $2 OR organizacion_id IS NULL)', [req.params.id, orgId || null]);
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado en tu organizacion.' });
    const doc = chk.rows[0];
    if (doc.organizacion_id === null) return res.status(403).json({ error: 'Los documentos globales solo pueden eliminarse por el Superadmin.' });
    try {
      const { error: errorStorage } = await supabaseAdmin.storage.from('documentos').remove([doc.archivo_path]);
      if (errorStorage) console.error('[documentos] No se pudo borrar el objeto de Storage:', errorStorage?.message || errorStorage);
    } catch (errorStorage) {
      console.error('[documentos] No se pudo borrar el objeto de Storage:', errorStorage?.message || errorStorage);
    }
    await db.query('DELETE FROM public.documentos WHERE id = $1::uuid', [doc.id]);
    await registrarAuditoria(req.usuario.id, 'ELIMINAR_DOCUMENTO', 'documentos', doc, null, req.ip, orgId);
    res.json({ mensaje: 'Documento eliminado con exito.' });
  } catch (error) {
    console.error('Error al eliminar documento:', error);
    res.status(500).json({ error: 'Error al eliminar el documento.' });
  }
});


/**
 * ========================================================
 * LOTE 3C (N8): PAGOS DE INSCRIPCION A TORNEOS
 * Registro manual del AdminLiga: equipo y/o jugador,
 * monto, moneda (Bs./USD), metodo, referencia y nota.
 * ========================================================
 */
const MONEDAS_PAGO = ['Bs.', 'USD'];
const METODOS_PAGO = ['Efectivo', 'Pago Movil', 'Transferencia', 'Zelle', 'Otro'];

router.get('/pagos', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resultado = await db.query(`
      SELECT p.id, p.torneo_id, p.equipo_id, p.jugador_id, p.monto, p.moneda, p.metodo, p.referencia, p.nota,
             TO_CHAR(p.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS creado_en,
             t.nombre AS torneo_nombre,
             e.nombre AS equipo_nombre,
             TRIM(j.nombre || ' ' || j.apellido) AS jugador_nombre,
             TRIM(COALESCE(u.nombre || ' ' || u.apellido, u.email, '')) AS registrado_por_nombre
      FROM public.pagos p
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.equipos e ON p.equipo_id = e.id
      LEFT JOIN public.jugadores j ON p.jugador_id = j.id
      LEFT JOIN public.usuarios u ON p.registrado_por = u.id
      WHERE p.organizacion_id = $1
      ORDER BY p.creado_en DESC
    `, [orgId || null]);
    res.json({ organizacion_id: orgId, pagos: resultado.rows });
  } catch (error) {
    console.error('Error al listar pagos:', error);
    res.status(500).json({ error: 'Error al obtener los pagos de inscripcion.' });
  }
});

router.post('/pagos', async (req, res) => {
  const { torneo_id, equipo_id, jugador_id, monto, moneda, metodo, referencia, nota } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    if (!orgId) return res.status(400).json({ error: 'No se pudo determinar la organizacion.' });
    const torneoId = parseInt(torneo_id, 10);
    if (!torneoId) return res.status(400).json({ error: 'El torneo de la inscripcion es obligatorio.' });
    const torneoChk = await db.query('SELECT id FROM public.torneos WHERE id = $1 AND organizacion_id = $2', [torneoId, orgId]);
    if (torneoChk.rows.length === 0) return res.status(400).json({ error: 'El torneo indicado no pertenece a tu organizacion.' });
    const equipoId = equipo_id ? parseInt(equipo_id, 10) : null;
    const jugadorId = jugador_id ? parseInt(jugador_id, 10) : null;
    if (!equipoId && !jugadorId) return res.status(400).json({ error: 'Indica el equipo o el jugador inscrito.' });
    if (equipoId) {
      const equipoChk = await db.query('SELECT id FROM public.equipos WHERE id = $1 AND organizacion_id = $2', [equipoId, orgId]);
      if (equipoChk.rows.length === 0) return res.status(400).json({ error: 'El equipo indicado no pertenece a tu organizacion.' });
    }
    if (jugadorId) {
      const jugadorChk = await db.query(
        'SELECT j.id FROM public.jugadores j JOIN public.equipos e ON j.equipo_id = e.id WHERE j.id = $1 AND e.organizacion_id = $2',
        [jugadorId, orgId]
      );
      if (jugadorChk.rows.length === 0) return res.status(400).json({ error: 'El jugador indicado no pertenece a tu organizacion.' });
    }
    const montoNum = parseFloat(monto);
    if (!montoNum || isNaN(montoNum) || montoNum <= 0) return res.status(400).json({ error: 'El monto del pago debe ser mayor a cero.' });
    if (montoNum > 99999999.99) return res.status(400).json({ error: 'El monto supera el limite permitido.' });
    const monedaPago = MONEDAS_PAGO.includes(moneda) ? moneda : 'Bs.';
    const metodoPago = METODOS_PAGO.includes(metodo) ? metodo : 'Otro';
    const referenciaLimpia = String(referencia || '').trim().slice(0, 100) || null;
    const notaLimpia = String(nota || '').trim().slice(0, 500) || null;
    const resDb = await db.query(
      `INSERT INTO public.pagos (organizacion_id, torneo_id, equipo_id, jugador_id, monto, moneda, metodo, referencia, nota, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [orgId, torneoId, equipoId, jugadorId, montoNum, monedaPago, metodoPago, referenciaLimpia, notaLimpia, req.usuario.id]
    );
    await registrarAuditoria(req.usuario.id, 'REGISTRAR_PAGO', 'pagos', null, resDb.rows[0], req.ip, orgId);
    res.status(201).json({ mensaje: 'Pago registrado con exito.', pago: resDb.rows[0] });
  } catch (error) {
    console.error('Error al registrar pago:', error);
    res.status(500).json({ error: 'Error registrando el pago de inscripcion.' });
  }
});

router.delete('/pagos/:id', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const chk = await db.query('SELECT * FROM public.pagos WHERE id = $1::uuid AND organizacion_id = $2', [req.params.id, orgId || null]);
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Pago no encontrado en tu organizacion.' });
    const pago = chk.rows[0];
    await db.query('DELETE FROM public.pagos WHERE id = $1::uuid', [pago.id]);
    await registrarAuditoria(req.usuario.id, 'ELIMINAR_PAGO', 'pagos', pago, null, req.ip, orgId);
    res.json({ mensaje: 'Pago eliminado con exito.' });
  } catch (error) {
    console.error('Error al eliminar pago:', error);
    res.status(500).json({ error: 'Error al eliminar el pago.' });
  }
});

module.exports = router;
