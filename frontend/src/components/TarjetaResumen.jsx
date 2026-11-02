// FASE B1 UX: tarjeta de resumen (KPI) de la pestana Inicio de los paneles.
// Componente de marca: icono del catalogo NavIcon, valor protagonista y accion opcional
// que navega a la pestana correspondiente. Sin emojis, boton rounded-lg.
import NavIcon from './NavIcon';

export default function TarjetaResumen({ icono, titulo, valor, texto, onClick, textoAccion }) {
  return (
    <div className="bg-white rounded-lg border border-brand-gold/20 shadow-sm p-4 flex flex-col gap-2 animate-fade-in">
      <div className="flex items-center gap-2 text-brand-brown">
        <NavIcon nombre={icono} className="w-5 h-5" />
        <span className="text-xs font-bold uppercase tracking-wide">{titulo}</span>
      </div>
      <div className="text-2xl font-black text-brand-rust leading-tight">{valor}</div>
      {texto ? <p className="text-sm text-brand-brown/70">{texto}</p> : null}
      {onClick && textoAccion ? (
        <button
          type="button"
          onClick={onClick}
          className="mt-auto self-start bg-white border border-brand-gold/40 text-brand-brown rounded-lg font-bold text-sm px-4 py-2 hover:bg-brand-rust hover:text-white transition-colors"
        >
          {textoAccion}
        </button>
      ) : null}
    </div>
  );
}
