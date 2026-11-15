const express = require('express');
const router = express.Router();
const db = require('../config/db');
// LOTE 7B: los endpoints publicos aceptan el id entero o el uuid_publico
// opaco (los links nuevos de la fase 7c usaran el uuid).
const { resolverIdPartido } = require('../utilidades/resolverIds');
// LOTE 8K: el acta oficial en PDF (pantalla publica y paneles) necesita la
// planilla persistida y el estado de las firmas sin exponer datos personales.
const { estadoFirmas } = require('../utilidades/firmasActa');

// 1. OBTENER PARTIDO ESPECÍFICO CON METADATOS (Árbitro, Anotador, Capitaes)
router.get('/partidos/:id', async (req, res) => {
  try {
    const partidoId = await resolverIdPartido(req.params.id); // LOTE 7B: id entero o uuid_publico
    if (!partidoId) {
      return res.status(400).json({ error: 'Formato de ID inválido. Debe ser el número del partido o su uuid público.' });
    }

    const resDb = await db.query(`
      SELECT p.id, p.uuid_publico, p.estado, p.fase, p.torneo_id, p.equipo_local_id, p.equipo_visita_id,
             TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora,
             p.hora_inicio, p.hora_final,
             el.nombre AS local_nombre, ev.nombre AS visita_nombre,
             t.nombre AS torneo_nombre, o.nombre AS organizacion_nombre, s.nombre AS sede_nombre,
             COALESCE(ua.nombre || ' ' || ua.apellido, '') AS arbitro_nombre,
             COALESCE(un.nombre || ' ' || un.apellido, '') AS anotador_nombre,
             COALESCE(jl.nombre || ' ' || jl.apellido, '') AS capitan_local_nombre,
             COALESCE(jv.nombre || ' ' || jv.apellido, '') AS capitan_visita_nombre,
             -- LOTE 8K3 (reporte de Keiko): marcador oficial del partido (tabla
             -- resultados; existe al finalizar y se actualiza con protestas).
             r.marcador_local, r.marcador_visita, r.tipo_resolucion
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      LEFT JOIN public.usuarios ua ON p.arbitro_id = ua.id
      LEFT JOIN public.usuarios un ON p.anotador_id = un.id
      LEFT JOIN public.jugadores jl ON el.capitan_id = jl.id
      LEFT JOIN public.jugadores jv ON ev.capitan_id = jv.id
      LEFT JOIN public.resultados r ON r.partido_id = p.id
      WHERE (o.eliminado_en IS NULL) AND p.id = $1 -- LOTE 8B: los partidos de ligas eliminadas no se exponen
    `, [partidoId]); // MODIFICACIÓN: Pasamos la variable parseada en lugar de req.params.id

    if (resDb.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado' });
    res.json(resDb.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Error al consultar partido' }); }
});

// 2. OBTENER NÓMINA PÚBLICA
router.get('/partidos/:id/nomina', async (req, res) => {
  try {
    const partidoId = await resolverIdPartido(req.params.id); // LOTE 7B: id entero o uuid_publico
    if (!partidoId) {
      return res.status(400).json({ error: 'Formato de ID inválido. Debe ser el número del partido o su uuid público.' });
    }

    const resDb = await db.query(`
      SELECT j.id, j.equipo_id, j.numero_dorsal, j.nombre, j.apellido, j.foto_url, e.nombre AS equipo_nombre
      FROM public.jugadores j
      JOIN public.equipos e ON j.equipo_id = e.id
      JOIN public.partidos p ON (p.equipo_local_id = e.id OR p.equipo_visita_id = e.id)
      WHERE p.id = $1 AND j.estado = 'Activo'
        AND NOT EXISTS ( -- LOTE 8B: nomina oculta si la liga del partido esta eliminada
          SELECT 1 FROM public.torneos t2
          JOIN public.organizaciones o2 ON t2.organizacion_id = o2.id
          WHERE t2.id = p.torneo_id AND o2.eliminado_en IS NOT NULL
        )
      ORDER BY e.nombre, j.numero_dorsal ASC
    `, [partidoId]); // MODIFICACIÓN: Pasamos la variable parseada
    res.json(resDb.rows);
  } catch (error) { res.status(500).json({ error: 'Error al obtener nómina.' }); }
});

// 3. LISTAR PARTIDOS ACTIVOS ORGANIZADOS
router.get('/partidos-activos', async (req, res) => {
  try {
    const resDb = await db.query(`
      SELECT p.id, p.uuid_publico, p.estado, p.fase, p.torneo_id, p.equipo_local_id, p.equipo_visita_id,
             TO_CHAR(p.fecha_hora, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha_hora,
             p.hora_inicio, p.hora_final,
             el.nombre AS local_nombre, ev.nombre AS visita_nombre,
             t.nombre AS torneo_nombre, o.nombre AS organizacion_nombre, s.nombre AS sede_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      WHERE (o.eliminado_en IS NULL) -- LOTE 8B: la cartelera no muestra partidos de ligas eliminadas
        AND (p.estado = 'En Curso'
         OR (p.estado = 'Agendado' AND p.fecha_hora::timestamp >= (NOW() AT TIME ZONE 'America/Caracas') - INTERVAL '60 minutes')) -- LOTE 8I: hora de gracia de 60 min; un Agendado recien vencido sigue publicandose como retrasado
      ORDER BY (p.estado = 'En Curso') DESC, t.nombre ASC, p.fecha_hora ASC
    `);
    res.json(resDb.rows);
  } catch (error) { 
    res.status(500).json({ error: 'Error al consultar partidos activos' }); 
  }
});

// 4. PLANILLA PERSISTIDA DEL PARTIDO (LOTE 8K): lanzamientos por jugador y
// tantos por mano que la pantalla publica y el acta en PDF necesitan.
router.get('/partidos/:id/planilla', async (req, res) => {
  try {
    const partidoId = await resolverIdPartido(req.params.id);
    if (!partidoId) {
      return res.status(400).json({ error: 'Formato de ID inválido. Debe ser el número del partido o su uuid público.' });
    }
    const resDb = await db.query('SELECT datos FROM public.planilla_estado WHERE partido_id = $1', [partidoId]);
    // Sin planilla persistida se responde vacio: el acta sale con las tablas en blanco.
    res.json(resDb.rows.length > 0 ? (resDb.rows[0].datos || {}) : {});
  } catch (error) { res.status(500).json({ error: 'Error al consultar la planilla del partido' }); }
});

// 5. ESTADO DE FIRMAS DEL ACTA (LOTE 8K): roles, si estan firmadas y la URL
// firmada de la imagen. Sin nombres personales: es una vista publica.
router.get('/partidos/:id/firmas', async (req, res) => {
  try {
    const partidoId = await resolverIdPartido(req.params.id);
    if (!partidoId) {
      return res.status(400).json({ error: 'Formato de ID inválido. Debe ser el número del partido o su uuid público.' });
    }
    const estado = await estadoFirmas(partidoId);
    res.json((estado.firmas || []).map((f) => ({
      rol_firma: f.rol_firma,
      exigible: f.exigible,
      firmada: f.firmada,
      url_firmada: f.url_firmada
    })));
  } catch (error) { res.status(500).json({ error: 'Error al consultar las firmas del acta' }); }
});

// 6. DISCIPLINA DEL PARTIDO (LOTE 8K6, pedido de Keiko): tarjetas emitidas,
// incidencias reportadas por el árbitro y protestas del partido. Alimenta la
// sección "INCIDENCIAS Y SANCIONES" del acta oficial en PDF. Vista pública
// sin datos personales de los autores: solo lo que firma el acta.
router.get('/partidos/:id/disciplina', async (req, res) => {
  try {
    const partidoId = await resolverIdPartido(req.params.id);
    if (!partidoId) {
      return res.status(400).json({ error: 'Formato de ID inválido. Debe ser el número del partido o su uuid público.' });
    }
    const visible = await db.query(`
      SELECT p.id FROM public.partidos p
      JOIN public.torneos t ON p.torneo_id = t.id
      JOIN public.organizaciones o ON t.organizacion_id = o.id
      WHERE p.id = $1 AND o.eliminado_en IS NULL -- LOTE 8B: disciplina oculta si la liga esta eliminada
    `, [partidoId]);
    if (visible.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado' });
    const tarjetas = await db.query(`
      SELECT tc.color, tc.motivo,
             TO_CHAR(tc.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS creado_en,
             j.nombre AS jugador_nombre, j.apellido AS jugador_apellido, j.numero_dorsal
      FROM public.tarjetas tc
      LEFT JOIN public.jugadores j ON tc.jugador_id = j.id
      WHERE tc.partido_id = $1
      ORDER BY tc.created_at ASC
    `, [partidoId]);
    const incidencias = await db.query(`
      SELECT i.tipo, i.descripcion,
             TO_CHAR(i.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS creado_en,
             j.nombre AS jugador_nombre, j.apellido AS jugador_apellido, j.numero_dorsal
      FROM public.incidencias_partido i
      LEFT JOIN public.jugadores j ON i.jugador_id = j.id
      WHERE i.partido_id = $1
      ORDER BY i.created_at ASC
    `, [partidoId]);
    const protestas = await db.query(`
      SELECT pr.motivo, pr.estado, pr.nota_resolucion,
             pr.medida_marcador_local, pr.medida_marcador_visita,
             TO_CHAR(pr.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS creado_en,
             eq.nombre AS equipo_protestante
      FROM public.protestas pr
      LEFT JOIN public.equipos eq ON pr.equipo_protestante_id = eq.id
      WHERE pr.partido_id = $1
      ORDER BY pr.created_at ASC
    `, [partidoId]);
    res.json({ tarjetas: tarjetas.rows, incidencias: incidencias.rows, protestas: protestas.rows });
  } catch (error) { res.status(500).json({ error: 'Error al consultar la disciplina del partido' }); }
});

module.exports = router;



