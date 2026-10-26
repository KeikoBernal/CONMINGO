import { useState } from 'react';

// LOTE 1a: CampoTexto, campo con etiqueta flotante compartido por los formularios
// del sistema. La etiqueta baja cuando el campo esta vacio y sube al enfocarlo o
// cuando hay contenido, garantizando que el nombre del campo siempre sea visible.
export default function CampoTexto({ etiqueta, tipo = 'text', valor, onChange, requerido = false, error = false, ayuda = '', className = '', onFocus, onBlur, ...props }) {
  const [enfocado, setEnfocado] = useState(false);
  const esFecha = tipo === 'date' || tipo === 'datetime-local' || tipo === 'time';
  const elevada = enfocado || esFecha || String(valor ?? '') !== '';
  return (
    <div className={'min-w-0 ' + className}>
      <div className="relative">
        <input
          type={tipo}
          value={valor}
          onChange={onChange}
          required={requerido}
          onFocus={event => { setEnfocado(true); if (onFocus) onFocus(event); }}
          onBlur={event => { setEnfocado(false); if (onBlur) onBlur(event); }}
          className={'w-full rounded-lg border bg-white px-3 pt-5 pb-1.5 text-sm font-semibold text-brand-brown outline-none transition-colors focus:border-brand-rust focus:ring-2 focus:ring-brand-gold/20 disabled:cursor-not-allowed disabled:bg-brand-cream/30 ' + (error ? 'border-red-500' : 'border-brand-gold/40')}
          {...props}
        />
        <label className={'pointer-events-none absolute left-3 transition-all duration-150 ' + (elevada ? 'top-1 text-[10px] font-bold uppercase tracking-wide text-brand-brown/60' : 'top-1/2 -translate-y-1/2 text-sm font-semibold text-brand-brown/50')}>{etiqueta}</label>
      </div>
      {ayuda && <p className="mt-1 text-[11px] font-semibold text-brand-brown/60">{ayuda}</p>}
    </div>
  );
}