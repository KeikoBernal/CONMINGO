import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { io } from 'socket.io-client';
import PlanillaUniversal from './PlanillaUniversal';
import SistemaMensajeria from './SistemaMensajeria';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function ArbitroDashboard({ usuario, cerrarSesion }) {
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

  const [mensajeriaAbierta, setMensajeriaAbierta] = useState(false);
  const [mensajes, setMensajes] = useState([]);
  const [nuevoMensaje, setNuevoMensaje] = useState('');
  const [destinatarioMsg, setDestinatarioMsg] = useState('rol_administrador de liga');

  const socketRef = useRef(null);

  const fetchConToken = async (endpoint, options = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    return await fetch(`${API_URL}/operativo${endpoint}`, {
      ...options, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
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
    // 1. Cargar Partidos
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
          localStorage.removeItem('partidoActivoId'); // Limpiar si ya caducó
        }
      }
    }

    // 2. Cargar Ligas a las que pertenece
    const resLigas = await fetchConToken('/mis-ligas');
    if (resLigas.ok) {
      const dataLigas = await resLigas.json();
      setLigas(dataLigas);
      // Autoseleccionar la primera liga si no hay ninguna escogida
      if (dataLigas.length > 0 && !ligaFiltro) setLigaFiltro(dataLigas[0].id);
    }
  };

  useEffect(() => { 
    socketRef.current = io(SOCKET_URL);
    cargarDatosOficial(); 
    return () => socketRef.current?.disconnect(); 
  }, [usuario]);

  // EFECTO QUE HACE AVANZAR EL RELOJ DEL ÁRBITRO
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

    // ESCUCHAR SEÑAL DEL RELOJ DEL ANOTADOR
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

  const enviarMensajeComoOficial = (e) => {
    e.preventDefault();
    if (!nuevoMensaje.trim()) return;
    const esParaDelegado = destinatarioMsg.includes('delegado');
    socketRef.current.emit('enviar_mensaje', { destinatario_sala: destinatarioMsg, cc_admin: esParaDelegado, remitente: `${usuario?.nombre || ''} (Árbitro)`, mensaje: nuevoMensaje, timestamp: new Date().toLocaleTimeString('es-VE') });
    setMensajes(prev => [...prev, { destinatario_sala: destinatarioMsg, remitente: 'Árbitro (Tú)', mensaje: nuevoMensaje, timestamp: new Date().toLocaleTimeString('es-VE'), propio: true }]);
    setNuevoMensaje('');
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

      // --- NUEVO: ENVIAR MENSAJE A LA BANDEJA DE ENTRADA DEL ADMINISTRADOR ---
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
      localStorage.removeItem('partidoActivoId'); // NUEVO: LIMPIAR AL SUSPENDER
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
      
      {modalSorteo && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1500 }}>
          <div style={{ background: '#FFF', padding: '25px', borderRadius: '8px', width: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h3 style={{ marginTop: 0 }}>🪙 Sorteo Oficial</h3>
            <textarea placeholder="Ej: Equipo Reputation gana mingo..." value={sorteoTexto} onChange={e => setSorteoTexto(e.target.value)} style={{ width: '100%', height: '100px', padding: '10px', marginBottom: '15px', border: '1px solid #CBD5E0', borderRadius: '4px' }} />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={guardarSorteo} style={{ flex: 1, padding: '10px', background: '#3182CE', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>Guardar Acta</button>
              <button onClick={() => setModalSorteo(null)} style={{ padding: '10px', background: '#E2E8F0', border: 'none', borderRadius: '4px' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', borderBottom: '2px solid #E2E8F0', paddingBottom: '15px', flexWrap: 'wrap', gap: '15px' }}>
        <h1 style={{ margin: 0, color: '#2D3748' }}>⚖️ Autoridad de Campo (Árbitro)</h1>
        
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
              <div key={p.id} style={{ background: '#FFF', border: '1px solid #CBD5E0', borderRadius: '8px', padding: '15px', marginBottom: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize: '1.1em', fontWeight: 'bold', marginBottom: '10px' }}>{p.local_nombre} vs {p.visita_nombre}</div>
                <div style={{ fontSize: '0.85em', color: '#718096', marginBottom: '15px' }}>⌚ {new Date(p.fecha_hora).toLocaleTimeString('es-VE', {hour: '2-digit', minute:'2-digit'})} | 🏟️ {p.sede_nombre}</div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setModalSorteo(p.id)} style={{ flex: 1, padding: '10px', background: '#EDF2F7', border: '1px solid #CBD5E0', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>🪙 Sorteo</button>
                  <button onClick={() => seleccionarPartido(p)} style={{ flex: 1, padding: '10px', background: '#3182CE', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>⚡ Control</button>
                </div>
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
                <div style={{ fontSize: '0.8em', color: '#718096', marginBottom: '10px' }}>{p.estado} - {p.hora_final || 'Sin finalizar'}</div>
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
                socketRef.current?.emit('presencia_oficial', { partidoId: partidoActivo.id, rol: 'arbitro', estado: false }); 
                }} style={{ padding: '8px 15px', background: '#E2E8F0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>⬅️ Volver
              </button>
              
              <div style={{ display: 'flex', gap: '15px' }}>
                {partidoActivo.estado === 'Finalizado' && (
                  <button onClick={() => window.open(`/?vista=puntajes&partido_id=${partidoActivo.id}`, '_blank')} style={{ padding: '8px 15px', background: '#D69E2E', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>📄 Descargar Acta (PDF)</button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: anotadorConectado ? '#38A169' : '#E53E3E' }}></div>
                  <span style={{ fontWeight: 'bold', color: '#4A5568' }}>Anotador {anotadorConectado ? 'Conectado' : 'Ausente'}</span>
                </div>
              </div>
            </div>

            <div style={{ background: '#FEFCBF', padding: '10px', borderRadius: '4px', marginBottom: '15px', fontSize: '0.9em', color: '#975A16', border: '1px solid #F6E05E' }}>
              <strong>💡 Tip de Arbitraje:</strong> Todas las jugadas ingresadas son válidas por defecto. Si detecta un error, haga clic sobre la celda en la tabla para enviar una orden de corrección al Anotador.
            </div>

            <div id="acta-planilla-pdf">
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

          <div style={{ width: '320px', position: 'sticky', top: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            
            <div style={{ background: '#2D3748', color: '#FFF', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#A0AEC0' }}>⏱️ Tiempo de Lanzamiento</h3>
              <div style={{ fontSize: '3em', fontWeight: '900', fontFamily: 'monospace', color: tiempoTurno > 50 ? '#FC8181' : '#FFF' }}>
                {formatoT(tiempoTurno)}
              </div>
              <div style={{ fontSize: '0.9em', color: '#718096', marginTop: '10px' }}>
                Tiempo Total: <span style={{ fontWeight: 'bold', color: '#FFF' }}>{formatoT(tiempoGlobal)}</span>
              </div>
              <div style={{ fontSize: '0.7em', color: '#4A5568', marginTop: '10px' }}>*Controlado remotamente por el Anotador</div>
            </div>

            <div style={{ background: '#FFF', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 15px 0' }}>⚠️ Sanciones Disciplinarias</h3>
              <select value={jugadorSancionId} onChange={e => setJugadorSancionId(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #CBD5E0' }}>
                <option value="">Seleccione infractor...</option>
                {[...jugadoresLocal, ...jugadoresVisita].map(j => <option key={j.id} value={j.id}>#{j.numero_dorsal} {j.apellido}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => emitirTarjeta('Amarilla')} style={{ flex: 1, padding: '12px', background: '#D69E2E', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Amonestar 🟨</button>
                <button onClick={() => emitirTarjeta('Roja')} style={{ flex: 1, padding: '12px', background: '#E53E3E', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Expulsar 🟥</button>
              </div>
            </div>

            <div style={{ background: '#FFF', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 15px 0' }}>🛑 Control de Juego</h3>
              <p style={{ fontSize: '0.85em', color: '#718096', margin: '0 0 15px 0' }}>Utilice esta opción solo en caso de fuerza mayor (lluvia, falta de luz, etc).</p>
              <button onClick={suspenderPartido} style={{ width: '100%', padding: '12px', background: '#E53E3E', color: '#FFF', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Suspender Partido</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}