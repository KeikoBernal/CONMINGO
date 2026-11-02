// FASE 1 UX: estado vacio consistente para vistas y tablas del sistema.
// Muestra un icono SVG de marca, un titulo, una descripcion corta y una
// accion opcional (boton principal). Sin emojis.
const ICONOS = {
  calendario: <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  equipo: <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  documento: <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  trofeo: <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 21h8m-4-4v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H5a2 2 0 00-2 2c0 1.657 1.343 3 3 3h1m10-5h2a2 2 0 012 2c0 1.657-1.343 3-3 3h-1" /></svg>,
  lista: <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>,
};

export default function EmptyState({ titulo, descripcion, icono = 'lista', accion }) {
  return (
    <div className="text-center p-8 sm:p-12 bg-white rounded-xl border border-brand-gold/20 shadow-sm">
      <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-brand-cream flex items-center justify-center text-brand-gold">
        {ICONOS[icono] || ICONOS.lista}
      </div>
      <p className="text-base font-bold text-brand-brown">{titulo}</p>
      {descripcion && <p className="text-sm text-brand-brown/60 mt-1 max-w-md mx-auto leading-snug">{descripcion}</p>}
      {accion && <div className="mt-5">{accion}</div>}
    </div>
  );
}
