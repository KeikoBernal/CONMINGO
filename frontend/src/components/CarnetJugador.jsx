import jsPDF from 'jspdf';

/**
 * ========================================================
 * LOTE 3D (N5): CARNETS DE JUGADOR EN PDF
 * Genera carnets tamaño carnet (ISO ID-1, 85.6 x 54 mm) en
 * grilla de 2 x 4 por página A4, listos para recortar por
 * el borde dorado. Componente 100 por ciento pasivo: no
 * llama a la API ni escribe en la BD, solo dibuja el PDF
 * con los datos que recibe por parámetros (jspdf ya
 * existente en el proyecto, cero dependencias nuevas).
 * ========================================================
 */

const COLOR_BROWN = [87, 44, 25];
const COLOR_RUST = [158, 63, 35];
const COLOR_CREAM = [242, 235, 224];
const COLOR_GOLD = [231, 186, 103];

const ANCHO_CARNET = 85.6;
const ALTO_CARNET = 54;
const FILAS_POR_PAGINA = 4;

const recortar = (doc, texto, anchoMax) => {
  const t = String(texto || '');
  if (doc.getTextWidth(t) <= anchoMax) return t;
  let recortado = t;
  while (recortado.length > 1 && doc.getTextWidth(recortado + '...') > anchoMax) {
    recortado = recortado.slice(0, -1);
  }
  return recortado + '...';
};

const detectarFormato = (dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  if (dataUrl.startsWith('data:image/png')) return 'PNG';
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG';
  return 'NO_SOPORTADO';
};

const dibujarLogo = (doc, logoUrl, x, y, tamano) => {
  const formato = detectarFormato(logoUrl);
  if (!formato || formato === 'NO_SOPORTADO') return false;
  try {
    doc.addImage(logoUrl, formato, x, y, tamano, tamano);
    return true;
  } catch (error) {
    console.error('[carnet] No se pudo dibujar el logo de la liga:', error?.message || error);
    return false;
  }
};

const dibujarCarnet = (doc, organizacion, equipo, jugador, x, y) => {
  // Base blanca con borde dorado (guía de corte)
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(COLOR_GOLD[0], COLOR_GOLD[1], COLOR_GOLD[2]);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, ANCHO_CARNET, ALTO_CARNET, 2, 2, 'FD');

  // Banda superior de la liga
  doc.setFillColor(COLOR_BROWN[0], COLOR_BROWN[1], COLOR_BROWN[2]);
  doc.rect(x, y, ANCHO_CARNET, 14, 'F');
  const logoOk = dibujarLogo(doc, organizacion?.logo_url, x + 2, y + 2, 10);
  const textoX = logoOk ? x + 14 : x + 3;
  const textoAncho = ANCHO_CARNET - (textoX - x) - 3;
  doc.setTextColor(COLOR_CREAM[0], COLOR_CREAM[1], COLOR_CREAM[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(recortar(doc, organizacion?.nombre || 'Liga de Bolas Criollas', textoAncho), textoX, y + 6);
  doc.setFontSize(5.5);
  doc.setTextColor(COLOR_GOLD[0], COLOR_GOLD[1], COLOR_GOLD[2]);
  doc.text('CARNET DE JUGADOR', textoX, y + 11.5);

  // Foto del jugador (o placeholder con iniciales si no tiene foto)
  const fotoX = x + 3;
  const fotoY = y + 17;
  const fotoW = 20;
  const fotoH = 24;
  let fotoOk = false;
  const formatoFoto = detectarFormato(jugador.foto_url);
  if (formatoFoto && formatoFoto !== 'NO_SOPORTADO') {
    try {
      doc.addImage(jugador.foto_url, formatoFoto, fotoX, fotoY, fotoW, fotoH);
      fotoOk = true;
    } catch (error) {
      console.error('[carnet] No se pudo dibujar la foto del jugador:', error?.message || error);
    }
  }
  if (!fotoOk) {
    doc.setFillColor(COLOR_CREAM[0], COLOR_CREAM[1], COLOR_CREAM[2]);
    doc.rect(fotoX, fotoY, fotoW, fotoH, 'F');
    doc.setTextColor(COLOR_BROWN[0], COLOR_BROWN[1], COLOR_BROWN[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(String(jugador.nombre || '?').charAt(0) + String(jugador.apellido || '?').charAt(0), fotoX + fotoW / 2, fotoY + fotoH / 2 + 2, { align: 'center' });
  }
  doc.setDrawColor(COLOR_GOLD[0], COLOR_GOLD[1], COLOR_GOLD[2]);
  doc.setLineWidth(0.3);
  doc.rect(fotoX, fotoY, fotoW, fotoH);

  // Datos del jugador
  const datosX = x + 26;
  const datosAncho = ANCHO_CARNET - (datosX - x) - 4;
  const nombreCompleto = (String(jugador.nombre || '') + ' ' + String(jugador.apellido || '')).trim() || 'Jugador';
  doc.setTextColor(COLOR_BROWN[0], COLOR_BROWN[1], COLOR_BROWN[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(recortar(doc, nombreCompleto, datosAncho), datosX, y + 22);
  doc.setFontSize(7.5);
  doc.text('C.I.: ' + String(jugador.cedula || 'N/D'), datosX, y + 28);
  doc.setFont('helvetica', 'normal');
  doc.text('Equipo: ' + recortar(doc, equipo?.nombre || 'N/D', datosAncho), datosX, y + 34);
  doc.text('Categoría: ' + recortar(doc, equipo?.categoria || 'N/D', datosAncho), datosX, y + 39);

  // Dorsal destacado
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(COLOR_RUST[0], COLOR_RUST[1], COLOR_RUST[2]);
  doc.text('#' + String(jugador.numero_dorsal || '--'), x + ANCHO_CARNET - 3, y + 27, { align: 'right' });

  // Pie del carnet
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(120, 120, 120);
  doc.text('Documento personal e intransferible', x + 3, y + ALTO_CARNET - 3);
};

const sanitizarNombreArchivo = (texto) => {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'jugador';
};

export const generarCarnetsPdf = async ({ organizacion, equipo, jugadores }) => {
  if (!Array.isArray(jugadores) || jugadores.length === 0) {
    throw new Error('No hay jugadores para generar carnets.');
  }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margenX = 12.2;
  const columnaX = [margenX, 210 - margenX - ANCHO_CARNET];
  jugadores.forEach((jugador, indice) => {
    const posEnPagina = indice % (FILAS_POR_PAGINA * 2);
    if (indice > 0 && posEnPagina === 0) doc.addPage();
    const x = columnaX[posEnPagina % 2];
    const y = 20 + Math.floor(posEnPagina / 2) * 62;
    dibujarCarnet(doc, organizacion, equipo, jugador, x, y);
  });
  const nombreBase = jugadores.length === 1
    ? 'carnet_' + sanitizarNombreArchivo(String(jugadores[0].numero_dorsal || '') + '_' + jugadores[0].nombre + '_' + jugadores[0].apellido)
    : 'carnets_' + sanitizarNombreArchivo(equipo?.nombre || 'equipo');
  doc.save(nombreBase + '.pdf');
};

export default generarCarnetsPdf;
