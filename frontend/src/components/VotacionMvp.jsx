import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// LOTE 4C (N3): votacion del Jugador Mas Util (MVP) del torneo. Componente
// compartido por los paneles de delegado, arbitro y anotador: votan todos
// los usuarios de la liga, un voto por persona y torneo. El AdminLiga abre
// y cierra la votacion desde su panel.
export default function VotacionMvp() {
  const [torneos, setTorneos] = useState([]);
  const [torneoId, setTorneoId] = useState('');
  const [estado, setEstado] = useState(null);
  const [candidatoId, setCandidatoId] = useState('');
  const [cargando, setCargando] = useState(false);
  const [votando, setVotando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const fetchOperativo = async (endpoint, options = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API_URL}/operativo${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...(options.headers || {}) }
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  };

  useEffect(() => {
    (async () => {
      const { ok, data } = await fetchOperativo('/torneos-votacion');
      if (ok) setTorneos(data);
    })();
  }, []);

  const cargarVotacion = async (id) => {
    setMensaje('');
    setEstado(null);
    setCandidatoId('');
    if (!id) return;
    setCargando(true);
    const { ok, data } = await fetchOperativo('/votacion-mvp?torneo_id=' + encodeURIComponent(id));
    setCargando(false);
    if (ok) setEstado(data);
    else setMensaje(data.error || 'No se pudo consultar la votación.');
  };

  const emitirVoto = async () => {
    if (!torneoId || !candidatoId) return;
    setVotando(true);
    const { ok, data } = await fetchOperativo('/votacion-mvp', { method: 'POST', body: JSON.stringify({ torneo_id: torneoId, jugador_id: candidatoId }) });
    setVotando(false);
    if (ok) {
      setMensaje('Voto registrado. ¡Gracias por participar!');
      cargarVotacion(torneoId);
    } else {
      setMensaje(data.error || 'No se pudo registrar el voto.');
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-brand-gold/20 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <label className="text-sm font-bold text-brand-brown whitespace-nowrap">Torneo:</label>
        <select
          value={torneoId}
          onChange={e => { setTorneoId(e.target.value); cargarVotacion(e.target.value); }}
          className="flex-1 p-2 border border-brand-gold/30 rounded-lg text-brand-brown"
        >
          <option value="">-- Selecciona el torneo --</option>
          {torneos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </div>

      {cargando && <p className="text-sm text-brand-brown/60">Consultando la votación...</p>}
      {mensaje && <p className="text-sm font-semibold text-brand-rust">{mensaje}</p>}

      {estado && estado.abierta && !estado.mi_voto && (
        <div className="space-y-3">
          <p className="text-sm text-brand-brown/70">La votación está abierta. Elige al jugador más útil del torneo: tu voto es secreto y único.</p>
          <select
            value={candidatoId}
            onChange={e => setCandidatoId(e.target.value)}
            className="w-full p-2 border border-brand-gold/30 rounded-lg text-brand-brown"
          >
            <option value="">-- Selecciona al candidato --</option>
            {estado.candidatos.map(j => <option key={j.id} value={j.id}>#{j.numero_dorsal} {j.nombre} {j.apellido} — {j.equipo_nombre}</option>)}
          </select>
          <button
            onClick={emitirVoto}
            disabled={votando || !candidatoId}
            className="bg-brand-rust text-white px-6 py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md disabled:opacity-50"
          >
            {votando ? 'Registrando...' : 'Emitir mi voto'}
          </button>
        </div>
      )}

      {estado && estado.abierta && estado.mi_voto && (
        <p className="text-sm font-semibold text-green-700">
          Ya emitiste tu voto por {estado.mi_voto.nombre} {estado.mi_voto.apellido}. Total de votos del torneo: {estado.total_votos}.
        </p>
      )}

      {estado && !estado.abierta && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-brand-brown">Votación cerrada — {estado.total_votos} voto(s) en total.</p>
          {(!estado.resultados || estado.resultados.length === 0) ? (
            <p className="text-sm text-brand-brown/60">Esta votación no recibió votos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-brand-gold/20 rounded-lg overflow-hidden min-w-[640px]">
                <thead>
                  <tr className="bg-brand-brown text-brand-cream text-left">
                    <th className="px-4 py-2">#</th>
                    <th className="px-4 py-2">Jugador</th>
                    <th className="px-4 py-2">Equipo</th>
                    <th className="px-4 py-2 text-right">Votos</th>
                  </tr>
                </thead>
                <tbody>
                  {estado.resultados.map((r, i) => (
                    <tr key={r.jugador_id} className={i === 0 ? 'bg-brand-gold/10 font-bold' : 'border-t border-brand-gold/10'}>
                      <td className="px-4 py-2">{i + 1}</td>
                      <td className="px-4 py-2">{r.jugador_nombre}</td>
                      <td className="px-4 py-2">{r.equipo_nombre}</td>
                      <td className="px-4 py-2 text-right">{r.votos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
