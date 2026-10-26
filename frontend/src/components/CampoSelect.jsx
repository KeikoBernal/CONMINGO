// LOTE 1a: CampoSelect, selector nativo con etiqueta flotante compartido por los
// formularios del sistema. La etiqueta permanece elevada sobre el borde y el
// elemento sigue siendo el <select> nativo del navegador (regla del proyecto).
export default function CampoSelect({ etiqueta, valor, onChange, requerido = false, className = '', children, ...props }) {
  return (
    <div className={'min-w-0 ' + className}>
      <div className="relative">
        <select
          value={valor}
          onChange={onChange}
          required={requerido}
          className="w-full appearance-none rounded-lg border border-brand-gold/40 bg-white px-3 pt-5 pb-1.5 pr-9 text-sm font-semibold text-brand-brown outline-none transition-colors focus:border-brand-rust focus:ring-2 focus:ring-brand-gold/20 disabled:cursor-not-allowed disabled:bg-brand-cream/30"
          {...props}
        >
          {children}
        </select>
        <label className="pointer-events-none absolute left-3 top-1 text-[10px] font-bold uppercase tracking-wide text-brand-brown/60">{etiqueta}</label>
        <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-brown/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
      </div>
    </div>
  );
}