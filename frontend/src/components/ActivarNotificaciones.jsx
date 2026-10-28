import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

// LOTE 5 (N4): activacion de las notificaciones push del navegador.
// Componente autocontenido: no usa fetchConToken porque cada dashboard
// prefija su propia ruta y este panel apunta al router /api/notificaciones
// comun a todos los roles.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Convierte la clave publica VAPID (base64url) al Uint8Array que exige
// pushManager.subscribe.
const urlBase64AUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const salida = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    salida[i] = raw.charCodeAt(i);
  }
  return salida;
};

export default function ActivarNotificaciones({ colapsado = false }) {
  const [estado, setEstado] = useState('cargando');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState(null);

  const fetchApi = async (ruta, opciones = {}) => {
    const { data } = await supabase.auth.getSession();
    const token = data && data.session ? data.session.access_token : '';
    return fetch(API_URL + ruta, {
      ...opciones,
      headers: {
        'Content-Type': 'application/json',
        ...(opciones.headers || {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    });
  };

  useEffect(() => {
    const revisar = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setEstado('no_soportado');
        return;
      }
      try {
        const resp = await fetchApi('/notificaciones/vapid-public-key');
        const datos = await resp.json();
        if (!datos.disponible) {
          setEstado('no_configurado');
          return;
        }
        if (Notification.permission === 'granted') setEstado('activo');
        else if (Notification.permission === 'denied') setEstado('denegado');
        else setEstado('desactivado');
      } catch (e) {
        setEstado('desactivado');
      }
    };
    revisar();
  }, []);

  const activarPush = async () => {
    setTrabajando(true);
    setError(null);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') {
        setError('No se dio permiso para las notificaciones en este navegador.');
        return;
      }
      const resp = await fetchApi('/notificaciones/vapid-public-key');
      const datos = await resp.json();
      if (!datos.disponible || !datos.publicKey) {
        setEstado('no_configurado');
        return;
      }
      const registro = await navigator.serviceWorker.ready;
      const suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64AUint8Array(datos.publicKey)
      });
      const res = await fetchApi('/notificaciones/suscripcion', {
        method: 'POST',
        body: JSON.stringify(suscripcion.toJSON())
      });
      const cuerpo = await res.json();
      if (!res.ok) throw new Error(cuerpo.error || 'Error al activar las notificaciones.');
      setEstado('activo');
    } catch (e) {
      setError(e && e.message ? e.message : 'Error al activar las notificaciones.');
    } finally {
      setTrabajando(false);
    }
  };

  if (estado === 'cargando' || estado === 'no_soportado') return null;

  return (
    <div className={colapsado ? 'md:hidden' : ''}>
      {estado === 'activo' && (
        <div className="flex items-center justify-center gap-2 text-xs font-semibold text-brand-gold">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          Notificaciones activas
        </div>
      )}
      {estado === 'no_configurado' && (
        <p className="text-xs text-brand-cream/60 text-center">Push no configurado en el servidor.</p>
      )}
      {estado === 'denegado' && (
        <p className="text-xs text-red-300 text-center">Notificaciones bloqueadas en este navegador.</p>
      )}
      {estado === 'desactivado' && (
        <button
          type="button"
          onClick={activarPush}
          disabled={trabajando}
          className="w-full py-2 rounded-lg font-bold transition-colors text-sm bg-brand-cream/10 text-brand-cream border border-brand-gold/30 hover:bg-brand-rust disabled:opacity-50"
        >
          {trabajando ? 'Activando...' : 'Activar notificaciones'}
        </button>
      )}
      {error && <p className="text-xs text-red-300 text-center mt-2">{error}</p>}
    </div>
  );
}
