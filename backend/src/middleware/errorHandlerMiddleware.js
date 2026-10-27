// ============================================================
// LOTE 4B (M1): MIDDLEWARE DE ERRORES DE INTEGRIDAD
// La migracion 010 agrego un indice unico de dorsal por equipo (y las
// tablas nuevas traen CHECKs y uniques propios). Este modulo convierte
// los errores crudos de PostgreSQL en respuestas amigables:
//   23505 unique_violation  -> 409 con mensaje en espanol
//   23514 check_violation   -> 400 con la restriccion involucrada
//   23503 foreign_key_violation -> 400 dato inexistente/eliminado
// Se usa de dos formas:
//   1. Helper responderSiErrorIntegridad: las rutas lo llaman en su
//      catch para responder 409/400 sin duplicar logica.
//   2. manejarErroresIntegridad: middleware de errores de Express
//      registrado en server.js despues de todas las rutas, como red
//      de seguridad (Express 5 tambien le pasa las promesas rechazadas).
// ============================================================

const MENSAJES_RESTRICCIONES = {
  jugadores_dorsal_unico_por_equipo: 'Ese dorsal ya está ocupado en el equipo por otro jugador activo o suspendido.',
  protestas_partido_equipo_unicas: 'Ese equipo ya tiene una protesta vigente para ese partido.'
};

const detalleError = (error, req) => ({
  ruta: req.method + ' ' + req.path,
  codigo: error?.code || null,
  restriccion: error?.constraint || null,
  detalle: error?.detail || null
});

// Helper para las rutas. Devuelve true si el error era de integridad y ya
// se envio la respuesta. Uso: if (responderSiErrorIntegridad(error, req, res)) return;
const responderSiErrorIntegridad = (error, req, res) => {
  if (!error) return false;
  if (error.code === '23505') {
    const restriccion = error.constraint || 'restriccion_desconocida';
    console.error('[integridad] Violación de unicidad:', detalleError(error, req));
    const mensaje = MENSAJES_RESTRICCIONES[restriccion] || 'Ya existe un registro con esos datos (' + restriccion + ').';
    res.status(409).json({ error: mensaje });
    return true;
  }
  if (error.code === '23514') {
    const restriccion = error.constraint || 'restriccion_desconocida';
    console.error('[integridad] Violación de CHECK:', detalleError(error, req));
    res.status(400).json({ error: 'El dato indicado no cumple una regla del sistema (' + restriccion + ').' });
    return true;
  }
  if (error.code === '23503') {
    console.error('[integridad] Violación de llave foránea:', detalleError(error, req));
    res.status(400).json({ error: 'El registro hace referencia a un dato que no existe o fue eliminado.' });
    return true;
  }
  return false;
};

// Middleware de errores de Express (4 argumentos). Red de seguridad global.
const manejarErroresIntegridad = (error, req, res, next) => {
  if (responderSiErrorIntegridad(error, req, res)) return;
  console.error('[errorHandler] Error no controlado:', { ruta: req.method + ' ' + req.path, mensaje: error?.message || error });
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Error interno del servidor.' });
};

module.exports = { responderSiErrorIntegridad, manejarErroresIntegridad };
