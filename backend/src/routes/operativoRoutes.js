const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verificarToken } = require('../middleware/authMiddleware');

router.use(verificarToken);

// 1. OBTENER MIS PARTIDOS (CORREGIDO)
router.get('/mis-partidos', async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const esAdmin = ['Administrador de Liga', 'Superadmin'].includes(req.usuario.rol || '');

    let query = `
      SELECT p.*, 
             t.organizacion_id,
             COALESCE(o.nombre, 'Partidos Independientes') as organizacion_nombre,
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
      LEFT JOIN public.organizaciones o ON t.organizacion_id = o.id
      LEFT JOIN public.sedes s ON p.sede_id = s.id
      LEFT JOIN public.usuarios ua ON p.arbitro_id = ua.id
      LEFT JOIN public.usuarios un ON p.anotador_id = un.id
      LEFT JOIN public.jugadores jl ON el.capitan_id = jl.id AND jl.estado = 'Activo'
      LEFT JOIN public.jugadores jv ON ev.capitan_id = jv.id AND jv.estado = 'Activo'
    `;
    
    const params = [];
    if (!esAdmin) { 
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
      SELECT p.*, 
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
      SELECT p.*, 
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
    const esAdmin = ['Administrador de Liga', 'Superadmin'].includes(req.usuario.rol || '');
    const chk = await db.query('SELECT estado, arbitro_id, anotador_id FROM public.partidos WHERE id = $1', [req.params.id]);
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado.' });
    
    if (!esAdmin && chk.rows[0].arbitro_id !== req.usuario.id && chk.rows[0].anotador_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Acceso denegado. No eres oficial asignado a este encuentro.' });
    }
    if (chk.rows[0].estado !== 'Agendado') {
      return res.status(400).json({ error: `Solo se pueden iniciar partidos en estado 'Agendado'. Estado actual: ${chk.rows[0].estado}` });
    }

    const { hora_inicio } = req.body;
    const resDb = await db.query(
      `UPDATE public.partidos SET estado = 'En Curso', hora_inicio = COALESCE(hora_inicio, $1) WHERE id = $2 RETURNING *`,
      [hora_inicio, req.params.id]
    );
    res.json({ mensaje: 'Partido iniciado con éxito.', partido: resDb.rows[0], hora_inicio: hora_inicio });
  } catch (error) { res.status(500).json({ error: 'Error al cambiar estado del partido.' }); }
});

// 3. FINALIZAR PARTIDO
router.put('/partidos/:id/finalizar', async (req, res) => {
  try {
    // INSERCIÓN: Validación estricta de rol y flujo de estado
    const esAdmin = ['Administrador de Liga', 'Superadmin'].includes(req.usuario.rol || '');
    const chk = await db.query('SELECT estado, arbitro_id, anotador_id FROM public.partidos WHERE id = $1', [req.params.id]);
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado.' });
    
    if (!esAdmin && chk.rows[0].arbitro_id !== req.usuario.id && chk.rows[0].anotador_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Acceso denegado. No eres oficial asignado a este encuentro.' });
    }
    if (chk.rows[0].estado !== 'En Curso') {
      return res.status(400).json({ error: `El partido debe estar 'En Curso' para finalizarlo. Estado actual: ${chk.rows[0].estado}` });
    }

    const { hora_final } = req.body;
    const resDb = await db.query(
      `UPDATE public.partidos SET estado = 'Finalizado', hora_final = $1 WHERE id = $2 RETURNING *`,
      [hora_final, req.params.id]
    );
    res.json({ mensaje: 'Partido finalizado con éxito.', partido: resDb.rows[0], hora_final: hora_final });
  } catch (error) { res.status(500).json({ error: 'Error al finalizar el partido.' }); }
});

// 4. SUSPENDER PARTIDO
router.put('/partidos/:id/suspender', async (req, res) => {
  try {
    // INSERCIÓN: Evitar suspender partidos que ya finalizaron
    const esAdmin = ['Administrador de Liga', 'Superadmin'].includes(req.usuario.rol || '');
    const chk = await db.query('SELECT estado, arbitro_id, anotador_id FROM public.partidos WHERE id = $1', [req.params.id]);
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado.' });
    
    if (!esAdmin && chk.rows[0].arbitro_id !== req.usuario.id && chk.rows[0].anotador_id !== req.usuario.id) {
      return res.status(403).json({ error: 'Acceso denegado. No eres oficial asignado a este encuentro.' });
    }
    if (chk.rows[0].estado === 'Finalizado') {
      return res.status(400).json({ error: 'No se puede suspender un partido que ya ha sido finalizado y cerrado.' });
    }

    const resDb = await db.query(`UPDATE public.partidos SET estado = 'Suspendido' WHERE id = $1 RETURNING *`, [req.params.id]);
    res.json({ mensaje: 'Partido suspendido.', partido: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al suspender el partido.' }); }
});

// 5. REGISTRAR SORTEO
router.put('/partidos/:id/sorteo', async (req, res) => {
  try {
    const { sorteo } = req.body;
    const resDb = await db.query(`UPDATE public.partidos SET sorteo_data = $1 WHERE id = $2 RETURNING *`, [JSON.stringify({ resultado: sorteo }), req.params.id]);
    res.json({ mensaje: 'Sorteo registrado.', partido: resDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al registrar sorteo.' }); }
});

// 6. NÓMINA DEL PARTIDO
router.get('/partidos/:id/nomina', async (req, res) => {
  try {
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
  const { numero_mano, equipo_ganador_id, tantos_anotados, detalle_jugadas } = req.body;
  const partidoId = req.params.id;
  
  try {
    // Extraer configuración del torneo (Regla 1 y 4)
    const torneoRes = await db.query(`
      SELECT t.reglas FROM public.partidos p JOIN public.torneos t ON p.torneo_id = t.id WHERE p.id = $1
    `, [partidoId]);
    
    if (torneoRes.rows.length === 0) return res.status(404).json({ error: 'Partido no encontrado.' });
    
    const reglas = torneoRes.rows[0].reglas || {};
    const metaPuntos = reglas.meta_puntos || 15;
    const limiteEsferas = reglas.esferas_por_equipo || 8; 
    
    // Validaciones 2 y 4: Control de Esferas y Coherencia Matemática
    if (detalle_jugadas && detalle_jugadas.length > 0) {
      const jugadasPorEquipo = {};
      const mapJugadorEquipo = {};
      
      const jugadoresIds = detalle_jugadas.map(dj => dj.jugador_id);
      const eqJugRes = await db.query(`SELECT id, equipo_id FROM public.jugadores WHERE id = ANY($1::int[])`, [jugadoresIds]);
      eqJugRes.rows.forEach(r => mapJugadorEquipo[r.id] = r.equipo_id);
      
      let esferasExitosasGanador = 0;
      
      for (const dj of detalle_jugadas) {
        const eqId = mapJugadorEquipo[dj.jugador_id];
        if (!jugadasPorEquipo[eqId]) jugadasPorEquipo[eqId] = 0;
        
        const tipo = (dj.tipo_destreza || '').toLowerCase().trim();
        if (tipo === 'a' || tipo === 'b') { // Arrime o Boche
          jugadasPorEquipo[eqId]++;
          // Contamos las esferas que ganan el punto
          if (eqId === equipo_ganador_id && dj.efectividad === true) {
            esferasExitosasGanador++;
          }
        }
      }
      
      // Regla 4: Validar límite de lanzamientos
      for (const [eq, count] of Object.entries(jugadasPorEquipo)) {
        if (count > limiteEsferas) {
          return res.status(400).json({ error: `El equipo superó el límite de \({limiteEsferas} esferas permitidas por mano. Registró:\){count}.` });
        }
      }
      
      // Regla 2: Coherencia de tantos
      if (tantos_anotados > esferasExitosasGanador) {
         return res.status(400).json({ error: `Incongruencia: Se intentan asignar \({tantos_anotados} tantos, pero el equipo ganador solo tiene\){esferasExitosasGanador} esferas más cerca del mingo marcadas como efectivas.` });
      }
    }
    
    // Insertar la mano en BD
    const manoDb = await db.query(
      `INSERT INTO public.manos (partido_id, numero_mano, equipo_ganador_id, tantos_anotados) VALUES ($1, $2, $3, $4) RETURNING *`,
      [partidoId, numero_mano, equipo_ganador_id, tantos_anotados]
    );
    
    // Regla 1: Comprobar límite de puntuación global para Finalización Automática
    const puntosRes = await db.query(`
      SELECT equipo_ganador_id, SUM(tantos_anotados) as total FROM public.manos WHERE partido_id = $1 GROUP BY equipo_ganador_id
    `, [partidoId]);
    
    let partidoFinalizado = false;
    for (const fila of puntosRes.rows) {
      if (fila.total >= metaPuntos) {
         const horaFinal = new Date().toISOString();
         await db.query(`UPDATE public.partidos SET estado = 'Finalizado', hora_final = $1 WHERE id = $2`, [horaFinal, partidoId]);
         partidoFinalizado = true;
         
         const io = req.app.get('io');
         if (io) {
           io.to(`partido_${partidoId}`).emit('partido_finalizado', { partido_id: partidoId, ganador_id: fila.equipo_ganador_id, hora_final: horaFinal, motivo: 'Límite de puntos alcanzado' });
         }
         break;
      }
    }
    
    res.json({ mensaje: 'Mano registrada.', mano: manoDb.rows[0], partido_finalizado: partidoFinalizado });
  } catch (error) { res.status(500).json({ error: 'Error al registrar la mano.' }); }
});

// Regla 3: Aplicación automática de sanciones
router.post('/partidos/:id/sanciones', async (req, res) => {
  const { jugador_id, tipo_tarjeta, motivo } = req.body;
  const partidoId = req.params.id;
  
  try {
    const tarjetaDb = await db.query(
      `INSERT INTO public.tarjetas (partido_id, jugador_id, tipo, motivo) VALUES ($1, $2, $3, $4) RETURNING *`,
      [partidoId, jugador_id, tipo_tarjeta, motivo]
    );
    
    // Bloquear participación futura si es Tarjeta Roja
    if (tipo_tarjeta === 'Roja') {
      await db.query(`UPDATE public.jugadores SET estado = 'Suspendido' WHERE id = $1`, [jugador_id]);
      // Quitar capitanía si la tuviera
      await db.query(`UPDATE public.equipos SET capitan_id = NULL WHERE capitan_id = $1`, [jugador_id]);
      
      const io = req.app.get('io');
      if (io) io.to(`partido_${partidoId}`).emit('jugador_expulsado', { jugador_id, partido_id: partidoId });
    }
    
    res.json({ mensaje: 'Sanción registrada correctamente.', tarjeta: tarjetaDb.rows[0] });
  } catch (error) { res.status(500).json({ error: 'Error al registrar la sanción.' }); }
});

module.exports = router;