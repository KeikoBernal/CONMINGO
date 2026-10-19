import { useEffect, useRef, useState } from 'react';
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';

// LOTE L: colores institucionales por estado del partido.
const CONFIG_ESTADO = {
  'Agendado': '#224e69',
  'En Curso': '#b45309',
  'Suspendido': '#b91c1c',
  'Finalizado': '#15803d'
};

const colorEstado = (estado) => CONFIG_ESTADO[estado] || '#6b7280';

const horaLegible = (fechaStr) => {
  const m = String(fechaStr || '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
};

// LOTE L: calendario visual de partidos del administrador de liga.
// FullCalendar v6 core montado de forma imperativa: los plugins del lock son v6
// y @fullcalendar/react está en v7 (incompatible), así que no se toca package.json.
export default function CalendarioPartidos({ partidos = [], sedesPorPartido = {}, onEditar, onReagendar }) {
  const contenedorRef = useRef(null);
  const calendarioRef = useRef(null);
  const callbacksRef = useRef({ onEditar, onReagendar });
  callbacksRef.current = { onEditar, onReagendar };
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    if (!contenedorRef.current) return;
    const calendario = new Calendar(contenedorRef.current, {
      plugins: [dayGridPlugin, timeGridPlugin],
      initialView: 'dayGridMonth',
      locale: 'es',
      height: 'auto',
      fixedWeekCount: false,
      allDaySlot: false,
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
      buttonText: { today: 'Hoy', month: 'Mes', week: 'Semana' },
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      eventClick: (info) => setDetalle(info.event.extendedProps.partido)
    });
    calendario.render();
    calendarioRef.current = calendario;
    return () => { calendario.destroy(); calendarioRef.current = null; };
  }, []);

  useEffect(() => {
    const calendario = calendarioRef.current;
    if (!calendario) return;
    calendario.removeAllEvents();
    partidos.forEach(p => {
      if (!p.fecha_hora) return;
      const color = colorEstado(p.estado);
      calendario.addEvent({
        id: String(p.id),
        title: `${horaLegible(p.fecha_hora)} ${p.local_nombre || 'Por definir'} vs ${p.visita_nombre || 'Por definir'}`,
        start: p.fecha_hora,
        backgroundColor: color,
        borderColor: color,
        extendedProps: { partido: p }
      });
    });
  }, [partidos]);

  return (
    <div className="animate-fade-in">
      <div className="mb-3 flex flex-wrap gap-2">
        {Object.keys(CONFIG_ESTADO).map(estado => (
          <span key={estado} className="inline-flex items-center gap-1.5 rounded-full border border-brand-gold/30 bg-white px-2.5 py-1 text-xs font-bold text-brand-brown">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorEstado(estado) }}></span>{estado}
          </span>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-brand-gold/30 bg-white p-3 shadow-sm">
        <div ref={contenedorRef}></div>
      </div>

      {detalle && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={() => setDetalle(null)}>
          <div className="w-full max-w-md animate-fade-in rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h4 className="text-lg font-bold text-brand-brown">
              {detalle.local_nombre || 'Por definir'} <span className="text-brand-rust">vs</span> {detalle.visita_nombre || 'Por definir'}
            </h4>
            <p className="mt-2 text-sm text-brand-brown/80">Fecha: {new Date(detalle.fecha_hora).toLocaleString('es-VE')}</p>
            {detalle.torneo_nombre && <p className="text-sm text-brand-brown/80">Torneo: {detalle.torneo_nombre}</p>}
            {sedesPorPartido[detalle.id] && <p className="text-sm text-brand-brown/80">Sede: {sedesPorPartido[detalle.id]}</p>}
            <span className="mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold text-white" style={{ backgroundColor: colorEstado(detalle.estado) }}>{detalle.estado}</span>
            {detalle.estado === 'Finalizado' && detalle.marcador_local !== null && detalle.marcador_local !== undefined && (
              <p className="mt-3 text-center text-2xl font-black text-brand-rust">{detalle.marcador_local} - {detalle.marcador_visita}</p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {(detalle.estado === 'Agendado' || detalle.estado === 'En Curso') && (
                <button type="button" onClick={() => { const p = detalle; setDetalle(null); callbacksRef.current.onEditar && callbacksRef.current.onEditar(p); }} className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-brown">Modificar</button>
              )}
              {detalle.estado === 'Suspendido' && (
                <button type="button" onClick={() => { const p = detalle; setDetalle(null); callbacksRef.current.onReagendar && callbacksRef.current.onReagendar(p); }} className="rounded-lg bg-brand-rust px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-brown">Reagendar</button>
              )}
              <button type="button" onClick={() => setDetalle(null)} className="rounded-lg border border-brand-gold/40 px-4 py-2 text-sm font-bold text-brand-brown transition-colors hover:bg-brand-cream">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
