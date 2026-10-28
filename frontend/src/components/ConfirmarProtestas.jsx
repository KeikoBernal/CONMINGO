import { useState, useEffect } from 'react';

const formatearFecha = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function ConfirmarProtestas({ fetchConToken }) {
  const [protestas, setProtestas] = useState([]);
  const [confirmandoId, setConfirmandoId] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  const cargar = async () => {
    try {
      const r = await fetchConToken('/protestas-confirmacion');
      if (r.ok) setProtestas((await r.json()).protestas || []);
    } catch {
      setMensaje({ tipo: 'error', texto: 'No se pudieron cargar las protestas por confirmar.' });
    }
  };

  useEffect(() => { cargar(); }, []);

  const confirmar = async (p) => {
    setConfirmandoId(p.id);
    setMensaje(null);
    try {
      const r = await fetchConToken('/protestas/' + p.id + '/confirmar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await r.json();
      if (r.ok) {
        setMensaje({ tipo: 'exito', texto: data.mensaje || 'Confirmación registrada.' });
        await cargar();
      } else {
        setMensaje({ tipo: 'error', texto: data.error || 'No se pudo confirmar la protesta.' });
      }
    } catch {
      setMensaje({ tipo: 'error', texto: 'No se pudo confirmar la protesta.' });
    } finally {
      setConfirmandoId(null);
    }
  };

  return (
    <div className="space-y-4">
      {mensaje && (
        <div className={'rounded-lg p-3 text-sm font-semibold ' + (mensaje.tipo === 'exito' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200')}>
          {mensaje.texto}
        </div>
      )}
      {protestas.length === 0 ? (
        <p className="text-sm text-brand-brown/60">No hay protestas esperando tu confirmación.</p>
      ) : protestas.map((p) => (
        <div key={p.id} className="rounded-xl border border-brand-gold/20 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <p className="font-bold text-brand-brown">{p.equipo_local} vs {p.equipo_visita}</p>
            <p className="text-xs text-brand-brown/60">Protesta presentada: {formatearFecha(p.creado_en)}</p>
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            <p><span className="font-semibold text-brand-brown">Motivo:</span> {p.motivo}</p>
            <p><span className="font-semibold text-brand-brown">Descripción:</span> {p.descripcion}</p>
            <p><span className="font-semibold text-brand-brown">Medida decretada:</span> {p.medida}</p>
            {p.nota_resolucion && <p><span className="font-semibold text-brand-brown">Nota del Admin:</span> {p.nota_resolucion}</p>}
            <p>
              <span className="font-semibold text-brand-brown">Marcador actual:</span>{' '}
              {(p.marcador_local !== null && p.marcador_local !== undefined) ? p.marcador_local + ' - ' + p.marcador_visita : 'Sin registrar'}
              {(p.medida_marcador_local !== null && p.medida_marcador_local !== undefined) && (
                <span> | <span className="font-semibold text-brand-brown">Propuesto:</span> {p.medida_marcador_local + ' - ' + p.medida_marcador_visita}</span>
              )}
            </p>
            <p className="text-xs text-brand-brown/70">
              Confirmación del árbitro: {p.confirmacion_arbitro ? 'registrada' : 'pendiente'} | Confirmación del anotador: {p.confirmacion_anotador ? 'registrada' : 'pendiente'}
            </p>
          </div>
          <button
            onClick={() => confirmar(p)}
            disabled={confirmandoId === p.id}
            className="mt-4 bg-brand-rust hover:bg-brand-brown text-white rounded-lg font-bold px-4 py-2 disabled:opacity-50"
          >
            {confirmandoId === p.id ? 'Confirmando...' : 'Confirmar'}
          </button>
        </div>
      ))}
    </div>
  );
}
