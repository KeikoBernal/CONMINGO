const express = require('express');
const router = express.Router();
const db = require('../config/db');

// 1. OBTENER PARTIDO ESPECÍFICO CON METADATOS (Árbitro, Anotador, Capitanes)
router.get('/partidos/:id', async (req, res) => {
  try {
    const partidoId = parseInt(req.params.id, 10);
    if (isNaN(partidoId)) {
      return res.status(400).json({ error: 'Formato de ID inválido. Debe ser un número entero.' });
    }

    const resDb = await db.query(`
      SELECT p.id, p.estado, p.fase, p.torneo_id, p.equipo_local_id, p.equipo_visita_id,
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
      WHERE p.id = $1
    `, [partidoId]); // MODIFICACIÓN: Pasamos la variable parseada en lugar de req.params.id

    if (resDb.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado' });
    res.json(resDb.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Error al consultar partido' }); }
});

// 2. OBTENER NÓMINA PÚBLICA
router.get('/partidos/:id/nomina', async (req, res) => {
  try {
    const partidoId = parseInt(req.params.id, 10);
    if (isNaN(partidoId)) {
      return res.status(400).json({ error: 'Formato de ID inválido. Debe ser un número entero.' });
    }

    const resDb = await db.query(`
      SELECT j.id, j.equipo_id, j.numero_dorsal, j.nombre, j.apellido, j.foto_url, e.nombre AS equipo_nombre
      FROM public.jugadores j
      JOIN public.equipos e ON j.equipo_id = e.id
      JOIN public.partidos p ON (p.equipo_local_id = e.id OR p.equipo_visita_id = e.id)
      WHERE p.id = $1 AND j.estado = 'Activo' ORDER BY e.nombre, j.numero_dorsal ASC
    `, [partidoId]); // MODIFICACIÓN: Pasamos la variable parseada
    res.json(resDb.rows);
  } catch (error) { res.status(500).json({ error: 'Error al obtener nómina.' }); }
});

// 3. LISTAR PARTIDOS ACTIVOS ORGANIZADOS
router.get('/partidos-activos', async (req, res) => {
  try {
    const resDb = await db.query(`
      SELECT p.id, p.estado, p.fase, p.torneo_id, p.equipo_local_id, p.equipo_visita_id,
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
      WHERE p.estado IN ('En Curso', 'Agendado')
      ORDER BY t.nombre ASC, p.fecha_hora ASC
    `);
    res.json(resDb.rows);
  } catch (error) { 
    res.status(500).json({ error: 'Error al consultar partidos activos' }); 
  }
});

module.exports = router;