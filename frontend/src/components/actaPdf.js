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
// LOTE 8K FIX: urlADataURL vive en pdfMarca (la usa tambien el encabezado
// para convertir el logo de la liga) y se re-exporta por compatibilidad.
import { encabezadoMarca, MARCA_PDF_BN, urlADataURL } from './pdfMarca';
export { urlADataURL };

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
  disciplina = null,
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
    headStyles: { fillColor: MARCA_PDF_BN.cream, textColor: MARCA_PDF_BN.brown }, // LOTE 8K3: cabecera blanca con texto oscuro, sin relleno negro
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
    headStyles: { fillColor: MARCA_PDF_BN.cream, textColor: MARCA_PDF_BN.brown }, // LOTE 8K3: cabecera blanca con texto oscuro, sin relleno negro
    didParseCell: function (data) {
      if (data.row.index === bodyVisita.length - 1) {
        data.cell.styles.fillColor = MARCA_PDF_BN.cream;
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  // LOTE 8K6 (pedido de Keiko): sección de disciplina del acta. Reúne las
  // tarjetas emitidas en el partido, las incidencias reportadas por el
  // árbitro y las protestas presentadas por los delegados. Si no hay nada
  // registrado la sección se omite y el acta queda como antes.
  const disc = disciplina || {};
  const nombreJugadorDisciplina = (x) => {
    if (!x || (!x.jugador_nombre && !x.jugador_apellido)) return '';
    const base = [x.jugador_apellido, x.jugador_nombre].filter(Boolean).join(' ').toUpperCase();
    return x.numero_dorsal !== null && x.numero_dorsal !== undefined && x.numero_dorsal !== ''
      ? `${base} (N° ${x.numero_dorsal})`
      : base;
  };
  const filasDisciplina = [];
  (disc.tarjetas || []).forEach(t => {
    filasDisciplina.push([
      'Tarjeta ' + (t.color || ''),
      nombreJugadorDisciplina(t),
      t.motivo || ''
    ]);
  });
  (disc.incidencias || []).forEach(i => {
    filasDisciplina.push([
      'Incidencia: ' + (i.tipo || ''),
      nombreJugadorDisciplina(i),
      i.descripcion || ''
    ]);
  });
  (disc.protestas || []).forEach(p => {
    const resolucionProtesta = p.estado === 'Resuelta'
      ? (p.medida_marcador_local !== null && p.medida_marcador_local !== undefined
          ? `Resuelta. Marcador ajustado a ${p.medida_marcador_local} - ${p.medida_marcador_visita}.` + (p.nota_resolucion ? ' ' + p.nota_resolucion : '')
          : ('Resuelta.' + (p.nota_resolucion ? ' ' + p.nota_resolucion : '')))
      : (p.estado === 'Pendiente Confirmacion' ? 'Pendiente de confirmación de los oficiales.' : (p.estado || 'Pendiente') + '.');
    filasDisciplina.push([
      'Protesta' + (p.equipo_protestante ? ': ' + p.equipo_protestante : ''),
      p.motivo || '',
      resolucionProtesta
    ]);
  });
  if (filasDisciplina.length > 0) {
    const finalYVisitaDisc = doc.lastAutoTable.finalY || 46;
    let yDisc = finalYVisitaDisc + 12;
    if (yDisc > 160) {
      doc.addPage();
      yDisc = 30;
    }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(35, 35, 35);
    doc.text('INCIDENCIAS Y SANCIONES', 14, yDisc);
    autoTable(doc, {
      startY: yDisc + 3,
      head: [['REGISTRO', 'INVOLUCRADO', 'MOTIVO / RESOLUCIÓN']],
      body: filasDisciplina,
      theme: 'grid',
      styles: { fontSize: 7.5, halign: 'left', cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.1 },
      columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 80 }, 2: { cellWidth: 'auto' } },
      headStyles: { fillColor: MARCA_PDF_BN.cream, textColor: MARCA_PDF_BN.brown } // LOTE 8K3: cabecera blanca con texto oscuro
    });
  }

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
      // LOTE 8K3 (reporte de Keiko): una firma REGISTRADA cuya imagen no se
      // pudo incrustar (URL firmada vencida o no disponible) ya no se queda
      // en blanco en silencio: el acta lo indica sobre la linea.
      const firma = listaFirmas.find(f => f.rol_firma === slot.rol && f.firmada);
      if (!firma) continue;
      let img = null;
      if (firma.url_firmada) {
        try { img = await urlADataURL(firma.url_firmada); } catch (e) { img = null; }
      }
      if (img) {
        // LOTE 8K4: el formato se deduce del dataURL (urlADataURL ya garantiza
        // que los bytes son un PNG o JPEG real); nunca se declara PNG a ciegas.
        const formatoFirma = (img.startsWith('data:image/jpeg') || img.startsWith('data:image/jpg')) ? 'JPEG' : 'PNG';
        doc.addImage(img, formatoFirma, slot.x + 7, yFirmas - 16, 40, 14);
      } else {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(110, 110, 110);
        doc.text('Firma registrada (imagen no disponible)', slot.x + 27.5, yFirmas - 6, { align: 'center' });
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
  // LOTE 8K FIX (reporte de Keiko): los endpoints /publico son PUBLICOS y
  // viven en la raiz de la API; fetchConToken prefija el router del rol
  // (/operativo o /admin-liga), donde esas rutas NO existen (404) y por eso
  // fallaban las descargas del acta. Se consultan con fetch plano.
  const resPartido = await fetch(`${apiUrl}/publico/partidos/${id}`);
  const partido = await resPartido.json();
  if (!resPartido.ok) throw new Error(partido.error || 'Partido no encontrado.');
  const resNomina = await fetch(`${apiUrl}/publico/partidos/${id}/nomina`);
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
  // LOTE 8K6: disciplina del partido (tarjetas, incidencias y protestas)
  // para la seccion final del acta. Endpoint publico: fetch plano.
  let disciplina = null;
  try {
    const resDisciplina = await fetch(`${apiUrl}/publico/partidos/${id}/disciplina`);
    if (resDisciplina.ok) disciplina = await resDisciplina.json();
  } catch (e) {
    // Sin disciplina registrada la seccion se omite.
  }
  return { partido, nomina, planilla, firmas, disciplina };
};

// Puente entre lo que devuelven los endpoints publicos y generarActaPDF.
export const generarActaDesdePartido = async (partido, nomina, planilla, firmas, { nombreLiga = '', logoLiga = null, disciplina = null } = {}) => {
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
    firmas,
    disciplina
  });
};




