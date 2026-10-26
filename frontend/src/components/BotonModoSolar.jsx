import { useEffect, useState } from 'react';

// N7: interruptor del modo Luz Solar para las canchas.
// Agranda todo el texto del sistema (escala rem) y aclara los fondos claros
// para que Arbitro y Anotador puedan leer la pantalla a plena luz del dia.
// La preferencia se guarda en localStorage y se aplica como clase en <body>.
export default function BotonModoSolar({ className = '' }) {
  const [activo, setActivo] = useState(() => localStorage.getItem('modoLuzSolar') === 'true');

  useEffect(() => {
    document.body.classList.toggle('modo-luz-solar', activo);
    localStorage.setItem('modoLuzSolar', String(activo));
  }, [activo]);

  const alternar = () => setActivo(previo => !previo);

  return (
    <button
      type="button"
      onClick={alternar}
      title={activo ? 'Desactivar modo Luz Solar' : 'Activar modo Luz Solar: texto grande para leer a plena luz del dia'}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold transition-colors shadow-sm border ${activo ? 'bg-brand-gold text-brand-brown border-brand-gold' : 'bg-white text-brand-brown border-brand-gold/40 hover:bg-brand-rust hover:text-white'} ${className}`}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.95-6.95l-1.414 1.414M7.464 15.536l-1.414 1.414m0-12.728l1.414 1.414m9.192 9.192l1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
      </svg>
      <span className="hidden sm:inline">Luz Solar</span>
    </button>
  );
}
