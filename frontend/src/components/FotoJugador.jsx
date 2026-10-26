import { useState } from 'react';

// C3: foto de jugador reutilizable.
// Escritorio: se agranda al pasar el cursor. Tocar o clic abre un modal con la foto ampliada.
export default function FotoJugador({ src, nombre, className = 'w-8 h-8 rounded-full border border-brand-gold/50' }) {
  const [modalAbierto, setModalAbierto] = useState(false);

  if (!src) return null;

  const alt = nombre ? `Foto de ${nombre}` : 'Foto del jugador';

  return (
    <>
      <button
        type="button"
        onClick={() => setModalAbierto(true)}
        title={nombre ? `Ver foto de ${nombre}` : 'Ver foto del jugador'}
        className={`relative group shrink-0 ${className}`}
      >
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover rounded-full transition-transform duration-200 md:group-hover:scale-150 md:group-hover:shadow-xl"
        />
      </button>

      {modalAbierto && (
        <div
          className="fixed inset-0 z-50 bg-brand-brown/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setModalAbierto(false)}
        >
          <img src={src} alt={alt} className="max-w-[90vw] max-h-[85vh] rounded-lg border-2 border-brand-gold shadow-2xl" />
          <button
            type="button"
            onClick={() => setModalAbierto(false)}
            title="Cerrar"
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-brand-cream text-brand-brown font-bold hover:bg-brand-gold transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
