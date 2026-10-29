// ============================================================
// LOTE 6F (M5): telemetria de errores con Sentry (backend).
// - Si SENTRY_DSN no esta definida, todo queda desactivado y el
//   servidor se comporta exactamente igual que siempre.
// - Si la dependencia @sentry/node todavia no esta instalada
//   (lockfile pendiente de regenerar), el modulo degrada a no-op
//   sin tumbar el arranque del servidor.
// ============================================================
let Sentry = null;
try {
  Sentry = require('@sentry/node');
} catch (err) {
  Sentry = null;
}

const inicializarTelemetria = () => {
  if (!Sentry) {
    console.warn('[telemetria] @sentry/node no esta instalada: reporte de errores desactivado');
    return;
  }
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[telemetria] SENTRY_DSN no definida: reporte de errores desactivado');
    return;
  }
  try {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0, // solo reporte de errores, sin trazas de rendimiento
      sendDefaultPii: false
    });
    console.log('[telemetria] Sentry activo');
  } catch (err) {
    console.error('[telemetria] No se pudo iniciar Sentry:', err?.message || err);
  }
};

// Red de seguridad: reporta a la telemetria sin interrumpir el flujo original.
const capturarError = (error, contexto = {}) => {
  if (!Sentry) return;
  try {
    Sentry.captureException(error, { extra: contexto });
  } catch (err) {
    // la telemetria nunca debe romper una respuesta del API
  }
};

module.exports = { inicializarTelemetria, capturarError };
