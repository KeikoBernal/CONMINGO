// LOTE 6H: aterriza el enlace de restablecimiento de contrasena (?restablecer=token).
// Vista publica, sin sesion: el administrador pide el reset desde el panel y la
// persona establece su propia clave con la misma politica de la clave
// provisional: 8+ caracteres con letras, numeros y caracter especial. Sin emojis.
import { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Misma politica que el backend en POST /restablecer-password
const POLITICA_PASSWORD = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,}$/;

export default function RestablecerContrasena() {
  const [estado, setEstado] = useState('formulario'); // formulario | ok | error
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);

  const establecer = async (e) => {
    e.preventDefault();
    if (enviando) return;
    setMensaje('');

    if (!POLITICA_PASSWORD.test(password.trim())) {
      return setMensaje('La contraseña debe tener al menos 8 caracteres e incluir letras, números y al menos un carácter especial.');
    }
    if (password.trim() !== confirmacion.trim()) {
      return setMensaje('Las contraseñas no coinciden. Verifica ambas e intenta de nuevo.');
    }

    const token = new URLSearchParams(window.location.search).get('restablecer');
    if (!token) {
      setEstado('error');
      setMensaje('El enlace no trae el código de restablecimiento.');
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch(`${API_URL}/restablecer-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, nueva_password: password.trim() }),
      });
      const datos = await res.json().catch(() => ({}));
      if (res.ok) {
        setEstado('ok');
        setMensaje(datos.mensaje || 'Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.');
      } else {
        setEstado('error');
        setMensaje(datos.error || 'El enlace de restablecimiento es inválido o ya expiró.');
      }
    } catch (err) {
      setEstado('error');
      setMensaje('Error de conexión con el servidor. Intenta de nuevo.');
    }
    setEnviando(false);
  };

  const volverAlInicio = () => {
    // Limpia el token de la URL para no reenviarlo al volver a la pantalla principal
    window.location.replace(window.location.pathname);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-cream font-sans text-brand-brown selection:bg-brand-gold/40 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-brand-gold/30 p-8 text-center animate-slide-up">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-cream rounded-full mb-4">
          {estado === 'formulario' ? (
            <svg className="w-8 h-8 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7z" /></svg>
          ) : estado === 'ok' ? (
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          ) : (
            <svg className="w-8 h-8 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )}
        </div>

        <h3 className="text-2xl font-bold mb-3">
          {estado === 'formulario' ? 'Establecer nueva contraseña' : estado === 'ok' ? 'Contraseña actualizada' : 'No se pudo completar el restablecimiento'}
        </h3>

        {estado === 'formulario' ? (
          <>
            <p className="text-sm text-brand-brown/70 mb-6">
              Define tu nueva contraseña. Debe tener al menos 8 caracteres e incluir letras, números y un carácter especial.
            </p>
            <form onSubmit={establecer} className="space-y-4 text-left">
              <div className="space-y-2">
                <label className="text-sm font-bold text-brand-brown">Nueva contraseña</label>
                <div className="relative">
                  <input
                    type={mostrarPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    className="w-full px-4 py-3 bg-brand-cream/20 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-rust focus:ring-2 focus:ring-brand-rust/20 transition-all pr-12"
                  />
                  <button type="button" onClick={() => setMostrarPassword(!mostrarPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand-rust transition-colors p-1">
                    {mostrarPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-brand-brown">Confirmar contraseña</label>
                <input
                  type={mostrarPassword ? 'text' : 'password'}
                  value={confirmacion}
                  onChange={(e) => setConfirmacion(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-brand-cream/20 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-rust focus:ring-2 focus:ring-brand-rust/20 transition-all"
                />
              </div>

              {mensaje && (
                <div className="p-3 rounded-lg text-sm text-center font-medium bg-red-50 text-red-600 border border-red-200">
                  {mensaje}
                </div>
              )}

              <button type="submit" disabled={enviando} className={`w-full text-white py-3 rounded-lg font-bold tracking-wide transition-colors shadow-md mt-2 ${enviando ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-rust hover:bg-brand-brown'}`}>
                {enviando ? 'Guardando...' : 'Establecer contraseña'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-brand-brown/70 mb-6">{mensaje}</p>
            <button onClick={volverAlInicio} className="w-full bg-brand-rust text-white py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md">
              {estado === 'ok' ? 'Ir a iniciar sesión' : 'Volver al inicio'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
