const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarToken } = require('../middleware/authMiddleware');
const { responderSiErrorIntegridad } = require('../middleware/errorHandlerMiddleware'); // LOTE 4C
const { notificarUsuarios } = require('../utilidades/notificacionesPush'); // LOTE 5 (N4): notificaciones web push
const firmasActa = require('../utilidades/firmasActa'); // LOTE 6D: firmas digitales del acta

// ============================================================
// LOTE FECHAS: hora canonica HH:MM (24 horas) de Venezuela.
// El cierre por meta de puntos escribia antes un ISO UTC en
// partidos.hora_final (texto) y esa cadena cruda llegaba a las
// vistas con 4 horas de desfase. Desde este lote se guarda la
// hora local de Caracas en formato corto y las vistas la
// normalizan con el kit de fechas del frontend.
// ============================================================
const horaCanonicaCaracas = () => {
  const partes = {};
  for (const parte of new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())) partes[parte.type] = parte.value;
  return partes.hour + ':' + partes.minute;
};

router.use(verificarToken);

// ============================================================
// LOTE PDF MARCA: datos de la organizacion del usuario (nombre y
// logo) para el encabezado de marca de los PDF de los roles
// operativos (delegado, arbitro y anotador no tienen endpoint
// propio de organizacion). Si el usuario no tiene organizacion_id
// se intenta la primera de sus organizaciones asociadas.
// ============================================================
router.get('/mi-organizacion', async (req, res) => {
  try {
    let resDb = await db.query('SELECT o.id, o.nombre, o.logo_url FROM public.organizaciones o WHERE o.id = $1', [req.usuario.organizacion_id]);
    if (resDb.rows.length === 0) {
      resDb = await db.query('SELECT o.id, o.nombre, o.logo_url FROM public.usuario_organizaciones uo JOIN public.organizaciones o ON uo.organizacion_id = o.id WHERE uo.usuario_id = $1 ORDER BY o.nombre ASC LIMIT 1', [req.usuario.id]);
    }
    if (resDb.rows.length === 0) return res.status(404).json({ error: 'No perteneces a una organizacion.' });
    res.json(resDb.rows[0]);
  } catch (error) {
    console.error('Error al obtener la organizacion del usuario:', error);
    res.status(500).json({ error: 'Error al obtener la organizacion.' });
  }
});


// ============================================================
// LOTE 4D (P1): RESULTADO OFICIAL DE PARTIDO
// El marcador final de un partido se calcula desde las manos
// registradas y se persiste en public.resultados (la tabla de
// posiciones se calcula desde esa tabla).
// ============================================================
const marcadorDesdeManos = async (partidoId) => {
  try {
    const eqRes = await db.query('SELECT equipo_local_id, equipo_visita_id FROM public.partidos WHERE id = $1', [partidoId]);
    if (eqRes.rows.length === 0) return { local: 0, visita: 0 };
    const localId = String(eqRes.rows[0].equipo_local_id);
    const visitaId = String(eqRes.rows[0].equipo_visita_id);
    // LOTE 8K: cada mano guarda los tantos de AMBOS equipos (tantos_local y
    // tantos_visita): en bolas criollas los dos equipos pueden puntuar en la
    // misma mano. Fallback legacy: manos viejas que solo guardaron el equipo
    // ganador y sus tantos (ambas columnas nuevas en 0 con tantos_anotados > 0).
    const manosRes = await db.query(
      'SELECT m.equipo_ganador_id, m.tantos_local, m.tantos_visita, m.tantos_anotados ' +
      'FROM public.manos m WHERE m.partido_id = $1 ORDER BY m.numero_mano',
      [partidoId]
    );
    let local = 0;
    let visita = 0;
    for (const fila of manosRes.rows) {
      const tLocal = parseInt(fila.tantos_local, 10) || 0;
      const tVisita = parseInt(fila.tantos_visita, 10) || 0;
      const tAnotados = parseInt(fila.tantos_anotados, 10) || 0;
      const esLegacy = tLocal === 0 && tVisita === 0 && tAnotados > 0;
      if (esLegacy) {
        if (String(fila.equipo_ganador_id) === localId) local += tAnotados;
        if (String(fila.equipo_ganador_id) === visitaId) visita += tAnotados;
      } else {
        local += tLocal;
        visita += tVisita;
      }
    }
    return { local, visita };
  } catch (error) {
    console.error('[resultados] No se pudo calcular el marcador desde las manos:', { partidoId, error: error?.message || error });
    return { local: 0, visita: 0 };
  }
};

const registrarResultadoOficial = async (partidoId, marcadorLocal, marcadorVisita, tipoResolucion, aprobadoPor, observaciones) => {
  try {
    const eqRes = await db.query('SELECT equipo_local_id, equipo_visita_id FROM public.partidos WHERE id = $1', [partidoId]);
    if (eqRes.rows.length === 0) return false;
    const localId = eqRes.rows[0].equipo_local_id;
    const visitaId = eqRes.rows[0].equipo_visita_id;
    const localNum = parseInt(marcadorLocal, 10) || 0;
    const visitaNum = parseInt(marcadorVisita, 10) || 0;
    const ganadorId = localNum > visitaNum ? localId : (visitaNum > localNum ? visitaId : null);
    await db.query(
      `INSERT INTO public.resultados (partido_id, marcador_local, marcador_visita, equipo_ganador_id, tipo_resolucion, aprobado_por, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (partido_id) DO UPDATE
       SET marcador_local = $2, marcador_visita = $3, equipo_ganador_id = $4, tipo_resolucion = $5, aprobado_por = $6, observaciones = $7`,
      [partidoId, localNum, visitaNum, ganadorId, tipoResolucion, aprobadoPor, observaciones]
    );
    return true;
  } catch (error) {
    console.error('[resultados] No se pudo registrar el resultado oficial:', { partidoId, error: error?.message || error });
    return false;
  }
};

// ============================================================
// LOTE O: TRAZABILIDAD — bitácora de acciones del operativo
// ============================================================
// Helper: organización a la que pertenece un partido (vía su torneo).
const obtenerOrgDePartido = async (partidoId) => {
  try {
    const { rows } = await db.query('SELECT t.organizacion_id FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id WHERE p.id = $1', [partidoId]);
    return rows[0]?.organizacion_id || null;
  } catch (e) { return null; }
};

// ============================================================
// LOTE 5 (N4): aviso del marcador final a los delegados de ambos
// equipos cuando un partido queda Finalizado.
// ============================================================
const notificarMarcadorFinal = async (partidoId, remitenteId) => {
  try {
    const eqRes = await db.query(
      'SELECT el.delegado_id AS delegado_local, ev.delegado_id AS delegado_visita FROM public.partidos p JOIN public.equipos el ON p.equipo_local_id = el.id JOIN public.equipos ev ON p.equipo_visita_id = ev.id WHERE p.id = $1',
      [partidoId]
    );
    if (eqRes.rows.length === 0) return;
    const delegadosFinal = [eqRes.rows[0].delegado_local, eqRes.rows[0].delegado_visita].filter(Boolean);
    if (delegadosFinal.length === 0) return;
    const marcadorFinal = await marcadorDesdeManos(partidoId);
    await notificarUsuarios({ organizacionId: await obtenerOrgDePartido(partidoId), remitenteId, destinatarios: delegadosFinal, titulo: 'Partido Finalizado', mensaje: 'Partido finalizado. Marcador oficial: ' + marcadorFinal.local + ' - ' + marcadorFinal.visita + '.' });
  } catch (errorPush) {
    console.error('[push] No se pudo notificar el marcador final:', errorPush?.message || errorPush);
  }
};

// Helper: insert en audit_logs con organización (no rompe el flujo si falla).
const { registrarAuditoria } = require('../utilidades/auditoria');

// ============================================================
// LOTE C/D: verificación de acceso a un partido según rol y organización.
// Superadmin: global. Administrador de Liga: partidos de su organización.
// Árbitro/Anotador: solo el partido que tiene asignado.
// ============================================================
const puedeAccederPartido = async (req, partidoId) => {
  const rolNorm = (req.usuario.rol || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  try {
    const { rows } = await db.query(
      'SELECT p.arbitro_id, p.anotador_id, t.organizacion_id FROM public.partidos p LEFT JOIN public.torneos t ON p.torneo_id = t.id WHERE p.id = $1',
      [partidoId]
    );
    if (rows.length === 0) return { ok: false, status: 404, error: 'Partido no encontrado.' };
    const fila = rows[0];
    if (rolNorm === 'superadmin') return { ok: true };
    if (rolNorm === 'administrador de liga') {
      if (fila.organizacion_id && fila.organizacion_id === req.usuario.organizacion_id) return { ok: true };
      return { ok: false, status: 403, error: 'Este partido no pertenece a tu organización.' };
    }
    if (rolNorm === 'arbitro' || rolNorm === 'anotador' || rolNorm === 'arbitro/anotador') {
      if (fila.arbitro_id === req.usuario.id || fila.anotador_id === req.usuario.id) return { ok: true };
      return { ok: false, status: 403, error: 'Acceso denegado. No eres oficial asignado a este encuentro.' };
    }
    return { ok: false, status: 403, error: 'No tienes permisos para operar este partido.' };
  } catch (e) {
    return { ok: false, status: 500, error: 'Error al verificar el acceso al partido.' };
  }
};

// 1. OBTENER MIS PARTIDOS (CORREGIDO)
router.get('/mis-partidos', async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const rolNorm = (req.usuario.rol || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const esAdmin = rolNorm === 'administrador de liga' || rolNorm === 'superadmin';

    let query = `
      SELECT p.*, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora,
             t.organizacion_id,
             COALESCE(o.nombre, 'Partidos Independientes') as organizacion_nombre,
             el.nombre AS local_nombre, ev.nombre AS visita_nombre,
             t.nombre AS torneo_nombre, t.reglas AS torneo_reglas, s.nombre AS sede_nombre,
             COALESCE(ua.nombre || ' ' || ua.apellido, 'Por definir') AS arbitro_nombre,
             COALESCE(un.nombre || ' ' || un.apellido, 'Por definir') AS anotador_nombre,
             COALESCE(jl.nombre || ' ' || jl.apellido, 'Por definir') AS capitan_local_nombre,
             COALESCE(jv.nombre || ' ' || jv.apellido, 'Por definir') AS capitan_visita_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      LEFT JOIN public.usuarios ua ON p.arbitro_id = ua.id
      LEFT JOIN public.usuarios un ON p.anotador_id = un.id
      LEFT JOIN public.jugadores jl ON el.capitan_id = jl.id AND jl.estado = 'Activo'
      LEFT JOIN public.jugadores jv ON ev.capitan_id = jv.id AND jv.estado = 'Activo'
    `;
    
    const params = [];
    if (rolNorm === 'superadmin') {
      // LOTE 8B: el superadmin ve todos los partidos menos los de ligas
      // eliminadas (baja logica; o es NULL en partidos independientes).
      query += ` WHERE o.eliminado_en IS NULL `;
    } else if (esAdmin && req.usuario.organizacion_id) {
      // LOTE C: el administrador de liga solo ve partidos de SU organización.
      query += ` WHERE t.organizacion_id = $1::uuid `;
      params.push(req.usuario.organizacion_id);
    } else {
      // Es vital el casting ::uuid para que PostgreSQL no arroje error
      query += ` WHERE p.arbitro_id = $1::uuid OR p.anotador_id = $1::uuid `;
      params.push(usuarioId);
    }
    query += ` ORDER BY p.fecha_hora ASC `;

    const resDb = await db.query(query, params);
    res.json(resDb.rows);
  } catch (error) { 
    console.error("Error consultando mis-partidos:", error);
    res.status(500).json({ error: 'Error consultando partidos asignados.' }); 
  }
});

router.get('/mis-ligas', async (req, res) => {
  try {
    const resDb = await db.query(`
      SELECT DISTINCT o.id, o.nombre 
      FROM public.usuario_organizaciones uo
      JOIN public.organizaciones o ON uo.organizacion_id = o.id
      WHERE uo.usuario_id = $1
    `, [req.usuario.id]);
    res.json(resDb.rows);
  } catch (error) { res.status(500).json({ error: 'Error al obtener ligas asociadas.' }); }
});

// Endpoint para obtener un partido específico con metadatos completos (Árbitro, Anotador, Capitanes)
router.get('/partidos-publicos/:id', async (req, res) => {
  try {
    const resDb = await db.query(`
      SELECT p.*, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora,
             el.nombre AS local_nombre, ev.nombre AS visita_nombre,
             t.nombre AS torneo_nombre, s.nombre AS sede_nombre,
             COALESCE(ua.nombre || ' ' || ua.apellido, 'Por definir') AS arbitro_nombre,
             COALESCE(un.nombre || ' ' || un.apellido, 'Por definir') AS anotador_nombre,
             COALESCE(jl.nombre || ' ' || jl.apellido, 'Por definir') AS capitan_local_nombre,
             COALESCE(jv.nombre || ' ' || jv.apellido, 'Por definir') AS capitan_visita_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      LEFT JOIN public.usuarios ua ON p.arbitro_id = ua.id
      LEFT JOIN public.usuarios un ON p.anotador_id = un.id
      LEFT JOIN public.jugadores jl ON el.capitan_id = jl.id AND jl.estado = 'Activo'
      LEFT JOIN public.jugadores jv ON ev.capitan_id = jv.id AND jv.estado = 'Activo'
      WHERE p.id = $1
    `, [req.params.id]);

    if (resDb.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado' });
    res.json(resDb.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar partido' });
  }
});

// Endpoint para listar partidos activos o en curso
router.get('/partidos-activos', async (req, res) => {
  try {
    const resDb = await db.query(`
      SELECT p.*, TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora,
             el.nombre AS local_nombre, ev.nombre AS visita_nombre,
             t.nombre AS torneo_nombre, s.nombre AS sede_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      WHERE p.estado IN ('En Curso', 'Agendado')
      ORDER BY p.fecha_hora ASC
    `);
    res.json(resDb.rows);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar partidos activos' });
  }
});

// 2. INICIAR PARTIDO
router.put('/partidos/:id/iniciar', async (req, res) => {
  try {
    // INSERCIÓN: Validación estricta de rol y flujo de estado
    // LOTE C/D: aislamiento por organización y verificación de oficial asignado.
    const acceso = await puedeAccederPartido(req, req.params.id);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    const chk = await db.query('SELECT estado FROM public.partidos WHERE id = $1', [req.params.id]);
    if (chk.rows[0].estado !== 'Agendado') {
      return res.status(400).json({ error: `Solo se pueden iniciar partidos en estado 'Agendado'. Estado actual: ${chk.rows[0].estado}` });
    }

    const { hora_inicio } = req.body;
    const resDb = await db.query(
      `UPDATE public.partidos SET estado = 'En Curso', hora_inicio = COALESCE(hora_inicio, $1) WHERE id = $2 RETURNING *`,
      [hora_inicio, req.params.id]
    );
    await registrarAuditoria(req.usuario.id, 'INICIAR_PARTIDO', 'partidos', { id: req.params.id }, { estado: 'En Curso', hora_inicio }, req.ip, await obtenerOrgDePartido(req.params.id));
    res.json({ mensaje: 'Partido iniciado con éxito.', partido: resDb.rows[0], hora_inicio: hora_inicio });
  } catch (error) { res.status(500).json({ error: 'Error al cambiar estado del partido.' }); }
});

// 3. FINALIZAR PARTIDO
router.put('/partidos/:id/finalizar', async (req, res) => {
  try {
    // INSERCIÓN: Validación estricta de rol y flujo de estado
    // LOTE C/D: aislamiento por organización y verificación de oficial asignado.
    const acceso = await puedeAccederPartido(req, req.params.id);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    const chk = await db.query('SELECT estado FROM public.partidos WHERE id = $1', [req.params.id]);
    if (chk.rows[0].estado !== 'En Curso') {
      return res.status(400).json({ error: `El partido debe estar 'En Curso' para finalizarlo. Estado actual: ${chk.rows[0].estado}` });
    }

    // LOTE 8K: el partido se finaliza PRIMERO (para preservar la hora final
    // verdadera) y las firmas del acta se recogen despues; ya no bloquean
    // el cierre del marcador.

    const { hora_final } = req.body;
    const resDb = await db.query(
      `UPDATE public.partidos SET estado = 'Finalizado', hora_final = $1 WHERE id = $2 RETURNING *`,
      [hora_final, req.params.id]
    );
    await registrarAuditoria(req.usuario.id, 'FINALIZAR_PARTIDO', 'partidos', { id: req.params.id }, { estado: 'Finalizado', hora_final }, req.ip, await obtenerOrgDePartido(req.params.id));
    // LOTE 4D (P1): el marcador de las manos queda como resultado oficial.
    const marcadorOficial = await marcadorDesdeManos(parseInt(req.params.id, 10));
    await registrarResultadoOficial(parseInt(req.params.id, 10), marcadorOficial.local, marcadorOficial.visita, 'Acta', req.usuario.id, null);
    // LOTE 5 (N4): aviso del marcador final a los delegados
    await notificarMarcadorFinal(parseInt(req.params.id, 10), req.usuario.id);
    res.json({ mensaje: 'Partido finalizado con éxito.', partido: resDb.rows[0], hora_final: hora_final });
  } catch (error) { res.status(500).json({ error: 'Error al finalizar el partido.' }); }
});

// 4. SUSPENDER PARTIDO
router.put('/partidos/:id/suspender', async (req, res) => {
  try {
    // INSERCIÓN: Evitar suspender partidos que ya finalizaron
    // LOTE C/D: aislamiento por organización y verificación de oficial asignado.
    const acceso = await puedeAccederPartido(req, req.params.id);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    const chk = await db.query('SELECT estado FROM public.partidos WHERE id = $1', [req.params.id]);
    if (chk.rows[0].estado === 'Finalizado') {
      return res.status(400).json({ error: 'No se puede suspender un partido que ya ha sido finalizado y cerrado.' });
    }

    const resDb = await db.query(`UPDATE public.partidos SET estado = 'Suspendido' WHERE id = $1 RETURNING *`, [req.params.id]);
    await registrarAuditoria(req.usuario.id, 'SUSPENDER_PARTIDO', 'partidos', { id: req.params.id }, { estado: 'Suspendido' }, req.ip, await obtenerOrgDePartido(req.params.id));
    res.json({ mensaje: 'Partido suspendido.', partido: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al suspender el partido.' }); }
});

// 5. REGISTRAR SORTEO
router.put('/partidos/:id/sorteo', async (req, res) => {
  try {
    const acceso = await puedeAccederPartido(req, req.params.id);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    // LOTE G: no permitir registrar el sorteo de partidos finalizados o cancelados
    const estadoSorteoRes = await db.query(`SELECT estado FROM public.partidos WHERE id = $1`, [req.params.id]);
    if (estadoSorteoRes.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado.' });
    if (estadoSorteoRes.rows[0].estado === 'Finalizado' || estadoSorteoRes.rows[0].estado === 'Cancelado') {
      return res.status(400).json({ error: 'No se puede registrar el sorteo de un partido finalizado o cancelado.' });
    }
    const { sorteo } = req.body;
    const resDb = await db.query(`UPDATE public.partidos SET sorteo_data = $1 WHERE id = $2 RETURNING *`, [JSON.stringify({ resultado: sorteo }), req.params.id]);
    await registrarAuditoria(req.usuario.id, 'SORTEO_PARTIDO', 'partidos', { id: req.params.id }, { sorteo }, req.ip, await obtenerOrgDePartido(req.params.id));
    res.json({ mensaje: 'Sorteo registrado.', partido: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al registrar sorteo.' }); }
});

// 6. NÓMINA DEL PARTIDO
router.get('/partidos/:id/nomina', async (req, res) => {
  try {
    const acceso = await puedeAccederPartido(req, req.params.id);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    const resDb = await db.query(`
      SELECT j.*, e.nombre AS equipo_nombre
      FROM public.jugadores j
      JOIN public.equipos e ON j.equipo_id = e.id
      JOIN public.partidos p ON (p.equipo_local_id = e.id OR p.equipo_visita_id = e.id)
      WHERE p.id = $1 AND j.estado = 'Activo' ORDER BY e.nombre, j.numero_dorsal ASC
    `, [req.params.id]);
    res.json(resDb.rows);
  } catch (error) { res.status(500).json({ error: 'Error al obtener nómina.' }); }
});

// INSERCIÓN DE NUEVO CÓDIGO:
// ==========================================
// REGISTRO DE MANOS Y SANCIONES (Validaciones 1, 2, 3 y 4)
// ==========================================

// Registrar mano y jugadas
router.post('/partidos/:id/manos', async (req, res) => {
  const { numero_mano, equipo_ganador_id, tantos_anotados, tantos_local, tantos_visita, detalle_jugadas } = req.body;
  const partidoId = req.params.id;
  
  try {
    // Extraer configuración del torneo (Regla 1 y 4)
    const acceso = await puedeAccederPartido(req, partidoId);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    const torneoRes = await db.query(`
      SELECT t.reglas, p.estado, p.equipo_local_id, p.equipo_visita_id FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id WHERE p.id = $1
    `, [partidoId]);
    
    if (torneoRes.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado.' });
    
    const reglas = torneoRes.rows[0].reglas || {};
    const metaPuntos = reglas.meta_puntos || 15;
    const limiteEsferas = reglas.esferas_por_equipo || 8;
    // LOTE 4C (N3): boche rastrero parametrizable por liga (se copia de la
    // plantilla de reglas a torneos.reglas.registrar_boche_rastrero).
    const permitirRastrero = reglas.registrar_boche_rastrero === true;
    const tiposLanzamiento = permitirRastrero ? ['a', 'b', 'r'] : ['a', 'b'];

    // LOTE G: Validaciones de integridad del partido y sanitización de entradas
    const filaPartido = torneoRes.rows[0];
    const equiposDelPartido = [filaPartido.equipo_local_id, filaPartido.equipo_visita_id].map(String);
    // LOTE 4C: el equipo_ganador_id llega como string y los ids de la tabla
    // como enteros; se normaliza una sola vez para comparar de verdad.
    const ganadorId = equipo_ganador_id ? String(equipo_ganador_id).trim().toLowerCase() : null;
    const numeroMano = Number(numero_mano);
    const tantosValor = Number(tantos_anotados);
    if (filaPartido.estado === 'Finalizado' || filaPartido.estado === 'Cancelado') {
      return res.status(400).json({ error: 'No se pueden registrar manos en un partido finalizado o cancelado.' });
    }
    if (!Number.isInteger(numeroMano) || numeroMano < 1) {
      return res.status(400).json({ error: 'El número de mano debe ser un entero mayor o igual a 1.' });
    }
    if (ganadorId && !equiposDelPartido.includes(ganadorId)) {
      return res.status(400).json({ error: 'El equipo ganador indicado no participa en este partido.' });
    }
    // LOTE 8K: los tantos ahora viajan por equipo (tantos_local/tantos_visita)
    // y AMBOS equipos pueden puntuar en la misma mano; el cuerpo legacy
    // (equipo_ganador_id + tantos_anotados) sigue aceptandose.
    let ganadorCalculado;
    let tantosLocal;
    let tantosVisita;
    const llegaNuevo = (tantos_local !== undefined && tantos_local !== null && tantos_local !== '')
      || (tantos_visita !== undefined && tantos_visita !== null && tantos_visita !== '');
    if (llegaNuevo) {
      tantosLocal = Number(tantos_local === undefined || tantos_local === null || tantos_local === '' ? 0 : tantos_local);
      tantosVisita = Number(tantos_visita === undefined || tantos_visita === null || tantos_visita === '' ? 0 : tantos_visita);
      if (!Number.isInteger(tantosLocal) || tantosLocal < 0 || tantosLocal > 6 || !Number.isInteger(tantosVisita) || tantosVisita < 0 || tantosVisita > 6) {
        return res.status(400).json({ error: 'Los tantos de cada equipo deben ser un entero entre 0 y 6.' });
      }
      // El ganador se deriva de los tantos (empate: mano sin ganador).
      ganadorCalculado = tantosLocal > tantosVisita ? String(filaPartido.equipo_local_id) : (tantosVisita > tantosLocal ? String(filaPartido.equipo_visita_id) : null);
    } else {
      if (!Number.isInteger(tantosValor) || tantosValor < 0 || tantosValor > 6) {
        return res.status(400).json({ error: 'Los tantos anotados deben ser un entero entre 0 y 6.' });
      }
      ganadorCalculado = ganadorId;
      tantosLocal = ganadorId === String(filaPartido.equipo_local_id) ? tantosValor : 0;
      tantosVisita = ganadorId === String(filaPartido.equipo_visita_id) ? tantosValor : 0;
    }
    
    // Validaciones 2 y 4: Control de Esferas y Coherencia Matemática
    if (detalle_jugadas && detalle_jugadas.length > 0) {
      const jugadasPorEquipo = {};
      const mapJugadorEquipo = {};
      
      const jugadoresIds = detalle_jugadas.map(dj => dj.jugador_id);
      const eqJugRes = await db.query(`SELECT id, equipo_id FROM public.jugadores WHERE id = ANY($1::int[])`, [jugadoresIds]);
      eqJugRes.rows.forEach(r => mapJugadorEquipo[r.id] = r.equipo_id);

      // LOTE G: los jugadores del detalle deben pertenecer a los equipos del partido
      for (const dj of detalle_jugadas) {
        const eqDelJugador = mapJugadorEquipo[dj.jugador_id];
        if (!eqDelJugador || !equiposDelPartido.includes(String(eqDelJugador))) {
          return res.status(400).json({ error: 'El detalle de jugadas incluye jugadores que no pertenecen a los equipos del partido.' });
        }
      }
      
      // LOTE 8K: esferas efectivas por equipo (los dos pueden puntuar en la
      // misma mano; antes solo se contaban las del ganador).
      let esferasExitosasLocal = 0;
      let esferasExitosasVisita = 0;

      for (const dj of detalle_jugadas) {
        const eqId = mapJugadorEquipo[dj.jugador_id];
        if (!jugadasPorEquipo[eqId]) jugadasPorEquipo[eqId] = 0;

        const tipo = (dj.tipo_destreza || '').toLowerCase().trim();
        // LOTE 4C (N3): solo se aceptan los lanzamientos habilitados por la liga.
        if (tipo !== 'n' && !tiposLanzamiento.includes(tipo)) {
          return res.status(400).json({ error: permitirRastrero ? "El tipo de lanzamiento debe ser 'a' (arrime), 'b' (boche de aire), 'r' (rastrero) o 'n' (nulo)." : "El tipo de lanzamiento debe ser 'a' (arrime), 'b' (boche de aire) o 'n' (nulo). Este torneo no registra boche rastrero." });
        }
        if (tiposLanzamiento.includes(tipo)) { // Arrime, Boche y Rastrero (si la liga lo permite)
          jugadasPorEquipo[eqId]++;
          // Contamos las esferas efectivas de cada equipo
          if (String(eqId) === String(filaPartido.equipo_local_id) && dj.efectividad === true) {
            esferasExitosasLocal++;
          }
          if (String(eqId) === String(filaPartido.equipo_visita_id) && dj.efectividad === true) {
            esferasExitosasVisita++;
          }
        }
      }

      // Regla 4: Validar límite de lanzamientos
      for (const [eq, count] of Object.entries(jugadasPorEquipo)) {
        if (count > limiteEsferas) {
          return res.status(400).json({ error: `El equipo superó el límite de ${limiteEsferas} esferas permitidas por mano. Registró: ${count}.` });
        }
      }

      // Regla 2: Coherencia de tantos por equipo (LOTE 8K: el mensaje nombra
      // la mano y el equipo para que el anotador sepa que celda completar).
      if (tantosLocal > esferasExitosasLocal) {
        return res.status(400).json({ error: `Incongruencia en la mano ${numeroMano}: se asignan ${tantosLocal} tantos al equipo local, pero solo tiene ${esferasExitosasLocal} esferas marcadas como efectivas. Completa los lanzamientos de esa mano.` });
      }
      if (tantosVisita > esferasExitosasVisita) {
        return res.status(400).json({ error: `Incongruencia en la mano ${numeroMano}: se asignan ${tantosVisita} tantos al equipo visitante, pero solo tiene ${esferasExitosasVisita} esferas marcadas como efectivas. Completa los lanzamientos de esa mano.` });
      }
    }
    
    // LOTE 4C (N3): la mano es idempotente (upsert). Si ya existe para este
    // partido y numero, se actualiza y su detalle se reemplaza; asi el acta
    // se puede corregir sin duplicados.
    // LOTE 8K: se guardan los tantos de ambos equipos (tantos_local y
    // tantos_visita); tantos_anotados queda como el mayor, para compatibilidad
    // con lecturas legacy.
    const previaRes = await db.query('SELECT id FROM public.manos WHERE partido_id = $1 AND numero_mano = $2', [partidoId, numeroMano]);
    let manoId;
    let manoDb;
    if (previaRes.rows.length > 0) {
      manoId = previaRes.rows[0].id;
      manoDb = await db.query('UPDATE public.manos SET equipo_ganador_id = $1, tantos_anotados = $2, tantos_local = $3, tantos_visita = $4 WHERE id = $5 RETURNING *', [ganadorCalculado, Math.max(tantosLocal, tantosVisita), tantosLocal, tantosVisita, manoId]);
      await db.query('DELETE FROM public.detalle_jugadas WHERE mano_id = $1', [manoId]);
    } else {
      manoDb = await db.query('INSERT INTO public.manos (partido_id, numero_mano, equipo_ganador_id, tantos_anotados, tantos_local, tantos_visita) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [partidoId, numeroMano, ganadorCalculado, Math.max(tantosLocal, tantosVisita), tantosLocal, tantosVisita]);
      manoId = manoDb.rows[0].id;
    }
    // LOTE 4C (N3): persistencia de los lanzamientos individuales (arrime 'a',
    // boche de aire 'b', rastrero 'r' si la liga lo permite, nulo 'n').
    if (detalle_jugadas && detalle_jugadas.length > 0) {
      for (const dj of detalle_jugadas) {
        const tipoJug = (dj.tipo_destreza || '').toLowerCase().trim();
        await db.query('INSERT INTO public.detalle_jugadas (mano_id, jugador_id, tipo_destreza, efectividad) VALUES ($1, $2, $3, $4)', [manoId, parseInt(dj.jugador_id, 10), tipoJug, dj.efectividad === true]);
      }
    }
    await registrarAuditoria(req.usuario.id, 'REGISTRAR_MANO', 'manos', null, { partido_id: parseInt(partidoId), numero_mano: numeroMano }, req.ip, await obtenerOrgDePartido(partidoId));
    
    // Regla 1: Comprobar límite de puntuación global para Finalización Automática
    // LOTE 8K: el marcador se calcula con los tantos de ambos equipos y la
    // meta cierra el partido SIN retener por firmas (estas se recogen despues).
    const marcadorAcumulado = await marcadorDesdeManos(partidoId);

    let partidoFinalizado = false;
    if (marcadorAcumulado.local >= metaPuntos || marcadorAcumulado.visita >= metaPuntos) {
      const horaFinal = horaCanonicaCaracas();
      await db.query(`UPDATE public.partidos SET estado = 'Finalizado', hora_final = $1 WHERE id = $2`, [horaFinal, partidoId]);
      partidoFinalizado = true;
      // LOTE 4D (P1): el cierre por meta tambien deja resultado oficial.
      await registrarResultadoOficial(partidoId, marcadorAcumulado.local, marcadorAcumulado.visita, 'Acta', req.usuario.id, null);
      // LOTE 5 (N4): aviso del marcador final a los delegados
      await notificarMarcadorFinal(partidoId, req.usuario.id);

      const io = req.app.get('io');
      if (io) {
        io.to(`partido_${partidoId}`).emit('partido_finalizado', { partido_id: partidoId, hora_final: horaFinal, motivo: 'Límite de puntos alcanzado' });
      }
    }

    res.json({ mensaje: 'Mano registrada.', mano: manoDb.rows[0], partido_finalizado: partidoFinalizado });
  } catch (error) {
    if (error && error.code === '23505') {
      return res.status(409).json({ error: 'Esa mano ya fue registrada para este partido.' });
    }
    res.status(500).json({ error: 'Error al registrar la mano.' });
  }
});

// Regla 3: Aplicación automática de sanciones
router.post('/partidos/:id/sanciones', async (req, res) => {
  const { jugador_id, tipo_tarjeta, motivo } = req.body;
  const partidoId = req.params.id;
  
  try {
    const acceso = await puedeAccederPartido(req, partidoId);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    const coloresValidos = ['Amarilla', 'Azul', 'Roja'];
    const colorNormalizado = coloresValidos.find(c => c.toLowerCase() === String(tipo_tarjeta || '').trim().toLowerCase());
    if (!colorNormalizado) {
      return res.status(400).json({ error: `Color de tarjeta inválido. Debe ser uno de: ${coloresValidos.join(', ')}.` });
    }
    // LOTE G: validar estado del partido y que el jugador sancionado pertenezca a sus equipos
    const jugadorIdNum = Number(jugador_id);
    if (!Number.isInteger(jugadorIdNum) || jugadorIdNum < 1) {
      return res.status(400).json({ error: 'Debe indicar el jugador sancionado.' });
    }
    const partidoSancionRes = await db.query(`SELECT estado, equipo_local_id, equipo_visita_id FROM public.partidos WHERE id = $1`, [partidoId]);
    if (partidoSancionRes.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado.' });
    const filaSancion = partidoSancionRes.rows[0];
    if (filaSancion.estado === 'Finalizado' || filaSancion.estado === 'Cancelado') {
      return res.status(400).json({ error: 'No se pueden registrar sanciones en un partido finalizado o cancelado.' });
    }
    const jugadorSancionRes = await db.query(`SELECT equipo_id FROM public.jugadores WHERE id = $1`, [jugadorIdNum]);
    if (jugadorSancionRes.rows.length === 0) {
      return res.status(400).json({ error: 'El jugador sancionado no existe.' });
    }
    if (String(jugadorSancionRes.rows[0].equipo_id) !== String(filaSancion.equipo_local_id) && String(jugadorSancionRes.rows[0].equipo_id) !== String(filaSancion.equipo_visita_id)) {
      return res.status(400).json({ error: 'El jugador sancionado no pertenece a los equipos del partido.' });
    }
    const tarjetaDb = await db.query(
      `INSERT INTO public.tarjetas (partido_id, jugador_id, color, motivo) VALUES ($1, $2, $3, $4) RETURNING *`,
      [partidoId, jugadorIdNum, colorNormalizado, motivo || null]
    );
    
    // Bloquear participación futura si es Tarjeta Roja
    if (colorNormalizado === 'Roja') {
      await db.query(`UPDATE public.jugadores SET estado = 'Suspendido' WHERE id = $1`, [jugador_id]);
      // Quitar capitanía si la tuviera
      await db.query(`UPDATE public.equipos SET capitan_id = NULL WHERE capitan_id = $1`, [jugador_id]);
      
      const io = req.app.get('io');
      if (io) io.to(`partido_${partidoId}`).emit('jugador_expulsado', { jugador_id, partido_id: partidoId });
    }
    
    await registrarAuditoria(req.usuario.id, 'EMITIR_SANCION', 'tarjetas', { partido_id: parseInt(partidoId), jugador_id: jugadorIdNum }, { color: colorNormalizado, motivo: motivo || null }, req.ip, await obtenerOrgDePartido(partidoId));
    res.json({ mensaje: 'Sanción registrada correctamente.', tarjeta: tarjetaDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al registrar la sanción.' }); }
});

// ============================================================
// LOTE N: INCIDENCIAS DEL PARTIDO (módulo del árbitro)
// ============================================================
router.get('/partidos/:id/incidencias', async (req, res) => {
  const partidoId = req.params.id;
  try {
    const acceso = await puedeAccederPartido(req, partidoId);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    const resultado = await db.query(
      `SELECT i.id, i.tipo, i.descripcion, i.created_at, i.jugador_id,
              j.nombre AS jugador_nombre, j.apellido AS jugador_apellido, j.numero_dorsal,
              u.nombre AS autor_nombre, u.apellido AS autor_apellido
       FROM public.incidencias_partido i
       LEFT JOIN public.jugadores j ON i.jugador_id = j.id
       LEFT JOIN public.usuarios u ON i.usuario_id = u.id
       WHERE i.partido_id = $1
       ORDER BY i.created_at DESC`,
      [partidoId]
    );
    res.json(resultado.rows);
  } catch (error) {
    console.error('Error al obtener incidencias:', error);
    res.status(500).json({ error: 'Error al obtener las incidencias del partido.' });
  }
});

router.post('/partidos/:id/incidencias', async (req, res) => {
  const partidoId = req.params.id;
  const { tipo, descripcion, jugador_id, client_id } = req.body; // FASE D UX: client_id deduplica el reenvio offline
  try {
    const acceso = await puedeAccederPartido(req, partidoId);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    // Solo el árbitro asignado (o un superadmin) puede reportar incidencias.
    const partidoRes = await db.query('SELECT arbitro_id FROM public.partidos WHERE id = $1', [partidoId]);
    if (partidoRes.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado.' });
    const esSuperadmin = (req.usuario.rol || '').toLowerCase().includes('superadmin');
    if (!esSuperadmin && String(partidoRes.rows[0].arbitro_id) !== String(req.usuario.id)) {
      return res.status(403).json({ error: 'Solo el árbitro asignado a este encuentro puede registrar incidencias.' });
    }
    const tiposValidos = ['Protesta', 'Lesión', 'Retraso de equipo', 'Deterioro de sede', 'Afición', 'Otro'];
    const tipoNormalizado = tiposValidos.find(t => t.toLowerCase() === String(tipo || '').trim().toLowerCase());
    if (!tipoNormalizado) {
      return res.status(400).json({ error: 'Tipo de incidencia inválido. Debe ser uno de: ' + tiposValidos.join(', ') + '.' });
    }
    const descLimpia = String(descripcion || '').trim();
    if (descLimpia.length < 5) {
      return res.status(400).json({ error: 'La descripción de la incidencia debe tener al menos 5 caracteres.' });
    }
    if (descLimpia.length > 1000) {
      return res.status(400).json({ error: 'La descripción de la incidencia no puede exceder 1000 caracteres.' });
    }
    let jugadorIdNum = null;
    if (jugador_id !== undefined && jugador_id !== null && jugador_id !== '') {
      jugadorIdNum = Number(jugador_id);
      if (!Number.isInteger(jugadorIdNum) || jugadorIdNum < 1) {
        return res.status(400).json({ error: 'El jugador indicado no es válido.' });
      }
    }
    // FASE D UX (offline): la incidencia llega con client_id cuando se registro sin
    // conexion; si ya existe (reenvio al reconectar) se devuelve la original.
    const clientId = client_id ? String(client_id).trim().slice(0, 120) : null;
    if (clientId) {
      const previa = await db.query('SELECT * FROM public.incidencias_partido WHERE partido_id = $1 AND client_id = $2', [partidoId, clientId]);
      if (previa.rows.length > 0) {
        return res.status(201).json({ mensaje: 'Incidencia ya registrada.', incidencia: previa.rows[0] });
      }
    }
    const insertada = await db.query(
      `INSERT INTO public.incidencias_partido (partido_id, usuario_id, jugador_id, tipo, descripcion, client_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [partidoId, req.usuario.id, jugadorIdNum, tipoNormalizado, descLimpia, clientId]
    );
    await registrarAuditoria(req.usuario.id, 'REGISTRAR_INCIDENCIA', 'incidencias_partido', { partido_id: parseInt(partidoId) }, { tipo: tipoNormalizado, jugador_id: jugadorIdNum }, req.ip, await obtenerOrgDePartido(partidoId));
    res.status(201).json({ mensaje: 'Incidencia registrada correctamente.', incidencia: insertada.rows[0] });
  } catch (error) {
    console.error('Error al registrar incidencia:', error);
    res.status(500).json({ error: 'Error al registrar la incidencia.' });
  }
});

// ============================================================
// LOTE 4C (N3): VOTACION MVP DEL TORNEO
// Votan todos los usuarios de la liga (solo verificarToken). El
// AdminLiga abre y cierra la votacion por torneo y cada persona
// emite un solo voto (unique votos_mvp_un_voto_por_votante).
// ============================================================
const esMiembroDeOrg = async (usuario, organizacionId) => {
  if (!organizacionId) return false;
  const rolNorm = (usuario.rol || '').toLowerCase();
  if (rolNorm === 'superadmin') return true;
  if (usuario.organizacion_id && String(usuario.organizacion_id) === String(organizacionId)) return true;
  const res = await db.query('SELECT 1 FROM public.usuario_organizaciones WHERE usuario_id = $1 AND organizacion_id = $2', [usuario.id, organizacionId]);
  return res.rows.length > 0;
};

router.get('/torneos-votacion', async (req, res) => {
  try {
    const resDb = await db.query(
      "SELECT DISTINCT t.id, t.nombre, t.reglas FROM public.torneos t WHERE t.tipo IS DISTINCT FROM 'Flash' AND t.organizacion_id IN (SELECT organizacion_id FROM public.usuario_organizaciones WHERE usuario_id = $1 UNION SELECT organizacion_id FROM public.usuarios WHERE id = $1 AND organizacion_id IS NOT NULL) ORDER BY t.nombre ASC",
      [req.usuario.id]
    );
    res.json(resDb.rows.map(t => ({ id: t.id, nombre: t.nombre, votacion_mvp: (t.reglas && t.reglas.votacion_mvp) || null })));
  } catch (error) {
    console.error('Error al listar torneos para votacion:', error);
    res.status(500).json({ error: 'Error al obtener los torneos.' });
  }
});

router.get('/votacion-mvp', async (req, res) => {
  const { torneo_id } = req.query;
  try {
    const torneoId = parseInt(torneo_id, 10);
    if (!torneoId) return res.status(400).json({ error: 'Indica el torneo de la votación.' });
    const torneoRes = await db.query('SELECT organizacion_id, reglas FROM public.torneos WHERE id = $1', [torneoId]);
    if (torneoRes.rows.length === 0) return res.status(404).json({ error: 'Torneo no encontrado.' });
    const torneo = torneoRes.rows[0];
    if (!(await esMiembroDeOrg(req.usuario, torneo.organizacion_id))) {
      return res.status(403).json({ error: 'Ese torneo no pertenece a tu liga.' });
    }
    const abierta = ((torneo.reglas || {}).votacion_mvp) === 'Abierta';
    const candidatos = await db.query(
      "SELECT j.id, j.nombre, j.apellido, j.numero_dorsal, e.nombre AS equipo_nombre FROM public.torneo_equipos te JOIN public.equipos e ON te.equipo_id = e.id JOIN public.jugadores j ON j.equipo_id = e.id AND j.estado = 'Activo' WHERE te.torneo_id = $1 ORDER BY e.nombre ASC, j.numero_dorsal ASC",
      [torneoId]
    );
    const miVoto = await db.query('SELECT v.jugador_id, j.nombre, j.apellido FROM public.votos_mvp v JOIN public.jugadores j ON v.jugador_id = j.id WHERE v.torneo_id = $1 AND v.votante_id = $2', [torneoId, req.usuario.id]);
    let resultados = null;
    // LOTE 4C: los resultados solo se muestran con la votacion cerrada;
    // el AdminLiga siempre los ve desde su propio panel.
    if (!abierta) {
      const conteo = await db.query(
        "SELECT j.id AS jugador_id, TRIM(j.nombre || ' ' || j.apellido) AS jugador_nombre, e.nombre AS equipo_nombre, COUNT(v.id) AS votos FROM public.votos_mvp v JOIN public.jugadores j ON v.jugador_id = j.id JOIN public.equipos e ON j.equipo_id = e.id WHERE v.torneo_id = $1 GROUP BY j.id, j.nombre, j.apellido, e.nombre ORDER BY votos DESC",
        [torneoId]
      );
      resultados = conteo.rows;
    }
    const total = await db.query('SELECT COUNT(*) AS n FROM public.votos_mvp WHERE torneo_id = $1', [torneoId]);
    res.json({ abierta, mi_voto: miVoto.rows[0] || null, candidatos: candidatos.rows, resultados, total_votos: parseInt(total.rows[0].n) });
  } catch (error) {
    console.error('Error al consultar la votacion MVP:', error);
    res.status(500).json({ error: 'Error al consultar la votación.' });
  }
});

router.post('/votacion-mvp', async (req, res) => {
  const { torneo_id, jugador_id } = req.body;
  try {
    const torneoId = parseInt(torneo_id, 10);
    const jugadorIdNum = parseInt(jugador_id, 10);
    if (!torneoId || !jugadorIdNum) return res.status(400).json({ error: 'Indica el torneo y el jugador del voto.' });
    const torneoRes = await db.query('SELECT organizacion_id, reglas FROM public.torneos WHERE id = $1', [torneoId]);
    if (torneoRes.rows.length === 0) return res.status(404).json({ error: 'Torneo no encontrado.' });
    const torneo = torneoRes.rows[0];
    if (!(await esMiembroDeOrg(req.usuario, torneo.organizacion_id))) {
      return res.status(403).json({ error: 'Ese torneo no pertenece a tu liga.' });
    }
    if (((torneo.reglas || {}).votacion_mvp) !== 'Abierta') {
      return res.status(400).json({ error: 'La votación MVP de este torneo no está abierta.' });
    }
    const candidatoRes = await db.query(
      "SELECT j.id FROM public.torneo_equipos te JOIN public.equipos e ON te.equipo_id = e.id JOIN public.jugadores j ON j.equipo_id = e.id WHERE te.torneo_id = $1 AND j.id = $2 AND j.estado = 'Activo' LIMIT 1",
      [torneoId, jugadorIdNum]
    );
    if (candidatoRes.rows.length === 0) return res.status(400).json({ error: 'Ese jugador no es candidato del torneo.' });
    const yaVoto = await db.query('SELECT 1 FROM public.votos_mvp WHERE torneo_id = $1 AND votante_id = $2', [torneoId, req.usuario.id]);
    if (yaVoto.rows.length > 0) return res.status(409).json({ error: 'Ya emitiste tu voto para el MVP de este torneo.' });
    await db.query('INSERT INTO public.votos_mvp (organizacion_id, torneo_id, votante_id, jugador_id) VALUES ($1, $2, $3, $4)', [torneo.organizacion_id, torneoId, req.usuario.id, jugadorIdNum]);
    await registrarAuditoria(req.usuario.id, 'VOTAR_MVP', 'votos_mvp', null, { torneo_id: torneoId, jugador_id: jugadorIdNum }, req.ip, torneo.organizacion_id);
    res.status(201).json({ mensaje: 'Voto registrado. ¡Gracias por participar!' });
  } catch (error) {
    if (responderSiErrorIntegridad(error, req, res)) return;
    console.error('Error al registrar el voto MVP:', error);
    res.status(500).json({ error: 'Error al registrar el voto.' });
  }
});


// ============================================================
// PREMIACION DEL TORNEO: vista destacada de los campeones del
// acta (arrimador, bochador, rastrero y Jugador Mas Util) y del
// MVP por votacion de la liga. La consume la vista compartida de
// premiacion (AdminLiga y delegados): pantalla, acta de
// premiacion en PDF y diplomas individuales por campeon.
// ============================================================
const LANCES_MINIMOS_PREMIACION = 10; // mismo minimo de las estadisticas individuales

router.get('/torneos-premiacion', async (req, res) => {
  try {
    const resDb = await db.query(
      "SELECT t.id, t.nombre, t.fecha_inicio, t.fecha_fin, t.tipo FROM public.torneos t WHERE t.tipo IS DISTINCT FROM 'Flash' AND t.organizacion_id IN (SELECT organizacion_id FROM public.usuario_organizaciones WHERE usuario_id = $1 UNION SELECT organizacion_id FROM public.usuarios WHERE id = $1 AND organizacion_id IS NOT NULL) ORDER BY t.fecha_inicio DESC, t.nombre ASC",
      [req.usuario.id]
    );
    res.json(resDb.rows.map(t => ({ id: t.id, nombre: t.nombre, fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin, tipo: t.tipo })));
  } catch (error) {
    console.error('Error al listar torneos para premiacion:', error);
    res.status(500).json({ error: 'Error al obtener los torneos.' });
  }
});

router.get('/torneos/:id/premiacion', async (req, res) => {
  try {
    const torneoId = parseInt(req.params.id, 10);
    if (!torneoId) return res.status(400).json({ error: 'Torneo invalido.' });
    const torneoRes = await db.query('SELECT id, nombre, fecha_inicio, fecha_fin, organizacion_id, reglas FROM public.torneos WHERE id = $1', [torneoId]);
    if (torneoRes.rows.length === 0) return res.status(404).json({ error: 'Torneo no encontrado.' });
    const torneo = torneoRes.rows[0];
    if (!(await esMiembroDeOrg(req.usuario, torneo.organizacion_id))) {
      return res.status(403).json({ error: 'Ese torneo no pertenece a tu liga.' });
    }
    // Campeones del acta: mismos criterios de las estadisticas individuales
    // (average = buenos x 1000 / lances, con minimo de lances exigido).
    const resDb = await db.query(
      "SELECT j.id AS jugador_id, j.nombre, j.apellido, j.numero_dorsal, e.nombre AS equipo_nombre, COUNT(dj.id) AS lances, SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) IN ('a','b','r') THEN 1 ELSE 0 END) AS lances_validos, SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) IN ('a','b','r') AND dj.efectividad = true THEN 1 ELSE 0 END) AS buenos, SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'a' THEN 1 ELSE 0 END) AS lances_arrime, SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'a' AND dj.efectividad = true THEN 1 ELSE 0 END) AS buenos_arrime, SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'b' THEN 1 ELSE 0 END) AS lances_boche, SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'b' AND dj.efectividad = true THEN 1 ELSE 0 END) AS buenos_boche, SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'r' THEN 1 ELSE 0 END) AS lances_rastrero, SUM(CASE WHEN LOWER(TRIM(CAST(dj.tipo_destreza AS TEXT))) = 'r' AND dj.efectividad = true THEN 1 ELSE 0 END) AS buenos_rastrero FROM public.detalle_jugadas dj JOIN public.manos m ON dj.mano_id = m.id JOIN public.partidos p ON m.partido_id = p.id JOIN public.jugadores j ON dj.jugador_id = j.id JOIN public.equipos e ON j.equipo_id = e.id WHERE p.estado = 'Finalizado' AND p.torneo_id = $1 GROUP BY j.id, j.nombre, j.apellido, j.numero_dorsal, e.nombre",
      [torneoId]
    );
    const average = (lances, buenos) => lances > 0 ? Math.round((buenos * 1000) / lances) : null;
    const filas = resDb.rows.map(r => {
      const lances = parseInt(r.lances_validos);
      const buenos = parseInt(r.buenos);
      const lancesArrime = parseInt(r.lances_arrime);
      const lancesBoche = parseInt(r.lances_boche);
      const lancesRastrero = parseInt(r.lances_rastrero);
      return {
        jugador_id: r.jugador_id, nombre: r.nombre, apellido: r.apellido, numero_dorsal: r.numero_dorsal, equipo_nombre: r.equipo_nombre,
        lances, buenos,
        lances_arrime: lancesArrime, buenos_arrime: parseInt(r.buenos_arrime),
        lances_boche: lancesBoche, buenos_boche: parseInt(r.buenos_boche),
        lances_rastrero: lancesRastrero, buenos_rastrero: parseInt(r.buenos_rastrero),
        average_global: average(lances, buenos),
        average_arrime: average(lancesArrime, parseInt(r.buenos_arrime)),
        average_boche: average(lancesBoche, parseInt(r.buenos_boche)),
        average_rastrero: average(lancesRastrero, parseInt(r.buenos_rastrero))
      };
    });
    const campeon = (campoLances, campoAvg) => filas.filter(f => f[campoLances] >= LANCES_MINIMOS_PREMIACION).sort((a, b) => (b[campoAvg] || 0) - (a[campoAvg] || 0))[0] || null;
    // MVP del torneo: se conoce cuando el AdminLiga cierra la votacion.
    let mvp = null;
    const votacion = (torneo.reglas && torneo.reglas.votacion_mvp) || null;
    if (votacion !== 'Abierta') {
      const conteo = await db.query(
        "SELECT j.id AS jugador_id, TRIM(j.nombre || ' ' || j.apellido) AS jugador_nombre, e.nombre AS equipo_nombre, COUNT(v.id) AS votos FROM public.votos_mvp v JOIN public.jugadores j ON v.jugador_id = j.id JOIN public.equipos e ON j.equipo_id = e.id WHERE v.torneo_id = $1 GROUP BY j.id, j.nombre, j.apellido, e.nombre ORDER BY votos DESC, j.nombre ASC LIMIT 1",
        [torneoId]
      );
      const total = await db.query('SELECT COUNT(*) AS n FROM public.votos_mvp WHERE torneo_id = $1', [torneoId]);
      if (conteo.rows.length > 0) {
        mvp = {
          jugador_id: conteo.rows[0].jugador_id,
          jugador_nombre: conteo.rows[0].jugador_nombre,
          equipo_nombre: conteo.rows[0].equipo_nombre,
          votos: parseInt(conteo.rows[0].votos, 10),
          total_votos: parseInt(total.rows[0].n, 10)
        };
      }
    }
    res.json({
      torneo: { id: torneo.id, nombre: torneo.nombre, fecha_inicio: torneo.fecha_inicio, fecha_fin: torneo.fecha_fin, votacion_mvp: votacion },
      lances_minimos: LANCES_MINIMOS_PREMIACION,
      campeones: {
        arrimador: campeon('lances_arrime', 'average_arrime'),
        bochador: campeon('lances_boche', 'average_boche'),
        rastrero: campeon('lances_rastrero', 'average_rastrero'),
        mas_util: campeon('lances', 'average_global')
      },
      ranking: filas.slice().sort((a, b) => (b.average_global || 0) - (a.average_global || 0)).slice(0, 10),
      mvp
    });
  } catch (error) {
    console.error('Error al calcular la premiacion del torneo:', error);
    res.status(500).json({ error: 'Error al calcular la premiación del torneo.' });
  }
});

// ============================================================
// LOTE 4D (P1): CONFIRMACION DE PROTESTAS POR LOS OFICIALES
// ============================================================
router.get('/protestas-confirmacion', async (req, res) => {
  try {
    const resultado = await db.query(`
      SELECT pr.id, pr.partido_id, pr.motivo, pr.descripcion, pr.medida, pr.nota_resolucion,
             TO_CHAR(pr.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS creado_en,
             pr.confirmacion_arbitro, pr.confirmacion_anotador,
             pr.medida_marcador_local, pr.medida_marcador_visita,
             p.arbitro_id, p.anotador_id,
             el.nombre AS equipo_local,
             ev.nombre AS equipo_visita,
             r.marcador_local, r.marcador_visita
      FROM public.protestas pr
      JOIN public.partidos p ON pr.partido_id = p.id
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.resultados r ON r.partido_id = p.id
      WHERE pr.estado = 'Pendiente Confirmacion'
        AND (p.arbitro_id = $1 OR p.anotador_id = $1)
      ORDER BY pr.created_at ASC
    `, [req.usuario.id]);
    res.json({ protestas: resultado.rows });
  } catch (error) {
    console.error('Error al listar protestas por confirmar:', error);
    res.status(500).json({ error: 'Error al obtener las protestas por confirmar.' });
  }
});

router.put('/protestas/:id/confirmar', async (req, res) => {
  try {
    const protestaId = parseInt(req.params.id, 10);
    const chk = await db.query(
      `SELECT pr.id, pr.partido_id, pr.estado, pr.medida, pr.medida_marcador_local, pr.medida_marcador_visita,
              pr.confirmacion_arbitro, pr.confirmacion_anotador, p.arbitro_id, p.anotador_id
       FROM public.protestas pr JOIN public.partidos p ON pr.partido_id = p.id
       WHERE pr.id = $1`,
      [protestaId]
    );
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Protesta no encontrada.' });
    const fila = chk.rows[0];
    if (fila.estado !== 'Pendiente Confirmacion') return res.status(400).json({ error: 'Esta protesta no está esperando confirmaciones.' });
    const esArbitro = String(fila.arbitro_id || '') === String(req.usuario.id);
    const esAnotador = String(fila.anotador_id || '') === String(req.usuario.id);
    if (!esArbitro && !esAnotador) return res.status(403).json({ error: 'Solo el árbitro o el anotador asignados al partido pueden confirmar esta protesta.' });
    const nuevoArbitro = esArbitro ? req.usuario.id : fila.confirmacion_arbitro;
    const nuevoAnotador = esAnotador ? req.usuario.id : fila.confirmacion_anotador;
    await db.query(
      'UPDATE public.protestas SET confirmacion_arbitro = $1, confirmacion_anotador = $2 WHERE id = $3',
      [nuevoArbitro, nuevoAnotador, protestaId]
    );
    const completa = Boolean(nuevoArbitro) && Boolean(nuevoAnotador);
    if (completa) {
      await db.query(
        "UPDATE public.protestas SET estado = 'Resuelta', resuelta_por = $1, resuelta_en = now() WHERE id = $2",
        [req.usuario.id, protestaId]
      );
      if (fila.medida_marcador_local !== null && fila.medida_marcador_local !== undefined
          && fila.medida_marcador_visita !== null && fila.medida_marcador_visita !== undefined) {
        await registrarResultadoOficial(fila.partido_id, fila.medida_marcador_local, fila.medida_marcador_visita, 'Protesta', req.usuario.id, 'Marcador corregido por protesta procedente.');
      }
    }
    await registrarAuditoria(req.usuario.id, 'CONFIRMAR_PROTESTA', 'protestas', { id: protestaId, estado: 'Pendiente Confirmacion' }, { confirmada: true, resuelta: completa }, req.ip, await obtenerOrgDePartido(fila.partido_id));
    // LOTE 5 (N4): aviso al presentador cuando la protesta queda resuelta
    if (completa) {
      try {
        const presentadorRes = await db.query('SELECT presentada_por, organizacion_id FROM public.protestas WHERE id = $1', [protestaId]);
        if (presentadorRes.rows.length > 0 && presentadorRes.rows[0].presentada_por) {
          await notificarUsuarios({ organizacionId: presentadorRes.rows[0].organizacion_id, remitenteId: req.usuario.id, destinatarios: [presentadorRes.rows[0].presentada_por], titulo: 'Protesta Resuelta', mensaje: 'Ambos oficiales confirmaron la protesta: quedó resuelta y el resultado oficial del partido fue actualizado.' });
        }
      } catch (errorPush) {
        console.error('[push] No se pudo notificar la resolución de la protesta:', errorPush?.message || errorPush);
      }
    }
    res.json({
      mensaje: completa
        ? 'Confirmación registrada. La protesta quedó resuelta y el resultado oficial actualizado.'
        : 'Confirmación registrada. Falta la confirmación del otro oficial del partido.',
      resuelta: completa
    });
  } catch (error) {
    if (responderSiErrorIntegridad(error, req, res)) return;
    console.error('Error al confirmar la protesta:', error);
    res.status(500).json({ error: 'Error al confirmar la protesta.' });
  }
});

// ============================================================
// LOTE 6D: FIRMAS DIGITALES DEL ACTA DEL PARTIDO
// Cuatro roles de firma: arbitro, anotador, delegado_local y
// delegado_visita. Los delegados firman en el dispositivo del
// anotador o del arbitro asignado (no firman desde su propio
// modulo), por lo que cualquiera de los dos oficiales registra
// esas firmas; el rol se valida en el servidor.
// ============================================================
router.get('/partidos/:id/firmas', async (req, res) => {
  try {
    const acceso = await puedeAccederPartido(req, req.params.id);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    const firmas = await firmasActa.estadoFirmas(parseInt(req.params.id, 10));
    res.json(firmas);
  } catch (error) {
    console.error('Error al consultar las firmas del acta:', error);
    res.status(500).json({ error: 'Error al consultar las firmas del acta.' });
  }
});

router.post('/partidos/:id/firmas', async (req, res) => {
  const { rol_firma, imagen } = req.body;
  const partidoId = parseInt(req.params.id, 10);
  try {
    const acceso = await puedeAccederPartido(req, req.params.id);
    if (!acceso.ok) return res.status(acceso.status).json({ error: acceso.error });
    const guardada = await firmasActa.guardarFirma({ partidoId, rolFirma: rol_firma, imagen, usuario: req.usuario });
    if (guardada.error) return res.status(guardada.status).json({ error: guardada.error });
    // Aviso en vivo al otro oficial y a la pantalla publica para que
    // refresquen el estado de las firmas del acta.
    const io = req.app.get('io');
    if (io) io.to('partido_' + partidoId).emit('firma_acta', { partido_id: partidoId, rol_firma: rol_firma });
    res.status(201).json({ mensaje: 'Firma registrada.', firmas: await firmasActa.estadoFirmas(partidoId) });
  } catch (error) {
    if (responderSiErrorIntegridad(error, req, res)) return;
    console.error('Error al guardar la firma del acta:', error);
    res.status(500).json({ error: 'Error al guardar la firma.' });
  }
});

module.exports = router;
