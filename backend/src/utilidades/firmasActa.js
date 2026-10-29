// ============================================================
// LOTE 6D: FIRMAS DIGITALES DEL ACTA DEL PARTIDO
// Utilidades compartidas por las rutas operativo (arbitro y
// anotador) y admin liga (historial de partidos y acta en PDF).
// La imagen PNG de cada firma vive en el bucket privado
// firmas-actas; la tabla firmas_acta lleva el registro de quien
// registro cada firma y cuando.
// ============================================================
const db = require('../config/db');
const supabaseAdmin = require('../config/supabaseAdmin');

const BUCKET_FIRMAS = 'firmas-actas';
const ROLES_FIRMA = ['arbitro', 'anotador', 'delegado_local', 'delegado_visita'];

// Roles exigibles del partido: arbitro y anotador si estan asignados;
// delegado de cada equipo solo si el equipo tiene delegado registrado.
// Un rol no exigible no bloquea la finalizacion del acta.
const firmasExigibles = async (partidoId) => {
  try {
    const { rows } = await db.query(
      'SELECT p.arbitro_id, p.anotador_id, el.delegado_id AS delegado_local_id, ev.delegado_id AS delegado_visita_id ' +
      'FROM public.partidos p ' +
      'LEFT JOIN public.equipos el ON p.equipo_local_id = el.id ' +
      'LEFT JOIN public.equipos ev ON p.equipo_visita_id = ev.id ' +
      'WHERE p.id = $1',
      [partidoId]
    );
    const fila = rows[0] || {};
    const exigibles = [];
    if (fila.arbitro_id) exigibles.push('arbitro');
    if (fila.anotador_id) exigibles.push('anotador');
    if (fila.delegado_local_id) exigibles.push('delegado_local');
    if (fila.delegado_visita_id) exigibles.push('delegado_visita');
    return exigibles;
  } catch (error) {
    console.error('[firmas-acta] No se pudo calcular las firmas exigibles:', { partidoId, error: error?.message || error });
    return [];
  }
};

// URL firmada (1 hora) para mostrar la imagen de una firma.
const urlFirmada = async (imagenPath) => {
  try {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET_FIRMAS).createSignedUrl(imagenPath, 3600);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (error) {
    console.error('[firmas-acta] No se pudo firmar la URL de la firma:', { imagenPath, error: error?.message || error });
    return null;
  }
};

// Estado completo de las firmas de un acta: exigibles, firmadas,
// faltantes y URL firmada de cada imagen para pintarla en el panel.
const estadoFirmas = async (partidoId) => {
  const exigibles = await firmasExigibles(partidoId);
  const { rows } = await db.query(
    'SELECT f.rol_firma, f.imagen_path, TO_CHAR(f.firmado_en, \'YYYY-MM-DD"T"HH24:MI:SS\') AS firmado_en, ' +
    'TRIM(COALESCE(u.nombre || \' \', \'\') || COALESCE(u.apellido, \'\')) AS registrada_por_nombre ' +
    'FROM public.firmas_acta f ' +
    'LEFT JOIN public.usuarios u ON f.registrada_por = u.id ' +
    'WHERE f.partido_id = $1',
    [partidoId]
  );
  const firmas = [];
  for (const rol of ROLES_FIRMA) {
    const fila = rows.find((r) => r.rol_firma === rol) || null;
    firmas.push({
      rol_firma: rol,
      exigible: exigibles.includes(rol),
      firmada: Boolean(fila),
      registrada_por_nombre: fila ? (fila.registrada_por_nombre || null) : null,
      firmado_en: fila ? fila.firmado_en : null,
      url_firmada: fila ? await urlFirmada(fila.imagen_path) : null
    });
  }
  const faltantes = firmas.filter((f) => f.exigible && !f.firmada).map((f) => f.rol_firma);
  return { exigibles, firmas, faltantes, completas: faltantes.length === 0 };
};

// Guarda la imagen de firma (dataURL PNG) en Storage y el registro en
// firmas_acta. Valida en el servidor quien puede registrar cada rol:
// la firma del arbitro solo la registra el arbitro asignado, la del
// anotador el anotador asignado, y las de los delegados las recoge en
// su dispositivo cualquiera de los dos oficiales asignados.
// Devuelve { error, status } cuando algo no corresponde.
const guardarFirma = async ({ partidoId, rolFirma, imagen, usuario }) => {
  try {
    if (!ROLES_FIRMA.includes(rolFirma)) {
      return { error: 'Rol de firma invalido.', status: 400 };
    }
    const imgStr = String(imagen || '');
    if (!imgStr.startsWith('data:image/png;base64,') || imgStr.length < 100) {
      return { error: 'La firma debe ser una imagen PNG valida.', status: 400 };
    }
    if (imgStr.length > 500000) {
      return { error: 'La imagen de la firma es demasiado grande.', status: 400 };
    }
    const { rows } = await db.query('SELECT id, estado, arbitro_id, anotador_id FROM public.partidos WHERE id = $1', [partidoId]);
    if (rows.length === 0) return { error: 'Partido no encontrado.', status: 404 };
    const partido = rows[0];
    if (partido.estado === 'Finalizado' || partido.estado === 'Cancelado') {
      return { error: 'No se pueden registrar firmas en un partido finalizado o cancelado.', status: 400 };
    }
    const esArbitro = String(partido.arbitro_id || '') === String(usuario.id);
    const esAnotador = String(partido.anotador_id || '') === String(usuario.id);
    const esSuperadmin = (usuario.rol || '').toLowerCase().includes('superadmin');
    if (rolFirma === 'arbitro' && !esArbitro && !esSuperadmin) {
      return { error: 'Solo el arbitro asignado puede registrar su firma.', status: 403 };
    }
    if (rolFirma === 'anotador' && !esAnotador && !esSuperadmin) {
      return { error: 'Solo el anotador asignado puede registrar su firma.', status: 403 };
    }
    if ((rolFirma === 'delegado_local' || rolFirma === 'delegado_visita') && !esArbitro && !esAnotador && !esSuperadmin) {
      return { error: 'Las firmas de los delegados las recoge el arbitro o el anotador asignado en su dispositivo.', status: 403 };
    }
    const exigibles = await firmasExigibles(partidoId);
    if (!exigibles.includes(rolFirma)) {
      return { error: 'Ese rol de firma no aplica a este partido.', status: 400 };
    }
    const path = partidoId + '/' + rolFirma + '.png';
    const base64 = imgStr.split(',')[1];
    const { error: errorStorage } = await supabaseAdmin.storage.from(BUCKET_FIRMAS).upload(path, base64, { contentType: 'image/png', upsert: true });
    if (errorStorage) {
      console.error('[firmas-acta] No se pudo subir la imagen a Storage:', { path, error: errorStorage?.message || errorStorage });
      return { error: 'No se pudo guardar la imagen de la firma.', status: 500 };
    }
    await db.query(
      'INSERT INTO public.firmas_acta (partido_id, rol_firma, registrada_por, imagen_path) VALUES ($1, $2, $3, $4) ' +
      'ON CONFLICT (partido_id, rol_firma) DO UPDATE SET registrada_por = $3, imagen_path = $4, firmado_en = now()',
      [partidoId, rolFirma, usuario.id, path]
    );
    return { ok: true };
  } catch (error) {
    console.error('[firmas-acta] Error al guardar la firma:', { partidoId, rolFirma, error: error?.message || error });
    return { error: 'Error al guardar la firma.', status: 500 };
  }
};

module.exports = { ROLES_FIRMA, firmasExigibles, estadoFirmas, guardarFirma };
