// LOTE 6G: aterriza el enlace de verificacion de correo (?verificar=token).
// Vista publica, sin sesion: sirve tanto para la verificacion inicial de la
// cuenta como para la confirmacion del cambio de correo (el backend distingue
// el tipo de token y responde con el mensaje que corresponde). Sin emojis.
import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function VerificarCorreo() {
  const [estado, setEstado] = useState('verificando'); // verificando | ok | error
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('verificar');
    if (!token) {
      setEstado('error');
      setMensaje('El enlace no trae el código de verificación.');
      return;
    }
    fetch(`${API_URL}/verificar-correo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const datos = await res.json().catch(() => ({}));
        setEstado(res.ok ? 'ok' : 'error');
        setMensaje(res.ok
          ? (datos.mensaje || 'Correo verificado correctamente.')
          : (datos.error || 'El enlace de verificación es inválido o ya expiró.'));
      })
      .catch(() => {
        setEstado('error');
        setMensaje('Error de conexión con el servidor. Intenta de nuevo.');
      });
  }, []);

  const volverAlInicio = () => {
    // Limpia el token de la URL para no reenviarlo al volver a la pantalla principal
    window.location.replace(window.location.pathname);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-cream font-sans text-brand-brown selection:bg-brand-gold/40 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-brand-gold/30 p-8 text-center animate-slide-up">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-cream rounded-full mb-4">
          {estado === 'verificando' ? (
            <div className="w-8 h-8 border-4 border-brand-gold border-t-brand-rust rounded-full animate-spin"></div>
          ) : estado === 'ok' ? (
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          ) : (
            <svg className="w-8 h-8 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )}
        </div>

        <h3 className="text-2xl font-bold mb-3">
          {estado === 'verificando' ? 'Verificando tu correo...' : estado === 'ok' ? 'Correo verificado' : 'No se pudo completar la verificación'}
        </h3>
        <p className="text-sm text-brand-brown/70 mb-6">{mensaje}</p>

        {estado !== 'verificando' ? (
          <button onClick={volverAlInicio} className="w-full bg-brand-rust text-white py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md">
            {estado === 'ok' ? 'Ir a iniciar sesión' : 'Volver al inicio'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
