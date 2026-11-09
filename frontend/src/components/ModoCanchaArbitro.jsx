import { useState } from 'react';

// FASE 3 UX: modo cancha del arbitro. Acciones grandes de partido en curso
// para el telefono a pie de cancha: marcador en vivo, cronometro (lectura:
// lo controla el anotador), tarjetas con jugador en fichas grandes,
// incidencias, suspension y firmas del acta. Reusa los handlers del panel,
// cero backend. La planilla queda como vista de revision (solicitarRevision).

const nombreJugador = (j) => [j?.nombre, j?.apellido].filter(Boolean).join(' ') || 'Jugador';

export default function ModoCanchaArbitro({
  partido, jugadoresLocal, jugadoresVisita,
  puntosPorManoLocal, puntosPorManoVisita,
  tiempoTurno, tiempoGlobal, formatoT,
  anotadorConectado, socketConectado,
  onEmitirTarjeta, onAbrirIncidencias, onSuspender,
  firmasActa, onFirmar, isSubmitting,
  onVerPlanilla, onVolverPanel
}) {
  const [jugadorSancion, setJugadorSancion] = useState('');

  const totalLocal = puntosPorManoLocal.reduce((a, p) => a + (parseInt(p, 10) || 0), 0);
  const totalVisita = puntosPorManoVisita.reduce((a, p) => a + (parseInt(p, 10) || 0), 0);
  const primeraManoAbierta = puntosPorManoLocal.findIndex((p, i) => p === '' && puntosPorManoVisita[i] === '');
  const manoActual = primeraManoAbierta === -1 ? puntosPorManoLocal.length : primeraManoAbierta + 1;
  const meta = parseInt(partido?.torneo_reglas?.meta_puntos, 10) || 0;

  const estado = partido?.estado;
  const accionesActivas = estado !== 'Finalizado' && estado !== 'Suspendido';

  const tarjeta = (color) => {
    if (jugadorSancion === '') return;
    onEmitirTarjeta(jugadorSancion, color);
    setJugadorSancion('');
  };

  const FichaJugador = ({ j }) => (
    <button
      onClick={() => setJugadorSancion(jugadorSancion === j.id ? '' : j.id)}
      className={`py-3 px-2 rounded-lg text-xs font-bold transition-colors border shadow-sm truncate ${jugadorSancion === j.id ? 'bg-brand-rust text-white border-brand-rust' : 'bg-white text-brand-brown border-brand-gold/30 hover:bg-brand-cream'}`}
    >
      <span className="block font-black">#{j.numero_dorsal || '-'}</span>
      {nombreJugador(j)}
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-in pb-8">

      {/* BARRA SUPERIOR: CONEXION PERSISTENTE Y VISTAS */}
      <div className="flex flex-wrap items-center gap-2">
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm text-xs font-bold uppercase tracking-wider ${socketConectado ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${socketConectado ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`}></span>
          {socketConectado ? 'En vivo' : 'Reintentando'}
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm text-xs font-bold uppercase tracking-wider ${anotadorConectado ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          Anotador {anotadorConectado ? 'en linea' : 'ausente'}
        </div>
        <button onClick={onVerPlanilla} className="ml-auto bg-brand-cream text-brand-brown px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-brand-gold hover:text-white transition-colors border border-brand-gold/30 shadow-sm flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
          Ver Planilla
        </button>
        <button onClick={onVolverPanel} className="bg-brand-cream text-brand-brown px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-brand-gold hover:text-white transition-colors border border-brand-gold/30 shadow-sm flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          Volver al Panel
        </button>
      </div>

      {/* MARCADOR EN VIVO */}
      <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm p-4">
        <div className="grid grid-cols-3 gap-2 items-center text-center">
          <div className="min-w-0">
            <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider truncate">{partido?.local_nombre}</div>
            <div className="text-5xl font-black text-brand-blue leading-tight">{totalLocal}</div>
          </div>
          <div>
            <div className="text-[0.65rem] font-bold text-brand-brown/50 uppercase tracking-widest">Mano</div>
            <div className="text-3xl font-black text-brand-brown leading-tight">{manoActual}<span className="text-base font-bold text-brand-brown/40">/{puntosPorManoLocal.length}</span></div>
            {meta > 0 && <div className="text-[0.65rem] font-bold text-brand-gold uppercase tracking-widest mt-1">Meta {meta}</div>}
            <div className={`mt-2 text-[0.65rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-block ${estado === 'En Curso' ? 'bg-green-50 text-green-700 border border-green-200' : estado === 'Finalizado' ? 'bg-brand-blue/10 text-brand-blue border border-brand-blue/20' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>{estado}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider truncate">{partido?.visita_nombre}</div>
            <div className="text-5xl font-black text-brand-rust leading-tight">{totalVisita}</div>
          </div>
        </div>
        {estado === 'Finalizado' && (
          <button onClick={() => window.open('/?vista=puntajes&partido_id=' + partido.id, '_blank')} className="mt-3 w-full bg-brand-gold text-white py-3 rounded-lg font-bold text-sm hover:bg-brand-rust transition-colors shadow-sm flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Descargar Acta (PDF)
          </button>
        )}
      </div>

      {/* CRONOMETRO (LECTURA, CONTROLADO POR EL ANOTADOR) */}
      <div className="bg-brand-brown text-white p-5 rounded-xl border border-brand-gold/20 shadow-lg text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 bg-brand-gold text-brand-brown text-[0.65rem] font-bold px-2 py-1 rounded-bl-lg uppercase tracking-wider">En Vivo</div>
        <div className="text-xs font-bold text-brand-cream/70 uppercase tracking-wider mb-1">Tiempo de Lanzamiento</div>
        <div className={`text-6xl font-black font-mono tracking-tighter my-1 ${tiempoTurno > 50 ? 'text-red-400 animate-pulse' : 'text-white'}`}>{formatoT(tiempoTurno)}</div>
        <div className="mt-3 text-sm font-bold text-brand-cream/70">Tiempo global: <span className="font-mono text-brand-gold">{formatoT(tiempoGlobal)}</span></div>
        <div className="text-[0.65rem] text-brand-cream/40 mt-2 uppercase tracking-wide">Controlado por el Anotador</div>
      </div>

      {accionesActivas && (
        <>
          {/* SANCIONES: JUGADOR EN FICHAS GRANDES + TARJETAS */}
          <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm p-4 space-y-3">
            <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider">Sanciones disciplinarias</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[0.65rem] font-bold text-brand-blue uppercase tracking-wider truncate mb-1.5">{partido?.local_nombre || 'Local'}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {jugadoresLocal.map(j => <FichaJugador key={j.id} j={j} />)}
                </div>
              </div>
              <div>
                <div className="text-[0.65rem] font-bold text-brand-rust uppercase tracking-wider truncate mb-1.5">{partido?.visita_nombre || 'Visita'}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {jugadoresVisita.map(j => <FichaJugador key={j.id} j={j} />)}
                </div>
              </div>
            </div>
            <div className={`grid grid-cols-2 gap-2 transition-opacity ${jugadorSancion === '' ? 'opacity-40 pointer-events-none' : ''}`}>
              <button onClick={() => tarjeta('Amarilla')} className="py-4 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 border border-yellow-500/30 rounded-lg font-bold shadow-sm transition-colors">
                <span className="block text-2xl font-black leading-none mb-1">Amarilla</span>
                <span className="block text-xs font-bold">Amonestar</span>
              </button>
              <button onClick={() => tarjeta('Roja')} className="py-4 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold shadow-sm transition-colors">
                <span className="block text-2xl font-black leading-none mb-1">Roja</span>
                <span className="block text-xs font-bold">Expulsar</span>
              </button>
            </div>
            <p className="text-[0.7rem] text-brand-brown/50 text-center">Selecciona quien comete la falta y toca la tarjeta. La amonestacion queda en el acta.</p>
          </div>

          {/* INCIDENCIAS DEL PARTIDO */}
          <button onClick={onAbrirIncidencias} className="w-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-500 hover:text-white rounded-xl py-4 font-bold shadow-sm transition-colors flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <span className="text-base">Ver y Registrar Incidencias</span>
          </button>

          {/* FIRMAS DIGITALES DEL ACTA */}
          <div className="bg-white rounded-xl border border-brand-gold/30 shadow-sm p-4">
            <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-1">Firmas del Acta</div>
            <p className="text-[0.7rem] text-brand-brown/60 mb-3">Entrega este dispositivo al responsable de cada equipo para firmar. El anotador firma desde su propio panel.</p>
            <div className="space-y-2">
              {(firmasActa.firmas || []).map(f => {
                const etiquetaFirma = f.rol_firma === 'arbitro' ? 'Arbitro' : f.rol_firma === 'anotador' ? 'Anotador' : f.rol_firma === 'delegado_local' ? 'Delegado ' + (partido?.local_nombre || 'Local') : 'Delegado ' + (partido?.visita_nombre || 'Visita');
                const firmableAqui = f.rol_firma !== 'anotador';
                return (
                  <div key={f.rol_firma} className="flex items-center justify-between gap-2 border border-brand-gold/20 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-brand-brown truncate">{etiquetaFirma}</div>
                      <div className={'text-[0.65rem] ' + (f.firmada ? 'text-green-700' : 'text-brand-brown/50')}>
                        {f.firmada ? 'Firmada' + (f.registrada_por_nombre ? ' por ' + f.registrada_por_nombre : '') : (f.exigible ? 'Pendiente (obligatoria)' : 'No aplica a este partido')}
                      </div>
                    </div>
                    {f.firmada ? (
                      <span className="text-[0.6rem] font-bold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 shrink-0">Firmada</span>
                    ) : f.exigible && firmableAqui ? (
                      <button onClick={() => onFirmar(f.rol_firma)} disabled={isSubmitting} className="bg-brand-blue text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-brand-brown transition-colors shadow-sm shrink-0 disabled:bg-gray-400 disabled:opacity-70 disabled:cursor-not-allowed">Firmar</button>
                    ) : f.exigible ? (
                      <span className="text-[0.6rem] text-brand-brown/40 shrink-0">En el panel del anotador</span>
                    ) : (
                      <span className="text-[0.6rem] text-brand-brown/40 shrink-0">No aplica</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* CONTROL DE JUEGO: SOLO FUERZA MAYOR */}
          <div className="bg-white rounded-xl border border-red-200 shadow-sm p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
            <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-1 pl-2">Control de Juego</div>
            <p className="text-[0.75rem] text-brand-brown/60 mb-3 pl-2">Solo en caso de fuerza mayor (lluvia, falta de luz, etc.).</p>
            <button onClick={onSuspender} disabled={isSubmitting} className={`w-full py-4 border rounded-lg text-sm font-black tracking-wider transition-colors shadow-sm ${isSubmitting ? 'bg-gray-200 text-gray-500 border-gray-300 opacity-70 cursor-not-allowed' : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-600 hover:text-white'}`}>
              {isSubmitting ? 'SUSPENDIENDO...' : 'SUSPENDER PARTIDO'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
