import React from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function PlanillaUniversal({
  rol = 'espectador',
  estadoPartido = 'Agendado',
  partidoId = null,
  datosPartido = {},
  jugadoresLocal = [],
  jugadoresVisita = [],
  efectividadJugadores = {},
  manualStats = {},
  puntosPorManoLocal = Array(20).fill(''),
  puntosPorManoVisita = Array(20).fill(''),
  alHacerClicCelda = () => {},
  alHacerClicPuntuacion = () => {},
  alSeleccionarStatCell = () => {}
}) {
  const manoIndices = Array.from({ length: 20 }, (_, i) => i + 1);

  const totalLocal = puntosPorManoLocal.reduce((acc, val) => acc + (Number(val) || 0), 0);
  const totalVisita = puntosPorManoVisita.reduce((acc, val) => acc + (Number(val) || 0), 0);
  
  let textoMarcador = "Encuentro Igualado";
  if (totalLocal > totalVisita) textoMarcador = `Lidera ${datosPartido.localNombre} (+${totalLocal - totalVisita})`;
  if (totalVisita > totalLocal) textoMarcador = `Lidera ${datosPartido.visitaNombre} (+${totalVisita - totalLocal})`;

  // ==========================================
  // FUNCIÓN GENERADORA DEL PDF NATIVO
  // ==========================================
  const generarPDF = () => {
    const doc = new jsPDF('landscape');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text("LIGA DE BOLAS CRIOLLAS - PLANILLA OFICIAL DE ANOTACIÓN", 14, 15);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Encuentro: ${datosPartido.localNombre || 'Local'} vs ${datosPartido.visitaNombre || 'Visita'}`, 14, 22);
    doc.text(`Fecha: ${datosPartido.fecha || '---'} | H. Inicio: ${datosPartido.horaInicio || '--:--'} | H. Final: ${datosPartido.horaFinal || '--:--'}`, 14, 28);
    doc.text(`Marcador Final: ${datosPartido.localNombre} (${totalLocal}) - (${totalVisita}) ${datosPartido.visitaNombre}`, 14, 34);

    const headBase = ['N°', 'JUGADORES', ...Array.from({length: 20}, (_, i) => (i + 1).toString()), 'AL', 'AB', 'BL', 'BB'];

    const bodyLocal = jugadoresLocal.map(j => {
      const stats = manualStats[j.id] || { AL: 0, AB: 0, BL: 0, BB: 0 };
      const manos = Array.from({length: 20}, (_, i) => {
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
    
    bodyLocal.push([
      '', 'PUNTUACIÓN POR MANO ->', ...puntosPorManoLocal.map(p => p !== 0 && p !== '' ? p.toString() : ''), '', '', '', ''
    ]);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`EQUIPO LOCAL: ${datosPartido.localNombre} (Capitán: ${datosPartido.capitanLocal || 'N/R'})`, 14, 43);
    
    autoTable(doc, {
      startY: 46,
      head: [headBase],
      body: bodyLocal,
      theme: 'grid',
      styles: { fontSize: 7, halign: 'center', cellPadding: 1, lineColor: [0, 0, 0], lineWidth: 0.1 },
      columnStyles: { 1: { halign: 'left', cellWidth: 50 } }, 
      headStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0] },
      didParseCell: function (data) {
        if (data.row.index === bodyLocal.length - 1) {
          data.cell.styles.fillColor = [240, 240, 240]; 
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    const bodyVisita = jugadoresVisita.map(j => {
      const stats = manualStats[j.id] || { AL: 0, AB: 0, BL: 0, BB: 0 };
      const manos = Array.from({length: 20}, (_, i) => {
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

    bodyVisita.push([
      '', 'PUNTUACIÓN POR MANO ->', ...puntosPorManoVisita.map(p => p !== 0 && p !== '' ? p.toString() : ''), '', '', '', ''
    ]);

    const finalYLocal = doc.lastAutoTable.finalY || 46;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`EQUIPO VISITANTE: ${datosPartido.visitaNombre} (Capitán: ${datosPartido.capitanVisita || 'N/R'})`, 14, finalYLocal + 10);

    autoTable(doc, {
      startY: finalYLocal + 13,
      head: [headBase],
      body: bodyVisita,
      theme: 'grid',
      styles: { fontSize: 7, halign: 'center', cellPadding: 1, lineColor: [0, 0, 0], lineWidth: 0.1 },
      columnStyles: { 1: { halign: 'left', cellWidth: 50 } },
      headStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0] },
      didParseCell: function (data) {
        if (data.row.index === bodyVisita.length - 1) {
          data.cell.styles.fillColor = [240, 240, 240];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    let finalYVisita = doc.lastAutoTable.finalY + 25;
    if (finalYVisita > 170) {
      doc.addPage();
      finalYVisita = 30;
    }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    doc.line(30, finalYVisita, 90, finalYVisita);
    doc.text("Capitán / Delegado (Local)", 42, finalYVisita + 5);

    doc.line(190, finalYVisita, 250, finalYVisita);
    doc.text("Capitán / Delegado (Visitante)", 198, finalYVisita + 5);

    finalYVisita += 25;
    doc.line(30, finalYVisita, 90, finalYVisita);
    doc.text(`Anotador: ${datosPartido.anotador || '_______________'}`, 40, finalYVisita + 5);

    doc.line(110, finalYVisita, 170, finalYVisita);
    doc.text("Juez de Calce", 130, finalYVisita + 5);

    doc.line(190, finalYVisita, 250, finalYVisita);
    doc.text("Juez de Mingo", 210, finalYVisita + 5);

    const nombreArchivo = `Acta_${datosPartido.localNombre}_vs_${datosPartido.visitaNombre}.pdf`.replace(/\s+/g, '_');
    doc.save(nombreArchivo);
  };

  const RenderTablaEquipo = ({ titulo, capitan, jugadores, puntos, esLocal, colorHeader }) => (
    <div className="mb-8 bg-white rounded-xl shadow-sm border border-brand-gold/30 overflow-hidden">
      <div className={`${colorHeader} text-white px-5 py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center font-bold text-sm uppercase tracking-wider`}>
        <span className="mb-1 sm:mb-0">Equipo: {titulo}</span>
        <span className="text-xs text-white/80">Capitán: {capitan || 'Por definir'}</span>
      </div>

      <div className="overflow-x-auto hide-scrollbar">
        <table className="w-full border-collapse text-xs sm:text-sm whitespace-nowrap min-w-225">
          <thead>
            <tr className="bg-brand-cream/50 text-brand-brown">
              <th className="border border-brand-gold/30 p-2 w-8">F</th>
              <th className="border border-brand-gold/30 p-2 w-8">N°</th>
              <th className="border border-brand-gold/30 p-2 w-48 text-left">Apellidos y Nombres</th>
              <th colSpan={20} className="border border-brand-gold/30 p-2 text-center uppercase tracking-widest text-[0.65rem] sm:text-xs font-black">Control de Lanzamientos (Manos)</th>
              <th className="border border-brand-gold/30 p-2 w-10">AL</th>
              <th className="border border-brand-gold/30 p-2 w-10">AB</th>
              <th className="border border-brand-gold/30 p-2 w-10">BL</th>
              <th className="border border-brand-gold/30 p-2 w-10">BB</th>
            </tr>
          </thead>
          <tbody>
            {jugadores.map((j) => {
              const stats = manualStats[j.id] || { AL: 0, AB: 0, BL: 0, BB: 0 };

              return (
                <tr key={j.id} className="border-b border-brand-gold/20 hover:bg-brand-cream/10 transition-colors">
                  <td className="border border-brand-gold/20 p-1">
                    <div className="w-7 h-7 rounded-full bg-brand-cream/50 mx-auto overflow-hidden flex items-center justify-center border border-brand-gold/30">
                      {j.foto_url ? (
                        <img src={j.foto_url} alt={j.nombre} className="w-full h-full object-cover" />
                      ) : (
                        <svg className="w-4 h-4 text-brand-brown/40" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                      )}
                    </div>
                  </td>
                  <td className="border border-brand-gold/20 p-2 text-center font-bold text-brand-brown">{j.numero_dorsal}</td>
                  <td className="border border-brand-gold/20 p-2 text-left uppercase font-semibold text-brand-brown truncate max-w-50">
                    {j.apellido} {j.nombre}
                  </td>
                  
                  {manoIndices.map((m) => {
                    const manoIndex = m - 1;
                    const jugada = efectividadJugadores[j.id]?.[manoIndex];
                    let bgCelda = 'bg-white';
                    if (jugada?.estado === 'validado') bgCelda = 'bg-green-100';
                    if (jugada?.estado === 'rechazado') bgCelda = 'bg-red-100';

                    return (
                      <td key={m} onClick={() => rol !== 'espectador' && alHacerClicCelda(j.id, manoIndex)}
                        className={`border border-brand-gold/20 p-2 text-center font-bold text-brand-brown cursor-${rol === 'espectador' ? 'default' : 'pointer'} ${bgCelda}`}>
                        {jugada?.valor || ''}
                      </td>
                    );
                  })}

                  {['AL', 'AB', 'BL', 'BB'].map(tipo => {
                    const val = stats[tipo] || 0;
                    return (
                      <td key={tipo} 
                          onClick={() => rol === 'anotador' && alSeleccionarStatCell(j.id, tipo)}
                          className={`border border-brand-gold/20 p-2 text-center font-black bg-brand-cream/20 cursor-${rol === 'anotador' ? 'pointer' : 'default'} hover:bg-brand-cream/60 transition-colors`}
                      >
                        <span className={val > 0 ? 'text-brand-blue' : 'text-transparent'}>
                          {val > 0 ? val : '-'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            <tr className="bg-brand-cream/30 text-brand-brown/60">
              <td colSpan={3} className="border border-brand-gold/20 p-2 text-right font-bold uppercase tracking-wider text-xs">Mano N°</td>
              {manoIndices.map((n) => (
                <td key={`h-${n}`} className="border border-brand-gold/20 p-1 text-center text-[0.65rem] font-medium">{n}</td>
              ))}
              <td colSpan={4} className="border border-brand-gold/20 bg-brand-cream/50"></td>
            </tr>

            <tr className="bg-white">
              <td colSpan={3} className="border border-brand-gold/20 p-3 text-right font-black uppercase text-brand-brown text-xs">
                Puntuación por mano
              </td>
              {puntos.map((pts, i) => (
                <td key={`pts-${i}`} 
                    onClick={() => rol === 'anotador' && alHacerClicPuntuacion(esLocal, i)}
                    className={`border border-brand-gold/20 p-2 text-center font-black text-lg ${pts ? 'text-brand-blue' : 'text-transparent'} ${rol === 'anotador' ? 'cursor-pointer hover:bg-yellow-50' : 'cursor-default'}`}>
                  {pts !== 0 && pts !== '' ? pts : '-'}
                </td>
              ))}
              <td colSpan={4} className="border border-brand-gold/20 bg-brand-cream/50"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="font-sans w-full min-w-0 bg-white rounded-xl">
      
      {/* MARCADOR PRINCIPAL TIPO ESTADIO */}
      <div className="bg-brand-brown text-brand-cream p-6 border-b-4 border-brand-gold flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-linear-to-b from-white/5 to-transparent pointer-events-none"></div>
        
        <div className="flex flex-col items-center z-10 w-full md:w-1/3">
          <span className="text-xs uppercase tracking-widest text-brand-gold font-bold mb-1">{datosPartido.localNombre || 'Local'}</span>
          <div className="text-6xl lg:text-7xl font-black tabular-nums tracking-tighter drop-shadow-md">{totalLocal}</div>
        </div>

        <div className="flex flex-col items-center z-10 text-center w-full md:w-1/3 border-y border-white/10 md:border-y-0 py-4 md:py-0">
          <div className="text-xs uppercase tracking-[0.2em] text-brand-cream/50 mb-2 font-bold">{estadoPartido}</div>
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div className="text-sm font-medium text-brand-cream/80">{datosPartido.horaInicio || '--:--'} - {datosPartido.horaFinal || '--:--'}</div>
          </div>
          <div className="px-4 py-1.5 bg-brand-gold/20 border border-brand-gold/40 rounded-full text-brand-gold font-bold text-sm tracking-wider uppercase">
            {textoMarcador}
          </div>
        </div>

        <div className="flex flex-col items-center z-10 w-full md:w-1/3 relative">
          <span className="text-xs uppercase tracking-widest text-brand-gold font-bold mb-1">{datosPartido.visitaNombre || 'Visita'}</span>
          <div className="text-6xl lg:text-7xl font-black tabular-nums tracking-tighter drop-shadow-md">{totalVisita}</div>
          
          {partidoId && (
            <button onClick={() => window.open(`/?vista=puntajes&partido_id=${partidoId}`, '_blank')} className="mt-4 md:absolute md:-bottom-2 md:-right-2 bg-brand-blue/20 hover:bg-brand-blue border border-brand-blue text-brand-blue hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 uppercase tracking-wider">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              Proyectar
            </button>
          )}
        </div>
      </div>

      <div className="p-4 md:p-6 bg-brand-cream/20">
        <div className="flex flex-col sm:flex-row justify-between text-xs sm:text-sm text-brand-brown/70 font-medium mb-6 px-2 border-b border-brand-gold/20 pb-4">
          <div className="flex gap-4">
            <span><strong className="text-brand-brown">Árbitro:</strong> {datosPartido.arbitro}</span>
            <span><strong className="text-brand-brown">Anotador:</strong> {datosPartido.anotador}</span>
          </div>
          <div className="mt-2 sm:mt-0">
            <strong className="text-brand-brown">Fecha:</strong> {datosPartido.fecha || '--/--/----'}
          </div>
        </div>

        <RenderTablaEquipo titulo={datosPartido.localNombre || 'Local'} capitan={datosPartido.capitanLocal} jugadores={jugadoresLocal} puntos={puntosPorManoLocal} esLocal={true} colorHeader="bg-brand-blue" />
        <RenderTablaEquipo titulo={datosPartido.visitaNombre || 'Visita'} capitan={datosPartido.capitanVisita} jugadores={jugadoresVisita} puntos={puntosPorManoVisita} esLocal={false} colorHeader="bg-brand-rust" />

        <div className="text-center mt-8 pb-4">
          <button 
            onClick={generarPDF} 
            className="w-full sm:w-auto mx-auto bg-brand-gold hover:bg-brand-rust text-white px-8 py-3.5 rounded-xl font-black text-sm uppercase tracking-widest transition-colors shadow-md flex justify-center items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Descargar Acta Oficial en PDF
          </button>
        </div>
      </div>

    </div>
  );
}