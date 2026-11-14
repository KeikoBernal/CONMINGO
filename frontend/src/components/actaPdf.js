// ============================================================
// LOTE 8K: generador compartido del ACTA OFICIAL EN PDF (la
// planilla de puntajes con lanzamientos, tantos por mano y
// firmas). Lo usan la PlanillaUniversal (boton Descargar Acta
// Oficial en PDF), los paneles de anotador y arbitro (partido
// activo e historial) y el AdminLiga (historial). Estilo blanco
// y negro con el logo de la liga y el logo CONMINGO en la
// cabecera, y las firmas digitales incrustadas cuando estan
// registradas (pedido de Keiko).
// ============================================================
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatearFecha, formatearHora } from './fechas';
import { encabezadoMarca, MARCA_PDF_BN } from './pdfMarca';

// Descarga una imagen (URL firmada de Storage) y la devuelve como
// dataURL lista para jsPDF. Devuelve null si no esta disponible.
export const urlADataURL = async (url) => {
  try {
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve) => {
      const lector = new FileReader();
      lector.onload = () => resolve(lector.result);
      lector.onerror = () => resolve(null);
      lector.readAsDataURL(blob);
    });
    return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null;
  } catch (e) {
    return null;
  }
};

// Genera y descarga el acta oficial en PDF. Los datos son los mismos que
// pinta la PlanillaUniversal; firmas es el estado de firmasActa del backend
// (array con rol_firma, firmada y url_firmada) y es opcional: sin firmas el
// acta sale con las lineas en blanco.
export const generarActaPDF = async ({
  nombreLiga = '',
  logoLiga = null,
  datosPartido = {},
  jugadoresLocal = [],
  jugadoresVisita = [],
  efectividadJugadores = {},
  manualStats = {},
  puntosPorManoLocal = Array(20).fill(''),
  puntosPorManoVisita = Array(20).fill(''),
  firmas = null,
  nombreArchivo = null
} = {}) => {
  const doc = new jsPDF('landscape');

  // LOTE 8K: cabecera en blanco y negro con el logo de la liga y el logo CONMINGO.
  await encabezadoMarca(doc, { nombreLiga, logoUrl: logoLiga, titulo: 'PLANILLA OFICIAL DE ANOTACIÓN', blancoYNegro: true });

  const totalLocal = puntosPorManoLocal.reduce((acc, val) => acc + (Number(val) || 0), 0);
  const totalVisita = puntosPorManoVisita.reduce((acc, val) => acc + (Number(val) || 0), 0);

  // LOTE 8K: las firmas llegan como array plano (endpoint publico) o como el
  // objeto completo del endpoint autenticado ({ firmas: [...] }); se normaliza.
  const listaFirmas = Array.isArray(firmas) ? firmas : (firmas && Array.isArray(firmas.firmas) ? firmas.firmas : null);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Encuentro: ${datosPartido.localNombre || 'Local'} vs ${datosPartido.visitaNombre || 'Visita'}`, 14, 30);
  doc.text(`Fecha: ${datosPartido.fecha || '---'} | H. Inicio: ${formatearHora(datosPartido.horaInicio) || '--:--'} | H. Final: ${formatearHora(datosPartido.horaFinal) || '--:--'}`, 14, 36);
  doc.text(`Marcador Final: ${datosPartido.localNombre} (${totalLocal}) - (${totalVisita}) ${datosPartido.visitaNombre}`, 14, 42);

  const headBase = ['N°', 'JUGADORES', ...Array.from({ length: 20 }, (_, i) => (i + 1).toString()), 'AL', 'AB', 'BL', 'BB'];

  const filasEquipo = (jugadores) => {
    const body = jugadores.map(j => {
      const stats = manualStats[j.id] || { AL: 0, AB: 0, BL: 0, BB: 0 };
      const manos = Array.from({ length: 20 }, (_, i) => {
        const jugada = efectividadJugadores[j.id]?.[i];
        return jugada?.valor || '';
      });
      return [
        j.numero_dorsal,
        `${j.apellido} ${j.nombre}`.toUpperCase(),
        ...manos,
        stats.AL || '', stats.AB || '', stats.BL || '', stats.BB || ''
      ];
    });
    return body;
  };
  // Nota: las filas de puntuacion por mano se agregan aparte para respetar
  // el orden exacto de columnas (20 manos + 4 stats).
  const filaTantos = (puntos) => ([
    '', 'PUNTUACIÓN POR MANO ->', ...puntos.map(p => p !== 0 && p !== '' ? p.toString() : ''), '', '', '', ''
  ]);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`EQUIPO LOCAL: ${datosPartido.localNombre} (Capitán: ${datosPartido.capitanLocal || 'N/R'})`, 14, 49);

  const bodyLocal = filasEquipo(jugadoresLocal);
  bodyLocal[bodyLocal.length - 1] = filaTantos(puntosPorManoLocal);
  autoTable(doc, {
    startY: 51,
    head: [headBase],
    body: bodyLocal,
    theme: 'grid',
    styles: { fontSize: 7, halign: 'center', cellPadding: 1, lineColor: [0, 0, 0], lineWidth: 0.1 },
    columnStyles: { 1: { halign: 'left', cellWidth: 50 } },
    headStyles: { fillColor: MARCA_PDF_BN.brown, textColor: MARCA_PDF_BN.cream },
    didParseCell: function (data) {
      if (data.row.index === bodyLocal.length - 1) {
        data.cell.styles.fillColor = MARCA_PDF_BN.cream;
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  const finalYLocal = doc.lastAutoTable.finalY || 46;
  doc.text(`EQUIPO VISITANTE: ${datosPartido.visitaNombre} (Capitán: ${datosPartido.capitanVisita || 'N/R'})`, 14, finalYLocal + 12);

  const bodyVisita = filasEquipo(jugadoresVisita);
  bodyVisita[bodyVisita.length - 1] = filaTantos(puntosPorManoVisita);
  autoTable(doc, {
    startY: finalYLocal + 15,
    head: [headBase],
    body: bodyVisita,
    theme: 'grid',
    styles: { fontSize: 7, halign: 'center', cellPadding: 1, lineColor: [0, 0, 0], lineWidth: 0.1 },
    columnStyles: { 1: { halign: 'left', cellWidth: 50 } },
    headStyles: { fillColor: MARCA_PDF_BN.brown, textColor: MARCA_PDF_BN.cream },
    didParseCell: function (data) {
      if (data.row.index === bodyVisita.length - 1) {
        data.cell.styles.fillColor = MARCA_PDF_BN.cream;
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  // LOTE 8K: firmas reales del acta (capitanes/delegados, arbitro y anotador;
  // los roles Juez de Calce y Juez de Mingo no se usan en la liga). Cada
  // firma digital registrada se incrusta sobre su linea; las pendientes
  // quedan en blanco para firmar a mano.
  const slotsFirma = [
    { etiqueta: 'Capitán / Delegado (Local)', x: 14, rol: 'delegado_local' },
    { etiqueta: 'Capitán / Delegado (Visitante)', x: 88, rol: 'delegado_visita' },
    { etiqueta: datosPartido.arbitro ? 'Árbitro: ' + datosPartido.arbitro : 'Árbitro', x: 162, rol: 'arbitro' },
    { etiqueta: datosPartido.anotador ? 'Anotador: ' + datosPartido.anotador : 'Anotador', x: 236, rol: 'anotador' }
  ];
  let yFirmas = doc.lastAutoTable.finalY + 22;
  if (yFirmas > 170) {
    doc.addPage();
    yFirmas = 30;
  }
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.3);
  for (const slot of slotsFirma) doc.line(slot.x, yFirmas, slot.x + 55, yFirmas);
  if (listaFirmas) {
    for (const slot of slotsFirma) {
      const firma = listaFirmas.find(f => f.rol_firma === slot.rol && f.firmada && f.url_firmada);
      if (!firma) continue;
      try {
        const img = await urlADataURL(firma.url_firmada);
        if (img) doc.addImage(img, 'PNG', slot.x + 7, yFirmas - 16, 40, 14);
      } catch (e) {
        // La imagen no esta disponible: queda la linea en blanco.
      }
    }
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  for (const slot of slotsFirma) {
    doc.text(String(slot.etiqueta), slot.x + 27.5, yFirmas + 5, { align: 'center' });
  }

  const nombre = (nombreArchivo || `Acta_${datosPartido.localNombre}_vs_${datosPartido.visitaNombre}.pdf`).replace(/\s+/g, '_');
  doc.save(nombre);
};

// Trae todo lo necesario para generar el acta de un partido ya guardado
// (historial de anotador/arbitro y AdminLiga): metadatos publicos, nomina,
// planilla persistida (lanzamientos y tantos por mano) y firmas registradas.
// fetchConToken es el helper del panel (agrega el Bearer); apiUrl es la base
// de la API para los endpoints publicos.
export const cargarDatosActa = async (partidoId, { fetchConToken, apiUrl }) => {
  const id = encodeURIComponent(partidoId);
  const resPartido = await fetchConToken(`/publico/partidos/${id}`);
  const partido = await resPartido.json();
  if (!resPartido.ok) throw new Error(partido.error || 'Partido no encontrado.');
  const resNomina = await fetchConToken(`/publico/partidos/${id}/nomina`);
  const nomina = resNomina.ok ? await resNomina.json() : [];
  let planilla = {};
  try {
    const resPlanilla = await fetch(`${apiUrl}/publico/partidos/${id}/planilla`);
    if (resPlanilla.ok) planilla = await resPlanilla.json();
  } catch (e) {
    // Sin planilla persistida el acta sale con la tabla vacia.
  }
  let firmas = null;
  try {
    const resFirmas = await fetchConToken(`/partidos/${id}/firmas`);
    if (resFirmas.ok) firmas = await resFirmas.json();
  } catch (e) {
    // Sin firmas el acta sale con las lineas en blanco.
  }
  return { partido, nomina, planilla, firmas };
};

// Puente entre lo que devuelven los endpoints publicos y generarActaPDF.
export const generarActaDesdePartido = async (partido, nomina, planilla, firmas, { nombreLiga = '', logoLiga = null } = {}) => {
  return generarActaPDF({
    nombreLiga,
    logoLiga,
    datosPartido: {
      arbitro: partido.arbitro_nombre,
      anotador: partido.anotador_nombre,
      capitanLocal: partido.capitan_local_nombre,
      capitanVisita: partido.capitan_visita_nombre,
      localNombre: partido.local_nombre,
      visitaNombre: partido.visita_nombre,
      fecha: partido.fecha_hora ? formatearFecha(partido.fecha_hora) : '',
      horaInicio: partido.hora_inicio,
      horaFinal: partido.hora_final
    },
    jugadoresLocal: nomina.filter(j => j.equipo_id === partido.equipo_local_id),
    jugadoresVisita: nomina.filter(j => j.equipo_id === partido.equipo_visita_id),
    efectividadJugadores: planilla.efectividad || {},
    manualStats: planilla.manualStats || {},
    puntosPorManoLocal: planilla.tantosLocal || Array(20).fill(''),
    puntosPorManoVisita: planilla.tantosVisita || Array(20).fill(''),
    firmas
  });
};
