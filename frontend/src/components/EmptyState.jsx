// FASE 1 UX: estado vacio consistente para vistas y tablas del sistema.
// Muestra un icono SVG de marca, un titulo, una descripcion corta y una
// accion opcional (boton principal). Sin emojis.
// FASE 3C: los dibujos vienen del catalogo unico de NavIcon; un nombre
// desconocido cae en el icono lista.
import NavIcon, { existeIcono } from './NavIcon';

export default function EmptyState({ titulo, descripcion, icono = 'lista', accion }) {
  const nombreIcono = existeIcono(icono) ? icono : 'lista';
  return (
    <div className="text-center p-8 sm:p-12 bg-white rounded-xl border border-brand-gold/20 shadow-sm">
      <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-brand-cream flex items-center justify-center text-brand-gold">
        <NavIcon nombre={nombreIcono} className="w-7 h-7" />
      </div>
      <p className="text-base font-bold text-brand-brown">{titulo}</p>
      {descripcion && <p className="text-sm text-brand-brown/60 mt-1 max-w-md mx-auto leading-snug">{descripcion}</p>}
      {accion && <div className="mt-5">{accion}</div>}
    </div>
  );
}
