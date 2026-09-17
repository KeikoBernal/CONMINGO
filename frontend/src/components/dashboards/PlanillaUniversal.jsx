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
  const tdStyle = { border: '1px solid #CBD5E0', padding: '6px', textAlign: 'center', height: '32px' };
  const thStyle = { ...tdStyle, background: '#EDF2F7', fontWeight: 'bold', color: '#2D3748' };

  const totalLocal = puntosPorManoLocal.reduce((acc, val) => acc + (Number(val) || 0), 0);
  const totalVisita = puntosPorManoVisita.reduce((acc, val) => acc + (Number(val) || 0), 0);
  
  let textoMarcador = "Empate";
  if (totalLocal > totalVisita) textoMarcador = `Lidera ${datosPartido.localNombre} (+${totalLocal - totalVisita})`;
  if (totalVisita > totalLocal) textoMarcador = `Lidera ${datosPartido.visitaNombre} (+${totalVisita - totalLocal})`;

  // ==========================================
  // FUNCIÓN GENERADORA DEL PDF NATIVO
  // ==========================================
  const generarPDF = () => {
    // Crear documento en formato Horizontal (Landscape)
    const doc = new jsPDF('landscape');

    // 1. Cabecera del Documento
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text("LIGA DE BOLAS CRIOLLAS - PLANILLA OFICIAL DE ANOTACIÓN", 14, 15);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Encuentro: ${datosPartido.localNombre || 'Local'} vs ${datosPartido.visitaNombre || 'Visita'}`, 14, 22);
    doc.text(`Fecha: ${datosPartido.fecha || '---'} | H. Inicio: ${datosPartido.horaInicio || '--:--'} | H. Final: ${datosPartido.horaFinal || '--:--'}`, 14, 28);
    doc.text(`Marcador Final: ${datosPartido.localNombre} (${totalLocal}) - (${totalVisita}) ${datosPartido.visitaNombre}`, 14, 34);

    // 2. Definir Columnas base (N°, Jugadores, 1-20, Estadísticas)
    const headBase = ['N°', 'JUGADORES', ...Array.from({length: 20}, (_, i) => (i + 1).toString()), 'AL', 'AB', 'BL', 'BB'];

    // 3. Formatear Datos del Equipo Local
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
    // Fila de puntos al final de la tabla local
    bodyLocal.push([
      '', 'PUNTUACIÓN POR MANO ➡️', ...puntosPorManoLocal.map(p => p !== 0 && p !== '' ? p.toString() : ''), '', '', '', ''
    ]);

// 4. Dibujar Tabla Local
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`EQUIPO LOCAL: ${datosPartido.localNombre} (Capitán: ${datosPartido.capitanLocal || 'N/R'})`, 14, 43);
    
    // <-- CAMBIO: pasamos "doc" como primer parámetro
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

    // 5. Formatear Datos del Equipo Visitante
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
    // Fila de puntos al final de la tabla visita
    bodyVisita.push([
      '', 'PUNTUACIÓN POR MANO ➡️', ...puntosPorManoVisita.map(p => p !== 0 && p !== '' ? p.toString() : ''), '', '', '', ''
    ]);

    // 6. Dibujar Tabla Visita
    const finalYLocal = doc.lastAutoTable.finalY || 46;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`EQUIPO VISITANTE: ${datosPartido.visitaNombre} (Capitán: ${datosPartido.capitanVisita || 'N/R'})`, 14, finalYLocal + 10);

    // <-- CAMBIO: pasamos "doc" como primer parámetro
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

    // 7. Zona de Firmas
    let finalYVisita = doc.lastAutoTable.finalY + 25;
    
    // Si no hay espacio para las firmas en la misma hoja, crear una nueva
    if (finalYVisita > 170) {
      doc.addPage();
      finalYVisita = 30;
    }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    // Firmas Equipos
    doc.line(30, finalYVisita, 90, finalYVisita); // Línea Capitán Local
    doc.text("Capitán / Delegado (Local)", 42, finalYVisita + 5);

    doc.line(190, finalYVisita, 250, finalYVisita); // Línea Capitán Visita
    doc.text("Capitán / Delegado (Visitante)", 198, finalYVisita + 5);

    // Firmas Oficiales
    finalYVisita += 25;
    doc.line(30, finalYVisita, 90, finalYVisita);
    doc.text(`Anotador: ${datosPartido.anotador || '_______________'}`, 40, finalYVisita + 5);

    doc.line(110, finalYVisita, 170, finalYVisita);
    doc.text("Juez de Calce", 130, finalYVisita + 5);

    doc.line(190, finalYVisita, 250, finalYVisita);
    doc.text("Juez de Mingo", 210, finalYVisita + 5);

    // 8. Descargar PDF
    const nombreArchivo = `Acta_${datosPartido.localNombre}_vs_${datosPartido.visitaNombre}.pdf`.replace(/\s+/g, '_');
    doc.save(nombreArchivo);
  };

  const RenderTablaEquipo = ({ titulo, capitan, jugadores, puntos, esLocal }) => (
    <div style={{ marginBottom: '25px', background: '#FFF', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
      <div style={{ background: '#2D3748', color: '#FFF', padding: '10px 15px', display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
        <span>Equipo: {titulo}</span>
        <span>Capitán: {capitan || 'Por definir'}</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: '35px' }}>Foto</th>
            <th style={{ ...thStyle, width: '30px' }}>N°</th>
            <th style={{ ...thStyle, width: '200px', textAlign: 'left' }}>Apellidos y Nombres</th>
            <th colSpan={20} style={thStyle}>Control de Lanzamientos (Manos)</th>
            <th style={{ ...thStyle, width: '45px' }}>AL</th>
            <th style={{ ...thStyle, width: '45px' }}>AB</th>
            <th style={{ ...thStyle, width: '45px' }}>BL</th>
            <th style={{ ...thStyle, width: '45px' }}>BB</th>
          </tr>
        </thead>
        <tbody>
          {jugadores.map((j) => {
            const stats = manualStats[j.id] || { AL: 0, AB: 0, BL: 0, BB: 0 };

            return (
              <tr key={j.id} style={{ borderBottom: '1px solid #E2E8F0' }}>
                <td style={{ ...tdStyle, padding: '2px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#CBD5E0', margin: '0 auto', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {j.foto_url ? (
                      <img src={j.foto_url} alt={j.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '0.65em', color: '#4A5568' }}>📷</span>
                    )}
                  </div>
                </td>

                <td style={tdStyle}><strong>{j.numero_dorsal}</strong></td>
                <td style={{ ...tdStyle, textAlign: 'left', textTransform: 'uppercase', fontWeight: '500' }}>
                  {j.apellido} {j.nombre}
                </td>
                
                {manoIndices.map((m) => {
                  const manoIndex = m - 1;
                  const jugada = efectividadJugadores[j.id]?.[manoIndex];
                  let bgCelda = '#FFF';
                  if (jugada?.estado === 'validado') bgCelda = '#C6F6D5';
                  if (jugada?.estado === 'rechazado') bgCelda = '#FED7D7';

                  return (
                    <td key={m} onClick={() => rol !== 'espectador' && alHacerClicCelda(j.id, manoIndex)}
                      style={{ ...tdStyle, background: bgCelda, color: '#1A202C', fontWeight: 'bold', cursor: 'pointer' }}>
                      {jugada?.valor || ''}
                    </td>
                  );
                })}

                {['AL', 'AB', 'BL', 'BB'].map(tipo => {
                  const val = stats[tipo] || 0;
                  return (
                    <td key={tipo} 
                        onClick={() => rol === 'anotador' && alSeleccionarStatCell(j.id, tipo)}
                        style={{ ...tdStyle, background: '#F7FAFC', cursor: rol === 'anotador' ? 'pointer' : 'default', padding: '2px', transition: 'background 0.2s' }}
                        onMouseOver={(e) => { if(rol === 'anotador') e.currentTarget.style.background = '#E2E8F0'; }}
                        onMouseOut={(e) => { e.currentTarget.style.background = '#F7FAFC'; }}
                    >
                      <span style={{ fontWeight: 'bold', fontSize: '1.1em', color: val > 0 ? '#2B6CB0' : 'transparent' }}>
                        {val > 0 ? val : '-'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}

          <tr style={{ background: '#EDF2F7' }}>
            <td colSpan={3} style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold' }}>Mano N° ➡️</td>
            {manoIndices.map((n) => (
              <td key={`h-${n}`} style={{ ...tdStyle, fontSize: '0.75em', color: '#718096' }}>{n}</td>
            ))}
            <td colSpan={4} style={tdStyle}></td>
          </tr>

          <tr>
            <td colSpan={3} style={{ ...tdStyle, textAlign: 'right', fontWeight: 'bold', fontSize: '1.1em', background: '#FFF' }}>
              Puntuación final (Clic para editar)
            </td>
            {puntos.map((pts, i) => (
              <td key={`pts-${i}`} 
                  onClick={() => rol === 'anotador' && alHacerClicPuntuacion(esLocal, i)}
                  style={{ ...tdStyle, fontWeight: 'bold', fontSize: '1.2em', color: pts ? '#2B6CB0' : '#A0AEC0', background: rol === 'anotador' ? '#FFFFF0' : '#FFF', cursor: rol === 'anotador' ? 'pointer' : 'default' }}>
                {pts !== 0 && pts !== '' ? pts : ''}
              </td>
            ))}
            <td colSpan={4} style={{ border: '1px solid #CBD5E0', background: '#EDF2F7' }}></td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', background: '#F7FAFC', minWidth: '950px', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1A202C', color: '#FFF', padding: '15px 25px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: '2em', fontWeight: '900' }}>{totalLocal}</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.85em', textTransform: 'uppercase', letterSpacing: '2px', color: '#A0AEC0', marginBottom: '5px' }}>{estadoPartido}</div>
          <div style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#F6E05E' }}>🏆 {textoMarcador}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ fontSize: '2em', fontWeight: '900' }}>{totalVisita}</div>
          {partidoId && (
            <button onClick={() => window.open(`/?vista=puntajes&partido_id=${partidoId}`, '_blank')} style={{ background: '#3182CE', color: 'white', padding: '10px 15px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85em' }}>
              📺 Proyectar Pantalla
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9em', color: '#4A5568', marginBottom: '20px', padding: '0 10px' }}>
        <div><strong>Árbitro:</strong> {datosPartido.arbitro} | <strong>Anotador:</strong> {datosPartido.anotador}</div>
        <div><strong>Inicio:</strong> {datosPartido.horaInicio || '--:--'} | <strong>Final:</strong> {datosPartido.horaFinal || '--:--'}</div>
      </div>

      <RenderTablaEquipo titulo={datosPartido.localNombre || 'Local'} capitan={datosPartido.capitanLocal} jugadores={jugadoresLocal} puntos={puntosPorManoLocal} esLocal={true} />
      <RenderTablaEquipo titulo={datosPartido.visitaNombre || 'Visita'} capitan={datosPartido.capitanVisita} jugadores={jugadoresVisita} puntos={puntosPorManoVisita} esLocal={false} />

      {/* BOTÓN PARA GENERAR PDF LIMPIO */}
      <div style={{ textAlign: 'center', margin: '30px 0' }}>
        <button 
          onClick={generarPDF} 
          style={{ 
            background: '#38A169', 
            color: 'white', 
            padding: '12px 24px', 
            fontSize: '1.1em', 
            border: 'none', 
            borderRadius: '6px', 
            cursor: 'pointer', 
            fontWeight: 'bold', 
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)' 
          }}
        >
          🖨️ Descargar Acta en PDF
        </button>
      </div>

    </div>
  );
}