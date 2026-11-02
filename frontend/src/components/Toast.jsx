import { useCallback, useRef, useState } from 'react';

const TIPOS_TOAST = {
  exito: { icono: 'OK', texto: 'text-green-700', borde: 'border-green-500/40' },
  error: { icono: 'ERROR', texto: 'text-red-700', borde: 'border-red-500/40' },
  info: { icono: 'INFO', texto: 'text-brand-blue', borde: 'border-brand-blue/40' }
};

// LOTE K: hook de notificaciones visuales (reemplaza los alert nativos).
export function useToasts(duracionMs = 4200) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const cerrarToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const mostrarToast = useCallback((mensaje, tipo = 'exito') => {
    idRef.current += 1;
    const id = idRef.current;
    setToasts(prev => [...prev.slice(-3), { id, mensaje, tipo }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duracionMs);
  }, [duracionMs]);

  return { toasts, mostrarToast, cerrarToast };
}

// LOTE K: contenedor fijo de toasts (esquina superior derecha).
export function ToastContainer({ toasts, onCerrar }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2" role="status" aria-live="polite">
      {toasts.map(toast => {
        const config = TIPOS_TOAST[toast.tipo] || TIPOS_TOAST.info;
        return (
          <div key={toast.id} className={'animate-fade-in flex items-start gap-2 rounded-lg border bg-white px-4 py-3 shadow-lg ' + config.borde}>
            <span aria-hidden="true" className={'text-base leading-5 ' + config.texto}>{config.icono}</span>
            <p className={'flex-1 break-words text-sm font-semibold ' + config.texto}>{toast.mensaje}</p>
            <button type="button" onClick={() => onCerrar && onCerrar(toast.id)} className="shrink-0 text-lg leading-5 text-brand-brown/40 transition hover:text-brand-brown" aria-label="Cerrar notificación">✕</button>
          </div>
        );
      })}
    </div>
  );
}
