import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

// LOTE 6A: bandeja de notificaciones dentro de la app (campana).
// Lee los avisos que el backend ya registra en public.notificaciones
// (GET /api/notificaciones/mias) y los marca como leidos con
// PUT /api/notificaciones/marcar-leidas. Autocontenido igual que
// ActivarNotificaciones: cada dashboard prefija su propia ruta, asi
// que aqui se usa supabase.auth.getSession() y API_URL directamente.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const formatearHora = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return hora;
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
};

export default function CampanaNotificaciones({ colapsado = false }) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [items, setItems] = useState([]);
  const [noLeidas, setNoLeidas] = useState(0);

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

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await fetchApi('/notificaciones/mias');
      const datos = await res.json();
      const lista = Array.isArray(datos) ? datos : (datos.notificaciones || []);
      setItems(lista);
      setNoLeidas(lista.filter(av => !av.hora_lectura).length);
    } catch (e) {
      // silencioso: la campana no debe romper el panel
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const marcarLeidas = async () => {
    try {
      await fetchApi('/notificaciones/marcar-leidas', { method: 'PUT' });
      setItems(previo => previo.map(av => (av.hora_lectura ? av : { ...av, hora_lectura: new Date().toISOString() })));
      setNoLeidas(0);
    } catch (e) {
      // silencioso
    }
  };

  const alternar = () => {
    if (!abierto) cargar();
    setAbierto(previo => !previo);
  };

  return (
    <div className="relative mb-2">
      <button
        type="button"
        onClick={alternar}
        title="Notificaciones"
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg font-bold transition-colors text-sm bg-brand-cream/10 text-brand-cream border border-brand-gold/30 hover:bg-brand-rust"
      >
        <span className="relative inline-flex">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {noLeidas > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[0.6rem] font-black flex items-center justify-center">
              {noLeidas > 9 ? '9+' : noLeidas}
            </span>
          )}
        </span>
        <span className={colapsado ? 'md:hidden' : ''}>Notificaciones</span>
      </button>

      {abierto && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg border border-brand-gold/40 shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-brand-gold/20 bg-brand-cream">
            <span className="text-xs font-bold text-brand-brown uppercase tracking-wider">Notificaciones</span>
            <div className="flex items-center gap-2">
              {noLeidas > 0 && (
                <button type="button" onClick={marcarLeidas} className="text-[0.65rem] font-bold text-brand-blue hover:text-brand-rust">Marcar leidas</button>
              )}
              <button type="button" onClick={() => setAbierto(false)} className="p-1 text-brand-brown hover:bg-brand-cream rounded" title="Cerrar">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {cargando ? (
              <p className="p-4 text-xs text-brand-brown/60 text-center">Cargando...</p>
            ) : items.length === 0 ? (
              <p className="p-4 text-xs text-brand-brown/60 text-center">No tienes notificaciones.</p>
            ) : (
              items.map(av => (
                <div key={av.id} className={'px-3 py-2 border-b border-brand-gold/10 ' + (av.hora_lectura ? '' : 'bg-brand-cream/40')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-brand-brown truncate">{av.titulo}</span>
                    <span className="text-[0.6rem] text-brand-brown/50 shrink-0">{formatearHora(av.hora_envio)}</span>
                  </div>
                  <p className="text-[0.7rem] text-brand-brown/70 mt-0.5 leading-snug">{av.mensaje}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
