// FASE 2 UX: encabezado compartido de los 5 paneles.
// Consolidacion del header duplicado: titulo, boton de menu movil y acciones
// de la derecha. El boton Cerrar Sesion (y el resto de las funciones de
// cuenta: logo, respaldo, luz solar, filtro de liga) vive en el footer del
// sidebar: la barra del titulo queda solo con el titulo (pedido de Keiko).

export default function HeaderPanel({ titulo, onAbrirMenu, acciones, tituloMovil = false, apilado = false, claseTitulo }) {
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
      </div>
    </header>
  );
}
