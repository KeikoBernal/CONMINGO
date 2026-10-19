import { useCallback, useEffect, useState } from 'react';

// ============================================================
// LOTE M — PWA OFFLINE
// La app ya instala un Service Worker (vite-plugin-pwa) que precachea
// el "shell" (HTML/JS/CSS), de modo que abre sin conexión. Lo que faltaba
// era contarlo: sin red, Supabase y la API fallan con errores crípticos.
// Este módulo detecta la pérdida de conexión (eventos online/offline del
// navegador + verificación real contra el backend) y mientras tanto
// muestra una pantalla amable con botón de reintento.
// ============================================================

// Hook de conectividad. navigator.onLine puede mentir (wifi con portal
// cautivo, DNS caído), por eso el reintento verifica contra /api/health.
export function useConexion(apiUrl) {
  const [enLinea, setEnLinea] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [verificando, setVerificando] = useState(false);

  useEffect(() => {
    const marcarEnLinea = () => setEnLinea(true);
    const marcarSinConexion = () => setEnLinea(false);
    window.addEventListener('online', marcarEnLinea);
    window.addEventListener('offline', marcarSinConexion);
    return () => {
      window.removeEventListener('online', marcarEnLinea);
      window.removeEventListener('offline', marcarSinConexion);
    };
  }, []);

  const verificarConexion = useCallback(async () => {
    setVerificando(true);
    try {
      // Cualquier respuesta HTTP (incluso un 5xx de la API) demuestra que hay
      // red; solo el fallo total del fetch significa "sin conexión".
      await fetch(`${apiUrl}/health`, { method: 'HEAD', cache: 'no-store' });
      setEnLinea(true);
    } catch {
      setEnLinea(false);
    } finally {
      setVerificando(false);
    }
  }, [apiUrl]);

  return { enLinea, verificando, verificarConexion };
}

// Pantalla de marca que se muestra en toda la app mientras no hay conexión.
export default function PantallaOffline({ verificando = false, onReintentar }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-cream px-4 py-10 font-sans text-brand-brown selection:bg-brand-gold/40">
      <div className="w-full max-w-md text-center animate-fade-in">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-brand-rust/10 border border-brand-gold/40">
          <svg className="h-12 w-12 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.05 11.55a11 11 0 0114.9 0M7.5 14.05a7 7 0 019 0M10 16.55a3 3 0 014 0M12 19.55h.01M3 3l18 18" />
          </svg>
        </div>

        <h1 className="text-3xl font-extrabold tracking-tight mb-3">Sin conexión a Internet</h1>
        <p className="text-brand-brown/70 leading-relaxed mb-8">
          La aplicación sigue instalada y tus datos están a salvo, pero necesita
          conexión para consultar torneos, partidos y marcadores en vivo.
        </p>

        <button
          onClick={onReintentar}
          disabled={verificando}
          className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-lg font-bold tracking-wide text-white shadow-md transition-colors ${verificando ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-rust hover:bg-brand-brown hover:shadow-lg'}`}
        >
          {verificando ? (
            <>
              <span className="h-5 w-5 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
              Verificando conexión...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Reintentar conexión
            </>
          )}
        </button>

        <p className="mt-6 text-xs text-brand-brown/50">
          No te preocupes: la app vuelve sola en cuanto regrese la señal.
        </p>
      </div>
    </div>
  );
}
