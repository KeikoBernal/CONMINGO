import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

// LOTE 6F (M5): telemetria de errores con Sentry en el frontend.
// Si VITE_SENTRY_DSN no esta definida, el SDK queda inerte y la app
// se comporta exactamente igual que siempre.
const dsnSentry = import.meta.env.VITE_SENTRY_DSN
if (dsnSentry) {
  Sentry.init({
    dsn: dsnSentry,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0, // solo reporte de errores, sin trazas de rendimiento
    sendDefaultPii: false
  })
}

// LOTE 6F (M5): frontera de errores global. Si la UI falla, el error se
// reporta a Sentry y el usuario ve una pantalla de marca con boton de recargar.
const pantallaErrorSentry = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-brand-cream text-brand-brown px-4">
    <h1 className="text-2xl font-bold mb-2">Ocurrio un error inesperado</h1>
    <p className="mb-6 text-brand-brown/70 text-center">El equipo ya fue notificado. Intenta recargar la pagina.</p>
    <button
      onClick={() => window.location.reload()}
      className="px-6 py-2 rounded-lg bg-brand-rust text-white font-bold hover:bg-brand-brown transition-colors"
    >
      Recargar
    </button>
  </div>
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={pantallaErrorSentry}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
