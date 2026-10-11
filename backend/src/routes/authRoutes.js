// src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');

// FIX #4: se eliminó el endpoint POST /login (JWT propio + fallback 'secreto_desarrollo').
// Era código muerto e inseguro: el frontend autentica con Supabase Auth y
// authMiddleware.verificarToken valida ese token contra Supabase.

// Ruta para obtener partidos activos o agendados con nombres de equipos y sedes
router.get('/partidos-activos', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*, el.nombre as local_nombre, ev.nombre as visita_nombre, t.nombre as torneo_nombre,
             s.nombre as sede_nombre, o.nombre as organizacion_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id
      WHERE p.estado != 'Finalizado'
      ORDER BY p.fecha_hora ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al buscar partidos:', error);
    res.status(500).json({ error: 'Error al buscar partidos' });
  }
});

// Ruta para obtener un partido específico por su ID con toda su información relacionada
router.get('/partidos/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*, el.nombre as local_nombre, ev.nombre as visita_nombre, t.nombre as torneo_nombre,
             s.nombre as sede_nombre, o.nombre as organizacion_nombre
      FROM public.partidos p
      LEFT JOIN public.equipos el ON p.equipo_local_id = el.id
      LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id
      LEFT JOIN public.torneos t ON p.torneo_id = t.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id
      WHERE p.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Partido no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al buscar el partido:', error);
    res.status(500).json({ error: 'Error al buscar el partido' });
  }
});

router.get('/partidos/:id/nomina-publica', async (req, res) => {
  try {
    const resDb = await db.query(`
      SELECT j.*, e.nombre AS equipo_nombre FROM public.jugadores j
      JOIN public.equipos e ON j.equipo_id = e.id
      JOIN public.partidos p ON (p.equipo_local_id = e.id OR p.equipo_visita_id = e.id)
      WHERE p.id = $1 AND j.estado = 'Activo' ORDER BY e.nombre, j.numero_dorsal ASC
    `, [req.params.id]);
    res.json(resDb.rows);
  } catch (error) { res.status(500).json({ error: 'Error' }); }
});

module.exports = router;