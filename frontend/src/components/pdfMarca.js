// ============================================================
// LOTE PDF MARCA: kit compartido de marca para TODOS los PDF
// del sistema (todos los roles). Encabezado con logo de la
// liga, logo CONMINGO y nombre de la liga, mas la paleta de
// marca en RGB para las tablas. Los PDF sin liga (superadmin,
// vistas publicas) salen con la marca base CONMINGO.
// LOTE 8K (revision de Keiko): las planillas de puntajes, actas
// y reportes se imprimen en BLANCO Y NEGRO (solo los logos
// conservan su color); diplomas y carnets mantienen la paleta
// de marca a color via MARCA_PDF.
// LOTE 8K FIX (reporte de Keiko): la cabecera ya no dibuja una
// bola criolla inventada. El logo real de CONMINGO es /logo.svg
// (el mismo de la barra de inicio) y se rasteriza con canvas;
// el logo de la liga se descarga y convierte a dataURL antes de
// incrustarlo.
// ============================================================

// Paleta de marca en RGB (mismos valores del tema de index.css).
export const MARCA_PDF = {
  rust: [158, 63, 35],
  brown: [87, 44, 25],
  blue: [138, 176, 188],
  cream: [242, 235, 224],
  gold: [231, 186, 103]
};

// LOTE 8K: paleta en blanco y negro para planillas, actas y
// reportes. Los logos siguen dibujandose a color; todo lo demas
// (bandas, filetes, textos y tablas) sale en escala de grises.
export const MARCA_PDF_BN = {
  rust: [90, 90, 90],
  brown: [35, 35, 35],
  blue: [110, 110, 110],
  cream: [255, 255, 255],
  gold: [130, 130, 130]
};

const formatoImagen = (url) => {
  if (typeof url !== 'string' || !url.startsWith('data:image/')) return null;
  if (url.startsWith('data:image/png')) return 'PNG';
  if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) return 'JPEG';
  return null;
};

// Descarga una imagen (URL firmada de Storage o remota) y la devuelve como
// dataURL lista para jsPDF. Devuelve null si no esta disponible.
// LOTE 8K3 (reporte de Keiko: firmas que no aparecen en el PDF): ahora hace
// dos intentos de fetch y un fallback con <img crossOrigin> + canvas, para
// cubrir respuestas lentas o bloqueos puntuales de lectura; si todo falla
// devuelve null y el acta lo deja constancia en lugar de callarse.
export const urlADataURL = async (url) => {
  if (!url) return null;
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve) => {
          const lector = new FileReader();
          lector.onload = () => resolve(lector.result);
          lector.onerror = () => resolve(null);
          lector.readAsDataURL(blob);
        });
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) return dataUrl;
      }
    } catch (e) {
      // Se reintenta una vez; si vuelve a fallar pasa al fallback.
    }
  }
  try {
    const dataUrl = await new Promise((resolve) => {
      const imagen = new Image();
      imagen.crossOrigin = 'anonymous';
      imagen.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = imagen.naturalWidth || imagen.width || 1;
          canvas.height = imagen.naturalHeight || imagen.height || 1;
          canvas.getContext('2d').drawImage(imagen, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          resolve(null);
        }
      };
      imagen.onerror = () => resolve(null);
      imagen.src = url;
    });
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) return dataUrl;
  } catch (e) {
    // Sin imagen disponible.
  }
  return null;
};

// LOTE 8K FIX: normaliza el logo de la liga para jsPDF. Acepta un dataURL
// PNG/JPEG tal cual y convierte una URL remota (Storage de Supabase)
// descargandola; asi la cabecera muestra el logo real de la liga y no un
// dibujo de relleno. Devuelve null si no se puede obtener.
export const normalizarLogoLiga = async (logoUrl) => {
  if (typeof logoUrl !== 'string' || !logoUrl) return null;
  if (logoUrl.startsWith('data:image/')) return formatoImagen(logoUrl) ? logoUrl : null;
  if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) return urlADataURL(logoUrl);
  return null;
};

// Logo de la liga en (x, y) con lado tamano. Si no hay logo (o es
// WEBP, que jsPDF no soporta) dibuja una bola criolla de marca en
// la paleta indicada. Devuelve true solo si dibujo la imagen del logo.
// (Se conserva para diplomas y carnets; el encabezado de marca ya no la usa.)
export const dibujarLogoLiga = (pdf, logoUrl, x, y, tamano, conMarco = true, paleta = MARCA_PDF) => {
  const formato = formatoImagen(logoUrl);
  if (formato) {
    try {
      if (conMarco) {
        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(paleta.gold[0], paleta.gold[1], paleta.gold[2]);
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
  pdf.setFillColor(paleta.rust[0], paleta.rust[1], paleta.rust[2]);
  pdf.circle(cx, cy, radio, 'F');
  pdf.setDrawColor(paleta.gold[0], paleta.gold[1], paleta.gold[2]);
  pdf.setLineWidth(0.6);
  pdf.circle(cx, cy, radio, 'S');
  // Cruz pintada de la bola criolla (dos bandas elipticas cruzadas).
  pdf.setDrawColor(paleta.cream[0], paleta.cream[1], paleta.cream[2]);
  pdf.setLineWidth(0.9);
  pdf.ellipse(cx, cy, radio * 0.95, radio * 0.32, 'S');
  pdf.ellipse(cx, cy, radio * 0.32, radio * 0.95, 'S');
  return false;
};

// LOTE 8K FIX: logo REAL de CONMINGO (frontend/public/logo.svg, el mismo de
// la barra de inicio). jsPDF no incrusta SVG, asi que se rasteriza una sola
// vez con canvas (lienzo 256x256 con fondo transparente, sin deformar la
// imagen) y se cachea como dataURL PNG. Si no esta disponible, la cabecera
// sale sin el y nada se rompe.
let cacheLogoConmingo; // undefined: aun no cargado; null: no disponible
let promesaLogoConmingo = null;
export const obtenerLogoConmingo = () => {
  if (cacheLogoConmingo !== undefined) return Promise.resolve(cacheLogoConmingo);
  if (!promesaLogoConmingo) {
    promesaLogoConmingo = (async () => {
      try {
        const dataUrl = await new Promise((resolve) => {
          const imagen = new Image();
          imagen.onload = () => {
            try {
              const lado = 256;
              const escala = imagen.width > 0 && imagen.height > 0 ? Math.min(lado / imagen.width, lado / imagen.height) : 1;
              const ancho = Math.max(1, Math.round(imagen.width * escala));
              const alto = Math.max(1, Math.round(imagen.height * escala));
              const canvas = document.createElement('canvas');
              canvas.width = lado;
              canvas.height = lado;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(imagen, Math.round((lado - ancho) / 2), Math.round((lado - alto) / 2), ancho, alto);
              resolve(canvas.toDataURL('image/png'));
            } catch (e) {
              resolve(null);
            }
          };
          imagen.onerror = () => resolve(null);
          imagen.src = '/logo.svg';
        });
        cacheLogoConmingo = (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png')) ? dataUrl : null;
      } catch (e) {
        cacheLogoConmingo = null;
      }
      return cacheLogoConmingo;
    })();
  }
  return promesaLogoConmingo;
};

// Encabezado de marca para todos los PDF: banda (marron a color, gris casi
// negro en blanco y negro), logo de la liga a la izquierda, logo CONMINGO a
// la derecha y nombre de la liga; titulo y subtitulo viajan en la segunda
// linea. Devuelve la Y (30) donde el documento debe continuar. Es ASINCRONA
// porque normaliza el logo de la liga y precarga el logo CONMINGO: los
// generadores deben hacer await.
// LOTE 8K FIX (reporte de Keiko): nunca se dibuja una bola inventada. A la
// izquierda va el logo real de la liga (convertido a dataURL); si la liga no
// tiene logo, ocupa su lugar el logo real de CONMINGO. El logo de CONMINGO
// va a la derecha solo cuando la izquierda es el de la liga (nunca duplicado).
export const encabezadoMarca = async (pdf, { nombreLiga = '', logoUrl = null, titulo = 'REPORTE OFICIAL', subtitulo = '', blancoYNegro = false } = {}) => {
  const paleta = blancoYNegro ? MARCA_PDF_BN : MARCA_PDF;
  const ancho = pdf.internal.pageSize.getWidth();
  // LOTE 8K3 (reporte de Keiko): en blanco y negro la cabecera NO lleva banda
  // de relleno (fondo blanco, lista para imprimir); a color conserva la banda.
  if (!blancoYNegro) {
    pdf.setFillColor(paleta.brown[0], paleta.brown[1], paleta.brown[2]);
    pdf.rect(0, 0, ancho, 22, 'F');
  }
  const logoLigaData = await normalizarLogoLiga(logoUrl);
  const logoConmingo = await obtenerLogoConmingo();
  const logoIzquierdo = logoLigaData || logoConmingo;
  const formatoIzquierdo = logoIzquierdo && logoIzquierdo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
  if (logoIzquierdo) {
    try {
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(paleta.gold[0], paleta.gold[1], paleta.gold[2]);
      pdf.setLineWidth(0.4);
      pdf.roundedRect(6, 2.5, 17, 17, 1.5, 1.5, 'FD');
      pdf.addImage(logoIzquierdo, formatoIzquierdo, 7.5, 4, 14, 14);
    } catch (e) {
      // El logo izquierdo falla: la cabecera queda solo con el texto.
    }
  }
  if (logoLigaData && logoConmingo) {
    try {
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(ancho - 23, 2.5, 17, 17, 1.5, 1.5, 'FD');
      pdf.addImage(logoConmingo, 'PNG', ancho - 21.5, 4, 14, 14);
    } catch (e) {
      // El logo CONMINGO falla: la cabecera queda solo con el logo de la liga.
    }
  }
  pdf.setFont('helvetica', 'bold');
  // LOTE 8K3: sin banda oscura el nombre va en gris casi negro; a color
  // sigue en crema sobre la banda de marca.
  const colorTitulo = blancoYNegro ? MARCA_PDF_BN.brown : MARCA_PDF.cream;
  pdf.setTextColor(colorTitulo[0], colorTitulo[1], colorTitulo[2]);
  pdf.setFontSize(12);
  pdf.text(nombreLiga ? String(nombreLiga) : 'CONMINGO', 27, 9.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(paleta.gold[0], paleta.gold[1], paleta.gold[2]);
  const linea = (nombreLiga ? 'CONMINGO - ' : '') + titulo + (subtitulo ? ' - ' + subtitulo : '');
  pdf.text(String(linea).toUpperCase(), 27, 17);
  pdf.setDrawColor(paleta.gold[0], paleta.gold[1], paleta.gold[2]);
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

