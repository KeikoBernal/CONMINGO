// ============================================================
// Revision de seguridad (hallazgo bajo): registrarAuditoria estaba
// duplicado en 5 archivos de rutas (superadmin, adminLiga, delegado,
// operativo y notificaciones), asi que cualquier ajuste habia que
// replicarlo cinco veces. Esta es la definicion unica: inserta en
// public.audit_logs y, si la escritura falla, no rompe el flujo de
// la ruta (FIX #15: el error queda en el log con contexto).
// ============================================================
const db = require('../config/db');

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

module.exports = { registrarAuditoria };
