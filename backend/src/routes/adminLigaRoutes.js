const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt'); // IMPORTACIÓN AÑADIDA PARA VALIDACIÓN DE ADMIN
const { createClient } = require('@supabase/supabase-js');
const { verificarToken, autorizarRoles } = require('../middleware/authMiddleware');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const registrarAuditoria = async (usuarioId, accion, tabla, valoresPrevios = null, nuevosValores = null, ip = null) => {
  try {
    await db.query(
      `INSERT INTO public.audit_logs (usuario_id, accion, tabla, valores_previos, nuevos_valores, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuarioId, accion, tabla, valoresPrevios ? JSON.stringify(valoresPrevios) : null, nuevosValores ? JSON.stringify(nuevosValores) : null, ip]
    );
  } catch (error) {}
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

// NUEVA FUNCIÓN PARA SUSPENDER AUTOMÁTICAMENTE PARTIDOS PASADOS SIN INICIAR
const suspenderPartidosPasados = async (orgId) => {
  try {
    await db.query(`
      UPDATE public.partidos p
      SET estado = 'Suspendido'
      FROM public.torneos t
      WHERE p.torneo_id = t.id 
      AND t.organizacion_id = $1 
      AND p.estado = 'Agendado' 
      AND p.fecha_hora::timestamp < CURRENT_TIMESTAMP
    `, [orgId]);
  } catch (error) { console.error('Error al auto-suspender partidos:', error); }
};

router.use(verificarToken, autorizarRoles('Administrador de Liga', 'Superadmin'));

router.put('/mi-organizacion/logo', async (req, res) => {
  const { logo_url } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    await db.query(`UPDATE public.organizaciones SET logo_url = $1 WHERE id = $2`, [logo_url, orgId]);
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

      const msj = `Has sido programado para un encuentro el ${new Date(p.fecha_hora).toLocaleString('es-VE')}. Fase: ${p.fase || 'Regular'}`;
      
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
    const resultado = await db.query('SELECT * FROM public.sedes WHERE organizacion_id = $1 ORDER BY nombre ASC', [orgId]);
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
    await registrarAuditoria(req.usuario.id, 'CREAR_SEDE', 'sedes', null, resDb.rows[0], req.ip);
    res.status(201).json({ mensaje: 'Sede registrada con éxito.', sede: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error registrando sede.' }); }
});

router.put('/sedes/:id', async (req, res) => {
  const { nombre, direccion } = req.body;
  try {
    const resDb = await db.query(
      `UPDATE public.sedes SET nombre = $1, direccion = $2 WHERE id = $3 RETURNING *`,
      [formatearTexto(nombre), direccion ? direccion.trim() : null, req.params.id]
    );
    await registrarAuditoria(req.usuario.id, 'EDITAR_SEDE', 'sedes', null, resDb.rows[0], req.ip);
    res.json({ mensaje: 'Sede actualizada con éxito.', sede: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al actualizar sede.' }); }
});

router.delete('/sedes/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM public.sedes WHERE id = $1', [req.params.id]);
    await registrarAuditoria(req.usuario.id, 'ELIMINAR_SEDE', 'sedes', { id: req.params.id }, null, req.ip);
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
       WHERE e.organizacion_id = $1 OR $1 IS NULL
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

    // 2. Si no tiene partidos, procedemos a limpiar sus dependencias
    await db.query('DELETE FROM public.jugadores WHERE equipo_id = $1', [equipoId]);
    await db.query('DELETE FROM public.torneo_equipos WHERE equipo_id = $1', [equipoId]);
    
    // 3. Finalmente eliminamos el equipo
    await db.query('DELETE FROM public.equipos WHERE id = $1 AND organizacion_id = $2', [equipoId, orgId]);

    res.json({ mensaje: 'Equipo y su nómina han sido eliminados con éxito.' });
  } catch (error) {
    console.error('Error al eliminar equipo:', error);
    res.status(500).json({ error: 'Error al intentar eliminar el equipo.' });
  }
});

router.get('/equipos/:equipo_id/jugadores', async (req, res) => {
  try {
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
  if (isNaN(dorsalNum) || dorsalNum <= 0) {
    return res.status(400).json({ error: 'El número dorsal debe ser un número entero positivo.' });
  }
  try {
    const orgId = await obtenerOrgId(req.usuario);
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
    res.status(201).json({ mensaje: `Jugador registrado.${mensajeDelegado || ''}`, jugador: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al registrar el jugador.' }); }
});

router.post('/jugadores/batch-fotos', async (req, res) => {
  const { batch, equipo_id } = req.body; 
  try {
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
    const jugadorPrevio = await db.query('SELECT equipo_id FROM public.jugadores WHERE id = $1', [id]);
    if (jugadorPrevio.rows.length === 0) return res.status(404).json({ error: 'Jugador no encontrado.' });
    
    const equipoId = jugadorPrevio.rows[0].equipo_id;
    
    if (numero_dorsal) {
      const dorsalNum = parseInt(numero_dorsal);
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
    res.json({ mensaje: `Jugador y capitanía actualizados con éxito.${mensajeDelegado || ''}`, jugador: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error actualizando jugador.' }); }
});

router.put('/jugadores/:id/estado', async (req, res) => {
  const { estado, nuevo_capitan_id, equipo_id } = req.body;
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const resDb = await db.query(`UPDATE public.jugadores SET estado = $1 WHERE id = $2 RETURNING *`, [estado, req.params.id]);
    
    let mensajeDelegado = '';
    if (nuevo_capitan_id && equipo_id) {
      await db.query(`UPDATE public.equipos SET capitan_id = $1 WHERE id = $2`, [nuevo_capitan_id, equipo_id]);
      mensajeDelegado = await gestionarDelegadoPorCapitan(equipo_id, nuevo_capitan_id, orgId);
    }
    
    res.json({ mensaje: `Jugador ${estado.toLowerCase()} con éxito.${mensajeDelegado || ''}`, jugador: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al cambiar estado del jugador.' }); }
});

// ==========================================
// CREDENCIALES Y USUARIOS OPERATIVOS
// ==========================================
// Ruta para verificar si la cédula ya existe en todo el sistema
router.get('/verificar-cedula/:cedula', async (req, res) => {
  try {
    const user = await db.query('SELECT id, nombre, apellido, email FROM public.usuarios WHERE cedula = $1', [req.params.cedula]);
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

  try {
    const existe = await db.query('SELECT id FROM public.usuarios WHERE cedula = $1', [cedula.trim()]);
    
    if (existe.rows.length > 0) {
      const usuarioId = existe.rows[0].id;
      await db.query(
        `INSERT INTO public.usuario_organizaciones (usuario_id, organizacion_id, rol) VALUES ($1, $2, $3) 
         ON CONFLICT (usuario_id, organizacion_id) DO UPDATE SET rol = $3`,
        [usuarioId, orgId, rol]
      );
      if (rol.toLowerCase() === 'delegado de equipo' && equipo_id) {
        await db.query(`UPDATE public.equipos SET delegado_id = $1 WHERE id = $2`, [usuarioId, equipo_id]);
      }
      return res.status(200).json({ mensaje: 'El usuario ya existía y ha sido asociado a tu liga exitosamente.' });
    }

    const nombreFmt = formatearTexto(nombre);
    const apellidoFmt = formatearTexto(apellido);
    const emailReal = email.trim().toLowerCase();
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
      await db.query(`UPDATE public.equipos SET delegado_id = $1 WHERE id = $2`, [authUser.user.id, equipo_id]);
    }

    res.status(201).json({ mensaje: `Credencial creada con éxito. Clave temporal: ${passwordInicial}` });
  } catch (error) { res.status(500).json({ error: 'Error registrando credencial.' }); }
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
        error: `⚠️ Acción denegada: Un equipo nunca puede quedar sin delegado. Este usuario es el delegado actual del/los equipo(s): [${nombresEquipos}]. Debe asignar otro delegado a dicho(s) equipo(s) antes de poder eliminar sus credenciales.` 
      });
    }
    
    await db.query('DELETE FROM public.usuario_organizaciones WHERE usuario_id = $1 AND organizacion_id = $2', [usuarioId, orgId]);
    
    const ligasRestantes = await db.query('SELECT count(*) FROM public.usuario_organizaciones WHERE usuario_id = $1', [usuarioId]);
    
    if (parseInt(ligasRestantes.rows[0].count) === 0) {
      await db.query('DELETE FROM public.usuarios WHERE id = $1', [usuarioId]);
      await supabaseAdmin.auth.admin.deleteUser(usuarioId);
      return res.json({ mensaje: 'Credencial eliminada permanentemente (el usuario no pertenecía a ninguna otra liga).' });
    }
    
    res.json({ mensaje: 'Acceso revocado para tu liga con éxito. (El usuario conserva sus credenciales en sus otras ligas).' });
  } catch (error) { 
    console.error('Error al remover credencial:', error);
    res.status(500).json({ error: 'Error al remover credencial.' }); 
  }
});

router.post('/usuarios/:id/reset-password', async (req, res) => {
  try {
    const userDb = await db.query('SELECT email, cedula, nombre FROM public.usuarios WHERE id = $1', [req.params.id]);
    if (userDb.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
    
    const { cedula, nombre } = userDb.rows[0];
    const primerNombre = nombre ? nombre.trim().split(' ')[0] : 'User';
    const nuevaPassword = `${primerNombre}${cedula.trim().substring(0, 5)}!`;
    
    const hashedPwd = await bcrypt.hash(nuevaPassword, 10);

    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
      password: nuevaPassword, user_metadata: { debe_cambiar_password: true }
    });
    if (error) return res.status(400).json({ error: error.message });
    
    await db.query('UPDATE public.usuarios SET debe_cambiar_password = true, password_hash = $2 WHERE id = $1', [req.params.id, hashedPwd]);
    res.json({ mensaje: `Contraseña restablecida. Nueva clave temporal: ${nuevaPassword}` });
  } catch (error) { res.status(500).json({ error: 'Error al restablecer contraseña.' }); }
});

router.put('/equipos/:id/delegado', async (req, res) => {
  const { delegado_id } = req.body;
  try {
    await db.query(`UPDATE public.equipos SET delegado_id = $1 WHERE id = $2`, [delegado_id, req.params.id]);
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
    const resDb = await db.query(
      `INSERT INTO public.plantillas_reglas (organizacion_id, nombre, descripcion, reglas) VALUES ($1, $2, $3, $4) RETURNING *`,
      [orgId, formatearTexto(nombre), descripcion ? descripcion.trim() : null, JSON.stringify(reglas)]
    );
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
        mensajeResultado = ` 🔑 Credencial de delegado creada automáticamente. Contraseña inicial temporal: ${passwordInicial}`;
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
        SELECT p.*, el.nombre as local_nombre, ev.nombre as visita_nombre, s.nombre as sede_nombre 
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
    const sedes = await db.query('SELECT * FROM public.sedes WHERE organizacion_id = $1', [orgId]);
    const arbitros = await db.query(`SELECT id, nombre, apellido FROM public.usuarios WHERE (LOWER(rol) = 'arbitro' OR LOWER(rol) = 'árbitro') AND organizacion_id = $1`, [orgId]);
    const anotadores = await db.query(`SELECT id, nombre, apellido FROM public.usuarios WHERE LOWER(rol) = 'anotador' AND organizacion_id = $1`, [orgId]);
    
    const equipos = await db.query(`
      SELECT e.id, e.nombre, e.categoria, e.tipo_genero, 
             COUNT(j.id) as total_jugadores_activos
      FROM public.equipos e
      LEFT JOIN public.jugadores j ON j.equipo_id = e.id AND j.estado = 'Activo'
      WHERE e.organizacion_id = $1
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

  const hoyStr = new Date().toISOString().split('T')[0];
  if (fecha_inicio < hoyStr) {
    return res.status(400).json({ error: 'La fecha de inicio del torneo no puede ser una fecha pasada.' });
  }

  try {

    for (const p of partidos_iniciales) {
      if (await validarConflictos(p.fecha_hora, p.local_id, p.visita_id, p.arbitro_id, p.anotador_id)) {
        return res.status(400).json({ error: `Conflicto de Horario: Existen personas u equipos ocupados cerca de la fecha ${new Date(p.fecha_hora).toLocaleString()} (±2 horas).` });
      }
    }

    const reglaDb = await db.query('SELECT reglas FROM public.plantillas_reglas WHERE id = $1', [plantilla_id]);
    let reglasJson = reglaDb.rows.length > 0 ? reglaDb.rows[0].reglas : {};
    reglasJson.estado = 'Activo';

    const ahoraIso = new Date().toISOString();
    for (const p of partidos_iniciales) {
      if (!p.fecha_hora) return res.status(400).json({ error: 'Todos los partidos agendados deben tener fecha y hora.' });
      const fechaPartidoSolo = p.fecha_hora.split('T')[0];
      if (fechaPartidoSolo < fecha_inicio || fechaPartidoSolo > fecha_fin) {
        return res.status(400).json({ error: `La fecha del partido (${fechaPartidoSolo}) está fuera del rango del torneo.` });
      }
      if (p.fecha_hora < ahoraIso) {
        return res.status(400).json({ error: 'No se puede programar un partido en una fecha y hora que ya pasó.' });
      }
    }

    const resTorneo = await db.query(
      `INSERT INTO public.torneos (organizacion_id, nombre, fecha_inicio, fecha_fin, reglas, categorias_permitidas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [orgId, formatearTexto(nombre), fecha_inicio, fecha_fin, JSON.stringify(reglasJson), JSON.stringify(categorias_permitidas || [])]
    );
    const torneoId = resTorneo.rows[0].id;

    for (const p of partidos_iniciales) {
      await db.query(
        `INSERT INTO public.partidos (torneo_id, equipo_local_id, equipo_visita_id, sede_id, arbitro_id, anotador_id, fecha_hora, fase, es_local_siguiente) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [torneoId, p.local_id || null, p.visita_id || null, p.sede_id, p.arbitro_id || null, p.anotador_id || null, p.fecha_hora, p.fase || 'Primera Ronda', p.es_local_siguiente ?? true]
      );
    }
    await notificarInvolucrados(partidos_iniciales, orgId, req.usuario.id);
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
    const torPrevia = await db.query('SELECT reglas FROM public.torneos WHERE id = $1', [id]);
    if (torPrevia.rows.length === 0) return res.status(404).json({ error: 'Torneo no encontrado.' });

    let reglasActuales = torPrevia.rows[0].reglas || {};
    if (estado) reglasActuales.estado = estado;

    const resDb = await db.query(
      `UPDATE public.torneos SET nombre = COALESCE($1, nombre), fecha_inicio = COALESCE($2, fecha_inicio), fecha_fin = COALESCE($3, fecha_fin), reglas = $4 WHERE id = $5 RETURNING *`,
      [nombre ? formatearTexto(nombre) : null, fecha_inicio, fecha_fin, JSON.stringify(reglasActuales), id]
    );
    res.json({ mensaje: 'Torneo actualizado con éxito.', torneo: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al actualizar torneo.' }); }
});

router.get('/estadisticas', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    const partidosJugados = await db.query(`SELECT COUNT(*) FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id WHERE t.organizacion_id = $1 AND p.estado = 'Finalizado'`, [orgId]);
    const totalTorneos = await db.query(`SELECT COUNT(*) FROM public.torneos WHERE organizacion_id = $1`, [orgId]);
    const totalEquipos = await db.query(`SELECT COUNT(*) FROM public.equipos WHERE organizacion_id = $1`, [orgId]);
    const totalJugadores = await db.query(`SELECT COUNT(j.id) FROM public.jugadores j JOIN public.equipos e ON j.equipo_id = e.id WHERE e.organizacion_id = $1 AND j.estado = 'Activo'`, [orgId]);
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

router.get('/partidos-finalizados', async (req, res) => {
  try {
    const orgId = await obtenerOrgId(req.usuario);
    await suspenderPartidosPasados(orgId);
    const resultado = await db.query(`
      SELECT p.id, p.fecha_hora, p.estado, t.nombre as torneo_nombre, el.nombre as local_nombre, ev.nombre as visita_nombre, r.marcador_local, r.marcador_visita, p.equipo_local_id, p.equipo_visita_id, p.arbitro_id, p.anotador_id
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
      WHERE te.torneo_id = $1 AND ($2::VARCHAR IS NULL OR te.grupo = $2)
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
  const { organizacion_id, temporada } = req.query;
  try {
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
          SELECT pe.equipo_id, SUM(COALESCE(te.puntos_obtenidos, 0)) as total_puntos
          FROM ParticipacionEquipos pe
          JOIN public.torneo_equipos te ON pe.equipo_id = te.equipo_id
          JOIN TorneosTemporada tt ON te.torneo_id = tt.id
          GROUP BY pe.equipo_id
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
  const { equipo_local_id, equipo_visita_id, sede_id, arbitro_id, anotador_id, fecha_hora } = req.body;
  try {
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');
    const hora = String(ahora.getHours()).padStart(2, '0');
    const minuto = String(ahora.getMinutes()).padStart(2, '0');
    const ahoraLocalIso = `${anio}-${mes}-${dia}T${hora}:${minuto}`;

    if (fecha_hora < ahoraLocalIso) {
      return res.status(400).json({ error: 'No se puede programar un partido en una fecha y hora que ya pasó.' });
    }

    const orgId = await obtenerOrgId(req.usuario);

    let torneoIndep = await db.query(
      `SELECT id FROM public.torneos WHERE organizacion_id = $1 AND nombre = 'Partidos Independientes' LIMIT 1`,
      [orgId]
    );

    let torneoId;
    if (torneoIndep.rows.length === 0) {
      const fechaActual = new Date().toISOString().split('T')[0];
      const fechaFutura = '2099-12-31';
      const temporadaActual = '2026';

      const nuevoTorneo = await db.query(
        `INSERT INTO public.torneos (organizacion_id, nombre, fecha_inicio, fecha_fin, reglas, categorias_permitidas, temporada) 
         VALUES ($1, 'Partidos Independientes', $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, fechaActual, fechaFutura, JSON.stringify({ estado: 'Activo' }), JSON.stringify([]), temporadaActual]
      );
      torneoId = nuevoTorneo.rows[0].id;
    } else {
      torneoId = torneoIndep.rows[0].id;
    }

    const resDb = await db.query(
      `INSERT INTO public.partidos (torneo_id, equipo_local_id, equipo_visita_id, sede_id, arbitro_id, anotador_id, fecha_hora, fase, estado) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Partido Suelto', 'Agendado') RETURNING *`,
      [torneoId, equipo_local_id, equipo_visita_id, sede_id, arbitro_id || null, anotador_id || null, fecha_hora]
    );

    await notificarInvolucrados([resDb.rows[0]], orgId, req.usuario.id);
    res.status(201).json({ mensaje: 'Partido suelto agendado con éxito.', partido: resDb.rows[0] });
  } catch (error) { 
    res.status(500).json({ error: error.message || 'Error al agendar partido suelto.' }); 
  }
});

router.put('/partidos/:id/reagendar', async (req, res) => {
  const { nueva_fecha_hora } = req.body;
  const { id } = req.params;
  try {
    const partidoInfo = await db.query('SELECT equipo_local_id, equipo_visita_id, arbitro_id, anotador_id FROM public.partidos WHERE id = $1', [id]);
    const pInfo = partidoInfo.rows[0];

    if (await validarConflictos(nueva_fecha_hora, pInfo.equipo_local_id, pInfo.equipo_visita_id, pInfo.arbitro_id, pInfo.anotador_id, id)) {
      return res.status(400).json({ error: `Conflicto: No se puede reagendar. Equipos u oficiales ocupados en ese bloque horario.` });
    }

    await db.query(`UPDATE public.partidos SET fecha_hora = $1, estado = 'Agendado' WHERE id = $2`, [nueva_fecha_hora, id]);
    res.json({ mensaje: 'Partido reagendado exitosamente.' });
  } catch (error) { res.status(500).json({ error: 'Error al reagendar.' }); }
});

router.put('/partidos/:id/editar-oficiales', async (req, res) => {
  const { id } = req.params;
  const { fecha_hora, arbitro_id, anotador_id, sede_id } = req.body;
  try {
    const partidoInfo = await db.query('SELECT equipo_local_id, equipo_visita_id FROM public.partidos WHERE id = $1', [id]);
    const pInfo = partidoInfo.rows[0];

    if (await validarConflictos(fecha_hora, pInfo.equipo_local_id, pInfo.equipo_visita_id, arbitro_id, anotador_id, id)) {
      return res.status(400).json({ error: `Conflicto: Entidades ocupadas en esa nueva fecha/hora.` });
    }

    await db.query(`UPDATE public.partidos SET fecha_hora = COALESCE($1, fecha_hora), arbitro_id = $2, anotador_id = $3, sede_id = COALESCE($4, sede_id) WHERE id = $5`, [fecha_hora, arbitro_id || null, anotador_id || null, sede_id, id]);
    res.json({ mensaje: 'Partido modificado exitosamente.' });
  } catch (error) { res.status(500).json({ error: 'Error al modificar partido.' }); }
});

router.put('/partidos/:id/cancelar', async (req, res) => {
  try {
    await db.query(`UPDATE public.partidos SET estado = 'Cancelado' WHERE id = $1`, [req.params.id]);
    res.json({ mensaje: 'Partido cancelado exitosamente.' });
  } catch (error) { res.status(500).json({ error: 'Error al cancelar partido.' }); }
})

router.post('/partidos/:id/forzar-ganador', async (req, res) => {
  const { id: partidoId } = req.params;
  const { ganador_id, motivo, admin_password } = req.body;
  const adminId = req.usuario.id; 

  try {
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

    // 3. Si la contraseña es válida, procedemos a forzar el resultado
    // Primero garantizamos que el partido figure como finalizado.
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

    res.status(200).json({ mensaje: 'Resultado forzado y registrado con éxito en el sistema.' });

  } catch (error) {
    console.error('Error crítico al forzar ganador:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar la solicitud de forzado de resultado.' });
  }
});


module.exports = router;