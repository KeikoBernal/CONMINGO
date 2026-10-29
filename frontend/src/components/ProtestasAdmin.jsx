import { useState, useEffect, Fragment } from 'react';

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

export default function ProtestasAdmin({ fetchConToken }) {
  const [protestas, setProtestas] = useState([]);
  const [resolviendoId, setResolviendoId] = useState(null);
  const [form, setForm] = useState({ resolucion: 'Procedente', medida: '', nota: '', marcador_local: '', marcador_visita: '' });
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const cargar = async () => {
    try {
      const r = await fetchConToken('/protestas');
      if (r.ok) setProtestas((await r.json()).protestas || []);
    } catch {
      setMensaje({ tipo: 'error', texto: 'No se pudieron cargar las protestas.' });
    }
  };

  useEffect(() => { cargar(); }, []);

  const abrirForm = (p) => {
    setResolviendoId(p.id);
    setForm({ resolucion: 'Procedente', medida: '', nota: '', marcador_local: '', marcador_visita: '' });
  };

  const resolver = async (p) => {
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await fetchConToken('/protestas/' + p.id + '/resolver', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolucion: form.resolucion,
          medida: form.medida,
          nota: form.nota,
          marcador_local: form.marcador_local,
          marcador_visita: form.marcador_visita
        })
      });
      const data = await r.json();
      if (r.ok) {
        setMensaje({ tipo: 'exito', texto: data.mensaje || 'Protesta resuelta.' });
        setResolviendoId(null);
        await cargar();
      } else {
        setMensaje({ tipo: 'error', texto: data.error || 'No se pudo resolver la protesta.' });
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'No se pudo resolver la protesta.' });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-gold/20 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-bold text-brand-brown">Protestas de la liga</h3>
      <p className="mt-1 text-sm text-brand-brown/65">Una resolución Procedente con marcador corregido exige que el árbitro y el anotador del partido confirmen antes de aplicar el nuevo resultado oficial.</p>
      {mensaje && (
        <div className={'mt-3 rounded-lg p-3 text-sm font-semibold ' + (mensaje.tipo === 'exito' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200')}>
          {mensaje.texto}
        </div>
      )}
      {protestas.length === 0 ? (
        <p className="mt-3 text-sm text-brand-brown/60">No hay protestas presentadas.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-brand-brown/70">
                <th className="px-3 py-2 border-b border-brand-gold/20">Partido</th>
                <th className="px-3 py-2 border-b border-brand-gold/20">Presentada por</th>
                <th className="px-3 py-2 border-b border-brand-gold/20">Motivo</th>
                <th className="px-3 py-2 border-b border-brand-gold/20">Estado</th>
                <th className="px-3 py-2 border-b border-brand-gold/20">Marcador oficial</th>
                <th className="px-3 py-2 border-b border-brand-gold/20">Resolución</th>
                <th className="px-3 py-2 border-b border-brand-gold/20">Acción</th>
              </tr>
            </thead>
            <tbody>
              {protestas.map((p) => (
                <Fragment key={p.id}>
                  <tr className="align-top">
                    <td className="px-3 py-2 border-b border-brand-gold/10">
                      <p className="font-semibold text-brand-brown">{p.equipo_local} vs {p.equipo_visita}</p>
                      <p className="text-xs text-brand-brown/60">Protesta de: {p.equipo_protestante}</p>
                      <p className="text-xs text-brand-brown/60">{formatearFecha(p.creado_en)}</p>
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10">{p.presentada_por_nombre || '—'}</td>
                    <td className="px-3 py-2 border-b border-brand-gold/10 max-w-xs">
                      <p className="font-semibold text-brand-brown">{p.motivo}</p>
                      <p className="text-xs text-brand-brown/60">{p.descripcion}</p>
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10">
                      <span className={'inline-block rounded-full px-3 py-1 text-xs font-bold ' + (ESTADOS_PROTESTA[p.estado] || 'bg-gray-100 text-gray-600 border border-gray-200')}>{p.estado}</span>
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10 font-bold text-brand-brown">
                      {(p.marcador_local !== null && p.marcador_local !== undefined) ? p.marcador_local + ' - ' + p.marcador_visita : 'Sin registrar'}
                      {(p.medida_marcador_local !== null && p.medida_marcador_local !== undefined) && (
                        <p className="text-xs font-semibold text-blue-700">Propuesto: {p.medida_marcador_local + ' - ' + p.medida_marcador_visita}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10 max-w-xs text-xs text-brand-brown/70">
                      {p.resolucion ? (
                        <div className="space-y-1">
                          <p><span className="font-bold text-brand-brown">{p.resolucion}.</span> {p.medida}</p>
                          {p.nota_resolucion && <p>Nota: {p.nota_resolucion}</p>}
                          <p>Árbitro: {p.confirmacion_arbitro ? 'confirmó' : 'pendiente'} | Anotador: {p.confirmacion_anotador ? 'confirmó' : 'pendiente'}</p>
                        </div>
                      ) : 'En revisión'}
                    </td>
                    <td className="px-3 py-2 border-b border-brand-gold/10">
                      {p.estado === 'Pendiente' && (
                        <button onClick={() => abrirForm(p)} className="bg-brand-rust hover:bg-brand-brown text-white rounded-lg font-bold px-4 py-2 text-sm">
                          Resolver
                        </button>
                      )}
                    </td>
                  </tr>
                  {resolviendoId === p.id && (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 border-b border-brand-gold/10 bg-brand-gold/5">
                        <div className="rounded-lg border border-brand-gold/30 bg-white p-4 space-y-3">
                          <p className="text-sm font-bold text-brand-brown">Resolver protesta del partido {p.equipo_local} vs {p.equipo_visita}</p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="block text-xs font-semibold text-brand-brown mb-1">Resolución</label>
                              <select
                                value={form.resolucion}
                                onChange={(e) => setForm({ ...form, resolucion: e.target.value })}
                                className="w-full rounded-lg border border-brand-brown/30 px-3 py-2 text-sm bg-white"
                              >
                                <option value="Procedente">Procedente</option>
                                <option value="Improcedente">Improcedente</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-brand-brown mb-1">Nota (opcional)</label>
                              <input
                                type="text"
                                value={form.nota}
                                maxLength={500}
                                onChange={(e) => setForm({ ...form, nota: e.target.value })}
                                className="w-full rounded-lg border border-brand-brown/30 px-3 py-2 text-sm"
                              />
                            </div>
                          </div>
                          {form.resolucion === 'Procedente' && (
                            <div className="space-y-3">
                              <div>
                                <label className="block text-xs font-semibold text-brand-brown mb-1">Medida aplicada (obligatoria)</label>
                                <textarea
                                  value={form.medida}
                                  maxLength={2000}
                                  rows={2}
                                  onChange={(e) => setForm({ ...form, medida: e.target.value })}
                                  placeholder="Descripción de la medida decretada..."
                                  className="w-full rounded-lg border border-brand-brown/30 px-3 py-2 text-sm"
                                />
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <label className="block text-xs font-semibold text-brand-brown mb-1">Marcador corregido local (opcional)</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={form.marcador_local}
                                    onChange={(e) => setForm({ ...form, marcador_local: e.target.value })}
                                    className="w-full rounded-lg border border-brand-brown/30 px-3 py-2 text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-brand-brown mb-1">Marcador corregido visita (opcional)</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={form.marcador_visita}
                                    onChange={(e) => setForm({ ...form, marcador_visita: e.target.value })}
                                    className="w-full rounded-lg border border-brand-brown/30 px-3 py-2 text-sm"
                                  />
                                </div>
                              </div>
                              <p className="text-xs text-brand-brown/60">Si indicas marcador corregido, el nuevo resultado oficial se aplicará cuando el árbitro y el anotador del partido confirmen.</p>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => resolver(p)}
                              disabled={enviando}
                              className="bg-brand-rust hover:bg-brand-brown text-white rounded-lg font-bold px-4 py-2 text-sm disabled:opacity-50"
                            >
                              {enviando ? 'Guardando...' : 'Confirmar resolución'}
                            </button>
                            <button
                              onClick={() => setResolviendoId(null)}
                              className="border border-brand-brown/30 text-brand-brown rounded-lg font-bold px-4 py-2 text-sm hover:bg-brand-brown/10"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
