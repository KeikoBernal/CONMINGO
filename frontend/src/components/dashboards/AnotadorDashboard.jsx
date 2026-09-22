import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { io } from 'socket.io-client';
import PlanillaUniversal from './PlanillaUniversal';
import SistemaMensajeria from './SistemaMensajeria';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function AnotadorDashboard({ usuario, cerrarSesion }) {
  // PESTAÑAS DEL PANEL LATERAL: 'hoy' | 'proximos' | 'historial'
  const [pestana, setPestana] = useState(localStorage.getItem('anotadorPestana') || 'hoy');
  const [menuAbierto, setMenuAbierto] = useState(false);

  const [partidos, setPartidos] = useState([]);
  const [partidoActivo, setPartidoActivo] = useState(null);
  const [jugadoresLocal, setJugadoresLocal] = useState([]);
  const [jugadoresVisita, setJugadoresVisita] = useState([]);

  const [efectividadJugadores, setEfectividadJugadores] = useState({});
  const [manualStats, setManualStats] = useState({});
  const [puntosPorManoLocal, setPuntosPorManoLocal] = useState(Array(20).fill(''));
  const [puntosPorManoVisita, setPuntosPorManoVisita] = useState(Array(20).fill(''));
  
  const [modalRegistro, setModalRegistro] = useState(null);
  const [modalTantos, setModalTantos] = useState(null);
  const [modalStatPanel, setModalStatPanel] = useState(null);
  const [arbitroConectado, setArbitroConectado] = useState(false);
  
  const [tiempoGlobal, setTiempoGlobal] = useState(0);
  const [tiempoTurno, setTiempoTurno] = useState(0);
  const [cronometroGlobalActivo, setCronometroGlobalActivo] = useState(false);
  const [cronometroTurnoActivo, setCronometroTurnoActivo] = useState(false);

  const [mensajeriaAbierta, setMensajeriaAbierta] = useState(false);
  const [mensajes, setMensajes] = useState([]);
  const [nuevoMensaje, setNuevoMensaje] = useState('');
  const [destinatarioMsg, setDestinatarioMsg] = useState('rol_arbitro');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const socketRef = useRef(null);

  const [token, setToken] = useState(null);

  // --- ESTADOS MULTILIGA ---
  const [ligas, setLigas] = useState([]);
  const [ligaFiltro, setLigaFiltro] = useState('');

  useEffect(() => {
    localStorage.setItem('anotadorPestana', pestana);
  }, [pestana]);

  const fetchConToken = async (endpoint, options = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    return await fetch(`${API_URL}/operativo${endpoint}`, {
      ...options, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` }
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
    if (partidoActivo && (Object.keys(efectividadJugadores).length > 0 || puntosPorManoLocal.some(p => p !== ''))) {
      const backup = { efectividadJugadores, manualStats, puntosPorManoLocal, puntosPorManoVisita, timestamp: Date.now() };
      localStorage.setItem(`backup_partido_${partidoActivo.id}`, JSON.stringify(backup));
    }
  }, [efectividadJugadores, manualStats, puntosPorManoLocal, puntosPorManoVisita, partidoActivo]);

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
    socketRef.current.emit('presencia_oficial', { partidoId: partido.id, rol: 'anotador', estado: true });

    socketRef.current.on('presencia_actualizada', (data) => {
      if (data.rol === 'arbitro') setArbitroConectado(data.estado);
    });

    socketRef.current.on('actualizar_planilla', (data) => {
      if (data.efectividad) setEfectividadJugadores(data.efectividad);
      if (data.manualStats) setManualStats(data.manualStats);
      if (data.tantosLocal) setPuntosPorManoLocal(data.tantosLocal);
      if (data.tantosVisita) setPuntosPorManoVisita(data.tantosVisita);
      
      if (data.estadoPartido) {
        if (data.estadoPartido === 'Suspendido') {
          alert('🛑 El árbitro ha suspendido el partido. Los resultados hasta este momento se han guardado automáticamente. Serás redirigido al menú principal.');
          localStorage.removeItem('partidoActivoId');
          setPartidoActivo(null);
        } else {
          setPartidoActivo(prev => prev ? ({ ...prev, estado: data.estadoPartido }) : null);
        }
      }
    });

    socketRef.current.on('alerta_revision', (msg) => { alert(`⚠️ SOLICITUD DEL ÁRBITRO:\n\n${msg}`); });

    const res = await fetchConToken(`/partidos/${partido.id}/nomina`);
    if (res.ok) {
      const todos = await res.json();
      setJugadoresLocal(todos.filter(j => j.equipo_id === partido.equipo_local_id));
      setJugadoresVisita(todos.filter(j => j.equipo_id === partido.equipo_visita_id));
    }

    const localData = localStorage.getItem(`backup_partido_${partido.id}`);
    if (localData && partido.estado !== 'Finalizado' && partido.estado !== 'Suspendido') {
      const parsed = JSON.parse(localData);
      if (window.confirm('⚠️ Se detectaron datos locales sin sincronizar para este partido. ¿Deseas restaurar la planilla desde tu navegador? (Ideal si perdiste conexión recientemente)')) {
        setEfectividadJugadores(parsed.efectividadJugadores || {}); setManualStats(parsed.manualStats || {});
        setPuntosPorManoLocal(parsed.puntosPorManoLocal || Array(20).fill('')); setPuntosPorManoVisita(parsed.puntosPorManoVisita || Array(20).fill(''));
        socketRef.current.emit('sincronizar_planilla_completa', { partido_id: partido.id, efectividad: parsed.efectividadJugadores, manualStats: parsed.manualStats, tantosLocal: parsed.puntosPorManoLocal, tantosVisita: parsed.puntosPorManoVisita });
      }
    }
  };

  const enviarMensajeComoOficial = (e) => {
    e.preventDefault();
    const msgLimpio = nuevoMensaje.trim();
    if (!msgLimpio) return;
    
    const esParaDelegado = destinatarioMsg.includes('delegado');
    socketRef.current.emit('enviar_mensaje', { destinatario_sala: destinatarioMsg, cc_admin: esParaDelegado, remitente: `${usuario?.nombre || ''} (Anotador)`, mensaje: msgLimpio, timestamp: new Date().toLocaleTimeString('es-VE') });
    setMensajes(prev => [...prev, { destinatario_sala: destinatarioMsg, remitente: 'Anotador (Tú)', mensaje: msgLimpio, timestamp: new Date().toLocaleTimeString('es-VE'), propio: true }]);
    setNuevoMensaje('');
  };

  const handleIniciarPartido = async () => {
    if (isSubmitting) return; // INSERCIÓN: Idempotencia
    setIsSubmitting(true);
    
    const hora = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
    const res = await fetchConToken(`/partidos/${partidoActivo.id}/iniciar`, { method: 'PUT', body: JSON.stringify({ hora_inicio: hora }) });
    
    setIsSubmitting(false);
    if (res.ok) {
      setPartidoActivo(prev => ({ ...prev, estado: 'En Curso', hora_inicio: hora }));
      setCronometroGlobalActivo(true);
      socketRef.current?.emit('partido_iniciado', { partidoId: partidoActivo.id, hora_inicio: hora });
      socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno, cronometroTurnoActivo, tiempoGlobal, cronometroGlobalActivo: true });
    }
  };

  const finalizarPartido = async () => {
    if (isSubmitting) return;
    if (!window.confirm('¿Cerrar acta y registrar hora final?')) return;
    
    setIsSubmitting(true);
    const hora = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
    const res = await fetchConToken(`/partidos/${partidoActivo.id}/finalizar`, { method: 'PUT', body: JSON.stringify({ hora_final: hora }) });
    
    setIsSubmitting(false);
    if (res.ok) {
      setPartidoActivo(prev => ({ ...prev, estado: 'Finalizado', hora_final: hora }));
      setCronometroGlobalActivo(false); setCronometroTurnoActivo(false);
      socketRef.current?.emit('partido_finalizado', { partidoId: partidoActivo.id, hora_final: hora });
      socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno, cronometroTurnoActivo: false, tiempoGlobal, cronometroGlobalActivo: false });
      localStorage.removeItem(`backup_partido_${partidoActivo.id}`); 
      localStorage.removeItem('partidoActivoId');
    }
  };

  const toggleTurno = () => {
    const nuevoEstado = !cronometroTurnoActivo;
    setCronometroTurnoActivo(nuevoEstado);
    socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno, cronometroTurnoActivo: nuevoEstado, tiempoGlobal, cronometroGlobalActivo });
  };

  const resetTurno = () => {
    setTiempoTurno(0); setCronometroTurnoActivo(false);
    socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno: 0, cronometroTurnoActivo: false, tiempoGlobal, cronometroGlobalActivo });
  };

  const registrarLanzamiento = (valor) => {
    socketRef.current?.emit('proponer_jugada', { partido_id: partidoActivo.id, jugador_id: modalRegistro.jId, mano_index: modalRegistro.mIdx, valor });
    setModalRegistro(null);
  };

  const registrarTantosMano = (puntos) => {
    const ptsValidados = parseInt(puntos);
    if (isNaN(ptsValidados) || ptsValidados < 0 || ptsValidados > 6) {
      return alert('Error: Los tantos deben ser un valor entero entre 0 y 6.');
    }

    let nuevoLocal = [...puntosPorManoLocal], nuevoVisita = [...puntosPorManoVisita];
    const idx = parseInt(modalTantos.manoIdx); // INSERCIÓN: Casteo de index
    
    if (modalTantos.esLocal) { nuevoLocal[idx] = ptsValidados; nuevoVisita[idx] = 0; } 
    else { nuevoVisita[idx] = ptsValidados; nuevoLocal[idx] = 0; }
    
    setPuntosPorManoLocal(nuevoLocal); setPuntosPorManoVisita(nuevoVisita);
    socketRef.current?.emit('tantos_asignados', { partido_id: parseInt(partidoActivo.id), tantosLocal: nuevoLocal, tantosVisita: nuevoVisita });
    setModalTantos(null);
  };

  const modificarStatManual = (jugadorId, tipo, delta) => {
    const actual = manualStats[jugadorId]?.[tipo] || 0;
    const nuevoValor = Math.max(0, actual + delta);
    const nuevosStats = { ...manualStats, [jugadorId]: { ...(manualStats[jugadorId] || { AL: 0, AB: 0, BL: 0, BB: 0 }), [tipo]: nuevoValor } };
    setManualStats(nuevosStats);
    socketRef.current?.emit('actualizar_stats_manuales', { partido_id: partidoActivo.id, manualStats: nuevosStats });
  };

  const partidosFiltrados = partidos.filter(p => !ligaFiltro || p.organizacion_id === ligaFiltro);
  const hoyFecha = new Date().toLocaleDateString('es-VE');
  
  const partidosHoy = partidosFiltrados.filter(p => new Date(p.fecha_hora).toLocaleDateString('es-VE') === hoyFecha && p.estado !== 'Finalizado' && p.estado !== 'Suspendido');
  const partidosAgendados = partidosFiltrados.filter(p => new Date(p.fecha_hora).toLocaleDateString('es-VE') !== hoyFecha && p.estado !== 'Finalizado');
  const partidosFinalizados = partidosFiltrados.filter(p => p.estado === 'Finalizado' || p.estado === 'Suspendido');

  // Íconos para la barra lateral
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
      
      {/* MODAL REGISTRO JUGADAS (MESA DE ANOTACIÓN) */}
      {modalRegistro && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-1500 p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-sm shadow-2xl animate-slide-up text-center border border-brand-gold/30">
            <h2 className="text-xl font-black text-brand-brown mb-5">Registro Mano #{modalRegistro.mIdx + 1}</h2>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => registrarLanzamiento('A')} className="py-4 bg-brand-blue text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-blue-600 transition-colors">A</button>
              <button onClick={() => registrarLanzamiento('a')} className="py-4 bg-red-500 text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-red-600 transition-colors">a <span className="text-sm block font-medium">Nulo</span></button>
              <button onClick={() => registrarLanzamiento('B')} className="py-4 bg-green-600 text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-green-700 transition-colors">B</button>
              <button onClick={() => registrarLanzamiento('b')} className="py-4 bg-red-500 text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-red-600 transition-colors">b <span className="text-sm block font-medium">Nulo</span></button>
              <button onClick={() => registrarLanzamiento('N')} className="col-span-2 py-3 bg-gray-500 text-white rounded-lg text-xl font-bold shadow-sm hover:bg-gray-600 transition-colors">N <span className="text-sm font-medium ml-2">(Nulo General)</span></button>
              <button onClick={() => registrarLanzamiento('')} className="col-span-2 py-3 bg-gray-200 text-brand-brown rounded-lg font-bold hover:bg-gray-300 transition-colors mt-2">Borrar Celda</button>
            </div>
            <button onClick={() => setModalRegistro(null)} className="mt-5 w-full py-3 bg-transparent text-brand-brown font-bold hover:bg-brand-cream rounded-lg transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      {/* MODAL STATS MANUALES */}
      {modalStatPanel && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-1600 p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-xs shadow-2xl animate-slide-up text-center border border-brand-gold/30">
            <h3 className="text-lg font-bold text-brand-brown/70 mb-2">Ajustar {modalStatPanel.tipo}</h3>
            <div className="text-6xl font-black text-brand-brown my-6">{manualStats[modalStatPanel.jId]?.[modalStatPanel.tipo] || 0}</div>
            <div className="flex gap-4">
              <button onClick={() => modificarStatManual(modalStatPanel.jId, modalStatPanel.tipo, -1)} className="flex-1 py-4 text-3xl bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors shadow-sm">-</button>
              <button onClick={() => modificarStatManual(modalStatPanel.jId, modalStatPanel.tipo, 1)} className="flex-1 py-4 text-3xl bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors shadow-sm">+</button>
            </div>
            <button onClick={() => setModalStatPanel(null)} className="mt-6 w-full py-3 bg-gray-200 text-brand-brown rounded-lg font-bold hover:bg-gray-300 transition-colors">Cerrar Panel</button>
          </div>
        </div>
      )}

      {/* MODAL ASIGNAR TANTOS */}
      {modalTantos && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-1500 p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-sm shadow-2xl animate-slide-up text-center border border-brand-gold/30">
            <h3 className="text-xl font-black text-brand-brown mb-5">Asignar Tantos - Mano #{modalTantos.manoIdx + 1}</h3>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[0, 1, 2, 3, 4, 5, 6].map(p => (
                <button 
                  key={p} 
                  onClick={() => registrarTantosMano(p)} 
                  className={`py-4 text-white rounded-lg text-2xl font-bold shadow-sm transition-colors ${p === 0 ? 'bg-gray-400 hover:bg-gray-500' : 'bg-brand-blue hover:bg-blue-600'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button onClick={() => setModalTantos(null)} className="w-full py-3 bg-gray-200 text-brand-brown rounded-lg font-bold hover:bg-gray-300 transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      {/* SIDEBAR LATERAL DEL ANOTADOR */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-brand-brown text-brand-cream shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${menuAbierto ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static md:shrink-0`}>
        <div className="p-6 border-b border-brand-gold/20 shrink-0 bg-brand-brown/50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-brand-cream/10 border border-brand-gold/50 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            </div>
            <div className="overflow-hidden">
              <h1 className="text-base font-bold text-brand-cream truncate">Anotador Oficial</h1>
              <p className="text-xs text-brand-gold font-semibold uppercase tracking-wider mt-0.5">Mesa Técnica</p>
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
              {partidoActivo ? `Planilla Oficial: ${partidoActivo.local_nombre} vs ${partidoActivo.visita_nombre}` : (pestana === 'hoy' ? 'Partidos de Hoy' : pestana === 'proximos' ? 'Próximos Partidos' : 'Historial Reciente')}
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

                          <button onClick={() => seleccionarPartido(p)} className="w-full bg-brand-blue text-white py-2.5 rounded-lg text-sm font-bold hover:bg-brand-brown transition-colors flex justify-center items-center gap-2 shadow-sm">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            Abrir Planilla de Anotación
                          </button>
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
              
              {/* PLANILLA */}
              <div className="flex-1 w-full min-w-0 bg-white p-4 md:p-6 rounded-xl shadow-sm border border-brand-gold/20 overflow-x-auto">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-brand-gold/20 pb-4">
                  <button onClick={() => { 
                    localStorage.removeItem('partidoActivoId'); 
                    setPartidoActivo(null); 
                    socketRef.current?.emit('presencia_oficial', { partidoId: partidoActivo.id, rol: 'anotador', estado: false }); 
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
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border shadow-sm ${arbitroConectado ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                      <div className="relative flex h-3 w-3">
                        {arbitroConectado && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                        <span className={`relative inline-flex rounded-full h-3 w-3 ${arbitroConectado ? 'bg-green-500' : 'bg-red-500'}`}></span>
                      </div>
                      <span className="font-bold text-xs uppercase tracking-wider">Árbitro {arbitroConectado ? 'En Línea' : 'Ausente'}</span>
                    </div>
                  </div>
                </div>

                <div id="acta-planilla-pdf">
                  <PlanillaUniversal
                    rol={partidoActivo.estado === 'Finalizado' ? 'espectador' : 'anotador'}
                    estadoPartido={partidoActivo.estado}
                    partidoId={partidoActivo.id}
                    datosPartido={{ arbitro: partidoActivo.arbitro_nombre, anotador: partidoActivo.anotador_nombre, capitanLocal: partidoActivo.capitan_local_nombre, capitanVisita: partidoActivo.capitan_visita_nombre, localNombre: partidoActivo.local_nombre, visitaNombre: partidoActivo.visita_nombre, horaInicio: partidoActivo.hora_inicio, horaFinal: partidoActivo.hora_final }}
                    jugadoresLocal={jugadoresLocal} jugadoresVisita={jugadoresVisita}
                    efectividadJugadores={efectividadJugadores}
                    manualStats={manualStats}
                    puntosPorManoLocal={puntosPorManoLocal} puntosPorManoVisita={puntosPorManoVisita}
                    alHacerClicCelda={(jId, mIdx) => setModalRegistro({ jId, mIdx })}
                    alHacerClicPuntuacion={(esLocal, manoIdx) => setModalTantos({ esLocal, manoIdx })}
                    alSeleccionarStatCell={(jId, tipo) => setModalStatPanel({ jId, tipo })}
                  />
                </div>
              </div>

              {/* BARRA LATERAL DERECHA: HERRAMIENTAS DE MESA */}
              <div className="w-full lg:w-80 flex flex-col gap-5 shrink-0 lg:sticky lg:top-6">
                
                {partidoActivo.estado === 'Agendado' && (
                  <button 
                    onClick={handleIniciarPartido} 
                    disabled={isSubmitting}
                    className={`w-full py-4 rounded-xl text-lg font-black tracking-wider transition-colors shadow-md flex justify-center items-center gap-2 text-white ${isSubmitting ? 'bg-gray-400 opacity-70 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                  >
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                    {isSubmitting ? 'INICIANDO...' : 'INICIAR PARTIDO'}
                  </button>
                )}
                {partidoActivo.estado === 'En Curso' && (
                  <button 
                    onClick={finalizarPartido} 
                    disabled={isSubmitting}
                    className={`w-full py-4 rounded-xl text-lg font-black tracking-wider transition-colors shadow-md flex justify-center items-center gap-2 text-white ${isSubmitting ? 'bg-gray-400 opacity-70 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
                  >
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" /></svg>
                    {isSubmitting ? 'FINALIZANDO...' : 'FINALIZAR ACTA'}
                  </button>
                )}

                {/* CRONÓMETRO MESA TÉCNICA */}   
                <div className="bg-brand-brown text-white p-6 rounded-xl border border-brand-gold/20 shadow-lg text-center relative overflow-hidden">
                  <h4 className="text-sm font-bold text-brand-cream/70 uppercase tracking-wider mb-2 flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Tiempo Lanzamiento
                  </h4>
                  <div className={`text-6xl font-black font-mono tracking-tighter my-2 ${tiempoTurno > 50 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                    {formatoT(tiempoTurno)}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button onClick={toggleTurno} className={`flex-1 py-2 rounded-lg font-bold shadow-sm transition-colors ${cronometroTurnoActivo ? 'bg-yellow-500 hover:bg-yellow-600 text-yellow-900' : 'bg-brand-blue hover:bg-blue-600 text-white'}`}>
                      {cronometroTurnoActivo ? 'Pausar' : 'Iniciar'}
                    </button>
                    <button onClick={resetTurno} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold shadow-sm transition-colors">
                      Reset
                    </button>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-xl border border-brand-gold/30 shadow-sm text-center">
                  <div className="text-xs font-bold text-brand-brown/70 uppercase tracking-wider mb-2">Tiempo Total del Partido</div>
                  <div className="text-3xl font-black font-mono text-brand-brown">{formatoT(tiempoGlobal)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}