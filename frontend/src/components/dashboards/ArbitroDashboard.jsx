import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { io } from 'socket.io-client';
import PlanillaUniversal from './PlanillaUniversal';
import ChipOffline from '../ChipOffline';
import { useEnLinea, leerCola, encolar, contarCola, procesarCola, reintentarFallidos } from '../ColaOffline'; // FASE D UX: cola offline del arbitro
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
import { SkeletonTabla, SkeletonTarjetas } from '../SkeletonCarga'; // FASE 2 UX: esqueletos de carga de marca
import FirmaCanvas from '../FirmaCanvas'; // LOTE 6D: firmas digitales del acta
import { useToasts, ToastContainer } from '../Toast'; // FASE 1 UX: notificaciones toast de marca
import EmptyState from '../EmptyState'; // FASE 1 UX: estado vacio de marca
import TarjetaResumen from '../TarjetaResumen'; // FASE B1 UX: tarjetas de resumen de la pestana Inicio
import ConfirmDialog from '../ConfirmDialog'; // FASE 1 UX: dialogo de confirmacion de marca
import ModoCanchaArbitro from '../ModoCanchaArbitro'; // FASE 3 UX: modo cancha para el arbitro a pie de cancha
import { tecladoModal } from '../Accesibilidad';
import { formatearFecha, formatearFechaHora, formatearHoraDeFecha, formatearHora, fechaHoy } from '../fechas'; // LOTE FECHAS: formato unico dd/mm/aaaa y horas de 12 horas
// LOTE 8K: acta oficial en PDF compartida (blanco y negro, logos y firmas incrustadas).
import { generarActaPDF, cargarDatosActa, generarActaDesdePartido } from '../actaPdf';


const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
// LOTE 6B: VITE_SOCKET_URL puede llegar con el sufijo /api (la URL del REST, no la del
// socket). Socket.io interpreta el path del URI como NAMESPACE, asi que conectar a
// "/api" apuntaria al namespace /api (inexistente en el servidor) y cada handshake
// moriria con connect_error (aviso de "Conexion en tiempo real no disponible").
// Se normaliza quitando el sufijo: el socket siempre apunta a la raiz del servidor.
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000').replace(/\/api\/?$/, '');

export default function ArbitroDashboard({ usuario, cerrarSesion }) {
  // PESTAÑAS DEL PANEL LATERAL: 'hoy' | 'proximos' | 'historial'
  const [pestana, setPestana] = useState('inicio'); // FASE B1 UX: el panel abre siempre en la pestana Inicio
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [tourActivo, setTourActivo] = useState(() => tourPendiente('arbitro'));
  const cerrarTour = () => {
    marcarTourVisto('arbitro');
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalIncidencias, setModalIncidencias] = useState(false);
  const [incidencias, setIncidencias] = useState([]);
  const [cargandoIncidencias, setCargandoIncidencias] = useState(false);
  const [formIncidencia, setFormIncidencia] = useState({ tipo: 'Protesta', jugador_id: '', descripcion: '' });
  const [cargando, setCargando] = useState(false); // FASE 3C UX: esqueletos mientras llegan los partidos del oficial
  const [cargandoPartido, setCargandoPartido] = useState(false); // FASE 3C UX: candado del boton Control

  const [token, setToken] = useState(null);

  // FASE D UX: modo offline del arbitro. Sin senal el partido se sigue operando;
  // las escrituras se guardan en este dispositivo y se reenvian al reconectar.
  const enLinea = useEnLinea();
  const [colaOffline, setColaOffline] = useState(() => contarCola('arbitro'));
  const [reintentandoCola, setReintentandoCola] = useState(false);
  const refrescarCola = () => setColaOffline(contarCola('arbitro'));
  const reintentarColaFallidos = async () => {
    reintentarFallidos('arbitro');
    refrescarCola();
    setReintentandoCola(true);
    const resumen = await procesarCola('arbitro', fetchConToken);
    setReintentandoCola(false);
    refrescarCola();
    if (resumen.enviados > 0) {
      mostrarToast(resumen.enviados + (resumen.enviados === 1 ? ' envio sincronizado con el servidor.' : ' envios sincronizados con el servidor.'), 'exito');
      cargarDatosOficial();
    }
    if (contarCola('arbitro').fallidos > 0) mostrarToast('El envio sigue rechazado por el servidor. Comunicalo al AdminLiga si persiste.', 'error');
  };
  useEffect(() => {
    refrescarCola();
    if (!enLinea) return;
    if (leerCola('arbitro').length === 0) return;
    let vivo = true;
    (async () => {
      mostrarToast('Enviando lo guardado en este dispositivo...', 'info');
      const resumen = await procesarCola('arbitro', fetchConToken);
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
  const [ligas, setLigas] = useState([]);
  const [ligaFiltro, setLigaFiltro] = useState('');

  // Filtrado, busqueda y descargas de las tablas del modulo
  const [filtrosTablas, setFiltrosTablas] = useState({});
  const getFilter = key => filtrosTablas[key] || EMPTY_FILTER;
  const setTableFilter = key => next => setFiltrosTablas(previous => ({ ...previous, [key]: next }));
  const filtrarTabla = (key, rows, categoryFields = [], dateFields = []) => rows.filter(row => rowMatchesFilter(row, getFilter(key), categoryFields, dateFields));

  const socketRef = useRef(null);
  const partidoActivoRef = useRef(null); // LOTE T: espejo de partidoActivo para la reconexion del socket
  const avisoSocketDadoRef = useRef(false); // LOTE T: aviso de caida del tiempo real mostrado una sola vez
  const [firmasActa, setFirmasActa] = useState({ exigibles: [], firmas: [], faltantes: [] }); // LOTE 6D: estado de las firmas del acta
  const [modalFirma, setModalFirma] = useState(null); // LOTE 6D: rol de la firma que se esta dibujando

  // FASE 3 UX: vista del partido activo. En pantallas chicas el modo cancha es la
  // vista natural para dirigir desde el telefono; en escritorio, la planilla.
  // La eleccion manual queda recordada para la proxima sesion.
  const [modoCancha, setModoCancha] = useState(() => {
    const preferencia = localStorage.getItem('arbitroModoVista');
    if (preferencia === 'cancha' || preferencia === 'planilla') return preferencia === 'cancha';
    return window.innerWidth < 1024;
  });
  const cambiarModoVista = (aCancha) => {
    setModoCancha(aCancha);
    localStorage.setItem('arbitroModoVista', aCancha ? 'cancha' : 'planilla');
  };
  // FASE 3 UX: estado del socket siempre visible (antes solo un toast unico al caer)
  const [socketConectado, setSocketConectado] = useState(false);

  useEffect(() => { partidoActivoRef.current = partidoActivo; }, [partidoActivo]);

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
    setCargando(true); // FASE 3C UX: esqueleto de carga mientras llegan los partidos
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

      // LOTE T: reconexion automatica. Tras un reinicio del servidor (deploy de Render) el socket
      // se reconecta solo, pero hay que re-entrar a la sala y re-anunciar la presencia del rol.
      socketRef.current.on('connect', () => {
        setSocketConectado(true);
        avisoSocketDadoRef.current = false; // LOTE 6B: la reconexion (p. ej. tras un deploy de Render) fue exitosa; el proximo corte de conexion vuelve a avisar
        const activo = partidoActivoRef.current;
        if (!activo) return;
        socketRef.current.emit('unirse_partido', activo.id);
        socketRef.current.emit('presencia_oficial', { partidoId: activo.id, rol: 'arbitro', estado: true });
      });

      socketRef.current.on('connect_error', () => {
        if (avisoSocketDadoRef.current) return;
        avisoSocketDadoRef.current = true;
        setSocketConectado(false);
        mostrarToast('Conexion en tiempo real no disponible. El sistema reintentara automaticamente.', 'info');
      });

      socketRef.current.on('disconnect', () => setSocketConectado(false));
    })();

    return () => {
      cancelado = true;
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

  // LOTE 6D: estado de las firmas del acta (exigibles, firmadas y faltantes).
  const cargarFirmasActa = async (partidoId) => {
    try {
      const res = await fetchConToken(`/partidos/${partidoId}/firmas`);
      if (res.ok) setFirmasActa(await res.json());
    } catch (err) {
      // La seccion de firmas conserva el ultimo estado conocido.
    }
  };

  // FASE 3C UX: candado del boton Control; un doble toque duplicaria los listeners del socket
  const seleccionarPartido = async (partido) => {
    if (cargandoPartido) return;
    setCargandoPartido(true);
    try { await seleccionarPartidoBase(partido); } finally { setCargandoPartido(false); }
  };

  const seleccionarPartidoBase = async (partido) => {
    setAnotadorConectado(false); // LOTE T: no heredar la presencia del partido anterior; el servidor envia la foto actual al unirse
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

    socketRef.current.on('partido_finalizado_auto', (data) => {
      mostrarToast(`¡META DE PUNTOS ALCANZADA! El sistema cerro el acta automaticamente. Hora final: ${formatearHora(data.hora_final)}`, 'exito');
      setPartidoActivo(prev => prev ? ({ ...prev, estado: 'Finalizado', hora_final: data.hora_final }) : null);
      setCronometroGlobalActivo(false); setCronometroTurnoActivo(false);
      localStorage.removeItem('partidoActivoId');
    });

    socketRef.current.on('sincronizacion_cronometro', (data) => {
      setTiempoTurno(data.tiempoTurno);
      setCronometroTurnoActivo(data.cronometroTurnoActivo);
      setTiempoGlobal(data.tiempoGlobal);
      setCronometroGlobalActivo(data.cronometroGlobalActivo);
    });

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
  };

const guardarSorteo = async () => {
    // INSERCIÓN: Bloqueo y saneamiento
    if (isSubmitting) return;
    const textoSaneado = sorteoTexto.trim();
    if (!textoSaneado) return mostrarToast('El acta de sorteo no puede estar vacía.', 'error');
    
    setIsSubmitting(true);
    if (!enLinea) {
      encolar('arbitro', { metodo: 'PUT', ruta: `/partidos/${modalSorteo}/sorteo`, cuerpo: JSON.stringify({ sorteo: textoSaneado }), etiqueta: 'Sorteo del partido' });
      refrescarCola();
      setIsSubmitting(false);
      setModalSorteo(null);
      setSorteoTexto('');
      return mostrarToast('Sin conexion: sorteo guardado en este dispositivo. Se enviara al reconectar.', 'info');
    }
    const res = await fetchConToken(`/partidos/${modalSorteo}/sorteo`, { method: 'PUT', body: JSON.stringify({ sorteo: textoSaneado }) });
    setIsSubmitting(false);
    
    if (res.ok) { mostrarToast('Sorteo guardado exitosamente.', 'exito'); setModalSorteo(null); setSorteoTexto(''); }
  };

    // LOTE 6D: registra la firma dibujada. El arbitro firma su propio slot y
  // ademas recoge en su dispositivo las firmas de los delegados; el slot del
  // anotador lo firma el anotador desde su propio panel.
  const guardarFirmaActa = async (dataUrl) => {
    const rolFirma = modalFirma;
    setModalFirma(null);
    setIsSubmitting(true);
    if (!enLinea) {
      encolar('arbitro', { metodo: 'POST', ruta: `/partidos/${partidoActivo.id}/firmas`, cuerpo: JSON.stringify({ rol_firma: rolFirma, imagen: dataUrl }), etiqueta: 'Firma del acta' });
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

  // LOTE 8K: descarga el acta oficial en PDF de un partido del historial
  // (datos, planilla persistida y firmas vienen del backend).
  const descargarActaPdf = async (partidoId) => {
    try {
      const { partido, nomina, planilla, firmas } = await cargarDatosActa(partidoId, { fetchConToken, apiUrl: API_URL });
      await generarActaDesdePartido(partido, nomina, planilla, firmas, { nombreLiga: orgLiga?.nombre || '', logoLiga: orgLiga?.logo_url || null });
    } catch (err) {
      mostrarToast(err?.message || 'No se pudo generar el acta en PDF.', 'error');
    }
  };

  // LOTE 8K: descarga el acta del partido activo con el estado local del panel
  // (el arbitro no maneja stats manuales: van vacios, como en su planilla).
  const descargarActaActiva = async () => {
    try {
      await generarActaPDF({
        nombreLiga: orgLiga?.nombre || '',
        logoLiga: orgLiga?.logo_url || null,
        datosPartido: {
          arbitro: partidoActivo.arbitro_nombre, anotador: partidoActivo.anotador_nombre,
          capitanLocal: partidoActivo.capitan_local_nombre, capitanVisita: partidoActivo.capitan_visita_nombre,
          localNombre: partidoActivo.local_nombre, visitaNombre: partidoActivo.visita_nombre,
          fecha: formatearFecha(partidoActivo.fecha_hora), horaInicio: partidoActivo.hora_inicio, horaFinal: partidoActivo.hora_final
        },
        jugadoresLocal, jugadoresVisita,
        efectividadJugadores,
        puntosPorManoLocal, puntosPorManoVisita,
        firmas: firmasActa?.firmas || null
      });
    } catch (err) {
      mostrarToast(err?.message || 'No se pudo generar el acta en PDF.', 'error');
    }
  };

const suspenderPartido = async () => {
    if(!partidoActivo || isSubmitting) return; // INSERCIÓN: Prevención de doble click
    if (!(await pedirConfirmacion('Suspender partido', '¿Estás seguro de suspender este partido? Se guardarán los resultados actuales y desaparecerá de tu panel y del anotador hasta ser reagendado.', 'peligro'))) return;

    setIsSubmitting(true); // INSERCIÓN: Bloqueo
    if (!enLinea) {
      encolar('arbitro', { metodo: 'PUT', ruta: `/partidos/${partidoActivo.id}/suspender`, cuerpo: null, etiqueta: 'Suspender partido' });
      refrescarCola();
      setIsSubmitting(false); // INSERCIÓN: Liberación
      localStorage.removeItem('partidoActivoId');
      setPartidoActivo(null);
      return mostrarToast('Sin conexion: la suspension quedo guardada en este dispositivo. Al reconectar se enviara y el AdminLiga sera notificado.', 'info');
    }
    const res = await fetchConToken(`/partidos/${partidoActivo.id}/suspender`, { method: 'PUT' });
    setIsSubmitting(false); // INSERCIÓN: Liberación
    
    if (res.ok) {
      socketRef.current.emit('partido_suspendido', { partidoId: partidoActivo.id });
      socketRef.current.emit('enviar_notificacion_admin', { mensaje: `El árbitro ha suspendido el encuentro: ${partidoActivo.local_nombre} vs ${partidoActivo.visita_nombre} (Partido #${partidoActivo.id}). Requiere ser reagendado en el panel.`, tipo: 'alerta_suspension' });

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await fetch(`${API_URL}/mensajeria/enviar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({
            destinatario_rol: 'Administrador de Liga',
            mensaje: `URGENTE: El partido #${partidoActivo.id} (${partidoActivo.local_nombre} vs ${partidoActivo.visita_nombre}) fue SUSPENDIDO. Por favor reagendar en tu panel.`
          })
        });
      }

      mostrarToast('Partido suspendido con éxito. Los resultados han quedado guardados y el administrador ha sido notificado.', 'exito');
      localStorage.removeItem('partidoActivoId');
      setPartidoActivo(null); 
      cargarDatosOficial(); 
    } else { mostrarToast('Error de conexión al intentar suspender el partido.', 'error'); }
  };

  const abrirIncidencias = async () => {
    setModalIncidencias(true);
    setCargandoIncidencias(true);
    try {
      const res = await fetchConToken(`/partidos/${partidoActivo.id}/incidencias`);
      if (res.ok) {
        const data = await res.json();
        setIncidencias(Array.isArray(data) ? data : (data.incidencias || []));
      } else {
        setIncidencias([]);
      }
    } catch (err) {
      setIncidencias([]);
      mostrarToast('Error de conexión al cargar las incidencias.', 'error');
    } finally {
      setCargandoIncidencias(false);
    }
  };

  const registrarIncidencia = async (e) => {
    e.preventDefault();
    if (formIncidencia.descripcion.trim().length < 5) return mostrarToast('La descripción debe tener al menos 5 caracteres.', 'error');
    setIsSubmitting(true);
    if (!enLinea) {
      // FASE D UX: la incidencia viaja con client_id para que el backend deduplique el reenvio.
      encolar('arbitro', { metodo: 'POST', ruta: `/partidos/${partidoActivo.id}/incidencias`, cuerpo: JSON.stringify({ tipo: formIncidencia.tipo, descripcion: formIncidencia.descripcion.trim(), jugador_id: formIncidencia.jugador_id || null, client_id: 'inc-' + partidoActivo.id + '-' + Date.now() }), etiqueta: 'Incidencia del partido' });
      setIncidencias(prev => [{ id: 'local-' + Date.now(), tipo: formIncidencia.tipo, descripcion: formIncidencia.descripcion.trim(), jugador_id: formIncidencia.jugador_id || null, autor_nombre: usuario?.nombre, autor_apellido: usuario?.apellido, created_at: new Date().toISOString() }, ...prev]);
      setFormIncidencia({ tipo: 'Protesta', jugador_id: '', descripcion: '' });
      refrescarCola();
      setIsSubmitting(false);
      return mostrarToast('Sin conexion: incidencia guardada en este dispositivo. Se enviara al reconectar.', 'info');
    }
    try {
      const res = await fetchConToken(`/partidos/${partidoActivo.id}/incidencias`, { method: 'POST', body: JSON.stringify({ tipo: formIncidencia.tipo, descripcion: formIncidencia.descripcion.trim(), jugador_id: formIncidencia.jugador_id || null }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFormIncidencia({ tipo: 'Protesta', jugador_id: '', descripcion: '' });
        const res2 = await fetchConToken(`/partidos/${partidoActivo.id}/incidencias`);
        if (res2.ok) {
          const data2 = await res2.json();
          setIncidencias(Array.isArray(data2) ? data2 : (data2.incidencias || []));
        }
        mostrarToast(data.mensaje || 'Incidencia registrada correctamente.', 'exito');
      } else {
        mostrarToast(data.error || 'No se pudo registrar la incidencia.', 'error');
      }
    } catch (err) {
      mostrarToast('Error de conexión al registrar la incidencia.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // FASE 3 UX: nucleo compartido entre el selector lateral y el modo cancha.
  const emitirTarjetaA = async (jugadorId, color) => {
    const j = [...jugadoresLocal, ...jugadoresVisita].find(x => x.id === parseInt(jugadorId));
    if (!j) return mostrarToast('Selecciona un jugador.', 'error');
    if (!(await pedirConfirmacion(`Tarjeta ${color}`, `¿Amonestar con tarjeta ${color.toUpperCase()} a ${j.nombre} ${j.apellido}?`, color === 'Roja' ? 'peligro' : undefined))) return;
    socketRef.current?.emit('tarjeta_emitida', { partido_id: partidoActivo.id, jugador_id: j.id, color });
    mostrarToast(`Tarjeta ${color} registrada en acta.`, 'exito');
  };

  const emitirTarjeta = async (color) => {
    if (!jugadorSancionId) return mostrarToast('Selecciona un jugador.', 'error');
    await emitirTarjetaA(jugadorSancionId, color);
    setJugadorSancionId('');
  };

  const solicitarRevision = (jugadorId, manoIndex, jugadaObj) => {
    if (!jugadaObj || jugadaObj.estado === 'rechazado') return;
    const msg = window.prompt("Indique el motivo de la revisión para el anotador:", "Corregir valor ingresado");
    
    // INSERCIÓN: Saneamiento y Tipado numérico estricto antes del Socket
    const msgSaneado = msg?.trim();
    if (msgSaneado) {
      socketRef.current?.emit('solicitar_revision_jugada', { 
        partido_id: parseInt(partidoActivo.id), 
        jugador_id: parseInt(jugadorId), 
        mano_index: parseInt(manoIndex), 
        mensaje: msgSaneado 
      });
    }
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

  // Íconos para la barra lateral del árbitro
  // FASE 2 UX: los iconos viven en el catalogo compartido; cada pestana mapea a un nombre
  const ICONOS_PESTANA = { inicio: 'inicio', hoy: 'calendario', proximos: 'reloj', historial: 'documento', calendario: 'calendario', protestas: 'protesta', votacion: 'votacion' };

  return (
    <div className="flex h-screen w-full bg-brand-cream font-sans overflow-hidden">
      <SistemaMensajeria usuario={usuario} token={token} ligaActivaId={ligaFiltro} />
      <ChipOffline enLinea={enLinea} pendientes={colaOffline.pendientes} fallidos={colaOffline.fallidos} reintentando={reintentandoCola} onReintentar={reintentarColaFallidos} />
      <ToastContainer toasts={toasts} onCerrar={cerrarToast} />
            <TourGuia rol="arbitro" activo={tourActivo} onCerrar={cerrarTour} seccionInicio="inicio" onIrASeccion={(id) => { setPestana(id); setMenuAbierto(false); }} />
      <ConfirmDialog confirmacion={confirmacion} onCerrar={() => setConfirmacion(null)} />
      
      {/* MODAL SORTEO */}
      {modalSorteo && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-1500 p-4" role="dialog" aria-modal="true" aria-label="Sorteo Oficial" onKeyDown={(evento) => tecladoModal(evento, () => setModalSorteo(null))}>
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl animate-slide-up border border-brand-gold/30">
            <h3 className="text-xl font-bold text-brand-brown mb-4 flex items-center gap-2">
              <svg className="w-6 h-6 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Sorteo Oficial
            </h3>
            <textarea
              autoFocus
              placeholder="Ej: Equipo Reputation gana mingo y decide salir..." 
              value={sorteoTexto} 
              onChange={e => setSorteoTexto(e.target.value)} 
              className="w-full h-28 p-3 border border-brand-gold/40 rounded-lg focus:ring-2 focus:ring-brand-rust focus:border-brand-rust outline-none resize-none mb-5 text-sm font-medium text-brand-brown bg-brand-cream/10" 
            />
            <div className="flex gap-3">
              <button 
                onClick={guardarSorteo} 
                disabled={isSubmitting}
                className={`flex-1 text-white py-2.5 rounded-lg font-bold transition-colors shadow-sm ${isSubmitting ? 'bg-gray-400 opacity-70 cursor-not-allowed' : 'bg-brand-blue hover:bg-brand-brown'}`}
              >
                {isSubmitting ? 'Guardando...' : 'Guardar Acta'}
              </button>
              <button onClick={() => setModalSorteo(null)} className="flex-1 bg-gray-200 text-brand-brown py-2.5 rounded-lg font-bold hover:bg-gray-300 transition-colors">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE INCIDENCIAS DEL PARTIDO (LOTE N) */}
      {modalIncidencias && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Incidencias del Partido" onKeyDown={(evento) => tecladoModal(evento, () => setModalIncidencias(false))}>
          <div className="bg-white p-6 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-brand-brown mb-1">Incidencias del Partido</h3>
            <p className="text-xs text-brand-brown/60 mb-4">{partidoActivo?.local_nombre} vs {partidoActivo?.visita_nombre}</p>

            <div className="mb-5">
              <h4 className="text-sm font-bold text-brand-brown mb-2">Registradas ({incidencias.length})</h4>
              {cargandoIncidencias ? (
                <div className="py-2"><SkeletonTabla filas={3} columnas={2} compacto /></div>
              ) : incidencias.length === 0 ? (
                <p className="text-sm text-brand-brown/60">No hay incidencias registradas en este partido.</p>
              ) : (
                <ul className="space-y-2">
                  {incidencias.map(inc => (
                    <li key={inc.id} className="border border-brand-gold/30 rounded-lg p-3 bg-brand-cream/10">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[0.7rem] font-bold uppercase px-2 py-0.5 rounded bg-brand-gold/20 text-brand-brown">{inc.tipo}</span>
                        <span className="text-[0.65rem] text-brand-brown/50">{inc.created_at ? formatearFechaHora(inc.created_at) : ''}</span>
                      </div>
                      <p className="text-sm text-brand-brown">{inc.descripcion}</p>
                      <p className="text-[0.7rem] text-brand-brown/60 mt-1">
                        Registrada por: {inc.autor_nombre ? [inc.autor_nombre, inc.autor_apellido].filter(Boolean).join(' ') : 'Árbitro'}
                        {inc.jugador_nombre && (<> — Jugador: #{inc.numero_dorsal} {inc.jugador_nombre} {inc.jugador_apellido}</>)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form onSubmit={registrarIncidencia} className="space-y-3 border-t border-brand-gold/20 pt-4">
              <div>
                <label className="block text-xs font-bold text-brand-brown/70 mb-1">Tipo de incidencia</label>
                <select autoFocus value={formIncidencia.tipo} onChange={e => setFormIncidencia({...formIncidencia, tipo: e.target.value})} className="w-full p-2.5 rounded-lg border border-brand-gold/40 focus:ring-2 focus:ring-brand-rust outline-none text-sm font-medium text-brand-brown bg-brand-cream/20 cursor-pointer">
                  {['Protesta', 'Lesión', 'Retraso de equipo', 'Deterioro de sede', 'Afición', 'Otro'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-brand-brown/70 mb-1">Jugador involucrado (opcional)</label>
                <select value={formIncidencia.jugador_id} onChange={e => setFormIncidencia({...formIncidencia, jugador_id: e.target.value})} className="w-full p-2.5 rounded-lg border border-brand-gold/40 focus:ring-2 focus:ring-brand-rust outline-none text-sm font-medium text-brand-brown bg-brand-cream/20 cursor-pointer">
                  <option value="">Sin jugador asociado...</option>
                  <optgroup label={partidoActivo?.local_nombre || 'Local'}>
                    {jugadoresLocal.map(j => <option key={j.id} value={j.id}>#{j.numero_dorsal} {j.nombre} {j.apellido}</option>)}
                  </optgroup>
                  <optgroup label={partidoActivo?.visita_nombre || 'Visita'}>
                    {jugadoresVisita.map(j => <option key={j.id} value={j.id}>#{j.numero_dorsal} {j.nombre} {j.apellido}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-brand-brown/70 mb-1">Descripción</label>
                <textarea value={formIncidencia.descripcion} onChange={e => setFormIncidencia({...formIncidencia, descripcion: e.target.value})} placeholder="Describa la incidencia (mínimo 5 caracteres)..." rows="3" minLength="5" required className="w-full p-2.5 rounded-lg border border-brand-gold/40 focus:ring-2 focus:ring-brand-rust outline-none text-sm text-brand-brown"></textarea>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 bg-brand-rust hover:bg-brand-brown text-white rounded-lg text-sm font-bold transition-colors shadow-sm flex items-center justify-center gap-1">
                  {isSubmitting ? 'Guardando...' : 'Registrar Incidencia'}
                </button>
                <button type="button" onClick={() => setModalIncidencias(false)} className="flex-1 py-2.5 bg-gray-200 text-brand-brown rounded-lg text-sm font-bold hover:bg-gray-300 transition-colors">Cerrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* UX: barra lateral compartida (se colapsa en escritorio, menu deslizante en movil) */}
      <Sidebar
        titulo="Árbitro Oficial"
        subtitulo="Control de Cancha"
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
        claveColapso="arbitroSidebarColapsada"
        onVerGuia={() => setTourActivo(true)}
      />

      {/* CONTENEDOR PRINCIPAL */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-brand-cream relative overflow-y-auto">
        
        {/* HEADER SUPERIOR */}
        <HeaderPanel
          tituloMovil
          titulo={partidoActivo ? `Partido en Curso: ${partidoActivo.local_nombre} vs ${partidoActivo.visita_nombre}` : (pestana === 'inicio' ? 'Inicio' : pestana === 'hoy' ? 'Partidos de Hoy' : pestana === 'proximos' ? 'Próximos Partidos' : pestana === 'calendario' ? 'Calendario de Partidos' : pestana === 'votacion' ? 'Votación MVP' : pestana === 'protestas' ? 'Protestas' : 'Historial Reciente')}
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
                        <button onClick={() => seleccionarPartido(proximoCompromiso)} disabled={cargandoPartido} className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-brown transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{cargandoPartido ? 'Abriendo...' : partidoEnCurso ? 'Retomar control de cancha' : 'Abrir control de cancha'}</button>
                        <button onClick={() => setPestana('hoy')} className="bg-white border border-brand-gold/40 text-brand-brown px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm">Ver encuentros de hoy</button>
                      </div>
                    </div>
                  ) : (
                    <EmptyState titulo="Sin encuentros asignados" descripcion="Cuando la liga agende partidos con usted como arbitro, el proximo compromiso aparecera aqui." icono="calendario" />
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
                  <TableTools rows={partidosHoyBase} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={partidosHoy} filter={getFilter('hoy')} setFilter={setTableFilter('hoy')} columns={[{ key: 'fecha_hora', label: 'Fecha' }, { key: 'local_nombre', label: 'Local' }, { key: 'visita_nombre', label: 'Visitante' }, { key: 'sede_nombre', label: 'Sede' }, { key: 'estado', label: 'Estado' }]} filename="arbitro_partidos_hoy" modulo="Árbitro oficial" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
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

                          <div className="flex gap-2">
                            <button onClick={() => setModalSorteo(p.id)} className="flex-1 bg-brand-cream text-brand-brown py-2 rounded-lg text-sm font-bold border border-brand-gold/30 hover:bg-brand-gold hover:text-white hover:border-brand-gold transition-colors flex justify-center items-center gap-1 shadow-sm">Sorteo</button>
                            <button onClick={() => seleccionarPartido(p)} disabled={cargandoPartido} className="flex-1 bg-brand-blue text-white py-2 rounded-lg text-sm font-bold hover:bg-brand-brown transition-colors flex justify-center items-center gap-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> {cargandoPartido ? 'Abriendo...' : 'Control'}
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
                  <TableTools rows={partidosAgendadosBase} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={partidosAgendados} filter={getFilter('proximos')} setFilter={setTableFilter('proximos')} columns={[{ key: 'fecha_hora', label: 'Fecha' }, { key: 'local_nombre', label: 'Local' }, { key: 'visita_nombre', label: 'Visitante' }, { key: 'sede_nombre', label: 'Sede' }, { key: 'estado', label: 'Estado' }]} dateFields={['fecha_hora']} filename="arbitro_proximos_partidos" modulo="Árbitro oficial" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
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
                  <TableTools rows={partidosFinalizadosBase} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={partidosFinalizados} filter={getFilter('historial')} setFilter={setTableFilter('historial')} columns={[{ key: 'fecha_hora', label: 'Fecha' }, { key: 'local_nombre', label: 'Local' }, { key: 'visita_nombre', label: 'Visitante' }, { key: 'sede_nombre', label: 'Sede' }, { key: 'estado', label: 'Estado' }]} categoryFields={['estado']} dateFields={['fecha_hora']} filename="arbitro_historial_partidos" modulo="Árbitro oficial" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
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
                          {/* LOTE 8K: Proyectar abre la pantalla publica; Descargar PDF genera el acta. */}
                          <div className="flex gap-2">
                            <button onClick={() => window.open(`/?vista=puntajes&partido_id=${p.id}`, '_blank')} className="flex-1 bg-white text-brand-brown py-2 rounded-lg border border-brand-gold/40 text-xs font-bold hover:bg-brand-rust hover:text-white transition-colors flex justify-center items-center gap-2 shadow-sm">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                              Proyectar
                            </button>
                            <button onClick={() => descargarActaPdf(p.id)} className="flex-1 bg-white text-brand-brown py-2 rounded-lg border border-brand-gold/40 text-xs font-bold hover:bg-brand-rust hover:text-white transition-colors flex justify-center items-center gap-2 shadow-sm">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              Descargar PDF
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <PaginacionTabla {...pagHistorial} />
                </div>
              )}

            </div>
          ) : modoCancha ? (
            <ModoCanchaArbitro
              partido={partidoActivo}
              jugadoresLocal={jugadoresLocal}
              jugadoresVisita={jugadoresVisita}
              puntosPorManoLocal={puntosPorManoLocal}
              puntosPorManoVisita={puntosPorManoVisita}
              tiempoTurno={tiempoTurno}
              tiempoGlobal={tiempoGlobal}
              formatoT={formatoT}
              anotadorConectado={anotadorConectado}
              socketConectado={socketConectado}
              onEmitirTarjeta={emitirTarjetaA}
              onAbrirIncidencias={abrirIncidencias}
              onSuspender={suspenderPartido}
              firmasActa={firmasActa}
              onFirmar={setModalFirma}
              onDescargarActa={descargarActaActiva}
              isSubmitting={isSubmitting}
              onVerPlanilla={() => cambiarModoVista(false)}
              onVolverPanel={() => {
                localStorage.removeItem('partidoActivoId');
                setPartidoActivo(null);
                socketRef.current?.emit('presencia_oficial', { partidoId: partidoActivo.id, rol: 'arbitro', estado: false });
              }}
            />
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
                    <button onClick={() => cambiarModoVista(true)} className="bg-brand-blue text-white px-4 py-2 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-sm flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                      Modo Cancha
                    </button>
                    {partidoActivo.estado === 'Finalizado' && (
                      <button onClick={descargarActaActiva} className="bg-brand-gold text-white px-4 py-2 rounded-lg font-bold hover:bg-brand-rust transition-colors shadow-sm flex items-center gap-2 text-sm">
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
                    nombreLiga={orgLiga?.nombre || ''}
                    logoLiga={orgLiga?.logo_url || null}
                    estadoPartido={partidoActivo.estado}
                    datosPartido={{ arbitro: partidoActivo.arbitro_nombre, anotador: partidoActivo.anotador_nombre, localNombre: partidoActivo.local_nombre, visitaNombre: partidoActivo.visita_nombre, fecha: formatearFecha(partidoActivo.fecha_hora), horaInicio: partidoActivo.hora_inicio, horaFinal: partidoActivo.hora_final }}
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

                <div className="bg-white p-5 rounded-xl border border-amber-200 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                  <h3 className="text-base font-bold text-brand-brown mb-2 pl-2">Incidencias del Partido</h3>
                  <p className="text-[0.75rem] text-brand-brown/60 mb-4 pl-2 leading-relaxed">
                    Registre novedades: Protesta, Lesión, Retraso de equipo, Deterioro de sede, Afición u Otro.
                  </p>
                  <button onClick={abrirIncidencias} className="w-full py-3 border rounded-lg text-sm font-bold transition-colors shadow-sm flex items-center justify-center gap-2 bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-500 hover:text-white">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    Ver y Registrar Incidencias
                  </button>
                </div>

                {/* FIRMAS DIGITALES DEL ACTA (LOTE 6D) */}
                {/* LOTE 8K: las firmas se recogen DESPUES de finalizar el puntaje;
                    siguen visibles con el partido Finalizado (no en Suspendido). */}
                {partidoActivo.estado !== 'Suspendido' && (
                  <div className="bg-white p-5 rounded-xl border border-brand-gold/30 shadow-sm">
                    <h3 className="text-base font-bold text-brand-brown mb-1">Firmas del Acta</h3>
                    <p className="text-[0.7rem] text-brand-brown/60 mb-3">Las firmas no bloquean el cierre del puntaje: recógelas después de finalizar para dejar el acta completa. Los delegados firman aquí entregando este dispositivo al responsable de cada equipo. El anotador firma desde su propio panel.</p>
                    <div className="space-y-2">
                      {(firmasActa.firmas || []).map(f => {
                        const etiquetaFirma = f.rol_firma === 'arbitro' ? 'Árbitro' : f.rol_firma === 'anotador' ? 'Anotador' : f.rol_firma === 'delegado_local' ? 'Delegado ' + (partidoActivo.local_nombre || 'Local') : 'Delegado ' + (partidoActivo.visita_nombre || 'Visita');
                        const firmableAqui = f.rol_firma !== 'anotador';
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
                              <span className="text-[0.6rem] text-brand-brown/40 shrink-0">En el panel del anotador</span>
                            ) : (
                              <span className="text-[0.6rem] text-brand-brown/40 shrink-0">No aplica</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="bg-white p-5 rounded-xl border border-red-200 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
                  <h3 className="text-base font-bold text-brand-brown mb-2 pl-2">Control de Juego</h3>
                  <p className="text-[0.75rem] text-brand-brown/60 mb-4 pl-2 leading-relaxed">
                    Utilice esta opción solo en caso de fuerza mayor (lluvia, falta de luz, etc).
                  </p>
                  <button 
                    onClick={suspenderPartido} 
                    disabled={isSubmitting}
                    className={`w-full py-3 border rounded-lg text-sm font-bold transition-colors shadow-sm flex items-center justify-center gap-2 ${isSubmitting ? 'bg-gray-200 text-gray-500 border-gray-300 opacity-70 cursor-not-allowed' : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-600 hover:text-white'}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
                    {isSubmitting ? 'Suspendiendo...' : 'Suspender Partido'}
                  </button>
                </div>

              </div>
            </div>
          )}
        </div>
        {/* MODAL DE FIRMA DIGITAL DEL ACTA (LOTE 6D) */}
      {modalFirma && (
        <FirmaCanvas
          titulo={'Firma: ' + (modalFirma === 'arbitro' ? 'Árbitro' : modalFirma === 'delegado_local' ? 'Delegado ' + (partidoActivo?.local_nombre || 'Local') : modalFirma === 'delegado_visita' ? 'Delegado ' + (partidoActivo?.visita_nombre || 'Visita') : modalFirma)}
          onGuardar={guardarFirmaActa}
          onCerrar={() => setModalFirma(null)}
        />
      )}
    </main>
    </div>
  );
}
