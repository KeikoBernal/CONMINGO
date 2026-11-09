import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { io } from 'socket.io-client';
import PlanillaUniversal from './PlanillaUniversal';
import ChipOffline from '../ChipOffline';
import { useEnLinea, leerCola, encolar, contarCola, procesarCola, reintentarFallidos } from '../ColaOffline'; // FASE D UX: cola offline del anotador
import SistemaMensajeria from './SistemaMensajeria';
import { TableTools, EMPTY_FILTER, rowMatchesFilter, usePaginacion, PaginacionTabla } from './HerramientasTabla'; // FASE A1 UX: paginacion compartida
import CalendarioPartidos from '../CalendarioPartidos';
import BotonModoSolar from '../BotonModoSolar';
import VotacionMvp from '../VotacionMvp';
import ConfirmarProtestas from '../ConfirmarProtestas';
import Sidebar from '../Sidebar'; // UX: barra lateral compartida (colapso, grupos, notificaciones)
import TourGuia, { tourPendiente, marcarTourVisto } from '../TourGuia';
import HeaderPanel from '../HeaderPanel'; // FASE 2 UX: encabezado compartido de los paneles
import NavIcon from '../NavIcon'; // FASE 2 UX: catalogo unico de iconos de navegacion
import FirmaCanvas from '../FirmaCanvas'; // LOTE 6D: firmas digitales del acta
import { useToasts, ToastContainer } from '../Toast'; // FASE 1 UX: notificaciones toast de marca
import EmptyState from '../EmptyState'; // FASE 1 UX: estado vacio de marca
import TarjetaResumen from '../TarjetaResumen'; // FASE B1 UX: tarjetas de resumen de la pestana Inicio
import ConfirmDialog from '../ConfirmDialog'; // FASE 1 UX: dialogo de confirmacion de marca
import ModoCancha from '../ModoCancha'; // FASE 3 UX: modo cancha para anotar a pie de cancha
import CronometroFlotante from '../CronometroFlotante'; // LOTE 8E UX: cronometro como isla flotante
import { SkeletonTarjetas } from '../SkeletonCarga'; // FASE 2 UX: esqueletos de carga de marca
import { tecladoModal } from '../Accesibilidad';
import { formatearFecha, formatearFechaHora, formatearHoraDeFecha, formatearHora, horaCanonica, fechaHoy } from '../fechas'; // LOTE FECHAS: formato unico dd/mm/aaaa y horas de 12 horas


const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
// LOTE 6B: VITE_SOCKET_URL puede llegar con el sufijo /api (la URL del REST, no la del
// socket). Socket.io interpreta el path del URI como NAMESPACE, asi que conectar a
// "/api" apuntaria al namespace /api (inexistente en el servidor) y cada handshake
// moriria con connect_error (aviso de "Conexion en tiempo real no disponible").
// Se normaliza quitando el sufijo: el socket siempre apunta a la raiz del servidor.
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000').replace(/\/api\/?$/, '');

export default function AnotadorDashboard({ usuario, cerrarSesion }) {
  // PESTAÑAS DEL PANEL LATERAL: 'hoy' | 'proximos' | 'historial'
  const [pestana, setPestana] = useState('inicio'); // FASE B1 UX: el panel abre siempre en la pestana Inicio
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [tourActivo, setTourActivo] = useState(() => tourPendiente('anotador'));
  const cerrarTour = () => {
    marcarTourVisto('anotador');
    setTourActivo(false);
  };

  // FASE 1 UX: toasts y dialogo de confirmacion en vez de alert/confirm nativos
  const { toasts, mostrarToast, cerrarToast } = useToasts();
  const [confirmacion, setConfirmacion] = useState(null);
  const pedirConfirmacion = (titulo, mensaje, tipo) =>
    new Promise((resolver) => setConfirmacion({ titulo, mensaje, tipo, resolver }));

  const [partidos, setPartidos] = useState([]);
  // LOTE PDF MARCA: organizacion (nombre y logo) para los encabezados de los PDF.
  const [orgLiga, setOrgLiga] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${API_URL}/operativo/mi-organizacion`, { headers: { Authorization: 'Bearer ' + (session ? session.access_token : '') } });
        if (res.ok) setOrgLiga(await res.json());
      } catch (e) { /* sin organizacion los PDF salen con la marca base */ }
    })();
  }, []);
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
  const [cargando, setCargando] = useState(false); // FASE 3C UX: esqueletos mientras llegan los partidos del oficial
  const [cargandoPartido, setCargandoPartido] = useState(false); // FASE 3C UX: candado del boton Abrir Planilla
  const socketRef = useRef(null);
  const partidoActivoRef = useRef(null); // LOTE T: espejo de partidoActivo para la reconexion del socket
  const estadoPlanillaRef = useRef(null); // LOTE T: ultima planilla local con datos, para resincronizar tras reconexion
  const avisoSocketDadoRef = useRef(false); // LOTE T: aviso de caida del tiempo real mostrado una sola vez
  const [firmasActa, setFirmasActa] = useState({ exigibles: [], firmas: [], faltantes: [] }); // LOTE 6D: estado de las firmas del acta
  const [modalFirma, setModalFirma] = useState(null); // LOTE 6D: rol de la firma que se esta dibujando

  // FASE 3 UX: vista del partido activo. En pantallas chicas el modo cancha es la
  // vista natural (a pie de cancha, botones grandes); en escritorio, la planilla.
  // La eleccion manual queda recordada para la proxima sesion.
  const [modoCancha, setModoCancha] = useState(() => {
    const preferencia = localStorage.getItem('anotadorModoVista');
    if (preferencia === 'cancha' || preferencia === 'planilla') return preferencia === 'cancha';
    return window.innerWidth < 1024;
  });
  const cambiarModoVista = (aCancha) => {
    setModoCancha(aCancha);
    localStorage.setItem('anotadorModoVista', aCancha ? 'cancha' : 'planilla');
  };
  // FASE 3 UX: estado del socket siempre visible (antes solo un toast unico al caer)
  const [socketConectado, setSocketConectado] = useState(false);

  const [token, setToken] = useState(null);

  // FASE D UX: modo offline del anotador. Sin senal la planilla se sigue anotando;
  // iniciar, manos y firmas se guardan en este dispositivo y se reenvian al reconectar.
  const enLinea = useEnLinea();
  const [colaOffline, setColaOffline] = useState(() => contarCola('anotador'));
  const [reintentandoCola, setReintentandoCola] = useState(false);
  const refrescarCola = () => setColaOffline(contarCola('anotador'));
  const reintentarColaFallidos = async () => {
    reintentarFallidos('anotador');
    refrescarCola();
    setReintentandoCola(true);
    const resumen = await procesarCola('anotador', fetchConToken);
    setReintentandoCola(false);
    refrescarCola();
    if (resumen.enviados > 0) {
      mostrarToast(resumen.enviados + (resumen.enviados === 1 ? ' envio sincronizado con el servidor.' : ' envios sincronizados con el servidor.'), 'exito');
      cargarDatosOficial();
    }
    if (contarCola('anotador').fallidos > 0) mostrarToast('El envio sigue rechazado por el servidor. Comunicalo al AdminLiga si persiste.', 'error');
  };
  useEffect(() => {
    refrescarCola();
    if (!enLinea) return;
    if (leerCola('anotador').length === 0) return;
    let vivo = true;
    (async () => {
      mostrarToast('Enviando lo guardado en este dispositivo...', 'info');
      const resumen = await procesarCola('anotador', fetchConToken);
      if (!vivo) return;
      refrescarCola();
      if (resumen.enviados > 0) {
        mostrarToast(resumen.enviados + (resumen.enviados === 1 ? ' envio sincronizado con el servidor.' : ' envios sincronizados con el servidor.'), 'exito');
        cargarDatosOficial();
      }
      if (resumen.fallidos > 0) mostrarToast('Un envio fallo al reconectar y quedo en espera. Usa Reintentar en el aviso.', 'error');
    })();
    return () => { vivo = false; };
  }, [enLinea]);

  // --- ESTADOS MULTILIGA ---
  const [ligas, setLigas] = useState([]);
  const [ligaFiltro, setLigaFiltro] = useState('');

  // Filtrado, busqueda y descargas de las tablas del modulo
  const [filtrosTablas, setFiltrosTablas] = useState({});
  const getFilter = key => filtrosTablas[key] || EMPTY_FILTER;
  const setTableFilter = key => next => setFiltrosTablas(previous => ({ ...previous, [key]: next }));
  const filtrarTabla = (key, rows, categoryFields = [], dateFields = []) => rows.filter(row => rowMatchesFilter(row, getFilter(key), categoryFields, dateFields));

  useEffect(() => {
    localStorage.setItem('anotadorPestana', pestana);
  }, [pestana]);

  // LOTE T: espejos en refs para que los handlers del socket lean valores frescos
  // (el efecto de conexion se monta una sola vez y su closure quedaria viejo).
  useEffect(() => { partidoActivoRef.current = partidoActivo; }, [partidoActivo]);
  useEffect(() => {
    estadoPlanillaRef.current = (Object.keys(efectividadJugadores).length > 0 || puntosPorManoLocal.some(p => p !== '') || puntosPorManoVisita.some(p => p !== ''))
      ? { efectividad: efectividadJugadores, manualStats, tantosLocal: puntosPorManoLocal, tantosVisita: puntosPorManoVisita }
      : null;
  }, [efectividadJugadores, manualStats, puntosPorManoLocal, puntosPorManoVisita]);

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
    setCargando(true); // FASE 3C UX: esqueleto de carga mientras llegan los partidos
    // FASE D UX: sin senal no se puede pedir la lista al servidor; si hay un acta
    // abierta respaldada en este dispositivo, se retoma completa desde el backup local.
    if (!enLinea) {
      const savedPartidoId = localStorage.getItem('partidoActivoId');
      const localData = savedPartidoId ? localStorage.getItem(`backup_partido_${savedPartidoId}`) : null;
      if (savedPartidoId && localData) {
        const parsed = JSON.parse(localData);
        if (parsed.partido) {
          setPartidoActivo(parsed.partido);
          setJugadoresLocal(parsed.nominaLocal || []);
          setJugadoresVisita(parsed.nominaVisita || []);
          setEfectividadJugadores(parsed.efectividadJugadores || {});
          setManualStats(parsed.manualStats || {});
          setPuntosPorManoLocal(parsed.puntosPorManoLocal || Array(20).fill(''));
          setPuntosPorManoVisita(parsed.puntosPorManoVisita || Array(20).fill(''));
          mostrarToast('Sin conexion: se retomo el acta guardada en este dispositivo. Los cambios se enviaran al reconectar.', 'info');
        }
      }
      setCargando(false);
      return;
    }
    try {
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
    } finally {
      setCargando(false);
    }
  };

    useEffect(() => {
    // FIX #6: se conecta con el token de Supabase; el servidor valida la identidad.
    let cancelado = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelado) return;
      socketRef.current = io(SOCKET_URL, {
        transports: ['websocket'],
        upgrade: false,
        auth: { token: session?.access_token }
      });
      cargarDatosOficial();

      // LOTE T: reconexion automatica. Cuando Render reinicia el proceso, el socket se reconecta
      // solo, pero antes nadie re-emitia unirse_partido ni presencia_oficial: la sincronizacion
      // moria en silencio hasta refrescar la pagina. Al reconectar: re-entrar a la sala,
      // re-anunciar presencia y, si hay datos locales, resincronizar la planilla en el servidor.
      socketRef.current.on('connect', () => {
        setSocketConectado(true);
        avisoSocketDadoRef.current = false; // LOTE 6B: la reconexion (p. ej. tras un deploy de Render) fue exitosa; el proximo corte de conexion vuelve a avisar
        const activo = partidoActivoRef.current;
        if (!activo) return;
        socketRef.current.emit('unirse_partido', activo.id);
        socketRef.current.emit('presencia_oficial', { partidoId: activo.id, rol: 'anotador', estado: true });
        if (estadoPlanillaRef.current) {
          socketRef.current.emit('sincronizar_planilla_completa', { partido_id: activo.id, ...estadoPlanillaRef.current });
        }
      });

      socketRef.current.on('connect_error', () => {
        if (avisoSocketDadoRef.current) return;
        avisoSocketDadoRef.current = true;
        setSocketConectado(false);
        mostrarToast('Conexion en tiempo real no disponible. El sistema reintentara automaticamente; tu planilla local sigue protegida.', 'info');
      });

      socketRef.current.on('disconnect', () => setSocketConectado(false));
    })();

    return () => {
      cancelado = true;
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (partidoActivo && (Object.keys(efectividadJugadores).length > 0 || puntosPorManoLocal.some(p => p !== ''))) {
      // FASE D UX: el backup ahora incluye el partido y las nominas para poder
      // retomar el acta completa en este dispositivo incluso sin conexion.
      const backup = { partido: partidoActivo, nominaLocal: jugadoresLocal, nominaVisita: jugadoresVisita, efectividadJugadores, manualStats, puntosPorManoLocal, puntosPorManoVisita, timestamp: Date.now() };
      localStorage.setItem(`backup_partido_${partidoActivo.id}`, JSON.stringify(backup));
    }
  }, [efectividadJugadores, manualStats, puntosPorManoLocal, puntosPorManoVisita, partidoActivo]);

  // UX ajustes (pedido de Keiko): el simulador de partidos (pestana nueva)
  // puede enviar sus datos generados para aplicarlos a la planilla real del
  // partido activo. El simulador deja la carga en localStorage y aqui se
  // escucha el evento storage que el navegador dispara entre pestanas.
  const [simuladorPendiente, setSimuladorPendiente] = useState(null);

  useEffect(() => {
    const alCambiarAlmacenamiento = (evento) => {
      if (evento.key !== 'conmingo_simulador_export' || !evento.newValue) return;
      try { setSimuladorPendiente(JSON.parse(evento.newValue)); } catch { return; }
    };
    window.addEventListener('storage', alCambiarAlmacenamiento);
    return () => window.removeEventListener('storage', alCambiarAlmacenamiento);
  }, []);

  useEffect(() => {
    if (!simuladorPendiente) return;
    let vigente = true;
    (async () => {
      const carga = simuladorPendiente;
      const activo = partidoActivoRef.current;
      if (!activo) {
        mostrarToast('Para aplicar los datos del simulador, abre la planilla de un partido.', 'info');
      } else if (String(carga.partidoId) !== String(activo.uuid_publico || activo.id)) {
        mostrarToast('Los datos del simulador son de otro partido; no se aplicaron.', 'error');
      } else if (activo.estado === 'Finalizado' || activo.estado === 'Suspendido') {
        mostrarToast('El partido ya esta cerrado; no se pueden aplicar los datos del simulador.', 'error');
      } else {
        const aplicar = await pedirConfirmacion('Datos del simulador', 'Se reemplazara el contenido del acta en curso (lanzamientos, estadisticas y tantos por mano) con los datos generados por el simulador. Continuar?');
        if (aplicar) {
          const normalizarTantos = (tantos) => Array.from({ length: 20 }, (_, i) => (tantos && tantos[i] !== '' && tantos[i] != null ? String(tantos[i]) : ''));
          const efectividad = carga.efectividadJugadores || {};
          const stats = carga.manualStats || {};
          const tantosLocal = normalizarTantos(carga.puntosLocal);
          const tantosVisita = normalizarTantos(carga.puntosVisita);
          setEfectividadJugadores(efectividad);
          setManualStats(stats);
          setPuntosPorManoLocal(tantosLocal);
          setPuntosPorManoVisita(tantosVisita);
          socketRef.current?.emit('sincronizar_planilla_completa', { partido_id: activo.id, efectividad, manualStats: stats, tantosLocal, tantosVisita });
          mostrarToast('Datos del simulador aplicados al acta.', 'exito');
        }
      }
      if (vigente) setSimuladorPendiente(null);
    })();
    return () => { vigente = false; };
  }, [simuladorPendiente, mostrarToast, pedirConfirmacion]);

  useEffect(() => {
    let intGlobal, intTurno;
    if (cronometroGlobalActivo) intGlobal = setInterval(() => setTiempoGlobal(t => t + 1), 1000);
    if (cronometroTurnoActivo) intTurno = setInterval(() => setTiempoTurno(t => t + 1), 1000);
    return () => { clearInterval(intGlobal); clearInterval(intTurno); };
  }, [cronometroGlobalActivo, cronometroTurnoActivo]);

  const formatoT = (t) => `${Math.floor(t / 60).toString().padStart(2, '0')}:${(t % 60).toString().padStart(2, '0')}`;

  // LOTE 6D: estado de las firmas del acta (exigibles, firmadas y faltantes).
  const cargarFirmasActa = async (partidoId) => {
    try {
      const res = await fetchConToken(`/partidos/${partidoId}/firmas`);
      if (res.ok) setFirmasActa(await res.json());
    } catch (err) {
      // La seccion de firmas conserva el ultimo estado conocido.
    }
  };

  // FASE 3C UX: candado del boton Abrir Planilla; un doble toque duplicaria los listeners del socket
  const seleccionarPartido = async (partido) => {
    if (cargandoPartido) return;
    setCargandoPartido(true);
    try { await seleccionarPartidoBase(partido); } finally { setCargandoPartido(false); }
  };

  const seleccionarPartidoBase = async (partido) => {
    setArbitroConectado(false); // LOTE T: no heredar la presencia del partido anterior; el servidor envia la foto actual al unirse
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
          mostrarToast('El árbitro ha suspendido el partido. Los resultados hasta este momento se han guardado automáticamente. Serás redirigido al menú principal.', 'info');
          localStorage.removeItem('partidoActivoId');
          setPartidoActivo(null);
        } else {
          setPartidoActivo(prev => prev ? ({ ...prev, estado: data.estadoPartido }) : null);
        }
      }
    });

    socketRef.current.on('partido_finalizado_auto', (data) => {
      mostrarToast(`¡META ALCANZADA! El partido finalizo automaticamente al alcanzar el limite de tantos. Marcador final: ${data.marcador_local} - ${data.marcador_visita}`, 'exito');
      setPartidoActivo(prev => prev ? ({ ...prev, estado: 'Finalizado', hora_final: data.hora_final }) : null);
      setCronometroGlobalActivo(false); setCronometroTurnoActivo(false);
      localStorage.removeItem(`backup_partido_${data.partido_id}`); 
      localStorage.removeItem('partidoActivoId');
    });

    socketRef.current.on('error_validacion_jugada', (msg) => {
      mostrarToast(`ERROR DE VALIDACIÓN: ${msg}`, 'error');
    });

    socketRef.current.on('alerta_revision', (msg) => { mostrarToast(`SOLICITUD DEL ÁRBITRO: ${msg}`, 'info'); });

    socketRef.current.on('firma_acta', () => {
      cargarFirmasActa(partido.id); // LOTE 6D: el otro oficial registro una firma en su dispositivo
    });

    cargarFirmasActa(partido.id); // LOTE 6D: estado inicial de las firmas del acta
    const res = await fetchConToken(`/partidos/${partido.id}/nomina`);
    if (res.ok) {
      const todos = await res.json();
      setJugadoresLocal(todos.filter(j => j.equipo_id === partido.equipo_local_id));
      setJugadoresVisita(todos.filter(j => j.equipo_id === partido.equipo_visita_id));
    }

    const localData = localStorage.getItem(`backup_partido_${partido.id}`);
    if (localData && partido.estado !== 'Finalizado' && partido.estado !== 'Suspendido') {
      const parsed = JSON.parse(localData);
      if (await pedirConfirmacion('Restaurar planilla local', 'Se detectaron datos locales sin sincronizar para este partido. ¿Deseas restaurar la planilla desde tu navegador? (Ideal si perdiste conexión recientemente)')) {
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
    socketRef.current.emit('enviar_mensaje', { destinatario_sala: destinatarioMsg, cc_admin: esParaDelegado, remitente: `${usuario?.nombre || ''} (Anotador)`, mensaje: msgLimpio, timestamp: formatearHoraDeFecha(new Date()) });
    setMensajes(prev => [...prev, { destinatario_sala: destinatarioMsg, remitente: 'Anotador (Tú)', mensaje: msgLimpio, timestamp: formatearHoraDeFecha(new Date()), propio: true }]);
    setNuevoMensaje('');
  };

  const handleIniciarPartido = async () => {
    if (isSubmitting) return; // INSERCIÓN: Idempotencia
    setIsSubmitting(true);
    
    const hora = horaCanonica();
    if (!enLinea) {
      encolar('anotador', { metodo: 'PUT', ruta: `/partidos/${partidoActivo.id}/iniciar`, cuerpo: JSON.stringify({ hora_inicio: hora }), etiqueta: 'Iniciar partido' });
      refrescarCola();
      setIsSubmitting(false);
      setPartidoActivo(prev => ({ ...prev, estado: 'En Curso', hora_inicio: hora }));
      setCronometroGlobalActivo(true);
      return mostrarToast('Sin conexion: el inicio quedo registrado en este dispositivo. Se enviara al reconectar.', 'info');
    }
    const res = await fetchConToken(`/partidos/${partidoActivo.id}/iniciar`, { method: 'PUT', body: JSON.stringify({ hora_inicio: hora }) });
    
    setIsSubmitting(false);
    if (res.ok) {
      setPartidoActivo(prev => ({ ...prev, estado: 'En Curso', hora_inicio: hora }));
      setCronometroGlobalActivo(true);
      socketRef.current?.emit('partido_iniciado', { partidoId: partidoActivo.id, hora_inicio: hora });
      socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno, cronometroTurnoActivo, tiempoGlobal, cronometroGlobalActivo: true });
    }
  };

  // LOTE 4C (N3): persistencia del acta. Cada mano con jugadas o tantos se
  // envia al backend (upsert por numero de mano) con su detalle de
  // lanzamientos: A/a arrime, B/b boche de aire, R/r rastrero, N nulo.
  const guardarManosPersistidas = async () => {
    let guardadas = 0;
    let fallidas = 0;
    const mapaLanzamientos = { A: ['a', true], a: ['a', false], B: ['b', true], b: ['b', false], R: ['r', true], r: ['r', false], N: ['n', false] };
    for (let mIdx = 0; mIdx < 20; mIdx++) {
      const jugadas = [];
      for (const [jId, manos] of Object.entries(efectividadJugadores)) {
        const celda = manos && manos[mIdx];
        if (!celda) continue;
        const jugada = mapaLanzamientos[String(celda.valor || '')];
        if (jugada) jugadas.push({ jugador_id: parseInt(jId, 10), tipo_destreza: jugada[0], efectividad: jugada[1] });
      }
      const tantosLocal = parseInt(puntosPorManoLocal[mIdx], 10) || 0;
      const tantosVisita = parseInt(puntosPorManoVisita[mIdx], 10) || 0;
      if (jugadas.length === 0 && tantosLocal === 0 && tantosVisita === 0) continue;
      let ganadorId = null;
      let tantos = 0;
      if (tantosLocal > tantosVisita) { ganadorId = partidoActivo.equipo_local_id; tantos = tantosLocal; }
      else if (tantosVisita > tantosLocal) { ganadorId = partidoActivo.equipo_visita_id; tantos = tantosVisita; }
      if (!enLinea) {
        // FASE D UX: sin senal cada mano se guarda en la cola local; el backend hace
        // upsert por (partido, numero de mano), asi que el reenvio es idempotente.
        encolar('anotador', { metodo: 'POST', ruta: `/partidos/${partidoActivo.id}/manos`, cuerpo: JSON.stringify({ numero_mano: mIdx + 1, equipo_ganador_id: ganadorId, tantos_anotados: tantos, detalle_jugadas: jugadas }), etiqueta: 'Mano ' + (mIdx + 1) + ' del acta' });
        refrescarCola();
        guardadas++;
        continue;
      }
      try {
        const res = await fetchConToken(`/partidos/${partidoActivo.id}/manos`, { method: 'POST', body: JSON.stringify({ numero_mano: mIdx + 1, equipo_ganador_id: ganadorId, tantos_anotados: tantos, detalle_jugadas: jugadas }) });
        if (res.ok) guardadas++; else fallidas++;
      } catch (err) { fallidas++; }
    }
    return { guardadas, fallidas };
  };

  // LOTE 6D: registra la firma dibujada. El anotador firma su propio slot y
  // ademas recoge en su dispositivo las firmas de los delegados; el slot del
  // arbitro lo firma el arbitro desde su propio panel.
  const guardarFirmaActa = async (dataUrl) => {
    const rolFirma = modalFirma;
    setModalFirma(null);
    setIsSubmitting(true);
    if (!enLinea) {
      encolar('anotador', { metodo: 'POST', ruta: `/partidos/${partidoActivo.id}/firmas`, cuerpo: JSON.stringify({ rol_firma: rolFirma, imagen: dataUrl }), etiqueta: 'Firma del acta' });
      setFirmasActa(prev => ({ ...prev, firmas: [...(prev.firmas || []).filter(fr => fr.rol_firma !== rolFirma), { rol_firma: rolFirma, firmada: true }], faltantes: (prev.faltantes || []).filter(fl => fl !== rolFirma) }));
      refrescarCola();
      setIsSubmitting(false);
      return mostrarToast('Sin conexion: firma guardada en este dispositivo. Se enviara al reconectar.', 'info');
    }
    try {
      const res = await fetchConToken(`/partidos/${partidoActivo.id}/firmas`, { method: 'POST', body: JSON.stringify({ rol_firma: rolFirma, imagen: dataUrl }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFirmasActa(data.firmas || data);
        mostrarToast('Firma registrada en el acta.', 'exito');
      } else {
        mostrarToast(data.error || 'No se pudo registrar la firma.', 'error');
      }
    } catch (err) {
      mostrarToast('Error de conexión al registrar la firma.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const finalizarPartido = async () => {
    if (isSubmitting) return;
    // FASE D UX: el cierre del acta exige que el servidor valide las firmas exigibles;
    // sin conexion no se puede garantizar, asi que se bloquea con aviso claro.
    if (!enLinea) return mostrarToast('Finaliza el acta con conexion: el servidor valida las firmas exigibles antes de cerrar.', 'error');
    if (!(await pedirConfirmacion('Finalizar acta', '¿Cerrar acta y registrar hora final?'))) return;
    
    setIsSubmitting(true);
    // LOTE 4C (N3): se persisten las manos del acta (jugadas y tantos) antes
    // de cerrar el partido; es lo que alimenta las estadisticas individuales.
    const manosPersistidas = await guardarManosPersistidas();
    const hora = horaCanonica();
    const res = await fetchConToken(`/partidos/${partidoActivo.id}/finalizar`, { method: 'PUT', body: JSON.stringify({ hora_final: hora }) });
    // LOTE 6D: el backend rechaza el cierre si faltan firmas exigibles del acta.
    const dataFinal = await res.json().catch(() => ({}));
    setIsSubmitting(false);
    if (!res.ok && Array.isArray(dataFinal.firmas_faltantes) && dataFinal.firmas_faltantes.length > 0) {
      cargarFirmasActa(partidoActivo.id);
      mostrarToast('Faltan firmas del acta para finalizar: ' + dataFinal.firmas_faltantes.join(', ') + '. Recoge las firmas pendientes en este dispositivo o en el del árbitro y vuelve a intentar.', 'error');
      return;
    }
    if (res.ok) {
      setPartidoActivo(prev => ({ ...prev, estado: 'Finalizado', hora_final: hora }));
      setCronometroGlobalActivo(false); setCronometroTurnoActivo(false);
      socketRef.current?.emit('partido_finalizado', { partidoId: partidoActivo.id, hora_final: hora });
      socketRef.current?.emit('sync_cronometro', { partido_id: partidoActivo.id, tiempoTurno, cronometroTurnoActivo: false, tiempoGlobal, cronometroGlobalActivo: false });
      localStorage.removeItem(`backup_partido_${partidoActivo.id}`); 
      localStorage.removeItem('partidoActivoId');
      if (manosPersistidas.fallidas > 0) {
        mostrarToast(`${manosPersistidas.fallidas} mano(s) no pudieron guardarse en el acta (${manosPersistidas.guardadas} guardadas). Comunícalo al AdminLiga para completar el registro.`, 'error');
      }
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

  // FASE 3 UX: nucleo compartido entre el modal de la planilla y el modo cancha.
  const registrarLanzamientoEn = (jId, mIdx, valor) => {
    // LOTE T: actualizacion optimista local. Antes la celda dependia al 100% del eco del socket,
    // por lo que si el servidor se reiniciaba o el eco se perdia, el puntaje por mano se movia
    // pero la tabla de lanzamientos quedaba vacia. El eco del servidor llega despues y coincide.
    setEfectividadJugadores(prev => {
      const nuevo = { ...prev };
      if (!nuevo[jId]) nuevo[jId] = {};
      if (valor === '') delete nuevo[jId][mIdx];
      else nuevo[jId][mIdx] = { valor, estado: 'validado' };
      return nuevo;
    });
    socketRef.current?.emit('proponer_jugada', { partido_id: partidoActivo.id, jugador_id: jId, mano_index: mIdx, valor });
  };

  const registrarLanzamiento = (valor) => {
    const { jId, mIdx } = modalRegistro;
    registrarLanzamientoEn(jId, mIdx, valor);
    setModalRegistro(null);
  };

  // FASE 3 UX: nucleo compartido entre el modal de la planilla y el modo cancha.
  const asignarTantosMano = (esLocal, manoIdx, puntos) => {
    const ptsValidados = parseInt(puntos);
    if (isNaN(ptsValidados) || ptsValidados < 0 || ptsValidados > 6) {
      return mostrarToast('Error: Los tantos deben ser un valor entero entre 0 y 6.', 'error');
    }

    let nuevoLocal = [...puntosPorManoLocal], nuevoVisita = [...puntosPorManoVisita];
    const idx = parseInt(manoIdx)
    
    if (esLocal) { nuevoLocal[idx] = ptsValidados; nuevoVisita[idx] = 0; } 
    else { nuevoVisita[idx] = ptsValidados; nuevoLocal[idx] = 0; }
    
    setPuntosPorManoLocal(nuevoLocal); setPuntosPorManoVisita(nuevoVisita);
    socketRef.current?.emit('tantos_asignados', { partido_id: parseInt(partidoActivo.id), tantosLocal: nuevoLocal, tantosVisita: nuevoVisita });
  };

  const registrarTantosMano = (puntos) => {
    asignarTantosMano(modalTantos.esLocal, parseInt(modalTantos.manoIdx), puntos);
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
  const hoyFecha = fechaHoy();
  
  const partidosHoyBase = partidosFiltrados.filter(p => formatearFecha(p.fecha_hora) === hoyFecha && p.estado !== 'Finalizado' && p.estado !== 'Suspendido');
  const partidosAgendadosBase = partidosFiltrados.filter(p => formatearFecha(p.fecha_hora) !== hoyFecha && p.estado !== 'Finalizado');
  const partidosFinalizadosBase = partidosFiltrados.filter(p => p.estado === 'Finalizado' || p.estado === 'Suspendido');
  const partidosHoy = filtrarTabla('hoy', partidosHoyBase);
  const partidosAgendados = filtrarTabla('proximos', partidosAgendadosBase, [], ['fecha_hora']);
  const partidosFinalizados = filtrarTabla('historial', partidosFinalizadosBase, ['estado'], ['fecha_hora']);
  // FASE B1 UX: orientacion de la pestana Inicio (partido en juego o siguiente asignado).
  const partidoEnCurso = partidosFiltrados.find(p => p.estado === 'En Curso') || null;
  const proximoCompromiso = partidoEnCurso || partidosHoyBase[0] || partidosAgendadosBase[0] || null;
  const sedesCalendario = Object.fromEntries(partidosFiltrados.filter(p => p.sede_nombre).map(p => [p.id, p.sede_nombre]));

  // FASE A1 UX: los listados de temporada crecen sin control; se paginan del lado
  // del cliente igual que AdminLiga, Superadmin y Delegado (Fase 2).
  const pagProximos = usePaginacion(partidosAgendados);
  const pagHistorial = usePaginacion(partidosFinalizados);

  // Íconos para la barra lateral
  // FASE 2 UX: los iconos viven en el catalogo compartido; cada pestana mapea a un nombre
  const ICONOS_PESTANA = { inicio: 'inicio', hoy: 'calendario', proximos: 'reloj', historial: 'documento', votacion: 'votacion', protestas: 'protesta', calendario: 'calendario' };

  return (
    <div className="flex h-screen w-full bg-brand-cream font-sans overflow-hidden">
      
      <SistemaMensajeria usuario={usuario} token={token} ligaActivaId={ligaFiltro} />
      <ChipOffline enLinea={enLinea} pendientes={colaOffline.pendientes} fallidos={colaOffline.fallidos} reintentando={reintentandoCola} onReintentar={reintentarColaFallidos} />
      <ToastContainer toasts={toasts} onCerrar={cerrarToast} />
      <TourGuia rol="anotador" activo={tourActivo} onCerrar={cerrarTour} />
      <ConfirmDialog confirmacion={confirmacion} onCerrar={() => setConfirmacion(null)} />
      
      {/* MODAL REGISTRO JUGADAS (MESA DE ANOTACIÓN) */}
      {modalRegistro && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-1500 p-4" role="dialog" aria-modal="true" aria-label="Registro de jugada" onKeyDown={(evento) => tecladoModal(evento, () => setModalRegistro(null))}>
          <div className="bg-white p-6 rounded-xl w-full max-w-sm shadow-2xl animate-slide-up text-center border border-brand-gold/30">
            <h2 className="text-xl font-black text-brand-brown mb-5">Registro Mano #{modalRegistro.mIdx + 1}</h2>
            <div className="grid grid-cols-2 gap-3">
              <button autoFocus onClick={() => registrarLanzamiento('A')} className="py-4 bg-brand-blue text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-brand-brown transition-colors">A</button>
              <button onClick={() => registrarLanzamiento('a')} className="py-4 bg-red-500 text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-red-600 transition-colors">a <span className="text-sm block font-medium">Nulo</span></button>
              <button onClick={() => registrarLanzamiento('B')} className="py-4 bg-green-600 text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-green-700 transition-colors">B</button>
              <button onClick={() => registrarLanzamiento('b')} className="py-4 bg-red-500 text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-red-600 transition-colors">b <span className="text-sm block font-medium">Nulo</span></button>
                            {partidoActivo?.torneo_reglas?.registrar_boche_rastrero === true && (
                <>
                  <button onClick={() => registrarLanzamiento('R')} className="py-4 bg-brand-brown text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-brand-rust transition-colors">R</button>
                  <button onClick={() => registrarLanzamiento('r')} className="py-4 bg-red-500 text-white rounded-lg text-2xl font-bold shadow-sm hover:bg-red-600 transition-colors">r <span className="text-sm block font-medium">Nulo</span></button>
                </>
              )}
              <button onClick={() => registrarLanzamiento('N')} className="col-span-2 py-3 bg-gray-500 text-white rounded-lg text-xl font-bold shadow-sm hover:bg-gray-600 transition-colors">N <span className="text-sm font-medium ml-2">(Nulo General)</span></button>
              <button onClick={() => registrarLanzamiento('')} className="col-span-2 py-3 bg-gray-200 text-brand-brown rounded-lg font-bold hover:bg-gray-300 transition-colors mt-2">Borrar Celda</button>
            </div>
            <button onClick={() => setModalRegistro(null)} className="mt-5 w-full py-3 bg-transparent text-brand-brown font-bold hover:bg-brand-cream rounded-lg transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      {/* MODAL STATS MANUALES */}
      {modalStatPanel && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-1600 p-4" role="dialog" aria-modal="true" aria-label="Ajustar estadistica manual" onKeyDown={(evento) => tecladoModal(evento, () => setModalStatPanel(null))}>
          <div className="bg-white p-6 rounded-xl w-full max-w-xs shadow-2xl animate-slide-up text-center border border-brand-gold/30">
            <h3 className="text-lg font-bold text-brand-brown/70 mb-2">Ajustar {modalStatPanel.tipo}</h3>
            <div className="text-6xl font-black text-brand-brown my-6">{manualStats[modalStatPanel.jId]?.[modalStatPanel.tipo] || 0}</div>
            <div className="flex gap-4">
              <button autoFocus onClick={() => modificarStatManual(modalStatPanel.jId, modalStatPanel.tipo, -1)} className="flex-1 py-4 text-3xl bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-colors shadow-sm">-</button>
              <button onClick={() => modificarStatManual(modalStatPanel.jId, modalStatPanel.tipo, 1)} className="flex-1 py-4 text-3xl bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors shadow-sm">+</button>
            </div>
            <button onClick={() => setModalStatPanel(null)} className="mt-6 w-full py-3 bg-gray-200 text-brand-brown rounded-lg font-bold hover:bg-gray-300 transition-colors">Cerrar Panel</button>
          </div>
        </div>
      )}

      {/* MODAL ASIGNAR TANTOS */}
      {modalTantos && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-1500 p-4" role="dialog" aria-modal="true" aria-label="Asignar tantos" onKeyDown={(evento) => tecladoModal(evento, () => setModalTantos(null))}>
          <div className="bg-white p-6 rounded-xl w-full max-w-sm shadow-2xl animate-slide-up text-center border border-brand-gold/30">
            <h3 className="text-xl font-black text-brand-brown mb-5">Asignar Tantos - Mano #{modalTantos.manoIdx + 1}</h3>
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[0, 1, 2, 3, 4, 5, 6].map(p => (
                <button 
                  key={p} 
                  onClick={() => registrarTantosMano(p)} 
                  className={`py-4 text-white rounded-lg text-2xl font-bold shadow-sm transition-colors ${p === 0 ? 'bg-gray-400 hover:bg-gray-500' : 'bg-brand-blue hover:bg-brand-brown'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button autoFocus onClick={() => setModalTantos(null)} className="w-full py-3 bg-gray-200 text-brand-brown rounded-lg font-bold hover:bg-gray-300 transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      {/* UX: barra lateral compartida (se colapsa en escritorio, menu deslizante en movil) */}
      <Sidebar
        titulo="Anotador Oficial"
        subtitulo="Mesa Técnica"
        onCerrarSesion={cerrarSesion}
        extras={<>
          <BotonModoSolar className="w-full" />
          {ligas.length > 0 && (
            <select
              value={ligaFiltro}
              onChange={(e) => setLigaFiltro(e.target.value)}
              className="w-full p-2 bg-brand-cream/10 border border-brand-gold/30 rounded-lg text-xs font-bold text-brand-cream focus:ring-2 focus:ring-brand-rust outline-none shadow-sm cursor-pointer"
            >
              {ligas.map(l => <option key={l.id} value={l.id}>Liga: {l.nombre}</option>)}
            </select>
          )}
        </>}

        grupos={[
          { etiqueta: 'Panel', items: [
            { id: 'inicio', label: 'Inicio' },
          ]},
          { etiqueta: 'Partidos', items: [
            { id: 'hoy', label: 'Hoy', badge: partidosHoy.length },
            { id: 'proximos', label: 'Próximos', badge: partidosAgendados.length },
            { id: 'historial', label: 'Historial Reciente', badge: partidosFinalizados.length },
            { id: 'calendario', label: 'Calendario', badge: partidosFiltrados.length },
          ]},
          { etiqueta: 'Cierre de Jornada', items: [
            { id: 'votacion', label: 'Votación MVP' },
            { id: 'protestas', label: 'Protestas' },
          ]},
        ]}
        pestana={pestana}
        onPestana={(id) => { setPestana(id); setMenuAbierto(false); }}
        renderIcono={(id) => <NavIcon nombre={ICONOS_PESTANA[id]} />}
        menuAbierto={menuAbierto}
        onCerrarMenu={() => setMenuAbierto(false)}
        claveColapso="anotadorSidebarColapsada"
        onVerGuia={() => setTourActivo(true)}
      />

      {/* CONTENEDOR PRINCIPAL */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-brand-cream relative overflow-y-auto">
        
        {/* HEADER SUPERIOR */}
        <HeaderPanel
          tituloMovil
          titulo={partidoActivo ? `Planilla Oficial: ${partidoActivo.local_nombre} vs ${partidoActivo.visita_nombre}` : (pestana === 'inicio' ? 'Inicio' : pestana === 'hoy' ? 'Partidos de Hoy' : pestana === 'proximos' ? 'Próximos Partidos' : pestana === 'calendario' ? 'Calendario de Partidos' : pestana === 'votacion' ? 'Votación MVP' : pestana === 'protestas' ? 'Protestas' : 'Historial Reciente')}
          onAbrirMenu={() => setMenuAbierto(true)}
        />

        {/* CONTENIDO DE LAS PESTAÑAS O PARTIDO ACTIVO */}
        <div className="p-4 md:p-6 flex-1">
          {!partidoActivo ? (
            <div className="max-w-5xl mx-auto">
              
{pestana === 'inicio' && (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="text-lg font-bold text-brand-blue border-b-2 border-brand-blue/30 pb-2 flex items-center gap-2">
                    <NavIcon nombre="inicio" className="w-5 h-5" />
                    Resumen del dia
                  </h3>
                  {cargando && !proximoCompromiso ? (
                    <SkeletonTarjetas cantidad={1} clasesGrid="grid grid-cols-1 gap-4" />
                  ) : proximoCompromiso ? (
                    <div className="bg-white rounded-lg border-l-4 border-brand-blue border-y border-r border-y-brand-gold/20 border-r-brand-gold/20 p-5 shadow-sm">
                      <div className="text-xs font-bold uppercase tracking-wide text-brand-brown/60 mb-2">{partidoEnCurso ? 'Partido en juego ahora' : 'Tu proximo compromiso'}</div>
                      <div className="text-lg font-black text-brand-brown leading-tight">{proximoCompromiso.local_nombre} <span className="text-brand-rust mx-1 text-sm">vs</span> {proximoCompromiso.visita_nombre}</div>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-brand-brown/70 font-medium">
                        <span>{formatearHoraDeFecha(proximoCompromiso.fecha_hora)}</span>
                        <span>{proximoCompromiso.sede_nombre}</span>
                        {proximoCompromiso.estado ? <span className="bg-brand-cream/60 text-brand-brown px-2 py-0.5 rounded-full text-xs font-bold uppercase">{proximoCompromiso.estado}</span> : null}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <button onClick={() => seleccionarPartido(proximoCompromiso)} disabled={cargandoPartido} className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-brown transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{cargandoPartido ? 'Abriendo...' : partidoEnCurso ? 'Retomar planilla' : 'Abrir Planilla'}</button>
                        <button onClick={() => setPestana('hoy')} className="bg-white border border-brand-gold/40 text-brand-brown px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm">Ver encuentros de hoy</button>
                      </div>
                    </div>
                  ) : (
                    <EmptyState titulo="Sin encuentros asignados" descripcion="Cuando la liga agende partidos con usted como anotador, el proximo compromiso aparecera aqui." icono="calendario" />
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <TarjetaResumen icono="calendario" titulo="Partidos de hoy" valor={partidosHoy.length} texto="Encuentros programados para hoy." onClick={() => setPestana('hoy')} textoAccion="Ir a Hoy" />
                    <TarjetaResumen icono="reloj" titulo="Proximos asignados" valor={partidosAgendados.length} texto="Compromisos futuros de la temporada." onClick={() => setPestana('proximos')} textoAccion="Ir a Proximos" />
                    <TarjetaResumen icono="documento" titulo="Historial" valor={partidosFinalizados.length} texto="Partidos finalizados o suspendidos." onClick={() => setPestana('historial')} textoAccion="Ir al Historial" />
                  </div>
                </div>
              )}

              {/* PESTAÑA: PARTIDOS DE HOY */}
              {pestana === 'hoy' && (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="text-lg font-bold text-brand-blue border-b-2 border-brand-blue/30 pb-2 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Encuentros Programados para Hoy
                  </h3>
                  <TableTools rows={partidosHoyBase} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={partidosHoy} filter={getFilter('hoy')} setFilter={setTableFilter('hoy')} columns={[{ key: 'fecha_hora', label: 'Fecha' }, { key: 'local_nombre', label: 'Local' }, { key: 'visita_nombre', label: 'Visitante' }, { key: 'sede_nombre', label: 'Sede' }, { key: 'estado', label: 'Estado' }]} filename="anotador_partidos_hoy" modulo="Anotador oficial" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                  {cargando && partidosHoy.length === 0 ? (
                    <SkeletonTarjetas cantidad={4} clasesGrid="grid grid-cols-1 md:grid-cols-2 gap-4" />
                  ) : partidosHoy.length === 0 ? (
                    <EmptyState
                      titulo="Sin partidos hoy"
                      descripcion="No hay partidos agendados para el día de hoy. Revisa el calendario o vuelve mas tarde."
                      icono="calendario"
                    />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {partidosHoy.map(p => (
                        <div key={p.id} className="bg-white border-l-4 border-brand-blue border-y border-r border-y-brand-gold/20 border-r-brand-gold/20 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                          <div className="absolute top-0 right-0 bg-brand-blue/10 text-brand-blue text-[0.65rem] font-bold px-2 py-1 rounded-bl-lg uppercase tracking-wider">Hoy</div>
                          <div className="text-lg font-black text-brand-brown mb-3 leading-tight pr-8">{p.local_nombre} <span className="text-brand-rust mx-1 text-sm">vs</span> {p.visita_nombre}</div>
                          
                          <div className="space-y-1.5 mb-5">
                            <div className="flex items-center gap-2 text-sm text-brand-brown/70 font-medium">
                              <svg className="w-4 h-4 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              {formatearHoraDeFecha(p.fecha_hora)}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-brand-brown/70 font-medium">
                              <svg className="w-4 h-4 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                              {p.sede_nombre}
                            </div>
                          </div>

                          <button onClick={() => seleccionarPartido(p)} disabled={cargandoPartido} className="w-full bg-brand-blue text-white py-2.5 rounded-lg text-sm font-bold hover:bg-brand-brown transition-colors flex justify-center items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            {cargandoPartido ? 'Abriendo...' : 'Abrir Planilla de Anotación'}
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
                  <TableTools rows={partidosAgendadosBase} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={partidosAgendados} filter={getFilter('proximos')} setFilter={setTableFilter('proximos')} columns={[{ key: 'fecha_hora', label: 'Fecha' }, { key: 'local_nombre', label: 'Local' }, { key: 'visita_nombre', label: 'Visitante' }, { key: 'sede_nombre', label: 'Sede' }, { key: 'estado', label: 'Estado' }]} dateFields={['fecha_hora']} filename="anotador_proximos_partidos" modulo="Anotador oficial" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                  {cargando && partidosAgendados.length === 0 ? (
                    <SkeletonTarjetas cantidad={4} clasesGrid="grid grid-cols-1 md:grid-cols-2 gap-4" />
                  ) : partidosAgendados.length === 0 ? (
                    <EmptyState
                      titulo="Sin próximos partidos"
                      descripcion="No hay partidos agendados después de hoy en el calendario de tus ligas."
                      icono="reloj"
                    />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {pagProximos.filasPagina.map(p => (
                        <div key={p.id} className="bg-white border-l-4 border-brand-gold border-y border-r border-y-brand-gold/20 border-r-brand-gold/20 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow relative">
                          <div className="font-bold text-brand-brown mb-1.5 leading-tight">{p.local_nombre} <span className="text-brand-rust mx-1 text-xs">vs</span> {p.visita_nombre}</div>
                          <div className="flex items-center gap-2 text-xs font-semibold text-brand-brown/60">
                            <svg className="w-3.5 h-3.5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            {formatearFechaHora(p.fecha_hora)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <PaginacionTabla {...pagProximos} />
                </div>
              )}

              {/* PESTAÑA: CALENDARIO DE PARTIDOS */}
              {pestana === 'calendario' && (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="text-lg font-bold text-brand-brown/70 border-b-2 border-brand-brown/20 pb-2 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Calendario de Partidos
                  </h3>
                  {cargando && partidosFiltrados.length === 0 ? (
                    <SkeletonTarjetas cantidad={6} clasesGrid="grid grid-cols-1 md:grid-cols-2 gap-4" />
                  ) : partidosFiltrados.length === 0 ? (
                    <EmptyState
                      titulo="Calendario vacío"
                      descripcion="No hay partidos para mostrar en el calendario."
                      icono="calendario"
                    />
                  ) : (
                    <CalendarioPartidos partidos={partidosFiltrados} sedesPorPartido={sedesCalendario} />
                  )}
                </div>
              )}

              {/* PESTAÑA: VOTACION MVP (LOTE 4C N3) */}
              {pestana === 'votacion' && (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="text-lg font-bold text-brand-rust border-b-2 border-brand-rust/30 pb-2">Votación MVP del Torneo</h3>
                  <VotacionMvp />
                </div>
              )}

              {/* PESTAÑA: PROTESTAS (LOTE 4D P1) */}
              {pestana === 'protestas' && (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="text-lg font-bold text-brand-rust border-b-2 border-brand-rust/30 pb-2">Protestas por confirmar</h3>
                  <ConfirmarProtestas fetchConToken={fetchConToken} />
                </div>
              )}

              {/* PESTAÑA: HISTORIAL RECIENTE */}
              {pestana === 'historial' && (
                <div className="space-y-4 animate-fade-in">
                  <h3 className="text-lg font-bold text-brand-brown/70 border-b-2 border-brand-brown/20 pb-2 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Historial Reciente y Archivo
                  </h3>
                  <TableTools rows={partidosFinalizadosBase} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={partidosFinalizados} filter={getFilter('historial')} setFilter={setTableFilter('historial')} columns={[{ key: 'fecha_hora', label: 'Fecha' }, { key: 'local_nombre', label: 'Local' }, { key: 'visita_nombre', label: 'Visitante' }, { key: 'sede_nombre', label: 'Sede' }, { key: 'estado', label: 'Estado' }]} categoryFields={['estado']} dateFields={['fecha_hora']} filename="anotador_historial_partidos" modulo="Anotador oficial" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                  {cargando && partidosFinalizados.length === 0 ? (
                    <SkeletonTarjetas cantidad={4} clasesGrid="grid grid-cols-1 md:grid-cols-2 gap-4" />
                  ) : partidosFinalizados.length === 0 ? (
                    <EmptyState
                      titulo="Historial vacío"
                      descripcion="Aún no hay partidos finalizados ni suspendidos en tus ligas."
                      icono="documento"
                    />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {pagHistorial.filasPagina.map(p => (
                        <div key={p.id} className="bg-white border border-brand-gold/30 rounded-xl p-4 shadow-sm">
                          <div className="font-bold text-brand-brown mb-1 leading-tight">{p.local_nombre} <span className="text-brand-rust mx-1 text-xs">vs</span> {p.visita_nombre}</div>
                          <div className="flex items-center gap-2 text-xs font-semibold text-brand-brown/60 mb-3">
                            <span className={`px-2 py-0.5 rounded-full text-[0.65rem] uppercase tracking-wider text-white ${p.estado === 'Finalizado' ? 'bg-brand-blue' : 'bg-red-500'}`}>
                              {p.estado}
                            </span>
                            • {p.hora_final ? formatearHora(p.hora_final) : 'Sin hora'}
                          </div>
                          <button onClick={() => window.open(`/?vista=puntajes&partido_id=${p.id}`, '_blank')} className="w-full bg-white text-brand-brown py-2 rounded-lg border border-brand-gold/40 text-xs font-bold hover:bg-brand-rust hover:text-white transition-colors flex justify-center items-center gap-2 shadow-sm">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            Ver Acta / Descargar PDF
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <PaginacionTabla {...pagHistorial} />
                </div>
              )}

            </div>
          ) : modoCancha ? (
            <ModoCancha
              partido={partidoActivo}
              jugadoresLocal={jugadoresLocal}
              jugadoresVisita={jugadoresVisita}
              efectividadJugadores={efectividadJugadores}
              puntosPorManoLocal={puntosPorManoLocal}
              puntosPorManoVisita={puntosPorManoVisita}
              tiempoTurno={tiempoTurno}
              tiempoGlobal={tiempoGlobal}
              cronometroTurnoActivo={cronometroTurnoActivo}
              arbitroConectado={arbitroConectado}
              socketConectado={socketConectado}
              formatoT={formatoT}
              onToggleTurno={toggleTurno}
              onResetTurno={resetTurno}
              onRegistrarJugada={registrarLanzamientoEn}
              onAsignarTantos={asignarTantosMano}
              isSubmitting={isSubmitting}
              onIniciar={handleIniciarPartido}
              onFinalizar={finalizarPartido}
              onVerPlanilla={() => cambiarModoVista(false)}
              onVolverPanel={() => {
                localStorage.removeItem('partidoActivoId');
                setPartidoActivo(null);
                socketRef.current?.emit('presencia_oficial', { partidoId: partidoActivo.id, rol: 'anotador', estado: false });
              }}
            />
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
                    <button onClick={() => cambiarModoVista(true)} className="bg-brand-blue text-white px-4 py-2 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-sm flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                      Modo Cancha
                    </button>
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

                {/* ACCIONES PRINCIPALES DEL PARTIDO: iniciar y finalizar quedan a la
                    cima de la planilla, ordenados por prioridad de uso (pedido de Keiko). */}
                {partidoActivo.estado !== 'Finalizado' && partidoActivo.estado !== 'Suspendido' && (
                  <div className="flex gap-2 items-stretch mb-4">
                    {partidoActivo.estado === 'Agendado' && (
                      <button
                        onClick={handleIniciarPartido}
                        disabled={isSubmitting}
                        className={`min-w-0 flex-1 py-4 rounded-xl text-lg font-black tracking-wider transition-colors shadow-md flex justify-center items-center gap-2 text-white ${isSubmitting ? 'bg-gray-400 opacity-70 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                      >
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                        {isSubmitting ? 'INICIANDO...' : 'INICIAR PARTIDO'}
                      </button>
                    )}
                    {partidoActivo.estado === 'En Curso' && (
                      <button
                        onClick={finalizarPartido}
                        disabled={isSubmitting}
                        className={`min-w-0 flex-1 py-4 rounded-xl text-lg font-black tracking-wider transition-colors shadow-md flex justify-center items-center gap-2 text-white ${isSubmitting ? 'bg-gray-400 opacity-70 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'}`}
                      >
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" /></svg>
                        {isSubmitting ? 'FINALIZANDO...' : 'FINALIZAR ACTA'}
                      </button>
                    )}
                    <button
                      onClick={() => window.open('/?vista=simulador' + (partidoActivo ? '&partido_id=' + (partidoActivo.uuid_publico || partidoActivo.id) : ''), '_blank')}
                      title="Simulador de Partidos (nueva pestaña)"
                      aria-label="Simulador de Partidos (nueva pestaña)"
                      className="w-14 shrink-0 py-4 rounded-xl bg-brand-blue text-white text-[0.65rem] font-bold tracking-wider hover:bg-brand-brown transition-colors shadow-md flex flex-col justify-center items-center gap-1"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 12m9 0a9 9 0 11-18 0 9 9 0 0118 0M12 12m5 0a5 5 0 11-10 0 5 5 0 0110 0M12 12m1 0a1 1 0 11-2 0 1 1 0 012 0" /></svg>
                      Simulador
                    </button>
                  </div>
                )}

                <div id="acta-planilla-pdf">
                  <PlanillaUniversal
                    rol={partidoActivo.estado === 'Finalizado' ? 'espectador' : 'anotador'}
                    nombreLiga={orgLiga?.nombre || ''}
                    logoLiga={orgLiga?.logo_url || null}
                    estadoPartido={partidoActivo.estado}
                    partidoId={partidoActivo.id}
                    datosPartido={{ arbitro: partidoActivo.arbitro_nombre, anotador: partidoActivo.anotador_nombre, capitanLocal: partidoActivo.capitan_local_nombre, capitanVisita: partidoActivo.capitan_visita_nombre, localNombre: partidoActivo.local_nombre, visitaNombre: partidoActivo.visita_nombre, fecha: formatearFecha(partidoActivo.fecha_hora), horaInicio: partidoActivo.hora_inicio, horaFinal: partidoActivo.hora_final }}
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

                {/* FIRMAS DIGITALES DEL ACTA (LOTE 6D) */}
                {partidoActivo.estado !== 'Finalizado' && partidoActivo.estado !== 'Suspendido' && (
                  <div className="bg-white p-5 rounded-xl border border-brand-gold/30 shadow-sm">
                    <h3 className="text-base font-bold text-brand-brown mb-1">Firmas del Acta</h3>
                    <p className="text-[0.7rem] text-brand-brown/60 mb-3">Sin las firmas exigibles el acta no se puede finalizar. Los delegados firman aquí entregando este dispositivo al responsable de cada equipo.</p>
                    <div className="space-y-2">
                      {(firmasActa.firmas || []).map(f => {
                        const etiquetaFirma = f.rol_firma === 'arbitro' ? 'Árbitro' : f.rol_firma === 'anotador' ? 'Anotador' : f.rol_firma === 'delegado_local' ? 'Delegado ' + (partidoActivo.local_nombre || 'Local') : 'Delegado ' + (partidoActivo.visita_nombre || 'Visita');
                        const firmableAqui = f.rol_firma !== 'arbitro';
                        return (
                          <div key={f.rol_firma} className="flex items-center justify-between gap-2 border border-brand-gold/20 rounded-lg px-3 py-2">
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-brand-brown truncate">{etiquetaFirma}</div>
                              <div className={'text-[0.65rem] ' + (f.firmada ? 'text-green-700' : 'text-brand-brown/50')}>
                                {f.firmada ? 'Firmada' + (f.registrada_por_nombre ? ' por ' + f.registrada_por_nombre : '') : (f.exigible ? 'Pendiente (obligatoria)' : 'No aplica a este partido')}
                              </div>
                            </div>
                            {f.firmada ? (
                              <span className="text-[0.6rem] font-bold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 shrink-0">Firmada</span>
                            ) : f.exigible && firmableAqui ? (
                              <button onClick={() => setModalFirma(f.rol_firma)} disabled={isSubmitting} className="bg-brand-blue text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-brand-brown transition-colors shadow-sm shrink-0 disabled:bg-gray-400 disabled:opacity-70 disabled:cursor-not-allowed">Firmar</button>
                            ) : f.exigible ? (
                              <span className="text-[0.6rem] text-brand-brown/40 shrink-0">En el panel del árbitro</span>
                            ) : (
                              <span className="text-[0.6rem] text-brand-brown/40 shrink-0">No aplica</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* LOTE 8E UX: cronometro como isla flotante; el bloque fijo de mesa tecnica pasa a ser un icono circular expandible */}
                <CronometroFlotante
                  tiempoTurno={tiempoTurno}
                  tiempoGlobal={tiempoGlobal}
                  cronometroTurnoActivo={cronometroTurnoActivo}
                  formatoT={formatoT}
                  onToggleTurno={toggleTurno}
                  onResetTurno={resetTurno}
                />
              </div>
            </div>
          )}
        </div>
        {/* MODAL DE FIRMA DIGITAL DEL ACTA (LOTE 6D) */}
      {modalFirma && (
        <FirmaCanvas
          titulo={'Firma: ' + (modalFirma === 'anotador' ? 'Anotador' : modalFirma === 'delegado_local' ? 'Delegado ' + (partidoActivo?.local_nombre || 'Local') : modalFirma === 'delegado_visita' ? 'Delegado ' + (partidoActivo?.visita_nombre || 'Visita') : modalFirma)}
          onGuardar={guardarFirmaActa}
          onCerrar={() => setModalFirma(null)}
        />
      )}
    </main>
    </div>
  );
}