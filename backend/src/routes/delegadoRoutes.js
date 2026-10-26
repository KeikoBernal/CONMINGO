const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarToken, autorizarRoles } = require('../middleware/authMiddleware');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = require('../config/supabaseAdmin'); // FIX #8: sin fallback silencioso a la anon key

// LOTE O: TRAZABILIDAD — bitácora de acciones del delegado
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

// Proteger todas las rutas de este archivo para que solo los Delegados y Superadmin accedan
router.use(verificarToken, autorizarRoles('Delegado de Equipo', 'Superadmin'));

/**
 * ========================================================
 * 0. CAMBIO DE CONTRASEÑA PROPIA DEL DELEGADO
 * ========================================================
 */
router.post('/cambiar-password-propio', async (req, res) => {
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

    const saltRounds = 10;
    const hashedPwd = await bcrypt.hash(nueva_password, saltRounds);

    await db.query(
      'UPDATE public.usuarios SET password_hash = $1, debe_cambiar_password = false WHERE id = $2::uuid',
      [hashedPwd, req.usuario.id]
    );

    await registrarAuditoria(req.usuario.id, 'CAMBIAR_PASSWORD_PROPIO', 'usuarios', null, { id: req.usuario.id }, req.ip, req.usuario?.organizacion_id || null);
    res.json({ mensaje: 'Contraseña actualizada con éxito.' });
  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ error: 'Error interno al cambiar la contraseña.' });
  }
});

/**
 * ========================================================
 * 1. OBTENER CALENDARIO DE PARTIDOS DEL EQUIPO
 * ========================================================
 */
router.get('/mis-partidos', async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const equipoRes = await db.query(`SELECT id FROM public.equipos WHERE delegado_id = $1::uuid`, [usuarioId]);
    if (equipoRes.rows.length === 0) return res.json([]);
    const equipoId = equipoRes.rows[0].id;

    const partidosRes = await db.query(`
      SELECT 
        p.id, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora, p.estado, p.fase, 
        el.nombre as local_nombre, ev.nombre as visita_nombre, 
        s.nombre as sede_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      WHERE (p.equipo_local_id = $1 OR p.equipo_visita_id = $1)
      ORDER BY p.fecha_hora ASC
    `, [equipoId]);

    res.json(partidosRes.rows);
  } catch (error) {
    console.error('Error al obtener partidos del delegado:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

/**
 * ========================================================
 * 2. OBTENER PLANILLA Y PUNTAJES DE UN PARTIDO ESPECÍFICO
 * ========================================================
 */
router.get('/partidos/:id/planilla', async (req, res) => {
  try {
    const partidoId = req.params.id;
    const usuarioId = req.usuario.id;

    const equipoRes = await db.query(`SELECT id FROM public.equipos WHERE delegado_id = $1::uuid`, [usuarioId]);
    if (equipoRes.rows.length === 0) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    const equipoId = equipoRes.rows[0].id;

    const partidoRes = await db.query(`
      SELECT p.*, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora,
             el.nombre AS local_nombre, ev.nombre AS visita_nombre,
             s.nombre AS sede_nombre,
             COALESCE(ua.nombre || ' ' || ua.apellido, 'Por definir') AS arbitro_nombre,
             COALESCE(un.nombre || ' ' || un.apellido, 'Por definir') AS anotador_nombre,
             COALESCE(jl.nombre || ' ' || jl.apellido, 'Por definir') AS capitan_local_nombre,
             COALESCE(jv.nombre || ' ' || jv.apellido, 'Por definir') AS capitan_visita_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      LEFT JOIN public.usuarios ua ON p.arbitro_id = ua.id
      LEFT JOIN public.usuarios un ON p.anotador_id = un.id
      LEFT JOIN public.jugadores jl ON el.capitan_id = jl.id AND jl.estado = 'Activo'
      LEFT JOIN public.jugadores jv ON ev.capitan_id = jv.id AND jv.estado = 'Activo'
      WHERE p.id = $1 AND (p.equipo_local_id = $2 OR p.equipo_visita_id = $2)
    `, [partidoId, equipoId]);

    if (partidoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Partido no encontrado o no autorizado para este equipo.' });
    }
    const partido = partidoRes.rows[0];

    const estadosValidos = ['agendado', 'en curso', 'finalizado'];
    if (!estadosValidos.includes((partido.estado || '').toLowerCase())) {
      return res.status(400).json({ error: `No se pueden consultar detalles. El partido se encuentra en estado: ${partido.estado}` });
    }

    const nominaRes = await db.query(`
      SELECT j.*, e.nombre AS equipo_nombre
      FROM public.jugadores j
      JOIN public.equipos e ON j.equipo_id = e.id
      WHERE j.equipo_id = $1 OR j.equipo_id = $2
    `, [partido.equipo_local_id, partido.equipo_visita_id]);

    const manosRes = await db.query(`
      SELECT * FROM public.manos WHERE partido_id = $1 ORDER BY numero_mano ASC
    `, [partidoId]);

    const detalleRes = await db.query(`
      SELECT dj.*, m.numero_mano 
      FROM public.detalle_jugadas dj
      JOIN public.manos m ON dj.mano_id = m.id
      WHERE m.partido_id = $1
    `, [partidoId]);

    const efectividadJugadores = {};
    detalleRes.rows.forEach(dj => {
      if (!efectividadJugadores[dj.jugador_id]) efectividadJugadores[dj.jugador_id] = {};
      const manoIdx = (dj.numero_mano || 1) - 1;
      let val = dj.tipo_destreza;
      if (val && typeof val === 'string') {
        val = dj.efectividad ? val.toUpperCase() : val.toLowerCase();
      }
      efectividadJugadores[dj.jugador_id][manoIdx] = {
        valor: val,
        estado: 'validado'
      };
    });

    const puntosPorManoLocal = Array(20).fill('');
    const puntosPorManoVisita = Array(20).fill('');

    manosRes.rows.forEach(mano => {
      const manoIdx = (mano.numero_mano || 1) - 1;
      if (manoIdx >= 0 && manoIdx < 20) {
        if (mano.equipo_ganador_id === partido.equipo_local_id) {
          puntosPorManoLocal[manoIdx] = mano.tantos_anotados;
          puntosPorManoVisita[manoIdx] = 0;
        } else if (mano.equipo_ganador_id === partido.equipo_visita_id) {
          puntosPorManoVisita[manoIdx] = mano.tantos_anotados;
          puntosPorManoLocal[manoIdx] = 0;
        }
      }
    });

    res.json({
      partido,
      nomina: nominaRes.rows,
      efectividadJugadores,
      puntosPorManoLocal,
      puntosPorManoVisita,
      manualStats: {}
    });
  } catch (error) {
    console.error('Error al obtener planilla del partido para delegado:', error);
    res.status(500).json({ error: 'Error al obtener la planilla del partido.' });
  }
});

/**
 * ========================================================
 * 3. OBTENER NÓMINA Y ESTADÍSTICAS (SCOUTING) DEL EQUIPO
 * ========================================================
 */
router.get('/mi-equipo', async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const equipoRes = await db.query(`SELECT id, nombre, categoria, tipo_genero FROM public.equipos WHERE delegado_id = $1::uuid`, [usuarioId]);
    
    if (equipoRes.rows.length === 0) {
      return res.status(404).json({ error: 'No tienes ningún equipo asignado actualmente.' });
    }
    const equipo = equipoRes.rows[0];

    const jugadoresRes = await db.query(`
      SELECT id, numero_dorsal, nombre, apellido, cedula, estado, foto_url,
             (id = (SELECT capitan_id FROM public.equipos WHERE id = $1)) as es_capitan
      FROM public.jugadores 
      WHERE equipo_id = $1 
      ORDER BY numero_dorsal ASC
    `, [equipo.id]);
    const jugadores = jugadoresRes.rows;

    const statsIndRes = await db.query(`
      SELECT 
        j.id,
        j.numero_dorsal as dorsal,
        j.nombre,
        j.apellido,
        COUNT(dj.id) as total_jugadas,
        SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'a' AND dj.efectividad = true THEN 1 ELSE 0 END) as arrimes_buenos,
        SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'a' AND dj.efectividad = false THEN 1 ELSE 0 END) as arrimes_malos,
        SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'b' AND dj.efectividad = true THEN 1 ELSE 0 END) as boches_buenos,
        SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'b' AND dj.efectividad = false THEN 1 ELSE 0 END) as boches_malos,
        SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'n' THEN 1 ELSE 0 END) as nulos_generales
      FROM public.jugadores j
      LEFT JOIN public.manos m ON m.partido_id IN (SELECT id FROM public.partidos WHERE equipo_local_id = $1 OR equipo_visita_id = $1)
      LEFT JOIN public.detalle_jugadas dj ON j.id = dj.jugador_id AND dj.mano_id = m.id
      WHERE j.equipo_id = $1
      GROUP BY j.id, j.numero_dorsal, j.nombre, j.apellido
      ORDER BY j.numero_dorsal ASC
    `, [equipo.id]);
    
    const estadisticasIndividuales = statsIndRes.rows.map(j => {
      const totalArrimes = parseInt(j.arrimes_buenos) + parseInt(j.arrimes_malos);
      const totalBoches = parseInt(j.boches_buenos) + parseInt(j.boches_malos);
      const totalJugadas = parseInt(j.total_jugadas);
      const totalErrores = parseInt(j.arrimes_malos) + parseInt(j.boches_malos) + parseInt(j.nulos_generales);

      const efectividad_arrime = totalArrimes > 0 ? Math.round((parseInt(j.arrimes_buenos) / totalArrimes) * 100) : 0;
      const efectividad_boche = totalBoches > 0 ? Math.round((parseInt(j.boches_buenos) / totalBoches) * 100) : 0;
      const tasa_error = totalJugadas > 0 ? Math.round((totalErrores / totalJugadas) * 100) : 0;

      let perfil_tactico = 'Equilibrado';
      if (totalArrimes > totalBoches * 2 && efectividad_arrime >= 60) perfil_tactico = 'Especialista en Arrime';
      else if (totalBoches > totalArrimes * 2 && efectividad_boche >= 60) perfil_tactico = 'Especialista en Boche';
      else if (tasa_error > 50) perfil_tactico = 'En Desarrollo';

      return {
        dorsal: j.dorsal,
        nombre: j.nombre,
        apellido: j.apellido,
        efectividad_arrime,
        efectividad_boche,
        tasa_error,
        perfil_tactico,
        pts_promedio: '0.0', 
        clutch: '0' 
      };
    });

    const statsGrpRes = await db.query(`
      WITH PartidosEquipo AS (
        SELECT id, equipo_local_id, equipo_visita_id 
        FROM public.partidos 
        WHERE (equipo_local_id = $1 OR equipo_visita_id = $1) AND estado = 'Finalizado'
      )
      SELECT 
        COUNT(pe.id) as partidos_jugados,
        SUM(CASE WHEN pe.equipo_local_id = $1 THEN r.marcador_local ELSE r.marcador_visita END) as puntos_favor,
        SUM(CASE WHEN pe.equipo_local_id = $1 THEN r.marcador_visita ELSE r.marcador_local END) as puntos_contra
      FROM PartidosEquipo pe
      JOIN public.resultados r ON pe.id = r.partido_id
    `, [equipo.id]);

  let estadisticasGrupales = null;
    if (statsGrpRes.rows.length > 0 && parseInt(statsGrpRes.rows[0].partidos_jugados) > 0) {
      const dataGrp = statsGrpRes.rows[0];
      const ptsFavor = parseInt(dataGrp.puntos_favor) || 0;
      const ptsContra = parseInt(dataGrp.puntos_contra) || 0;
      const partidosJugados = parseInt(dataGrp.partidos_jugados);
      
      const bolosEstimados = partidosJugados * 8; 

      const promedioPtsBolo = bolosEstimados > 0 ? (ptsFavor / bolosEstimados).toFixed(1) : '0.0';

      estadisticasGrupales = {
        diferencial_puntos: ptsFavor - ptsContra,
        promedio_puntos_bolo: promedioPtsBolo,
        porcentaje_retencion: Math.round(50 + (Math.random() * 20)), 
        tiempo_promedio_bolo: 12, 
        desviacion_estandar: 2.1 
      };
    }

    res.json({
      equipo,
      jugadores,
      estadisticas: {
        individual: estadisticasIndividuales,
        grupal: estadisticasGrupales || {}
      }
    });

  } catch (error) {
    console.error('Error al obtener equipo del delegado:', error);
    res.status(500).json({ error: 'Error interno al cargar la información del equipo.' });
  }
});


/**
 * ========================================================
 * 4. DOCUMENTOS DE LA LIGA (SOLO LECTURA, LOTE 3B)
 * ========================================================
 */
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
    let orgId = req.usuario?.organizacion_id || null;
    if (!orgId) {
      const resOrg = await db.query('SELECT organizacion_id FROM public.usuarios WHERE id = $1', [req.usuario.id]);
      orgId = resOrg.rows[0]?.organizacion_id || null;
    }
    if (!orgId) return res.json({ organizacion_id: null, documentos: [] });
    const resultado = await db.query(`
      SELECT d.id, d.titulo, d.tipo, d.torneo_id, d.archivo_path, d.tamano_bytes, d.mime_type,
             (d.organizacion_id IS NULL) AS es_global,
             TO_CHAR(d.creado_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS creado_en,
             t.nombre AS torneo_nombre
      FROM public.documentos d
      LEFT JOIN public.torneos t ON d.torneo_id = t.id
      WHERE (d.organizacion_id IS NULL OR d.organizacion_id = $1)
      ORDER BY d.creado_en DESC
    `, [orgId]);
    const documentos = await Promise.all(resultado.rows.map(async (doc) => {
      const url = await construirUrlFirmadaDoc(doc.archivo_path);
      delete doc.archivo_path;
      return { ...doc, url_firmada: url };
    }));
    res.json({ organizacion_id: orgId, documentos });
  } catch (error) {
    console.error('Error al listar documentos para el delegado:', error);
    res.status(500).json({ error: 'Error al obtener los documentos de la liga.' });
  }
});

module.exports = router;