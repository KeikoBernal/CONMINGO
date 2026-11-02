import { useState } from 'react';

// FASE 3 UX: modo cancha para anotar desde el telefono a pie de cancha.
// Misma data y mismos eventos que la planilla (actualizacion optimista +
// proponer_jugada / tantos_asignados / sync_cronometro): solo presentacion,
// cero backend. La planilla sigue siendo la vista de auditoria completa.

const LETRAS = [
  { valor: 'A', etiqueta: 'Arrime', clases: 'bg-brand-blue hover:bg-brand-brown' },
  { valor: 'a', etiqueta: 'Arrime Nulo', clases: 'bg-red-500 hover:bg-red-600' },
  { valor: 'B', etiqueta: 'Boche de Aire', clases: 'bg-green-600 hover:bg-green-700' },
  { valor: 'b', etiqueta: 'Boche Nulo', clases: 'bg-red-500 hover:bg-red-600' },
  { valor: 'R', etiqueta: 'Boche Rastrero', clases: 'bg-brand-brown hover:bg-brand-rust' },
  { valor: 'r', etiqueta: 'Rastrero Nulo', clases: 'bg-red-500 hover:bg-red-600' },
  { valor: 'N', etiqueta: 'Nulo General', clases: 'bg-gray-500 hover:bg-gray-600' }
];

const nombreJugador = (j) => [j?.nombre, j?.apellido].filter(Boolean).join(' ') || 'Jugador';

export default function ModoCancha({
  partido, jugadoresLocal, jugadoresVisita, efectividadJugadores,
  puntosPorManoLocal, puntosPorManoVisita,
  tiempoTurno, tiempoGlobal, cronometroTurnoActivo,
  arbitroConectado, socketConectado, formatoT,
  onToggleTurno, onResetTurno, onRegistrarJugada, onAsignarTantos,
  isSubmitting, onIniciar, onFinalizar, onVerPlanilla
}) {
  const [jugadorSeleccionado, setJugadorSeleccionado] = useState(null);
  const [manoNavegacion, setManoNavegacion] = useState(null);

  const totalLocal = puntosPorManoLocal.reduce((a, p) => a + (parseInt(p, 10) || 0), 0);
  const totalVisita = puntosPorManoVisita.reduce((a, p) => a + (parseInt(p, 10) || 0), 0);
  const meta = parseInt(partido?.torneo_reglas?.meta_puntos, 10) || 0;

  // Mano abierta: la primera sin tantos asignados (los tantos cierran la mano).
  const primeraManoAbierta = puntosPorManoLocal.findIndex((p, i) => p === '' && puntosPorManoVisita[i] === '');
  const manoActual = manoNavegacion !== null ? manoNavegacion : (primeraManoAbierta === -1 ? puntosPorManoLocal.length - 1 : primeraManoAbierta);

  const jugadasDeMano = Object.entries(efectividadJugadores || {})
    .map(([jId, manos]) => {
      const celda = manos && manos[manoActual];
      if (!celda) return null;
      const jugador = [...(jugadoresLocal || []), ...(jugadoresVisita || [])].find(j => String(j.id) === String(jId));
      return { jId, nombre: jugador ? nombreJugador(jugador) : 'Jugador', valor: String(celda.valor || '') };
    })
    .filter(Boolean);

  const rastrero = partido?.torneo_reglas?.registrar_boche_rastrero === true;
  const botones = rastrero ? LETRAS : LETRAS.filter(l => l.valor !== 'R' && l.valor !== 'r');

  const registrar = (valor) => {
    if (jugadorSeleccionado === null) return;
    onRegistrarJugada(jugadorSeleccionado, manoActual, valor);
    setJugadorSeleccionado(null);
  };

  const asignarTantos = (esLocal, puntos) => {
    onAsignarTantos(esLocal, manoActual, puntos);
    setManoNavegacion(null); // la mano cerro: avanzar a la siguiente mano abierta
    setJugadorSeleccionado(null);
  };

  const irAMano = (delta) => {
    const destino = Math.min(puntosPorManoLocal.length - 1, Math.max(0, manoActual + delta));
    setManoNavegacion(destino);
    setJugadorSeleccionado(null);
  };

  const estado = partido?.estado;
  const enJuego = estado !== 'Finalizado' && estado !== 'Suspendido';

  const ChipJugadores = ({ titulo, lista, colorBorde }) => (
    <div>
      <div className={`text-xs font-bold uppercase tracking-wider mb-2 pb-1 border-b-2 ${colorBorde} truncate`}>{titulo}</div>
      {lista.length === 0 ? (
        <p className="text-sm text-brand-brown/50 py-2">Sin nomina cargada.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {lista.map(j => (
            <button
              key={j.id}
              onClick={() => setJugadorSeleccionado(jugadorSeleccionado === j.id ? null : j.id)}
              className={`py-3 px-2 rounded-lg text-sm font-bold transition-colors border shadow-sm truncate ${jugadorSeleccionado === j.id ? 'bg-brand-blue text-white border-brand-blue' : 'bg-white text-brand-brown border-brand-gold/30 hover:bg-brand-cream'}`}
            >
              {nombreJugador(j)}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-in pb-8">

      {/* BARRA SUPERIOR: CONEXION PERSISTENTE, ARBITRO Y VISTA DE AUDITORIA */}
      <div className="flex flex-wrap items-center gap-2">
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm text-xs font-bold uppercase tracking-wider ${socketConectado ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${socketConectado ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`}></span>
          {socketConectado ? 'En vivo' : 'Reintentando'}
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm text-xs font-bold uppercase tracking-wider ${arbitroConectado ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          Arbitro {arbitroConectado ? 'en linea' : 'ausente'}
        </div>
        <button onClick={onVerPlanilla} className="ml-auto bg-brand-cream text-brand-brown px-3 py-1.5 rounded-lg font-bold text-xs hover:bg-brand-gold hover:text-white transition-colors border border-brand-gold/30 shadow-sm flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
          Ver Planilla
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
            <div className="text-3xl font-black text-brand-brown leading-tight">{manoActual + 1}<span className="text-base font-bold text-brand-brown/40">/{puntosPorManoLocal.length}</span></div>
            {meta > 0 && <div className="text-[0.65rem] font-bold text-brand-gold uppercase tracking-widest mt-1">Meta {meta}</div>}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider truncate">{partido?.visita_nombre}</div>
            <div className="text-5xl font-black text-brand-rust leading-tight">{totalVisita}</div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 mt-3">
          <button onClick={() => irAMano(-1)} disabled={manoActual === 0} className="px-3 py-1.5 bg-brand-cream text-brand-brown rounded-lg border border-brand-gold/30 font-bold text-xs hover:bg-brand-gold hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            Anterior
          </button>
          <button onClick={() => setManoNavegacion(null)} className="px-3 py-1.5 bg-brand-cream text-brand-brown rounded-lg border border-brand-gold/30 font-bold text-xs hover:bg-brand-gold hover:text-white transition-colors">
            Mano abierta
          </button>
          <button onClick={() => irAMano(1)} disabled={manoActual >= puntosPorManoLocal.length - 1} className="px-3 py-1.5 bg-brand-cream text-brand-brown rounded-lg border border-brand-gold/30 font-bold text-xs hover:bg-brand-gold hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
            Siguiente
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      {/* CRONOMETRO PROTAGONISTA */}
      <div className="bg-brand-brown text-white p-5 rounded-xl border border-brand-gold/20 shadow-lg text-center">
        <div className="text-xs font-bold text-brand-cream/70 uppercase tracking-wider mb-1">Tiempo de Lanzamiento</div>
        <div className={`text-6xl font-black font-mono tracking-tighter my-1 ${tiempoTurno > 50 ? 'text-red-400 animate-pulse' : 'text-white'}`}>{formatoT(tiempoTurno)}</div>
        <div className="flex gap-2 mt-3">
          <button onClick={onToggleTurno} className={`flex-1 py-3 rounded-lg font-bold shadow-sm transition-colors ${cronometroTurnoActivo ? 'bg-yellow-500 hover:bg-yellow-600 text-yellow-900' : 'bg-brand-blue hover:bg-brand-brown text-white'}`}>{cronometroTurnoActivo ? 'Pausar' : 'Iniciar'}</button>
          <button onClick={onResetTurno} className="px-5 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold shadow-sm transition-colors">Reset</button>
        </div>
        <div className="mt-3 text-sm font-bold text-brand-cream/70">Total del partido: <span className="font-mono text-brand-cream">{formatoT(tiempoGlobal)}</span></div>
      </div>

      {/* REGISTRO DE JUGADA EN DOS TOQUES */}
      <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ChipJugadores titulo={partido?.local_nombre || 'Local'} lista={jugadoresLocal || []} colorBorde="border-brand-blue/30" />
          <ChipJugadores titulo={partido?.visita_nombre || 'Visita'} lista={jugadoresVisita || []} colorBorde="border-brand-rust/30" />
        </div>

        <div>
          <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">
            {jugadorSeleccionado === null ? 'Selecciona quien lanza en la mano ' + (manoActual + 1) : 'Toca la jugada para registrar'}
          </div>
          <div className={`grid grid-cols-2 gap-2 transition-opacity ${jugadorSeleccionado === null ? 'opacity-40 pointer-events-none' : ''}`}>
            {botones.map(b => (
              <button
                key={b.valor}
                onClick={() => registrar(b.valor)}
                className={`py-4 text-white rounded-lg shadow-sm transition-colors ${b.clases} ${b.valor === 'N' ? 'col-span-2' : ''}`}
              >
                <span className="block text-3xl font-black leading-none">{b.valor}</span>
                <span className="block text-xs font-bold mt-1">{b.etiqueta}</span>
              </button>
            ))}
          </div>
        </div>

        {jugadasDeMano.length > 0 && (
          <div>
            <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Jugadas de la mano {manoActual + 1}</div>
            <div className="space-y-1.5">
              {jugadasDeMano.map(j => (
                <div key={j.jId} className="flex items-center justify-between gap-2 bg-brand-cream/40 border border-brand-gold/20 rounded-lg px-3 py-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-sm font-black text-brand-brown w-5 text-center">{j.valor}</span>
                    <span className="text-xs font-bold text-brand-brown/70 truncate">{j.nombre}</span>
                  </div>
                  <button onClick={() => onRegistrarJugada(j.jId, manoActual, '')} title="Borrar jugada" className="p-1.5 text-brand-brown/50 hover:text-red-600 hover:bg-brand-cream rounded-lg transition-colors shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* TANTOS DE LA MANO */}
      <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm p-4 space-y-4">
        <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider">Tantos de la mano {manoActual + 1}</div>
        {[true, false].map(esLocal => (
          <div key={esLocal ? 'local' : 'visita'}>
            <div className="text-sm font-bold text-brand-brown truncate mb-1.5">{esLocal ? partido?.local_nombre || 'Local' : partido?.visita_nombre || 'Visita'}</div>
            <div className="grid grid-cols-7 gap-1.5">
              {[0, 1, 2, 3, 4, 5, 6].map(p => (
                <button key={p} onClick={() => asignarTantos(esLocal, p)} className={`py-3 rounded-lg text-lg font-black shadow-sm transition-colors ${p === 0 ? 'bg-gray-400 hover:bg-gray-500 text-white' : 'bg-brand-blue hover:bg-brand-brown text-white'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[0.7rem] text-brand-brown/50 text-center">Asignar tantos cierra la mano y pasa a la siguiente. Si te equivocaste, vuelve con Anterior y toca el numero correcto.</p>
      </div>

      {/* ACCIONES DEL PARTIDO */}
      {enJuego && (
        <div className="flex gap-2">
          {estado === 'Agendado' && (
            <button onClick={onIniciar} disabled={isSubmitting} className={`flex-1 py-4 rounded-xl text-base font-black tracking-wider transition-colors shadow-md text-white ${isSubmitting ? 'bg-gray-400 opacity-70 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}>
              {isSubmitting ? 'INICIANDO...' : 'INICIAR PARTIDO'}
            </button>
          )}
          {estado === 'En Curso' && (
            <button onClick={onFinalizar} disabled={isSubmitting} className={`flex-1 py-4 rounded-xl text-base font-black tracking-wider transition-colors shadow-md text-white ${isSubmitting ? 'bg-gray-400 opacity-70 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}>
              {isSubmitting ? 'FINALIZANDO...' : 'FINALIZAR ACTA'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
