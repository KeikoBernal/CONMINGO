// ============================================================
// LOTE 7B: resolucion de ids publicos (uuid_publico).
// Durante la transicion los endpoints aceptan AMBOS formatos:
// el id entero interno (el que sigue usando el sistema por dentro)
// y el uuid_publico opaco de la migracion 016 (el que usaran los
// links publicos de la fase 7c, QR del marcador incluido).
// ============================================================
const db = require('../config/db');

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Aviso unico: si la migracion 016 aun no se ejecuta, la columna
// uuid_publico no existe y las busquedas por uuid fallan. Se avisa una
// sola vez y los ids enteros siguen funcionando (degradacion segura).
let avisoColumnaAusente = false;

// Cache uuid_publico -> id entero. La pareja es inmutable (el uuid se
// asigna una vez en la 016), asi que no necesita expiracion.
const cacheUuidAId = new Map();

// Lista blanca de tablas con uuid_publico: el nombre de tabla nunca
// llega del cliente, pero por defensa en profundidad solo se aceptan
// las tablas de la migracion 016.
const TABLAS_CON_UUID = new Set([
  'torneos', 'sedes', 'equipos', 'jugadores', 'partidos', 'manos',
  'detalle_jugadas', 'tarjetas', 'resultados', 'notificaciones',
  'audit_logs', 'plantillas_reglas', 'torneo_equipos', 'incidencias_partido',
  'sanciones', 'protestas', 'votos_mvp', 'suscripciones_push', 'firmas_acta'
]);

const esUuidPublico = (valor) =>
  typeof valor === 'string' && REGEX_UUID.test(valor.trim());

const esIdEntero = (valor) => {
  const s = String(valor == null ? '' : valor).trim();
  return /^d+$/.test(s) && Number(s) > 0 && Number.isSafeInteger(Number(s));
};

// Devuelve el id entero interno de la fila, o null si el valor no es un
// entero valido ni un uuid_publico registrado en la tabla.
const resolverIdEntero = async (tabla, valor) => {
  if (esIdEntero(valor)) return Number(String(valor).trim());
  if (!esUuidPublico(valor)) return null;
  if (!TABLAS_CON_UUID.has(tabla)) return null;
  const uuid = valor.trim();
  const clave = tabla + ':' + uuid;
  const enCache = cacheUuidAId.get(clave);
  if (enCache !== undefined) return enCache;
  try {
    const { rows } = await db.query(
      'SELECT id FROM public.' + tabla + ' WHERE uuid_publico = $1 LIMIT 1',
      [uuid]
    );
    if (!rows.length) return null;
    const id = rows[0].id;
    if (cacheUuidAId.size > 10000) cacheUuidAId.clear();
    cacheUuidAId.set(clave, id);
    return id;
  } catch (e) {
    if (!avisoColumnaAusente) {
      avisoColumnaAusente = true;
      console.warn('[resolverIds] uuid_publico no disponible todavia (falta ejecutar la migracion 016?):', e && e.message ? e.message : e);
    }
    return null;
  }
};

// Atajos por tabla para las rutas
const resolverIdPartido = (valor) => resolverIdEntero('partidos', valor);

module.exports = { esUuidPublico, esIdEntero, resolverIdEntero, resolverIdPartido };
