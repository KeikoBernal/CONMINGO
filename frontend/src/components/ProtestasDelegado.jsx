import { useState, useEffect } from 'react';

const ESTADOS_PROTESTA = {
  'Pendiente': 'bg-amber-100 text-amber-800 border border-amber-200',
  'Pendiente Confirmacion': 'bg-blue-100 text-blue-800 border border-blue-200',
  'Resuelta': 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  'Retirada': 'bg-gray-100 text-gray-600 border border-gray-200'
};

const formatearFecha = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function ProtestasDelegado({ fetchConToken }) {
  const [partidos, setPartidos] = useState([]);
  const [protestas, setProtestas] = useState([]);
  const [form, setForm] = useState({ partido_id: '', motivo: '', descripcion: '' });
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const cargar = async () => {
    try {
      const [rP, rR] = await Promise.all([
        fetchConToken('/partidos-protestables'),
        fetchConToken('/protestas')
      ]);
      if (rP.ok) setPartidos((await rP.json()).partidos || []);
      if (rR.ok) setProtestas((await rR.json()).protestas || []);
    } catch {
      setMensaje({ tipo: 'error', texto: 'No se pudo cargar la información de protestas.' });
    }
  };

  useEffect(() => { cargar(); }, []);

  const presentar = async (e) => {
    e.preventDefault();
    if (!form.partido_id) {
      setMensaje({ tipo: 'error', texto: 'Selecciona el partido de la protesta.' });
      return;
    }
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await fetchConToken('/protestas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await r.json();
      if (r.ok) {
        setMensaje({ tipo: 'exito', texto: data.mensaje || 'Protesta presentada.' });
        setForm({ partido_id: '', motivo: '', descripcion: '' });
        await cargar();
      } else {
        setMensaje({ tipo: 'error', texto: data.error || 'No se pudo presentar la protesta.' });
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'No se pudo presentar la protesta.' });
    } finally {
      setEnviando(false);
    }
  };

  const etiquetaPartido = (p) => p.equipo_local + ' vs ' + p.equipo_visita + ' (' + formatearFecha(p.fecha_hora) + ')';

  return (
    <div className="space-y-6">
      {mensaje && (
        <div className={'rounded-lg p-3 text-sm font-semibold ' + (mensaje.tipo === 'exito' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200')}>
          {mensaje.texto}
        </div>
      )}

      <div className="rounded-xl border border-brand-gold/20 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-brand-brown">Presentar una protesta</h3>
        <p className="mt-1 text-sm text-brand-brown/65">Solo partidos Finalizados de tus equipos. El Administrador de la Liga revisará la protesta y, si es Procedente, el árbitro y el anotador del partido deberán confirmar la medida antes de aplicarse.</p>
        <form onSubmit={presentar} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-brand-brown mb-1">Partido</label>
            <select
              value={form.partido_id}
              onChange={(e) => setForm({ ...form, partido_id: e.target.value })}
              className="w-full rounded-lg border border-brand-brown/30 px-3 py-2 text-sm bg-white"
            >
              <option value="">Selecciona el partido...</option>
              {partidos.map((p) => (
                <option key={p.id} value={p.id} disabled={p.tiene_protesta}>
                  {etiquetaPartido(p)}{p.tiene_protesta ? ' (ya tiene protesta)' : ((p.marcador_local !== null && p.marcador_local !== undefined) ? ' - Marcador ' + p.marcador_local + ' a ' + p.marcador_visita : '')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-brand-brown mb-1">Motivo</label>
            <input
              type="text"
              value={form.motivo}
              maxLength={200}
              onChange={(e) => setForm({ ...form, motivo: e.target.value })}
              placeholder="Resumen del motivo (ej. alineación indebida)"
              className="w-full rounded-lg border border-brand-brown/30 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-brand-brown mb-1">Descripción</label>
            <textarea
              value={form.descripcion}
              maxLength={2000}
              rows={4}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              placeholder="Detalle de lo ocurrido: manos, jugadas, situación del partido..."
              className="w-full rounded-lg border border-brand-brown/30 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={enviando}
            className="bg-brand-rust hover:bg-brand-brown text-white rounded-lg font-bold px-4 py-2 disabled:opacity-50"
          >
            {enviando ? 'Presentando...' : 'Presentar protesta'}
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-brand-gold/20 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-brand-brown">Mis protestas</h3>
        {protestas.length === 0 ? (
          <p className="mt-3 text-sm text-brand-brown/60">No has presentado protestas.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-brand-brown/70">
                  <th className="px-3 py-2 border-b border-brand-gold/20">Partido</th>
                  <th className="px-3 py-2 border-b border-brand-gold/20">Motivo</th>
                  <th className="px-3 py-2 border-b border-brand-gold/20">Estado</th>
                  <th className="px-3 py-2 border-b border-brand-gold/20">Marcador oficial</th>
                  <th className="px-3 py-2 border-b border-brand-gold/20">Propuesto</th>
                  <th className="px-3 py-2 border-b border-brand-gold/20">Resolución</th>
                </tr>
              </thead>
              <tbody>
                {protestas.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className="px-3 py-2 border-b border-brand-gold/10">
                      <p className="font-semibold text-brand-brown">{p.equipo_local} vs {p.equipo_visita}</p>
                      <p className="text-xs text-brand-brown/60">Presentada: {formatearFecha(p.creado_en)}</p>
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10 max-w-xs">
                      <p className="font-semibold text-brand-brown">{p.motivo}</p>
                      <p className="text-xs text-brand-brown/60">{p.descripcion}</p>
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10">
                      <span className={'inline-block rounded-full px-3 py-1 text-xs font-bold ' + (ESTADOS_PROTESTA[p.estado] || 'bg-gray-100 text-gray-600 border border-gray-200')}>{p.estado}</span>
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10 font-bold text-brand-brown">
                      {(p.marcador_local !== null && p.marcador_local !== undefined) ? p.marcador_local + ' - ' + p.marcador_visita : 'Sin registrar'}
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10 font-semibold">
                      {(p.medida_marcador_local !== null && p.medida_marcador_local !== undefined) ? p.medida_marcador_local + ' - ' + p.medida_marcador_visita : '—'}
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10 max-w-xs text-xs text-brand-brown/70">
                      {p.resolucion ? (
                        <div className="space-y-1">
                          <p><span className="font-bold text-brand-brown">{p.resolucion}.</span> {p.medida}</p>
                          {p.nota_resolucion && <p>Nota: {p.nota_resolucion}</p>}
                        </div>
                      ) : 'En revisión'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
