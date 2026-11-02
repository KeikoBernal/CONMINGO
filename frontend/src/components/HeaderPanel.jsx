// FASE 2 UX: encabezado compartido de los 5 paneles.
// Consolidacion del header duplicado: titulo, boton de menu movil, acciones de la derecha
// y el boton Cerrar Sesion unificado (estilo del PR #84) viven aqui.
// FIX responsive (pedido de Keiko): en pantallas chicas las acciones y el boton
// Cerrar Sesion se envuelven en filas en vez de empujarse fuera de la pantalla;
// el alto pasa de fijo a minimo para que el header crezca cuando algo envuelve.

export default function HeaderPanel({ titulo, onAbrirMenu, onCerrarSesion, acciones, tituloMovil = false, apilado = false, claseTitulo }) {
  const claseContenedor = apilado
    ? 'h-auto sm:h-20 py-4 sm:py-0 bg-white border-b border-brand-gold/20 flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-6 shadow-sm shrink-0 gap-4'
    : 'min-h-16 sm:min-h-20 py-2 sm:py-0 bg-white border-b border-brand-gold/20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-6 shadow-sm shrink-0';
  const claseTituloFinal = claseTitulo || (tituloMovil
    ? 'text-xl sm:text-2xl font-bold text-brand-brown capitalize truncate min-w-0'
    : 'text-2xl font-bold text-brand-brown hidden sm:block');
  return (
    <header className={claseContenedor}>
      <div className={'flex items-center gap-4 min-w-0' + (apilado ? ' w-full sm:w-auto' : '')}>
        <button onClick={onAbrirMenu} className="md:hidden p-2 text-brand-brown hover:bg-brand-cream rounded-md shrink-0" aria-label="Abrir menu">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <h2 className={claseTituloFinal}>{titulo}</h2>
      </div>
      <div className={'flex flex-wrap items-center justify-end gap-2 sm:gap-4' + (apilado ? ' w-full sm:w-auto' : '')}>
        {acciones}
        <button onClick={onCerrarSesion} className="flex items-center gap-2 px-4 py-2 bg-brand-brown text-brand-cream hover:bg-brand-rust rounded-lg font-semibold text-sm transition-colors shadow-sm shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          <span className="hidden sm:inline">Cerrar Sesion</span>
        </button>
      </div>
    </header>
  );
}
