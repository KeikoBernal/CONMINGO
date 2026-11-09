import { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { tecladoModal } from '../Accesibilidad';

// LOTE 8F UX: compartir un partido agendado. Modal de marca con el link del
// marcador publico, su QR descargable y la barra de compartir: en movil el
// Web Share nativo del sistema (abre todas las apps instaladas) y en
// escritorio botones de WhatsApp, Telegram, X, Facebook y copiar link.
// Solo presentacion, cero backend.

export default function CompartirPartido({ partido, url, onCerrar }) {
  const [copiado, setCopiado] = useState(false);
  const encuentro = (partido?.local_nombre || 'Por definir') + ' vs ' + (partido?.visita_nombre || 'Por definir');
  const mensaje = 'Sigue el encuentro ' + encuentro + ' en vivo en CONMINGO';
  const shareNativo = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const compartirNativo = () => {
    navigator.share({ title: 'CONMINGO', text: mensaje, url: url }).catch(() => {});
  };

  const copiarLink = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch (e) {
      try {
        const area = document.createElement('textarea');
        area.value = url;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        ok = true;
      } catch (e2) { /* el navegador nego el permiso de copia */ }
    }
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  };

  const descargarQr = () => {
    const canvas = document.getElementById('canvas-qr-compartir');
    if (!canvas) return;
    const enlace = document.createElement('a');
    enlace.href = canvas.toDataURL('image/png');
    enlace.download = 'qr-marcador-' + (partido?.uuid_publico || partido?.id || 'partido') + '.png';
    enlace.click();
  };

  const redes = [
    { id: 'whatsapp', etiqueta: 'WhatsApp', enlace: 'https://wa.me/?text=' + encodeURIComponent(mensaje + ' ' + url) },
    { id: 'telegram', etiqueta: 'Telegram', enlace: 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(mensaje) },
    { id: 'x', etiqueta: 'X', enlace: 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(mensaje) },
    { id: 'facebook', etiqueta: 'Facebook', enlace: 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url) }
  ];

  return (
    <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Compartir Partido" onKeyDown={(evento) => tecladoModal(evento, onCerrar)}>
      <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl border border-brand-gold/30 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-brand-brown">Compartir Partido</h3>
          <button autoFocus onClick={onCerrar} className="p-2 text-brand-brown hover:bg-brand-cream rounded-lg" title="Cerrar" aria-label="Cerrar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="text-sm text-brand-brown/70 mb-2">{encuentro}</p>
        <p className="text-xs text-brand-brown/60 mb-4">Comparte el enlace del marcador publico para que el publico siga el partido en vivo desde su telefono.</p>
        <div className="flex justify-center bg-white p-4 border border-brand-gold/30 rounded-lg">
          <QRCodeCanvas id="canvas-qr-compartir" value={url} size={220} level="M" marginSize={2} bgColor="#FFFFFF" fgColor="#000000" />
        </div>
        <p className="text-[0.65rem] text-brand-brown/50 mt-2 text-center break-all">{url}</p>

        {shareNativo ? (
          <button onClick={compartirNativo} className="mt-4 w-full py-3 bg-brand-blue text-white rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-sm">Compartir</button>
        ) : (
          <div className="mt-4">
            <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Compartir en</div>
            <div className="grid grid-cols-2 gap-2">
              {redes.map(red => (
                <button key={red.id} onClick={() => window.open(red.enlace, '_blank')} className="py-2.5 px-3 bg-brand-cream border border-brand-gold/40 text-brand-brown rounded-lg font-bold text-sm hover:bg-brand-rust hover:text-white transition-colors">{red.etiqueta}</button>
              ))}
              <button onClick={copiarLink} className="py-2.5 px-3 bg-brand-cream border border-brand-gold/40 text-brand-brown rounded-lg font-bold text-sm hover:bg-brand-rust hover:text-white transition-colors col-span-2">{copiado ? 'Link copiado' : 'Copiar link'}</button>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <button onClick={descargarQr} className="flex-1 py-3 bg-white border border-brand-gold/40 text-brand-brown rounded-lg font-bold hover:bg-brand-rust hover:text-white transition-colors">Descargar PNG</button>
          <button onClick={() => window.open(url, '_blank')} className="flex-1 py-3 bg-brand-blue text-white rounded-lg font-bold hover:bg-brand-brown transition-colors">Abrir Pantalla</button>
        </div>
        <button onClick={onCerrar} className="mt-3 w-full py-3 bg-gray-200 text-brand-brown rounded-lg font-bold hover:bg-gray-300 transition-colors">Cerrar</button>
      </div>
    </div>
  );
}