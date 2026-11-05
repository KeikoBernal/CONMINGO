// ============================================================
// LOTE PDF MARCA: kit compartido de marca para TODOS los PDF
// del sistema (todos los roles). Encabezado con banda marron,
// filete dorado, logo de la liga (o bola criolla dibujada si no
// hay logo) y nombre de la liga, mas la paleta de marca en RGB
// para las tablas. Los PDF sin liga (superadmin, vistas
// publicas) salen con la marca base CONMINGO.
// ============================================================

// Paleta de marca en RGB (mismos valores del tema de index.css).
export const MARCA_PDF = {
  rust: [158, 63, 35],
  brown: [87, 44, 25],
  blue: [138, 176, 188],
  cream: [242, 235, 224],
  gold: [231, 186, 103]
};

const formatoImagen = (url) => {
  if (typeof url !== 'string' || !url.startsWith('data:image/')) return null;
  if (url.startsWith('data:image/png')) return 'PNG';
  if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) return 'JPEG';
  return null;
};

// Logo de la liga en (x, y) con lado tamano. Si no hay logo (o es
// WEBP, que jsPDF no soporta) dibuja una bola criolla de marca:
// circulo rust con aro dorado y cruz pintada crema. Devuelve true
// solo si dibujo la imagen del logo.
export const dibujarLogoLiga = (pdf, logoUrl, x, y, tamano, conMarco = true) => {
  const formato = formatoImagen(logoUrl);
  if (formato) {
    try {
      if (conMarco) {
        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(MARCA_PDF.gold[0], MARCA_PDF.gold[1], MARCA_PDF.gold[2]);
        pdf.setLineWidth(0.4);
        pdf.roundedRect(x, y, tamano, tamano, 1.5, 1.5, 'FD');
      }
      const borde = conMarco ? tamano * 0.09 : 0;
      pdf.addImage(logoUrl, formato, x + borde, y + borde, tamano - 2 * borde, tamano - 2 * borde);
      return true;
    } catch (e) {
      // El logo falla: se dibuja la bola de marca en su lugar.
    }
  }
  const cx = x + tamano / 2;
  const cy = y + tamano / 2;
  const radio = tamano / 2 - 0.5;
  pdf.setFillColor(MARCA_PDF.rust[0], MARCA_PDF.rust[1], MARCA_PDF.rust[2]);
  pdf.circle(cx, cy, radio, 'F');
  pdf.setDrawColor(MARCA_PDF.gold[0], MARCA_PDF.gold[1], MARCA_PDF.gold[2]);
  pdf.setLineWidth(0.6);
  pdf.circle(cx, cy, radio, 'S');
  // Cruz pintada de la bola criolla (dos bandas elipticas cruzadas).
  pdf.setDrawColor(MARCA_PDF.cream[0], MARCA_PDF.cream[1], MARCA_PDF.cream[2]);
  pdf.setLineWidth(0.9);
  pdf.ellipse(cx, cy, radio * 0.95, radio * 0.32, 'S');
  pdf.ellipse(cx, cy, radio * 0.32, radio * 0.95, 'S');
  return false;
};

// Encabezado de marca para todos los PDF: banda marron, filete
// dorado, logo y nombre de la liga; titulo y subtitulo viajan en
// la segunda linea dorada. Devuelve la Y (30) donde el documento
// debe continuar.
export const encabezadoMarca = (pdf, { nombreLiga = '', logoUrl = null, titulo = 'REPORTE OFICIAL', subtitulo = '' } = {}) => {
  const ancho = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(MARCA_PDF.brown[0], MARCA_PDF.brown[1], MARCA_PDF.brown[2]);
  pdf.rect(0, 0, ancho, 22, 'F');
  dibujarLogoLiga(pdf, logoUrl, 6, 2.5, 17, true);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(MARCA_PDF.cream[0], MARCA_PDF.cream[1], MARCA_PDF.cream[2]);
  pdf.setFontSize(12);
  pdf.text(nombreLiga ? String(nombreLiga) : 'CONMINGO', 27, 9.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(MARCA_PDF.gold[0], MARCA_PDF.gold[1], MARCA_PDF.gold[2]);
  const linea = (nombreLiga ? 'CONMINGO - ' : '') + titulo + (subtitulo ? ' - ' + subtitulo : '');
  pdf.text(String(linea).toUpperCase(), 27, 17);
  pdf.setDrawColor(MARCA_PDF.gold[0], MARCA_PDF.gold[1], MARCA_PDF.gold[2]);
  pdf.setLineWidth(0.6);
  pdf.line(0, 22, ancho, 22);
  return 30;
};

// Reduce el tamano de fuente hasta que el texto cabe en anchoMax.
export const ajustarTexto = (pdf, texto, anchoMax, tamanoInicial, tamanoMinimo = 6) => {
  let tamano = tamanoInicial;
  pdf.setFontSize(tamano);
  while (tamano > tamanoMinimo && pdf.getTextWidth(String(texto)) > anchoMax) {
    tamano -= 0.5;
    pdf.setFontSize(tamano);
  }
  return tamano;
};
