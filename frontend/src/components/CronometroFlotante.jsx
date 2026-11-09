import { useState } from 'react';

// LOTE 8E UX: cronometro como isla flotante. El bloque fijo de Tiempo de
// Lanzamiento + Total del partido que robaba pantalla en la planilla y en el
// modo cancha pasa a ser un icono circular de marca, fijo en la esquina
// inferior derecha, que se expande al tocarlo. Solo presentacion, cero backend.

export default function CronometroFlotante({
  tiempoTurno, tiempoGlobal, cronometroTurnoActivo, formatoT,
  onToggleTurno, onResetTurno
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-[1400] flex flex-col items-end gap-2">

      {/* PANEL EXPANDIDO: los mismos controles del bloque fijo que reemplaza */}
      {abierto && (
        <div className="bg-brand-brown text-white p-5 rounded-xl border border-brand-gold/20 shadow-lg text-center w-64 animate-fade-in">
          <div className="text-xs font-bold text-brand-cream/70 uppercase tracking-wider mb-1">Tiempo de Lanzamiento</div>
          <div className={`text-5xl font-black font-mono tracking-tighter my-1 ${tiempoTurno > 50 ? 'text-red-400 animate-pulse' : 'text-white'}`}>{formatoT(tiempoTurno)}</div>
          {onToggleTurno && (
            <div className="flex gap-2 mt-3">
              <button onClick={onToggleTurno} className={`flex-1 py-2.5 rounded-lg font-bold shadow-sm transition-colors ${cronometroTurnoActivo ? 'bg-yellow-500 hover:bg-yellow-600 text-yellow-900' : 'bg-brand-blue hover:bg-brand-brown text-white'}`}>{cronometroTurnoActivo ? 'Pausar' : 'Iniciar'}</button>
              {onResetTurno && (
                <button onClick={onResetTurno} className="px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold shadow-sm transition-colors">Reset</button>
              )}
            </div>
          )}
          <div className="mt-3 text-sm font-bold text-brand-cream/70">Total del partido: <span className="font-mono text-brand-cream">{formatoT(tiempoGlobal)}</span></div>
        </div>
      )}

      {/* ICONO CIRCULAR DE MARCA: compacto muestra el tiempo al vuelo, expandido cierra */}
      <button
        onClick={() => setAbierto(a => !a)}
        aria-expanded={abierto}
        aria-label="Cronometro de lanzamiento"
        className={`w-14 h-14 rounded-full border-2 shadow-lg flex items-center justify-center transition-colors ${abierto ? 'bg-brand-gold border-brand-gold text-brand-brown hover:bg-brand-rust hover:text-white' : 'bg-brand-brown border-brand-gold/60 text-white hover:bg-brand-rust'}`}
      >
        {abierto ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        ) : tiempoTurno > 0 || tiempoGlobal > 0 ? (
          <span className="text-[0.7rem] font-black font-mono">{formatoT(tiempoTurno)}</span>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        )}
      </button>
    </div>
  );
}