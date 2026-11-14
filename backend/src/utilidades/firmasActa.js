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

// Devuelve la imagen de una firma lista para mostrar e incrustar en el PDF.
// LOTE 8K5 (reporte de Keiko: "Firma registrada (imagen no disponible)" y el
// "wrong PNG signature" anterior): las firmas se guardaban en Storage como el
// TEXTO base64 de la imagen, no como los bytes PNG decodificados, asi que el
// navegador y jsPDF las rechazaban. Esta funcion descarga el objeto, verifica
// la firma de bytes PNG real (89 50 4E 47) y si el objeto es base64 legado lo
// decodifica al vuelo; devuelve un dataURL directo (funciona en <img>, en el
// endpoint publico y en jsPDF sin depender de CORS) y como ultimo recurso la
// URL firmada.
const esPngReal = (buf) => Buffer.isBuffer(buf) && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

const urlFirmada = async (imagenPath) => {
  try {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET_FIRMAS).download(imagenPath);
    if (error) throw error;
    const buf = Buffer.from(await data.arrayBuffer());
    if (esPngReal(buf)) {
      return 'data:image/png;base64,' + buf.toString('base64');
    }
    // Objeto legado: el texto base64 de la imagen guardado como archivo.
    const texto = buf.toString('utf8').trim();
    const base64Limpio = texto.includes(',') ? texto.split(',').pop().trim() : texto;
    const decodificado = Buffer.from(base64Limpio, 'base64');
    if (esPngReal(decodificado)) {
      return 'data:image/png;base64,' + decodificado.toString('base64');
    }
    // No es PNG ni base64 legado: URL firmada por si es JPEG u otro formato.
    const firmada = await supabaseAdmin.storage.from(BUCKET_FIRMAS).createSignedUrl(imagenPath, 3600);
    if (firmada.error) throw firmada.error;
    return firmada.data?.signedUrl || null;
  } catch (error) {
    console.error('[firmas-acta] No se pudo preparar la imagen de la firma:', { imagenPath, error: error?.message || error });
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
    // LOTE 8K: el partido se FINALIZA primero (para preservar la hora final
    // verdadera) y las firmas se recogen despues; solo Cancelado bloquea.
    if (partido.estado === 'Cancelado') {
      return { error: 'No se pueden registrar firmas en un partido cancelado.', status: 400 };
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
    // LOTE 8K5 (causa raiz de las firmas invisibles en el PDF): se suben los
    // BYTES PNG decodificados, no el texto base64. Antes el archivo quedaba
    // como texto con etiqueta image/png y ni el navegador ni jsPDF podian
    // leerlo ("wrong PNG signature").
    const bytesPng = Buffer.from(base64, 'base64');
    if (!esPngReal(bytesPng)) {
      return { error: 'La imagen de la firma esta corrupta. Vuelve a firmar.', status: 400 };
    }
    const { error: errorStorage } = await supabaseAdmin.storage.from(BUCKET_FIRMAS).upload(path, bytesPng, { contentType: 'image/png', upsert: true });
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


