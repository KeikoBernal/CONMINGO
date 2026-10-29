import { useEffect, useRef, useState } from 'react';

// LOTE 6D: modal de firma digital sobre canvas. Soporta dedo (táctil),
// ratón y lápiz; devuelve la imagen como dataURL PNG lista para el
// backend. Estilo de la marca, sin emojis.
export default function FirmaCanvas({ titulo, onGuardar, onCerrar }) {
  const canvasRef = useRef(null);
  const dibujandoRef = useRef(false);
  const [hayTrazo, setHayTrazo] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1f2937';

    // Escala: el canvas interno puede medir distinto que el mostrado.
    const posicionar = (e) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
      };
    };
    const alBajar = (e) => {
      e.preventDefault();
      dibujandoRef.current = true;
      const p = posicionar(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    const alMover = (e) => {
      if (!dibujandoRef.current) return;
      e.preventDefault();
      const p = posicionar(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      setHayTrazo(true);
    };
    const alSubir = () => { dibujandoRef.current = false; };

    canvas.addEventListener('pointerdown', alBajar);
    canvas.addEventListener('pointermove', alMover);
    window.addEventListener('pointerup', alSubir);
    return () => {
      canvas.removeEventListener('pointerdown', alBajar);
      canvas.removeEventListener('pointermove', alMover);
      window.removeEventListener('pointerup', alSubir);
    };
  }, []);

  const limpiar = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHayTrazo(false);
  };

  const guardar = () => {
    if (!hayTrazo) return;
    onGuardar(canvasRef.current.toDataURL('image/png'));
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 p-4">
      <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl border border-brand-gold/30">
        <h3 className="text-xl font-bold text-brand-brown mb-1">{titulo}</h3>
        <p className="text-xs text-brand-brown/60 mb-4">Firme con el dedo o el ratón dentro del recuadro.</p>
        <canvas
          ref={canvasRef}
          width={420}
          height={180}
          className="w-full h-44 bg-white border-2 border-dashed border-brand-gold/50 rounded-lg touch-none cursor-crosshair shadow-inner"
        />
        <div className="flex gap-3 mt-5">
          <button onClick={guardar} disabled={!hayTrazo} className={'flex-1 text-white py-2.5 rounded-lg font-bold transition-colors shadow-sm ' + (hayTrazo ? 'bg-brand-blue hover:bg-brand-brown' : 'bg-gray-400 opacity-70 cursor-not-allowed')}>
            Guardar Firma
          </button>
          <button onClick={limpiar} className="flex-1 bg-brand-cream text-brand-brown py-2.5 rounded-lg font-bold hover:bg-brand-gold hover:text-white transition-colors border border-brand-gold/30 shadow-sm">
            Limpiar
          </button>
          <button onClick={onCerrar} className="flex-1 bg-gray-200 text-brand-brown py-2.5 rounded-lg font-bold hover:bg-gray-300 transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
