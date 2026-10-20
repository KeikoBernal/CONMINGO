// FIX #8: Cliente admin de Supabase SIN fallback silencioso a la anon key.
// Si falta SUPABASE_SERVICE_ROLE_KEY, cualquier uso administrativo falla con un error claro
// (objeto guardián) en vez de degradarse a una clave sin privilegios.
const { createClient } = require('@supabase/supabase-js');

const MENSAJE_ERROR =
  'SUPABASE_SERVICE_ROLE_KEY no está configurada en el servidor. No se puede ejecutar esta operación administrativa.';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[supabaseAdmin] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. ' +
    'Las operaciones administrativas (crear usuarios, cambiar contraseñas, eliminar ligas) fallarán hasta configurarlas.'
  );
}

function crearCliente() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      auth: {
        admin: new Proxy({}, { get() { throw new Error(MENSAJE_ERROR); } }),
      },
      get() { throw new Error(MENSAJE_ERROR); },
    };
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = crearCliente();
