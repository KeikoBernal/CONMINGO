// FIX #9: Lista blanca de orígenes CORS (usada por Express y Socket.io).
const ORIGENES_ENV = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

const ORIGENES_DEV = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

const origenesPermitidos = [...new Set([...ORIGENES_ENV, ...ORIGENES_DEV])];

if (!ORIGENES_ENV.length && process.env.NODE_ENV === 'production') {
  // LOTE 6C: aviso accionable. Sin la variable, el frontend desplegado en
  // *.vercel.app sigue funcionando; pero si algun dia se publica la app en
  // un dominio propio hay que definir CORS_ORIGINS en Render (URLs completas
  // separadas por coma) o ese dominio sera rechazado por el CORS.
  console.warn('CORS: CORS_ORIGINS no está definida en Render. Se aceptan localhost y *.vercel.app. Si usas un dominio propio, define CORS_ORIGINS con las URLs separadas por coma.');
}

function origenPermitido(origin, callback) {
  // Peticiones same-origin o clientes sin cabecera Origin
  if (!origin) return callback(null, true);
  const limpio = String(origin).replace(/\/$/, '');
  if (origenesPermitidos.includes(limpio)) return callback(null, true);
  try {
    const { hostname } = new URL(limpio);
    if (/\.vercel\.app$/i.test(hostname)) return callback(null, true);
  } catch (_) { /* origen malformado */ }
  console.warn('CORS: origen rechazado →', origin);
  return callback(new Error('Origen no permitido por CORS.'));
}

module.exports = { origenPermitido, origenesPermitidos };
