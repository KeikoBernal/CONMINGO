import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { io } from 'socket.io-client';
import PlanillaUniversal from './PlanillaUniversal';
import SistemaMensajeria from './SistemaMensajeria';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function ArbitroDashboard({ usuario, cerrarSesion }) {
  // PESTAÑAS DEL PANEL LATERAL: 'hoy' | 'proximos' | 'historial'
  const [pestana, setPestana] = useState(localStorage.getItem('arbitroPestana') || 'hoy');
  const [menuAbierto, setMenuAbierto] = useState(false);

  const [partidos, setPartidos] = useState([]);
  const [partidoActivo, setPartidoActivo] = useState(null);
  const [jugadoresLocal, setJugadoresLocal] = useState([]);
  const [jugadoresVisita, setJugadoresVisita] = useState([]);

  const [efectividadJugadores, setEfectividadJugadores] = useState({});
  const [puntosPorManoLocal, setPuntosPorManoLocal] = useState(Array(20).fill(''));
  const [puntosPorManoVisita, setPuntosPorManoVisita] = useState(Array(20).fill(''));
  
  const [anotadorConectado, setAnotadorConectado] = useState(false);
  
  // ESTADOS DEL CRONÓMETRO SINCRONIZADO
  const [tiempoGlobal, setTiempoGlobal] = useState(0);
  const [tiempoTurno, setTiempoTurno] = useState(0);
  const [cronometroGlobalActivo, setCronometroGlobalActivo] = useState(false);
  const [cronometroTurnoActivo, setCronometroTurnoActivo] = useState(false);
  
  const [jugadorSancionId, setJugadorSancionId] = useState('');
  const [modalSorteo, setModalSorteo] = useState(null);
  const [sorteoTexto, setSorteoTexto] = useState('');

  const [token, setToken] = useState(null);
  const [ligas, setLigas] = useState([]);
  const [ligaFiltro, setLigaFiltro] = useState('');

  const socketRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('arbitroPestana', pestana);
  }, [pestana]);

  const fetchConToken = async (endpoint, options = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    return await fetch(`${API_URL}/operativo${endpoint}`, {
      ...options, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    });
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token);
    });
  }, []);

  const cargarDatosOficial = async () => {
    const res = await fetchConToken('/mis-partidos');
    if (res.ok) {
      const partidosData = await res.json();
      setPartidos(partidosData);

      const savedPartidoId = localStorage.getItem('partidoActivoId');
      if (savedPartidoId) {
        const partidoToRestore = partidosData.find(p => p.id === parseInt(savedPartidoId) && p.estado !== 'Finalizado' && p.estado !== 'Suspendido');
        if (partidoToRestore) {
          seleccionarPartido(partidoToRestore);
        } else {
          localStorage.removeItem('partidoActivoId');
        }
      }
    }

    const resLigas = await fetchConToken('/mis-ligas');
    if (resLigas.ok) {
      const dataLigas = await resLigas.json();
      setLigas(dataLigas);
      if (dataLigas.length > 0 && !ligaFiltro) setLigaFiltro(dataLigas[0].id);
    }
  };

  useEffect(() => { 
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket'],
      upgrade: false
    });
    
    cargarDatosOficial(); 
    
    return () => {
      if (socketRef.current) socketRef.current.disconnect(); 
    };
  }, []);

  useEffect(() => {
    let intGlobal, intTurno;
    if (cronometroGlobalActivo) intGlobal = setInterval(() => setTiempoGlobal(t => t + 1), 1000);
    if (cronometroTurnoActivo) intTurno = setInterval(() => setTiempoTurno(t => t + 1), 1000);
    return () => { clearInterval(intGlobal); clearInterval(intTurno); };
  }, [cronometroGlobalActivo, cronometroTurnoActivo]);

  const formatoT = (t) => `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toString().padStart(2, '0')}`;

  const seleccionarPartido = async (partido) => {
    setPartidoActivo(partido);
    localStorage.setItem('partidoActivoId', partido.id);
    socketRef.current.emit('unirse_partido', partido.id);
    socketRef.current.emit('presencia_oficial', { partidoId: partido.id, rol: 'arbitro', estado: true });
    
    socketRef.current.on('presencia_actualizada', (data) => {
      if (data.rol === 'anotador') setAnotadorConectado(data.estado);
    });

    socketRef.current.on('actualizar_planilla', (data) => {
      if (data.efectividad) setEfectividadJugadores(data.efectividad);
      if (data.tantosLocal) setPuntosPorManoLocal(data.tantosLocal);
      if (data.tantosVisita) setPuntosPorManoVisita(data.tantosVisita);
      if (data.estadoPartido) setPartidoActivo(prev => prev ? ({ ...prev, estado: data.estadoPartido }) : null);
    });

    socketRef.current.on('sincronizacion_cronometro', (data) => {
      setTiempoTurno(data.tiempoTurno);
      setCronometroTurnoActivo(data.cronometroTurnoActivo);
      setTiempoGlobal(data.tiempoGlobal);
      setCronometroGlobalActivo(data.cronometroGlobalActivo);
    });

    const res = await fetchConToken(`/partidos/${partido.id}/nomina`);
    if (res.ok) {
      const todos = await res.json();
      setJugadoresLocal(todos.filter(j => j.equipo_id === partido.equipo_local_id));
      setJugadoresVisita(todos.filter(j => j.equipo_id === partido.equipo_visita_id));
    }
  };

  const guardarSorteo = async () => {
    const res = await fetchConToken(`/partidos/${modalSorteo}/sorteo`, { method: 'PUT', body: JSON.stringify({ sorteo: sorteoTexto }) });
    if (res.ok) { alert('Sorteo guardado exitosamente.'); setModalSorteo(null); }
  };

  const suspenderPartido = async () => {
    if(!partidoActivo) return;
    const confirmacion = window.confirm("🛑 ¿Estás seguro de suspender este partido? Se guardarán los resultados actuales y desaparecerá de tu panel y del anotador hasta ser reagendado.");
    if (!confirmacion) return;

    const res = await fetchConToken(`/partidos/${partidoActivo.id}/suspender`, { method: 'PUT' });
    if (res.ok) {
      socketRef.current.emit('partido_suspendido', { partidoId: partidoActivo.id });
      socketRef.current.emit('enviar_notificacion_admin', { mensaje: `🚨 El árbitro ha suspendido el encuentro: ${partidoActivo.local_nombre} vs ${partidoActivo.visita_nombre} (Partido #${partidoActivo.id}). Requiere ser reagendado en el panel.`, tipo: 'alerta_suspension' });

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await fetch(`${API_URL}/mensajeria/enviar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({
            destinatario_rol: 'Administrador de Liga',
            mensaje: `🚨 URGENTE: El partido #${partidoActivo.id} (${partidoActivo.local_nombre} vs ${partidoActivo.visita_nombre}) fue SUSPENDIDO. Por favor reagendar en tu panel.`
          })
        });
      }

      alert('Partido suspendido con éxito. Los resultados han quedado guardados y el administrador ha sido notificado.');
      localStorage.removeItem('partidoActivoId');
      setPartidoActivo(null); 
      cargarDatosOficial(); 
    } else { alert('Error de conexión al intentar suspender el partido.'); }
  };

  const emitirTarjeta = (color) => {
    if (!jugadorSancionId) return alert('Selecciona un jugador.');
    const j = [...jugadoresLocal, ...jugadoresVisita].find(x => x.id === parseInt(jugadorSancionId));
    if (!window.confirm(`¿Amonestar con tarjeta ${color.toUpperCase()} a ${j.nombre} ${j.apellido}?`)) return;
    socketRef.current?.emit('tarjeta_emitida', { partido_id: partidoActivo.id, jugador_id: j.id, color });
    setJugadorSancionId(''); alert(`Tarjeta ${color} registrada en acta.`);
  };

  const solicitarRevision = (jugadorId, manoIndex, jugadaObj) => {
    if (!jugadaObj || jugadaObj.estado === 'rechazado') return;
    const msg = window.prompt("Indique el motivo de la revisión para el anotador:", "Corregir valor ingresado");
    if (msg) {
      socketRef.current?.emit('solicitar_revision_jugada', { partido_id: partidoActivo.id, jugador_id: jugadorId, mano_index: manoIndex, mensaje: msg });
    }
  };

  const partidosFiltrados = partidos.filter(p => !ligaFiltro || p.organizacion_id === ligaFiltro);
  const hoyFecha = new Date().toLocaleDateString('es-VE');
  
  const partidosHoy = partidosFiltrados.filter(p => new Date(p.fecha_hora).toLocaleDateString('es-VE') === hoyFecha && p.estado !== 'Finalizado' && p.estado !== 'Suspendido');
  const partidosAgendados = partidosFiltrados.filter(p => new Date(p.fecha_hora).toLocaleDateString('es-VE') !== hoyFecha && p.estado !== 'Finalizado');
  const partidosFinalizados = partidosFiltrados.filter(p => p.estado === 'Finalizado' || p.estado === 'Suspendido');

  // Íconos para la barra lateral del árbitro
  const NavIcon = ({ id }) => {
    switch (id) {
      case 'hoy':
        return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
      case 'proximos':
        return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
      case 'historial':
        return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen w-full bg-brand-cream font-sans overflow-hidden">
      <SistemaMensajeria usuario={usuario} token={token} ligaActivaId={ligaFiltro} />
      
      {/* MODAL SORTEO */}
      {modalSorteo && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-1500 p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl animate-slide-up border border-brand-gold/30">
            <h3 className="text-xl font-bold text-brand-brown mb-4 flex items-center gap-2">
              <svg className="w-6 h-6 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Sorteo Oficial
            </h3>
            <textarea 
              placeholder="Ej: Equipo Reputation gana mingo y decide salir..." 
              value={sorteoTexto} 
              onChange={e => setSorteoTexto(e.target.value)} 
              className="w-full h-28 p-3 border border-brand-gold/40 rounded-lg focus:ring-2 focus:ring-brand-rust focus:border-brand-rust outline-none resize-none mb-5 text-sm font-medium text-brand-brown bg-brand-cream/10" 
            />
            <div className="flex gap-3">
              <button onClick={guardarSorteo} className="flex-1 bg-brand-blue text-white py-2.5 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-sm">Guardar Acta</button>
              <button onClick={() => setModalSorteo(null)} className="flex-1 bg-gray-200 text-brand-brown py-2.5 rounded-lg font-bold hover:bg-gray-300 transition-colors">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* SIDEBAR LATERAL DEL ÁRBITRO */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-brand-brown text-brand-cream shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${menuAbierto ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static md:shrink-0`}>
        <div className="p-6 border-b border-brand-gold/20 shrink-0 bg-brand-brown/50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-brand-cream/10 border border-brand-gold/50 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>
            </div>
            <div className="overflow-hidden">
              <h1 className="text-base font-bold text-brand-cream truncate">Árbitro Oficial</h1>
              <p className="text-xs text-brand-gold font-semibold uppercase tracking-wider mt-0.5">Control de Cancha</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 hide-scrollbar flex flex-col gap-6">
          <div>
            <div className="px-6 mb-2 text-xs font-bold text-brand-blue uppercase tracking-wider">Navegación</div>
            <nav className="space-y-1">
              {[
                { id: 'hoy', label: 'Partidos de Hoy', badge: partidosHoy.length },
                { id: 'proximos', label: 'Próximos Partidos', badge: partidosAgendados.length },
                { id: 'historial', label: 'Historial Reciente', badge: partidosFinalizados.length }
              ].map(item => {
                const isActive = pestana === item.id;
                return (
                  <button 
                    key={item.id} 
                    onClick={() => { setPestana(item.id); setMenuAbierto(false); }} 
                    className={`w-full px-6 py-3 text-sm font-medium transition-colors flex items-center justify-between ${isActive ? 'bg-brand-rust/20 text-brand-gold border-r-4 border-brand-gold' : 'text-brand-cream/70 hover:bg-brand-cream/5 hover:text-brand-cream'}`}
                  >
                    <div className="flex items-center gap-3">
                      <NavIcon id={item.id} />
                      <span>{item.label}</span>
                    </div>
                    {item.badge > 0 && (
                      <span className="bg-brand-gold/20 text-brand-gold text-xs font-bold px-2 py-0.5 rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-brand-gold/20 shrink-0">
          <button onClick={cerrarSesion} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-cream/10 hover:bg-brand-rust text-brand-cream rounded transition-colors text-sm font-semibold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {menuAbierto && (
        <div className="fixed inset-0 bg-brand-brown/50 z-30 md:hidden" onClick={() => setMenuAbierto(false)}></div>
      )}

      {/* CONTENEDOR PRINCIPAL */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-brand-cream relative overflow-y-auto">
        
        {/* HEADER SUPERIOR */}
        <header className="h-16 sm:h-20 bg-white border-b border-brand-gold/20 flex items-center justify-between px-6 shadow-sm shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setMenuAbierto(true)} className="md:hidden p-2 text-brand-brown hover:bg-brand-cream rounded-md">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <h2 className="text-xl sm:text-2xl font-bold text-brand-brown capitalize">
              {partidoActivo ? `Partido en Curso: ${partidoActivo.local_nombre} vs ${partidoActivo.visita_nombre}` : (pestana === 'hoy' ? 'Partidos de Hoy' : pestana === 'proximos' ? 'Próximos Partidos' : 'Historial Reciente')}
            </h2>
          </div>
          
          <div className="flex items-center gap-3">
            {ligas.length > 0 && (
              <select 
                value={ligaFiltro} 
                onChange={(e) => setLigaFiltro(e.target.value)}
                className="p-2 bg-brand-cream/30 border border-brand-gold/40 rounded-lg text-sm font-bold text-brand-brown focus:ring-2 focus:ring-brand-rust outline-none shadow-sm cursor-pointer"
              >
                {ligas.map(l => <option key={l.id} value={l.id}>Liga: {l.nombre}</option>)}
              </select>
            )}
          </div>
        </header>

        {/* CONTENIDO DE LAS PESTAÑAS O PARTIDO ACTIVO */}
        <div className="p-4 md:p-6 flex-1">
          {!partidoActivo ? (
            <div className="max-w-5xl mx-auto">
              
              {/* PESTAÑA: PARTIDOS DE HOY */}
              {pestana === 'hoy' && (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="text-lg font-bold text-brand-blue border-b-2 border-brand-blue/30 pb-2 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Encuentros Programados para Hoy
                  </h3>
                  {partidosHoy.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-xl border border-brand-gold/20 shadow-sm">
                      <p className="text-brand-brown/50 text-sm">No hay partidos agendados para el día de hoy.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {partidosHoy.map(p => (
                        <div key={p.id} className="bg-white border-l-4 border-brand-blue border-y border-r border-y-brand-gold/20 border-r-brand-gold/20 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                          <div className="absolute top-0 right-0 bg-brand-blue/10 text-brand-blue text-[0.65rem] font-bold px-2 py-1 rounded-bl-lg uppercase tracking-wider">Hoy</div>
                          <div className="text-lg font-black text-brand-brown mb-3 leading-tight pr-8">{p.local_nombre} <span className="text-brand-rust mx-1 text-sm">vs</span> {p.visita_nombre}</div>
                          
                          <div className="space-y-1.5 mb-5">
                            <div className="flex items-center gap-2 text-sm text-brand-brown/70 font-medium">
                              <svg className="w-4 h-4 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              {new Date(p.fecha_hora).toLocaleTimeString('es-VE', {hour: '2-digit', minute:'2-digit'})}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-brand-brown/70 font-medium">
                              <svg className="w-4 h-4 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                              {p.sede_nombre}
                            </div>
                          </div>

                          <div className="flex gap-2">
                            <button onClick={() => setModalSorteo(p.id)} className="flex-1 bg-brand-cream text-brand-brown py-2 rounded-lg text-sm font-bold border border-brand-gold/30 hover:bg-brand-gold hover:text-white hover:border-brand-gold transition-colors flex justify-center items-center gap-1 shadow-sm">🪙 Sorteo</button>
                            <button onClick={() => seleccionarPartido(p)} className="flex-1 bg-brand-blue text-white py-2 rounded-lg text-sm font-bold hover:bg-brand-brown transition-colors flex justify-center items-center gap-1 shadow-sm">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> Control
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* PESTAÑA: PRÓXIMOS PARTIDOS */}
              {pestana === 'proximos' && (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="text-lg font-bold text-brand-gold border-b-2 border-brand-gold/30 pb-2 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Próximos Partidos Agendados
                  </h3>
                  {partidosAgendados.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-xl border border-brand-gold/20 shadow-sm">
                      <p className="text-brand-brown/50 text-sm">No hay próximos partidos en el calendario.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {partidosAgendados.map(p => (
                        <div key={p.id} className="bg-white border-l-4 border-brand-gold border-y border-r border-y-brand-gold/20 border-r-brand-gold/20 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative">
                          <div className="font-bold text-brand-brown mb-1.5 leading-tight">{p.local_nombre} <span className="text-brand-rust mx-1 text-xs">vs</span> {p.visita_nombre}</div>
                          <div className="flex items-center gap-2 text-xs font-semibold text-brand-brown/60">
                            <svg className="w-3.5 h-3.5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            {new Date(p.fecha_hora).toLocaleDateString('es-VE', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* PESTAÑA: HISTORIAL RECIENTE */}
              {pestana === 'historial' && (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="text-lg font-bold text-brand-brown/70 border-b-2 border-brand-brown/20 pb-2 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Historial Reciente y Archivo
                  </h3>
                  {partidosFinalizados.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-xl border border-brand-gold/20 shadow-sm">
                      <p className="text-brand-brown/50 text-sm">No hay registros en el historial.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {partidosFinalizados.map(p => (
                        <div key={p.id} className="bg-white border border-brand-gold/30 rounded-xl p-4 shadow-sm">
                          <div className="font-bold text-brand-brown mb-1 leading-tight">{p.local_nombre} <span className="text-brand-rust mx-1 text-xs">vs</span> {p.visita_nombre}</div>
                          <div className="flex items-center gap-2 text-xs font-semibold text-brand-brown/60 mb-3">
                            <span className={`px-2 py-0.5 rounded-full text-[0.65rem] uppercase tracking-wider text-white ${p.estado === 'Finalizado' ? 'bg-brand-blue' : 'bg-red-500'}`}>
                              {p.estado}
                            </span>
                            • {p.hora_final ? p.hora_final : 'Sin hora'}
                          </div>
                          <button onClick={() => window.open(`/?vista=puntajes&partido_id=${p.id}`, '_blank')} className="w-full bg-brand-cream/50 text-brand-blue py-2 rounded border border-brand-blue/30 text-xs font-bold hover:bg-brand-blue hover:text-white transition-colors flex justify-center items-center gap-2 shadow-sm">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Ver Acta / Descargar PDF
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>
          ) : (
            // VISTA DEL PARTIDO ACTIVO (Planilla y Panel de Cancha)
            <div className="flex flex-col lg:flex-row gap-6 animate-fade-in items-start">
              
              <div className="flex-1 w-full min-w-0 bg-white p-4 md:p-6 rounded-xl shadow-sm border border-brand-gold/20">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-brand-gold/20 pb-4">
                  <button onClick={() => { 
                    localStorage.removeItem('partidoActivoId'); 
                    setPartidoActivo(null); 
                    socketRef.current?.emit('presencia_oficial', { partidoId: partidoActivo.id, rol: 'arbitro', estado: false }); 
                    }} className="bg-brand-cream text-brand-brown px-4 py-2 rounded-lg font-bold hover:bg-brand-gold hover:text-white transition-colors border border-brand-gold/30 shadow-sm flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    Volver al Panel
                  </button>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    {partidoActivo.estado === 'Finalizado' && (
                      <button onClick={() => window.open(`/?vista=puntajes&partido_id=${partidoActivo.id}`, '_blank')} className="bg-brand-gold text-white px-4 py-2 rounded-lg font-bold hover:bg-brand-rust transition-colors shadow-sm flex items-center gap-2 text-sm">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        Descargar Acta (PDF)
                      </button>
                    )}
                    
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-sm ${anotadorConectado ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                      <div className="relative flex h-3 w-3">
                        {anotadorConectado && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                        <span className={`relative inline-flex rounded-full h-3 w-3 ${anotadorConectado ? 'bg-green-500' : 'bg-red-500'}`}></span>
                      </div>
                      <span className="font-bold text-xs uppercase tracking-wider">Anotador {anotadorConectado ? 'En Línea' : 'Ausente'}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-6 text-sm text-yellow-800 shadow-sm flex items-start gap-3">
                  <svg className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <div>
                    <strong className="block mb-1">Tip de Arbitraje:</strong> 
                    Todas las jugadas ingresadas son válidas por defecto. Si detecta un error, haga clic sobre la celda en la tabla para enviar una orden de corrección al Anotador.
                  </div>
                </div>

                <div id="acta-planilla-pdf" className="overflow-x-auto hide-scrollbar">
                  <PlanillaUniversal
                    rol={partidoActivo.estado === 'Finalizado' ? 'espectador' : 'arbitro'}
                    estadoPartido={partidoActivo.estado}
                    datosPartido={{ arbitro: partidoActivo.arbitro_nombre, anotador: partidoActivo.anotador_nombre, localNombre: partidoActivo.local_nombre, visitaNombre: partidoActivo.visita_nombre, horaInicio: partidoActivo.hora_inicio, horaFinal: partidoActivo.hora_final }}
                    jugadoresLocal={jugadoresLocal} jugadoresVisita={jugadoresVisita}
                    efectividadJugadores={efectividadJugadores}
                    puntosPorManoLocal={puntosPorManoLocal} puntosPorManoVisita={puntosPorManoVisita}
                    alHacerClicCelda={solicitarRevision}
                  />
                </div>
              </div>

              {/* BARRA LATERAL DERECHA: HERRAMIENTAS DE CANCHA */}
              <div className="w-full lg:w-80 flex flex-col gap-5 shrink-0 lg:sticky lg:top-6">
                
                <div className="bg-brand-brown text-white p-6 rounded-xl border border-brand-gold/20 shadow-lg text-center relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-brand-gold text-brand-brown text-[0.65rem] font-bold px-2 py-1 rounded-bl-lg uppercase tracking-wider">En Vivo</div>
                  <h3 className="text-sm font-bold text-brand-cream/70 uppercase tracking-wider mb-2 flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Tiempo Lanzamiento
                  </h3>
                  <div className={`text-6xl font-black font-mono tracking-tighter my-2 ${tiempoTurno > 50 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                    {formatoT(tiempoTurno)}
                  </div>
                  <div className="text-sm text-brand-cream/60 mt-4 font-medium border-t border-white/10 pt-3">
                    Tiempo Global: <span className="font-bold text-brand-gold">{formatoT(tiempoGlobal)}</span>
                  </div>
                  <div className="text-[0.65rem] text-brand-cream/40 mt-2 uppercase tracking-wide">Controlado por el Anotador</div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-brand-gold/30 shadow-sm">
                  <h3 className="text-base font-bold text-brand-brown mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    Sanciones Disciplinarias
                  </h3>
                  <select 
                    value={jugadorSancionId} 
                    onChange={e => setJugadorSancionId(e.target.value)} 
                    className="w-full p-2.5 mb-4 rounded-lg border border-brand-gold/40 focus:ring-2 focus:ring-brand-rust outline-none text-sm font-medium text-brand-brown bg-brand-cream/20 cursor-pointer"
                  >
                    <option value="">Seleccione infractor...</option>
                    <optgroup label={partidoActivo?.local_nombre || 'Local'}>
                       {jugadoresLocal.map(j => <option key={j.id} value={j.id}>#{j.numero_dorsal} {j.nombre} {j.apellido}</option>)}
                    </optgroup>
                    <optgroup label={partidoActivo?.visita_nombre || 'Visita'}>
                       {jugadoresVisita.map(j => <option key={j.id} value={j.id}>#{j.numero_dorsal} {j.nombre} {j.apellido}</option>)}
                    </optgroup>
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => emitirTarjeta('Amarilla')} className="flex-1 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 border border-yellow-500/30 rounded-lg text-sm font-bold transition-colors shadow-sm flex items-center justify-center gap-1">Amonestar</button>
                    <button onClick={() => emitirTarjeta('Roja')} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm flex items-center justify-center gap-1">Expulsar</button>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-red-200 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
                  <h3 className="text-base font-bold text-brand-brown mb-2 pl-2">Control de Juego</h3>
                  <p className="text-[0.75rem] text-brand-brown/60 mb-4 pl-2 leading-relaxed">
                    Utilice esta opción solo en caso de fuerza mayor (lluvia, falta de luz, etc).
                  </p>
                  <button onClick={suspenderPartido} className="w-full py-3 bg-red-50 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white rounded-lg text-sm font-bold transition-colors shadow-sm flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
                    Suspender Partido
                  </button>
                </div>

              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}