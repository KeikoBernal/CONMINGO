// FASE 1 UX: dialogo de confirmacion de marca que sustituye a window.confirm
// en los cinco paneles. Patron de uso en cada dashboard:
//   const [confirmacion, setConfirmacion] = useState(null);
//   const pedirConfirmacion = (titulo, mensaje, tipo) =>
//     new Promise((resolver) => setConfirmacion({ titulo, mensaje, tipo, resolver }));
//   if (!(await pedirConfirmacion('Eliminar sede', '¿Eliminar esta sede?', 'peligro'))) return;
// Resuelve true al confirmar y false al cancelar o pulsar fuera del dialogo.
import { tecladoModal } from './Accesibilidad';

export default function ConfirmDialog({ confirmacion, onCerrar }) {
  if (!confirmacion) return null;

  const cerrarCon = (valor) => {
    confirmacion.resolver(valor);
    onCerrar();
  };

  const esPeligro = confirmacion.tipo === 'peligro';

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={confirmacion.titulo} onKeyDown={(evento) => tecladoModal(evento, () => cerrarCon(false))} onClick={() => cerrarCon(false)}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-2xl border border-brand-gold/30 p-6 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className={'w-10 h-10 rounded-full flex items-center justify-center shrink-0 ' + (esPeligro ? 'bg-red-50 text-red-600' : 'bg-brand-cream text-brand-brown')}>
            {esPeligro ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.91-.462.103-.994.59-.994 1.09m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            )}
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-brand-brown">{confirmacion.titulo}</h3>
            <p className="mt-1 text-sm text-brand-brown/70 leading-snug whitespace-pre-line">{confirmacion.mensaje}</p>
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-3 mt-6">
          <button type="button" autoFocus onClick={() => cerrarCon(false)} className="flex-1 px-4 py-2.5 rounded-lg font-bold text-sm bg-brand-cream text-brand-brown border border-brand-gold/40 hover:bg-brand-gold hover:text-white transition-colors shadow-sm">
            {confirmacion.textoCancelar || 'Cancelar'}
          </button>
          <button type="button" onClick={() => cerrarCon(true)} className={'flex-1 px-4 py-2.5 rounded-lg font-bold text-sm text-white transition-colors shadow-sm ' + (esPeligro ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-rust hover:bg-brand-brown')}>
            {confirmacion.textoConfirmar || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
