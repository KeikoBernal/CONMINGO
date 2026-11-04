import { useState } from 'react';

// C2: barra lateral compartida de los dashboards.
// En escritorio se contrae a modo solo-iconos (persistido en localStorage);
// en movil sigue siendo el menu deslizante que abre la hamburguesa.
export default function Sidebar({
  logoUrl,
  titulo,
  subtitulo,
  grupos = [],
  pestana,
  onPestana,
  animandoBoton,
  renderIcono,
  menuAbierto,
  onCerrarMenu,
  claveColapso = 'sidebarColapsada',
  onVerGuia,
}) {
  const [colapsado, setColapsado] = useState(() => localStorage.getItem(claveColapso) === 'true');

  const alternarColapso = () => {
    setColapsado(previo => {
      localStorage.setItem(claveColapso, String(!previo));
      return !previo;
    });
  };

  return (
    <>
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-brand-brown text-brand-cream shadow-2xl transform transition-all duration-300 ease-in-out flex flex-col ${menuAbierto ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static md:shrink-0 ${colapsado ? 'md:w-20' : 'md:w-64'}`}>

        {/* Boton para contraer o expandir (solo escritorio) */}
        <button
          type="button"
          onClick={alternarColapso}
          title={colapsado ? 'Expandir menu lateral' : 'Contraer menu lateral'}
          aria-label={colapsado ? 'Expandir menu lateral' : 'Contraer menu lateral'}
          className="hidden md:flex absolute top-6 -right-3 z-10 w-6 h-6 items-center justify-center rounded-full bg-brand-brown border border-brand-gold/50 text-brand-gold hover:text-brand-cream hover:border-brand-cream transition-colors shadow-md"
        >
          <svg className={`w-3.5 h-3.5 transition-transform duration-300 ${colapsado ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Logo y nombre de la liga */}
        <div className={`border-b border-brand-gold/20 shrink-0 bg-brand-brown/50 ${colapsado ? 'md:px-2 md:py-4' : 'p-6'}`}>
          <div className={`flex items-center gap-3 ${colapsado ? 'md:justify-center md:gap-0' : ''}`}>
            <div className="w-12 h-12 rounded-full bg-brand-cream/10 border border-brand-gold/50 flex items-center justify-center shrink-0 overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo Liga" className="w-full h-full object-cover" />
              ) : (
                <svg className="w-6 h-6 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              )}
            </div>
            <div className={`overflow-hidden ${colapsado ? 'md:hidden' : ''}`}>
              <h1 className="text-lg font-bold text-brand-cream truncate" title={titulo}>
                {titulo}
              </h1>
              <p className="text-xs text-brand-gold font-semibold uppercase tracking-wider mt-0.5">
                {subtitulo}
              </p>
            </div>
          </div>
        </div>

        {/* Navegacion */}
        <div className="flex-1 overflow-y-auto py-6 hide-scrollbar flex flex-col gap-6">
          {grupos.map(grupo => (
            <div key={grupo.etiqueta}>
              <div className={`px-6 mb-2 text-xs font-bold text-brand-blue uppercase tracking-wider ${colapsado ? 'md:hidden' : ''}`}>
                {grupo.etiqueta}
              </div>
              <nav className="space-y-1">
                {grupo.items.map(item => {
                  const isAnimating = animandoBoton === item.id;
                  const isActive = pestana === item.id && !isAnimating;

                  return (
                    <button
                      key={item.id}
                      onClick={() => onPestana(item.id)}
                      title={item.label}
                      aria-label={item.label}
                      className={`w-full ${colapsado ? 'md:px-0' : 'px-6'} py-3 text-sm font-medium transition-colors ${isActive ? `bg-brand-rust/20 text-brand-gold border-r-4 border-brand-gold ${colapsado ? 'md:border-r-0' : ''}` : 'text-brand-cream/70 hover:bg-brand-cream/5 hover:text-brand-cream'}`}
                    >
                      <div className={`flex items-center gap-3 w-full ${colapsado ? 'md:justify-center' : ''}`}>
                        {/* Envoltorio del icono para transformarlo en bola */}
                        <div className={`w-6 h-6 flex items-center justify-center shrink-0 ${isAnimating ? 'anim-icono-bola' : ''}`}>
                          {renderIcono(item.id)}
                        </div>
                        <span className={`transition-all ${colapsado ? 'md:hidden' : ''} ${isAnimating ? 'anim-texto-fade' : ''}`}>
                          {item.label}
                        </span>
                        {/* UX: contador opcional por item (p. ej. partidos de hoy de Arbitro/Anotador) */}
                        {item.badge > 0 && (
                          <span className={`bg-brand-gold/20 text-brand-gold text-xs font-bold px-2 py-0.5 rounded-full ${colapsado ? 'md:hidden' : ''}`}>
                            {item.badge}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>


        {/* B2: guia del panel, relanzable al pie del sidebar */}
        {onVerGuia && (
          <div className={`border-t border-brand-gold/20 shrink-0 ${colapsado ? 'md:px-2 md:py-3' : 'px-6 py-4'}`}>
            <button
              type="button"
              onClick={onVerGuia}
              title="Ver guia del panel"
              aria-label="Ver guia del panel"
              className={`w-full flex items-center gap-3 ${colapsado ? 'md:justify-center' : ''} py-2 text-sm font-semibold text-brand-gold hover:text-brand-cream hover:bg-brand-cream/5 rounded-lg transition-colors`}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
              <span className={`transition-all ${colapsado ? 'md:hidden' : ''}`}>Ver guia del panel</span>
            </button>
          </div>
        )}
      </aside>

      {/* OVERLAY MOVIL */}
      {menuAbierto && (
        <div className="fixed inset-0 bg-brand-brown/50 z-30 md:hidden" onClick={onCerrarMenu}></div>
      )}
    </>
  );
}
