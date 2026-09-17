import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import PlanillaUniversal from './PlanillaUniversal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function PantallaPuntajes() {
  const [partidosEnVivo, setPartidosEnVivo] = useState([]);
  const [partidoSeleccionado, setPartidoSeleccionado] = useState(null);
  
  const [jugadoresLocal, setJugadoresLocal] = useState([]);
  const [jugadoresVisita, setJugadoresVisita] = useState([]);
  const [efectividadJugadores, setEfectividadJugadores] = useState({});
  const [manualStats, setManualStats] = useState({});
  const [puntosPorManoLocal, setPuntosPorManoLocal] = useState(Array(20).fill(''));
  const [puntosPorManoVisita, setPuntosPorManoVisita] = useState(Array(20).fill(''));

  const [cargando, setCargando] = useState(true);
  const socketRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const partidoIdUrl = params.get('partido_id');

    if (partidoIdUrl) {
      cargarPartidoEspecifico(partidoIdUrl);
    } else {
      fetch(`${API_URL}/publico/partidos-activos`) 
        .then(res => res.json())
        .then(data => {
          setPartidosEnVivo(Array.isArray(data) ? data : []);
          setCargando(false);
        }).catch(() => setCargando(false));
    }
    return () => socketRef.current?.disconnect();
  }, []);

  const cargarPartidoEspecifico = (id) => {
    setCargando(true);
    socketRef.current = io(SOCKET_URL);
    socketRef.current.emit('unirse_partido', id);
    
    socketRef.current.on('actualizar_planilla', (data) => {
      if (data.efectividad) setEfectividadJugadores(data.efectividad);
      if (data.manualStats) setManualStats(data.manualStats);
      if (data.tantosLocal) setPuntosPorManoLocal(data.tantosLocal);
      if (data.tantosVisita) setPuntosPorManoVisita(data.tantosVisita);
      if (data.estadoPartido) setPartidoSeleccionado(prev => prev ? { ...prev, estado: data.estadoPartido } : null);
    });

    fetch(`${API_URL}/publico/partidos/${id}`) 
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) {
          setPartidoSeleccionado(data);
          return fetch(`${API_URL}/publico/partidos/${id}/nomina`)
            .then(res => res.json())
            .then(nomina => {
              setJugadoresLocal(nomina.filter(j => j.equipo_id === data.equipo_local_id));
              setJugadoresVisita(nomina.filter(j => j.equipo_id === data.equipo_visita_id));
              setCargando(false);
            });
        }
        setCargando(false);
      }).catch(() => setCargando(false));
  };

  if (cargando) return <div style={{ padding: '40px', textAlign: 'center', color: '#FFF', background: '#1A202C', minHeight: '100vh' }}><h3>🔄 Sintonizando en vivo...</h3></div>;

  return (
    <div style={{ padding: '20px', background: '#1A202C', color: '#FFF', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>📺 Pantalla Oficial de Resultados en Vivo</h2>

      {!partidoSeleccionado ? (
        <div>
          <h3>Partidos Activos:</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            {partidosEnVivo.length === 0 ? <p>No hay partidos activos en este momento.</p> : partidosEnVivo.map(p => (
              <button key={p.id} onClick={() => window.location.href=`/?vista=puntajes&partido_id=${p.id}`} style={{ padding: '20px', background: '#2D3748', color: '#FFF', border: 'none', borderRadius: '6px', cursor: 'pointer', textAlign: 'left' }}>
                <strong>{p.local_nombre} vs {p.visita_nombre}</strong><br/><small style={{ color: '#CBD5E0' }}>Sede: {p.sede_nombre}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ background: '#FFF', color: '#000', borderRadius: '8px', overflow: 'hidden' }}>
          {/* Se llama al componente PlanillaUniversal pasandole el rol='espectador' para deshabilitar clicks */}
          <PlanillaUniversal 
            rol="espectador"
            estadoPartido={partidoSeleccionado.estado}
            partidoId={partidoSeleccionado.id}
            datosPartido={{
              arbitro: partidoSeleccionado.arbitro_nombre, anotador: partidoSeleccionado.anotador_nombre,
              capitanLocal: partidoSeleccionado.capitan_local_nombre, capitanVisita: partidoSeleccionado.capitan_visita_nombre,
              localNombre: partidoSeleccionado.local_nombre, visitaNombre: partidoSeleccionado.visita_nombre,
              horaInicio: partidoSeleccionado.hora_inicio, horaFinal: partidoSeleccionado.hora_final,
              fecha: partidoSeleccionado.fecha_hora ? new Date(partidoSeleccionado.fecha_hora).toLocaleDateString('es-VE') : ''
            }}
            jugadoresLocal={jugadoresLocal} jugadoresVisita={jugadoresVisita}
            efectividadJugadores={efectividadJugadores} manualStats={manualStats}
            puntosPorManoLocal={puntosPorManoLocal} puntosPorManoVisita={puntosPorManoVisita}
          />
        </div>
      )}
    </div>
  );
}