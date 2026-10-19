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
      ca = fs.readFileSync(certRef, 'utf-8');
    }
    return { ca, rejectUnauthorized: true };
  }

  console.warn(
    '⚠️ [db] SSL de PostgreSQL sin verificación de certificado (rejectUnauthorized: false). ' +
    'Configura PGSSLCERT con el certificado CA del proveedor para una conexión verificada.'
  );
  return { rejectUnauthorized: false };
}

// ============================================================================
// LOTE O: CONNECTION POOLER DE SUPABASE (puerto 6543, modo transacción)
// ============================================================================
// En Render (producción) conviene apuntar DATABASE_URL al pooler de Supabase:
//   postgresql://postgres.<ref-proyecto>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
//
// ¿Por qué?
// - El puerto 5432 directo gasta una conexión real del proyecto por cada cliente:
//   Render + despliegues paralelos agotan el límite de conexiones de Supabase.
// - El pooler 6543 (transaction mode) multiplexa las conexiones de verdad.
// - node-postgres NO usa prepared statements con nombre, así que es compatible
//   con transaction mode sin ningún cambio de código.
// - Solo para MIGRACIONES/DDL puntuales usa el 5432 (session mode) en local,
//   nunca este pool del backend.
//
// Tuning del pool (configurable por variables de entorno):
// - PG_POOL_MAX:           conexiones máximas del pool (default 10).
// - PG_IDLE_TIMEOUT_MS:     ms antes de cerrar una conexión ociosa (default 30000).
// - PG_CONNECT_TIMEOUT_MS:  ms máximos esperando una conexión (default 10000),
//                           evita peticiones colgadas en Render si Supabase tarda.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
  ssl: construirSSL(),
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
