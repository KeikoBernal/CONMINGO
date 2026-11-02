import { useCallback, useRef, useState } from 'react';

// FASE 1 UX: sistema de toasts compartido por los cinco paneles.
// useToasts() expone mostrarToast(mensaje, 'exito' | 'error' | 'info') con la
// misma firma que tenia el toast local del AdminLiga, y ToastPanel los dibuja
// fijos arriba a la derecha, por encima del resto de la interfaz.
// Sustituye los alert() nativos del navegador, que rompen la identidad visual
// de la marca y son bruscos en el movil. Sin emojis: solo iconos SVG.

const DURACION_TOAST_MS = 4500;
const TOASTS_MAXIMOS = 4;

const CONFIG_TOAST = {
  exito: { barra: 'border-l-green-600', icono: 'text-green-600' },
  error: { barra: 'border-l-red-600', icono: 'text-red-600' },
  info: { barra: 'border-l-brand-blue', icono: 'text-brand-blue' },
};

const IconoToast = ({ tipo }) => {
  if (tipo === 'exito') return <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  if (tipo === 'error') return <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  return <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
};

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const siguienteId = useRef(0);

  const quitarToast = useCallback((id) => {
    setToasts((previo) => previo.filter((toast) => toast.id !== id));
  }, []);

  const mostrarToast = useCallback((mensaje, tipo = 'info') => {
    if (!mensaje) return;
    const id = ++siguienteId.current;
    setToasts((previo) => [...previo, { id, mensaje: String(mensaje), tipo }].slice(-TOASTS_MAXIMOS));
    setTimeout(() => quitarToast(id), DURACION_TOAST_MS);
  }, [quitarToast]);

  return { toasts, mostrarToast, quitarToast };
}

export function ToastPanel({ toasts, onQuitar }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="fixed top-20 right-4 z-[2500] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((toast) => {
        const config = CONFIG_TOAST[toast.tipo] || CONFIG_TOAST.info;
        return (
          <div key={toast.id} className={'pointer-events-auto bg-white border border-brand-gold/30 border-l-4 ' + config.barra + ' rounded-lg shadow-xl px-4 py-3 flex items-start gap-3 animate-slide-up'}>
            <span className={config.icono + ' mt-0.5'}><IconoToast tipo={toast.tipo} /></span>
            <p className="text-sm font-semibold text-brand-brown leading-snug flex-1 whitespace-pre-line">{toast.mensaje}</p>
            <button type="button" onClick={() => onQuitar(toast.id)} className="sin-toque text-brand-brown/40 hover:text-brand-brown transition-colors shrink-0 p-1" title="Cerrar aviso">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
