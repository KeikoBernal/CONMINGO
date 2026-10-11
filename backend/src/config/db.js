const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

// FIX #9: SSL configurable, sin rejectUnauthorized:false a ciegas.
// - DATABASE_SSL=false     → sin SSL (desarrollo local)
// - PGSSLCERT=ruta/ca.pem   → SSL verificando la CA (recomendado en producción)
// - PGSSLCERT con PEM       → también soportado
// - Sin ninguna de las anteriores → mantiene el comportamiento actual (con aviso en logs)
function construirSSL() {
  if (String(process.env.DATABASE_SSL || '').toLowerCase() === 'false') return false;

  const certRef = process.env.PGSSLCERT || process.env.DATABASE_CA_CERT;
  if (certRef) {
    let ca;
    if (certRef.includes('-----BEGIN CERTIFICATE-----')) {
      ca = certRef;
    } else {
      ca = fs.readFileSync(certRef, 'utf8');
    }
    return { ca, rejectUnauthorized: true };
  }

  console.warn(
    '⚠️ [db] SSL de PostgreSQL sin verificación de certificado (rejectUnauthorized: false). ' +
    'Configura PGSSLCERT con el certificado CA del proveedor para una conexión verificada.'
  );
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: construirSSL(),
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
