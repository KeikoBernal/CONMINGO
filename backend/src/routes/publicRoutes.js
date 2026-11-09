const express = require('express');
const router = express.Router();
const db = require('../config/db');
// LOTE 7B: los endpoints publicos aceptan el id entero o el uuid_publico
// opaco (los links nuevos de la fase 7c usaran el uuid).
const { resolverIdPartido } = require('../utilidades/resolverIds');

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
             COALESCE(jv.nombre || ' ' || jv.apellido, '') AS capitan_visita_nombre
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
         OR (p.estado = 'Agendado' AND p.fecha_hora::timestamp >= (NOW() AT TIME ZONE 'America/Caracas')))
      ORDER BY (p.estado = 'En Curso') DESC, t.nombre ASC, p.fecha_hora ASC
    `);
    res.json(resDb.rows);
  } catch (error) { 
    res.status(500).json({ error: 'Error al consultar partidos activos' }); 
  }
});

module.exports = router;
