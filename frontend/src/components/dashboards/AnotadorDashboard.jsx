import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { io } from 'socket.io-client';
import PlanillaUniversal from './PlanillaUniversal';
import SistemaMensajeria from './SistemaMensajeria';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function AnotadorDashboard({ usuario, cerrarSesion }) {
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
  const socketRef = useRef(null);

  const fetchConToken = async (endpoint, options = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    return await fetch(`${API_URL}/operativo${endpoint}`, {
      ...options, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` }
    });
  };

  const [token, setToken] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token);
    });
  }, []);

  // --- NUEVOS ESTADOS MULTILIGA ---
  const [ligas, setLigas] = useState([]);
  const [ligaFiltro, setLigaFiltro] = useState('');

const cargarDatosOficial = async () => {
    const res = await fetchConToken('/mis-partidos');
    if (res.ok) {
      const partidosData = await res.json();
      setPartidos(partidosData);

      // --- NUEVO: RESTAURAR PARTIDO AL REFRESCAR LA PÁGINA ---
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

  // --- REEMPLAZO DEL useEffect: Inicializamos Socket PRIMERO ---
  useEffect(() => { 
    socketRef.current = io(SOCKET_URL);
    cargarDatosOficial(); 
    return () => socketRef.current?.disconnect(); 
  }, [usuario]);
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
    localStorage.setItem('partidoActivoId', partido.id); // NUEVO: GUARDAR ESTADO AL ENTRAR

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
          localStorage.removeItem('partidoActivoId'); // NUEVO: LIMPIAR SI LO SUSPENDEN REMOTAMENTE
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
    if (!nuevoMensaje.trim()) return;
    const esParaDelegado = destinatarioMsg.includes('delegado');
    socketRef.current.emit('enviar_mensaje', { destinatario_sala: destinatarioMsg, cc_admin: esParaDelegado, remitente: `${usuario?.nombre || ''} (Anotador)`, mensaje: nuevoMensaje, timestamp: new Date().toLocaleTimeString('es-VE') });
    setMensajes(prev => [...prev, { destinatario_sala: destinatarioMsg, remitente: 'Anotador (Tú)', mensaje: nuevoMensaje, timestamp: new Date().toLocaleTimeString('es-VE'), propio: true }]);
    setNuevoMensaje('');
  };

  // 1. SINCRONIZACIÓN DEL CRONÓMETRO AL INICIAR
  const handleIniciarPartido = async () => {
    const hora = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
    const res = await fetchConToken(`/partidos/${partidoActivo.id}/iniciar`, { method: 'PUT', body: JSON.stringify({ hora_inicio: hora }) });
    if (res.ok) {
      setPartidoActivo(prev => ({ ...prev, estado: 'En Curso', hora_inicio: hora }));
      setCronometroGlobalActivo(true);
      socketRef.current?.emit('partido_iniciado', { partidoId: partidoActivo.id, hora_inicio: hora });
      socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno, cronometroTurnoActivo, tiempoGlobal, cronometroGlobalActivo: true });
    }
  };

  // 2. SINCRONIZACIÓN DEL CRONÓMETRO AL FINALIZAR
  const finalizarPartido = async () => {
    if (!window.confirm('¿Cerrar acta y registrar hora final?')) return;
    const hora = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true });
    const res = await fetchConToken(`/partidos/${partidoActivo.id}/finalizar`, { method: 'PUT', body: JSON.stringify({ hora_final: hora }) });
    if (res.ok) {
      setPartidoActivo(prev => ({ ...prev, estado: 'Finalizado', hora_final: hora }));
      setCronometroGlobalActivo(false); setCronometroTurnoActivo(false);
      socketRef.current?.emit('partido_finalizado', { partidoId: partidoActivo.id, hora_final: hora });
      socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno, cronometroTurnoActivo: false, tiempoGlobal, cronometroGlobalActivo: false });
      localStorage.removeItem(`backup_partido_${partidoActivo.id}`); 
      localStorage.removeItem('partidoActivoId'); // NUEVO: LIMPIAR AL FINALIZAR
    }
  };

  // 3. SINCRONIZACIÓN AL PRESIONAR INICIAR/PAUSAR
  const toggleTurno = () => {
    const nuevoEstado = !cronometroTurnoActivo;
    setCronometroTurnoActivo(nuevoEstado);
    socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno, cronometroTurnoActivo: nuevoEstado, tiempoGlobal, cronometroGlobalActivo });
  };

  // 4. SINCRONIZACIÓN AL PRESIONAR RESET
  const resetTurno = () => {
    setTiempoTurno(0); setCronometroTurnoActivo(false);
    socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno: 0, cronometroTurnoActivo: false, tiempoGlobal, cronometroGlobalActivo });
  };

  const registrarLanzamiento = (valor) => {
    socketRef.current?.emit('proponer_jugada', { partido_id: partidoActivo.id, jugador_id: modalRegistro.jId, mano_index: modalRegistro.mIdx, valor });
    setModalRegistro(null);
  };

  const registrarTantosMano = (puntos) => {
    let nuevoLocal = [...puntosPorManoLocal], nuevoVisita = [...puntosPorManoVisita];
    const idx = modalTantos.manoIdx;
    if (modalTantos.esLocal) { nuevoLocal[idx] = puntos; nuevoVisita[idx] = 0; } 
    else { nuevoVisita[idx] = puntos; nuevoLocal[idx] = 0; }
    setPuntosPorManoLocal(nuevoLocal); setPuntosPorManoVisita(nuevoVisita);
    socketRef.current?.emit('tantos_asignados', { partido_id: partidoActivo.id, tantosLocal: nuevoLocal, tantosVisita: nuevoVisita });
    setModalTantos(null);
  };

  const modificarStatManual = (jugadorId, tipo, delta) => {
    const actual = manualStats[jugadorId]?.[tipo] || 0;
    const nuevoValor = Math.max(0, actual + delta);
    const nuevosStats = { ...manualStats, [jugadorId]: { ...(manualStats[jugadorId] || { AL: 0, AB: 0, BL: 0, BB: 0 }), [tipo]: nuevoValor } };
    setManualStats(nuevosStats);
    socketRef.current?.emit('actualizar_stats_manuales', { partido_id: partidoActivo.id, manualStats: nuevosStats });
  };

  // Aplicamos el filtro a la variable partidosFiltrados ANTES de dividirlos por fechas
  const partidosFiltrados = partidos.filter(p => !ligaFiltro || p.organizacion_id === ligaFiltro);

  const hoyFecha = new Date().toLocaleDateString('es-VE');
  const partidosHoy = partidosFiltrados.filter(p => new Date(p.fecha_hora).toLocaleDateString('es-VE') === hoyFecha && p.estado !== 'Finalizado' && p.estado !== 'Suspendido');
  const partidosAgendados = partidosFiltrados.filter(p => new Date(p.fecha_hora).toLocaleDateString('es-VE') !== hoyFecha && p.estado !== 'Finalizado');
  const partidosFinalizados = partidosFiltrados.filter(p => p.estado === 'Finalizado' || p.estado === 'Suspendido');

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '15px', fontFamily: 'sans-serif' }}>
      
      {/* Pasamos ligaFiltro al sistema de mensajería para aislar los chats por organización */}
      <SistemaMensajeria usuario={usuario} token={token} ligaActivaId={ligaFiltro} />
      
      {modalRegistro && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1500 }}>
          <div style={{ background: '#FFF', padding: '25px', borderRadius: '12px', width: '90%', maxWidth: '350px', textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 20px 0' }}>Mano #{modalRegistro.mIdx + 1}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <button onClick={() => registrarLanzamiento('A')} style={{ padding: '20px', background: '#3182CE', color: '#FFF', border: 'none', borderRadius: '8px', fontSize: '1.5em', fontWeight: 'bold' }}>A</button>
              <button onClick={() => registrarLanzamiento('a')} style={{ padding: '20px', background: '#E53E3E', color: '#FFF', border: 'none', borderRadius: '8px', fontSize: '1.5em', fontWeight: 'bold' }}>a (Nulo)</button>
              <button onClick={() => registrarLanzamiento('B')} style={{ padding: '20px', background: '#38A169', color: '#FFF', border: 'none', borderRadius: '8px', fontSize: '1.5em', fontWeight: 'bold' }}>B</button>
              <button onClick={() => registrarLanzamiento('b')} style={{ padding: '20px', background: '#E53E3E', color: '#FFF', border: 'none', borderRadius: '8px', fontSize: '1.5em', fontWeight: 'bold' }}>b (Nulo)</button>
              <button onClick={() => registrarLanzamiento('N')} style={{ gridColumn: 'span 2', padding: '15px', background: '#718096', color: '#FFF', border: 'none', borderRadius: '8px', fontSize: '1.3em', fontWeight: 'bold' }}>N (Nulo General)</button>
              <button onClick={() => registrarLanzamiento('')} style={{ gridColumn: 'span 2', padding: '15px', background: '#E2E8F0', color: '#4A5568', border: 'none', borderRadius: '8px', fontWeight: 'bold' }}>Borrar Celda</button>
            </div>
            <button onClick={() => setModalRegistro(null)} style={{ marginTop: '20px', width: '100%', padding: '10px', background: 'transparent', border: 'none' }}>Cancelar</button>
          </div>
        </div>
      )}

      {modalStatPanel && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1600 }}>
          <div style={{ background: '#FFF', padding: '30px', borderRadius: '12px', textAlign: 'center', width: '90%', maxWidth: '300px' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#4A5568' }}>Ajustar {modalStatPanel.tipo}</h3>
            <div style={{ fontSize: '4em', margin: '20px 0', fontWeight: '900', color: '#2D3748' }}>{manualStats[modalStatPanel.jId]?.[modalStatPanel.tipo] || 0}</div>
            <div style={{ display: 'flex', gap: '20px' }}>
              <button onClick={() => modificarStatManual(modalStatPanel.jId, modalStatPanel.tipo, -1)} style={{ flex: 1, padding: '20px', fontSize: '2em', background: '#E53E3E', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}>-</button>
              <button onClick={() => modificarStatManual(modalStatPanel.jId, modalStatPanel.tipo, 1)} style={{ flex: 1, padding: '20px', fontSize: '2em', background: '#38A169', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}>+</button>
            </div>
            <button onClick={() => setModalStatPanel(null)} style={{ marginTop: '25px', width: '100%', padding: '12px', background: '#E2E8F0', border: 'none', borderRadius: '8px', fontWeight: 'bold' }}>Cerrar Panel</button>
          </div>
        </div>
      )}

      {modalTantos && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1500 }}>
          <div style={{ background: '#FFF', padding: '25px', borderRadius: '12px', width: '90%', maxWidth: '350px', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 15px 0' }}>Asignar Tantos - Mano #{modalTantos.manoIdx + 1}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '15px' }}>
              {[0, 1, 2, 3, 4, 5, 6].map(p => (
                <button key={p} onClick={() => registrarTantosMano(p)} style={{ padding: '20px', background: p === 0 ? '#CBD5E0' : '#3182CE', color: '#FFF', border: 'none', borderRadius: '8px', fontSize: '1.4em', fontWeight: 'bold' }}>{p}</button>
              ))}
            </div>
            <button onClick={() => setModalTantos(null)} style={{ width: '100%', padding: '10px', background: '#E2E8F0', border: 'none', borderRadius: '4px' }}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', borderBottom: '2px solid #E2E8F0', paddingBottom: '15px', flexWrap: 'wrap', gap: '15px' }}>
        <h1 style={{ margin: 0, color: '#2D3748' }}>📝 Panel Oficial de Anotación</h1>
        
        {/* SELECTOR MULTILIGA */}
        {ligas.length > 0 && (
          <select 
            value={ligaFiltro} 
            onChange={(e) => setLigaFiltro(e.target.value)}
            style={{ padding: '8px', fontSize: '1em', borderRadius: '4px', border: '1px solid #CBD5E0', background: '#FFF' }}
          >
            {ligas.map(l => <option key={l.id} value={l.id}>Liga: {l.nombre}</option>)}
          </select>
        )}

        <button onClick={cerrarSesion} style={{ padding: '8px 16px', background: '#E2E8F0', border: 'none', borderRadius: '6px', fontWeight: 'bold' }}>Cerrar Sesión</button>
      </div>

      {!partidoActivo ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
          <div>
            <h3 style={{ color: '#3182CE', borderBottom: '2px solid #3182CE', paddingBottom: '5px' }}>📅 Partidos de Hoy</h3>
            {partidosHoy.length === 0 ? <p style={{ color: '#A0AEC0' }}>No hay partidos agendados para hoy.</p> : partidosHoy.map(p => (
              <div key={p.id} style={{ background: '#FFF', border: '1px solid #CBD5E0', borderRadius: '8px', padding: '15px', marginBottom: '10px' }}>
                <div style={{ fontSize: '1.1em', fontWeight: 'bold', marginBottom: '10px' }}>{p.local_nombre} vs {p.visita_nombre}</div>
                <div style={{ fontSize: '0.85em', color: '#718096', marginBottom: '15px' }}>⌚ {new Date(p.fecha_hora).toLocaleTimeString('es-VE', {hour: '2-digit', minute:'2-digit'})} | 🏟️ {p.sede_nombre}</div>
                <button onClick={() => seleccionarPartido(p)} style={{ width: '100%', padding: '10px', background: '#3182CE', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Entrar al Partido</button>
              </div>
            ))}
          </div>
          <div>
            <h3 style={{ color: '#D69E2E', borderBottom: '2px solid #D69E2E', paddingBottom: '5px' }}>🗓️ Próximos Partidos</h3>
            {partidosAgendados.map(p => (
              <div key={p.id} style={{ background: '#FFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '15px', marginBottom: '10px' }}>
                <div style={{ fontWeight: 'bold' }}>{p.local_nombre} vs {p.visita_nombre}</div>
                <div style={{ fontSize: '0.8em', color: '#718096' }}>{new Date(p.fecha_hora).toLocaleDateString('es-VE')}</div>
              </div>
            ))}
          </div>
          <div>
            <h3 style={{ color: '#4A5568', borderBottom: '2px solid #4A5568', paddingBottom: '5px' }}>📁 Historial</h3>
            {partidosFinalizados.map(p => (
              <div key={p.id} style={{ background: '#EDF2F7', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '15px', marginBottom: '10px', opacity: 0.9 }}>
                <div style={{ fontWeight: 'bold' }}>{p.local_nombre} vs {p.visita_nombre}</div>
                <div style={{ fontSize: '0.8em', color: '#718096', marginBottom: '10px' }}>{p.estado} - {p.hora_final || 'Sin Finalizar'}</div>
                <button onClick={() => window.open(`/?vista=puntajes&partido_id=${p.id}`, '_blank')} style={{ width: '100%', padding: '8px', background: '#38A169', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85em' }}>📄 Ver Acta / Descargar PDF</button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
          
          <div style={{ flex: 1, overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <button onClick={() => { 
                localStorage.removeItem('partidoActivoId'); 
                setPartidoActivo(null); 
                socketRef.current?.emit('presencia_oficial', { partidoId: partidoActivo.id, rol: 'anotador', estado: false }); 
              }} style={{ padding: '8px 15px', background: '#E2E8F0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>⬅️ Volver
              </button>              
              <div style={{ display: 'flex', gap: '15px' }}>
                {partidoActivo.estado === 'Finalizado' && (
                  <button onClick={() => window.open(`/?vista=puntajes&partido_id=${partidoActivo.id}`, '_blank')} style={{ padding: '8px 15px', background: '#D69E2E', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>📄 Descargar Acta (PDF)</button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: arbitroConectado ? '#38A169' : '#E53E3E' }}></div>
                  <span style={{ fontWeight: 'bold', color: '#4A5568' }}>Árbitro {arbitroConectado ? 'Conectado' : 'Ausente'}</span>
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

          <div style={{ width: '300px', position: 'sticky', top: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {partidoActivo.estado === 'Agendado' && (
              <button onClick={handleIniciarPartido} style={{ width: '100%', padding: '15px', background: '#38A169', color: '#FFF', border: 'none', borderRadius: '8px', fontSize: '1.1em', fontWeight: 'bold', cursor: 'pointer' }}>▶️ INICIAR PARTIDO</button>
            )}
            {partidoActivo.estado === 'En Curso' && (
              <button onClick={finalizarPartido} style={{ width: '100%', padding: '15px', background: '#E53E3E', color: '#FFF', border: 'none', borderRadius: '8px', fontSize: '1.1em', fontWeight: 'bold', cursor: 'pointer' }}>🏁 FINALIZAR ACTA</button>
            )}

            <div style={{ background: '#2D3748', color: '#FFF', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#A0AEC0' }}>⏱️ TIEMPO DE LANZAMIENTO</h4>
              <div style={{ fontSize: '3em', fontWeight: '900', fontFamily: 'monospace', color: tiempoTurno > 50 ? '#FC8181' : '#FFF' }}>{formatoT(tiempoTurno)}</div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={toggleTurno} style={{ flex: 1, padding: '10px', background: '#4A5568', color: '#FFF', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>{cronometroTurnoActivo ? 'Pausar' : 'Iniciar'}</button>
                <button onClick={resetTurno} style={{ padding: '10px', background: '#E53E3E', color: '#FFF', border: 'none', borderRadius: '6px' }}>Reset</button>
              </div>
            </div>

            <div style={{ background: '#FFF', padding: '15px', borderRadius: '8px', border: '1px solid #E2E8F0', textAlign: 'center' }}>
              <div style={{ fontSize: '0.9em', color: '#718096', marginBottom: '5px' }}>Tiempo Total del Partido</div>
              <div style={{ fontSize: '2em', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatoT(tiempoGlobal)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}