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
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket'],
      upgrade: false
    });
    socketRef.current.emit('unirse_partido', id);
    
    socketRef.current.on('actualizar_planilla', (data) => {
      // 1. Validar que la data que entra por el socket pertenece exactamente al ID en pantalla
      if (data.partido_id && String(data.partido_id) !== String(id)) return;
      
      // 2. Sanitización estricta de tipos de datos antes de inyectar en el estado de React
      if (data.efectividad && typeof data.efectividad === 'object') setEfectividadJugadores(data.efectividad);
      if (data.manualStats && typeof data.manualStats === 'object') setManualStats(data.manualStats);
      if (Array.isArray(data.tantosLocal)) setPuntosPorManoLocal(data.tantosLocal);
      if (Array.isArray(data.tantosVisita)) setPuntosPorManoVisita(data.tantosVisita);
      if (data.estadoPartido && typeof data.estadoPartido === 'string') setPartidoSeleccionado(prev => prev ? { ...prev, estado: data.estadoPartido } : null);
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
        } else {
          // INSERCIÓN: Manejo explícito de error en carga si el partido no existe o hay error de DB
          alert('El partido solicitado no existe o no se encuentra disponible.');
          window.location.href = '/?vista=puntajes';
        }
      }).catch(() => {
        // INSERCIÓN: Redirección de seguridad en caso de caída del servidor
        alert('Error de conexión al intentar cargar la información del encuentro.');
        window.location.href = '/?vista=puntajes';
      });
  };

  if (cargando) {
    return (
      <div className="flex h-screen items-center justify-center bg-brand-brown text-brand-gold font-sans">
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <svg className="w-12 h-12 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          <h3 className="text-xl font-bold tracking-widest uppercase">Sintonizando en vivo...</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-brown text-brand-cream font-sans p-4 md:p-8">
      {!partidoSeleccionado ? (
        <div className="max-w-6xl mx-auto animate-fade-in">
          <div className="flex items-center justify-center gap-3 mb-10 border-b border-brand-gold/20 pb-6">
            <svg className="w-8 h-8 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            <h2 className="text-2xl md:text-4xl font-black text-brand-gold uppercase tracking-wider text-center">
              Transmisión de Resultados en Vivo
            </h2>
          </div>

          <h3 className="text-lg font-bold text-brand-cream/70 uppercase tracking-widest mb-6">Partidos Activos</h3>
          
          {partidosEnVivo.length === 0 ? (
            <div className="bg-brand-cream/5 border border-brand-gold/20 rounded-xl p-12 text-center text-brand-cream/50">
              <p className="text-lg">No hay partidos activos en este momento.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {partidosEnVivo.map(p => (
                <button 
                  key={p.id} 
                  onClick={() => window.location.href=`/?vista=puntajes&partido_id=${p.id}`} 
                  className="bg-brand-cream text-brand-brown p-6 rounded-xl border-2 border-brand-gold/30 hover:border-brand-gold hover:shadow-[0_0_20px_rgba(212,175,55,0.3)] transition-all text-left group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 bg-brand-rust text-white text-[0.65rem] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                    En Vivo
                  </div>
                  <div className="text-xl font-black mb-3 leading-tight pr-8">
                    {p.local_nombre} <span className="text-brand-rust mx-1 text-base">vs</span> {p.visita_nombre}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-brand-brown/70 font-medium border-t border-brand-gold/20 pt-3">
                    <svg className="w-4 h-4 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    Sede: {p.sede_nombre}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-350 mx-auto animate-fade-in">
          <div className="mb-4">
            <button onClick={() => window.location.href='/?vista=puntajes'} className="text-brand-gold hover:text-white font-bold flex items-center gap-2 transition-colors text-sm uppercase tracking-wider">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              Volver a la cartelera
            </button>
          </div>
          <div className="bg-brand-cream text-brand-brown rounded-2xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] border border-brand-gold/20">
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
        </div>
      )}
    </div>
  );
}