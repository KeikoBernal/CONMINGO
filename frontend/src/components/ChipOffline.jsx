// FASE D UX: chip persistente del modo offline de los oficiales. Sin senal
// avisa que todo se guarda en este dispositivo; al volver la conexion muestra
// los envios que el servidor rechazo, con boton de reintentar.
export default function ChipOffline({ enLinea, pendientes, fallidos, reintentando, onReintentar }) {
  if (enLinea && pendientes === 0 && fallidos === 0) return null;

  if (!enLinea) {
    return (
      <div className="fixed bottom-4 right-4 z-40 max-w-xs bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg shadow-lg animate-fade-in" role="status">
        <p className="text-sm font-bold">Sin conexion</p>
        <p className="text-xs mt-0.5 leading-relaxed">
          Todo se guarda en este dispositivo{pendientes > 0 ? ' (' + pendientes + ' por enviar)' : ''}. Se envia solo al reconectar.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-xs bg-red-50 border border-red-300 text-red-800 px-4 py-3 rounded-lg shadow-lg animate-fade-in" role="status">
      <p className="text-sm font-bold">{fallidos} {fallidos === 1 ? 'envio fallido' : 'envios fallidos'}</p>
      <p className="text-xs mt-0.5 leading-relaxed">El servidor rechazo estos envios guardados localmente.</p>
      <button
        onClick={onReintentar}
        disabled={reintentando}
        className="mt-2 w-full bg-red-600 text-white py-2 rounded-lg text-xs font-bold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {reintentando ? 'Reintentando...' : 'Reintentar envios'}
      </button>
    </div>
  );
}
