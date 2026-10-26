import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../../supabaseClient';
import { io } from 'socket.io-client';
import SistemaMensajeria from './SistemaMensajeria';
import { useToasts, ToastContainer } from '../Toast';
import CalendarioPartidos from '../CalendarioPartidos';
import { TableTools, EMPTY_FILTER, rowMatchesFilter } from './HerramientasTabla';
import CampoTexto from '../CampoTexto';
import CampoSelect from '../CampoSelect';
import Sidebar from '../Sidebar';
import FotoJugador from '../FotoJugador';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function AdminLigaDashboard({ usuario, cerrarSesion }) {
  const [pestana, setPestana] = useState(localStorage.getItem('adminLigaPestana') || 'equipos');

  // LOTE K: notificaciones tipo toast (reemplazan los alert nativos)
  const { toasts, mostrarToast, cerrarToast } = useToasts();
  const [menuAbierto, setMenuAbierto] = useState(false);

// Estado para saber qué botón específico se está transformando en bola
  const [animandoBoton, setAnimandoBoton] = useState(null);

  const cambiarPestanaConAnimacion = (nuevaPestana) => {
    // Si ya estamos ahí o hay una animación en curso, no hacemos nada
    if (nuevaPestana === pestana || animandoBoton) return;
    
    setAnimandoBoton(nuevaPestana);
    
    // La animación de la bola criolla dura 700ms. Cambiamos la pestaña justo al final.
    setTimeout(() => {
      setPestana(nuevaPestana);
      setMenuAbierto(false);
      setAnimandoBoton(null);
    }, 700);
  };

  useEffect(() => {
    localStorage.setItem('adminLigaPestana', pestana);
  }, [pestana]);

  const [mensaje, setMensaje] = useState('');
  const [debeCambiarPass, setDebeCambiarPass] = useState(false);
  const [nuevaClave, setNuevaClave] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estados Globales
  const [equipos, setEquipos] = useState([]);
  const [equipoSeleccionado, setEquipoSeleccionado] = useState(null);
  const [jugadores, setJugadores] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [plantillasReglas, setPlantillasReglas] = useState([]);
  const [recursosTorneo, setRecursosTorneo] = useState({ sedes: [], arbitros: [], anotadores: [], equipos: [] });
  const [usuariosOperativos, setUsuariosOperativos] = useState([]);
  const [estadisticas, setEstadisticas] = useState(null);
  const [partidos, setPartidos] = useState([]);
  const [torneosList, setTorneosList] = useState([]);
  const [bitacora, setBitacora] = useState([]);

  const socketRef = useRef(null);

  // Estados de torneos y posiciones
  const [posicionesGeneral, setPosicionesGeneral] = useState([]);
  const [torneoPosicionesId, setTorneoPosicionesId] = useState('');
  const [acumuladoLiga, setAcumuladoLiga] = useState([]);
  const [temporadaFiltro, setTemporadaFiltro] = useState('2026');

  // Estados para edición y modales
  const [modalCapitan, setModalCapitan] = useState({ visible: false, viejoId: null, equipoId: null, candidatos: [] });
  const [modalTransferencia, setModalTransferencia] = useState(null);
  const [categoriasSeleccionadas, setCategoriasSeleccionadas] = useState([]);
  const [jugadorEditandoId, setJugadorEditandoId] = useState(null);
  const [sedeEditando, setSedeEditando] = useState(null);
  const [torneoEditando, setTorneoEditando] = useState(null);
  const [modalReagendar, setModalReagendar] = useState({ visible: false, partido: null, nuevaFecha: '' });
  const [modalEditarPartido, setModalEditarPartido] = useState({ visible: false, partido: null, fecha_hora: '', arbitro_id: '', anotador_id: '', sede_id: '' });

  // Formularios
  const [formSede, setFormSede] = useState({ nombre: '', direccion: '' });
  const [formEquipo, setFormEquipo] = useState({ nombre: '', categoria: 'Adulto 22+', tipo_genero: 'Mixto', logo_url: '' });
  const [busquedaSedes, setBusquedaSedes] = useState('');
  const [busquedaEquipos, setBusquedaEquipos] = useState('');
  const [busquedaCredenciales, setBusquedaCredenciales] = useState('');
  const [filtrosTablas, setFiltrosTablas] = useState({});
  const getFilter = key => filtrosTablas[key] || EMPTY_FILTER;
  const setTableFilter = key => next => setFiltrosTablas(previous => ({ ...previous, [key]: next }));
  const filteredRows = (key, rows, categoryFields = [], dateFields = []) => rows.filter(row => rowMatchesFilter(row, getFilter(key), categoryFields, dateFields));
  
  const [formJugador, setFormJugador] = useState({ cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', correo: '', telefono: '', numero_dorsal: '', foto_url: '', es_capitan: false });
  const [formCredencial, setFormCredencial] = useState({ nombre: '', apellido: '', cedula: '', email: '', rol: 'arbitro', equipo_id: '' });
  const [formPartidoSuelto, setFormPartidoSuelto] = useState({ equipo_local_id: '', equipo_visita_id: '', sede_id: '', arbitro_id: '', anotador_id: '', fecha_hora: '', plantilla_id: '' });  const [formReglas, setFormReglas] = useState({ nombre: '', descripcion: '', puntos_victoria: 3, puntos_empate: 1, puntos_derrota: 0, limite_jugadores: 8, meta_puntos: 15, tiempo_minutos: 60, tarjetas_suspension: 2, esferas_por_equipo: 8, politica_clasificacion: 'ganador_vs_ganador' });  
  const [subPestanaTorneo, setSubPestanaTorneo] = useState('lista');
  const [pasoTorneo, setPasoTorneo] = useState(1);
  const [formTorneo, setFormTorneo] = useState({ nombre: '', fecha_inicio: '', fecha_fin: '', plantilla_id: '', categoria: 'Adulto 22+', tipo_genero: 'Mixto', sistema_clasificacion: 'liga_semifinales', opcion_grupos: 'cruc_semis', incluir_tercer_lugar: true, temporada: '2026' });
  const [equiposSeleccionadosTorneo, setEquiposSeleccionadosTorneo] = useState([]);
  const [partidosIniciales, setPartidosIniciales] = useState([]);
  // LOTE P: torneos flash — se anotan los asistentes del día; el sorteo
  // Fisher-Yates los reparte en equipos (≈4 por equipo) y arma el todos
  // contra todos. El badge muestra "N asistentes → M equipos".
  const [formFlash, setFormFlash] = useState({ nombre: '', sede_id: '', fecha_hora_inicio: '', minutos_entre_partidos: 45, plantilla_id: '', arbitro_id: '', anotador_id: '', ida_y_vuelta: false });
  const [participantesFlash, setParticipantesFlash] = useState([{ cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', telefono: '' }, { cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', telefono: '' }]);
  const [sugerenciasCedula, setSugerenciasCedula] = useState({ visible: false, idx: -1, items: [] });
  const [resultadoFlash, setResultadoFlash] = useState(null);
  const [creandoFlash, setCreandoFlash] = useState(false);
  const temporizadorAutocomplete = useRef(null);

  const hoyStr = new Date().toISOString().split('T')[0];
  const ahora = new Date();
  const ahoraIsoLocal = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}T${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  
  const fetchConToken = async (endpoint, options = {}) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return { ok: false, status: 401, json: async () => ({ error: 'Sesión no válida' }) };
      const response = await fetch(`${API_URL}/admin-liga${endpoint}`, { ...options, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, ...options.headers } });
      if (response.status === 401) setMensaje('Tu sesión ha expirado.');
      return response;
    } catch (err) { return { ok: false, status: 500, json: async () => ({ error: 'Error de conexión.' }) }; }
  };

  const toBase64 = file => new Promise((resolve, reject) => {
    const maxSize = 2 * 1024 * 1024; // 2MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    
    if (!allowedTypes.includes(file.type)) return reject(new Error('Formato no permitido. Solo JPG, PNG o WEBP.'));
    if (file.size > maxSize) return reject(new Error('El archivo supera los 2MB permitidos.'));

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });

  const [orgData, setOrgData] = useState({ nombre: 'Cargando...', logo_url: null });

  // Función para obtener la data desde el backend
  const cargarOrganizacion = async () => {
    try {
      const res = await fetchConToken('/mi-organizacion');
      if (res.ok) {
        const data = await res.json();
        setOrgData(data);
      }
    } catch (error) {
      console.error("Error al cargar datos de organización");
    }
  };

  useEffect(() => {
    cargarOrganizacion();
  }, []);

  const subirLogoOrganizacion = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const base64 = await toBase64(file);
      const res = await fetchConToken('/mi-organizacion/logo', { method: 'PUT', body: JSON.stringify({ logo_url: base64 }) });
      const data = await res.json();
      if (res.ok) {
        mostrarToast(data.mensaje || 'Logo actualizado correctamente', 'exito');
        cargarOrganizacion(); // <-- Refresca la UI al instante
      } else {
        mostrarToast(data.error || 'Error subiendo logo', 'error');
      }
    } catch (e) { 
      mostrarToast(e.message || 'Error al procesar la imagen del logo.', 'error'); 
    }
  };

  const manejarBatchUploadJugadores = async (e) => {
    const files = e.target.files;
    if (files.length === 0) return;
    let batch = [];
    setMensaje(`Procesando ${files.length} fotos...`);
    for (let file of files) {
      const cedula = file.name.split('.')[0]; 
      const base64 = await toBase64(file);
      batch.push({ cedula, foto_url: base64 });
    }
    const res = await fetchConToken('/jugadores/batch-fotos', { method: 'POST', body: JSON.stringify({ batch, equipo_id: equipoSeleccionado.id }) });
    const data = await res.json();
    if (res.ok) {
      mostrarToast(data.mensaje, 'exito'); setMensaje('');
      const resEq = await fetchConToken(`/equipos/${equipoSeleccionado.id}/jugadores`);
      if (resEq.ok) setJugadores(await resEq.json());
    } else { mostrarToast(data.error, 'error'); setMensaje(''); }
  };

  const cargarDatos = async () => {
    setMensaje('');
    try {
      if (pestana === 'equipos' || pestana === 'credenciales') {
        const res = await fetchConToken('/equipos'); if (res.ok) setEquipos(await res.json());
        const resOp = await fetchConToken('/usuarios-operativos'); if (resOp.ok) setUsuariosOperativos(await resOp.json());
      } else if (pestana === 'sedes') {
        const res = await fetchConToken('/sedes'); if (res.ok) setSedes(await res.json());
      } else if (pestana === 'reglas') {
        const res = await fetchConToken('/plantillas-reglas'); if (res.ok) setPlantillasReglas(await res.json());
      } else if (pestana === 'torneos') {
        const resEq = await fetchConToken('/equipos'); if (resEq.ok) setEquipos(await resEq.json());
        const resReg = await fetchConToken('/plantillas-reglas'); if (resReg.ok) setPlantillasReglas(await resReg.json());
        const resRec = await fetchConToken('/torneos/recursos'); if (resRec.ok) setRecursosTorneo(await resRec.json());
        const resTor = await fetchConToken('/torneos'); if (resTor.ok) setTorneosList(await resTor.json());
        // Cargamos partidos globales para obtener los suspendidos
        const resPart = await fetchConToken('/partidos-finalizados'); if (resPart.ok) setPartidos(await resPart.json());
      } else if (pestana === 'estadisticas') {
        const res = await fetchConToken('/estadisticas'); if (res.ok) setEstadisticas(await res.json());
      } else if (pestana === 'historial') {
        const res = await fetchConToken('/partidos-finalizados'); if (res.ok) setPartidos(await res.json());
      } else if (pestana === 'bitacora') {
        const res = await fetchConToken('/bitacora'); if (res.ok) setBitacora(await res.json());
      }
    } catch (e) { setMensaje('Error cargando datos del servidor.'); }
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
    })();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.debe_cambiar_password) setDebeCambiarPass(true);
    });
    return () => {
      cancelado = true;
      socketRef.current?.disconnect();
    };
  }, [usuario]);

  const [token, setToken] = useState(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token);
    });
  }, []);

  useEffect(() => { cargarDatos(); }, [pestana]);

  const consultarPosicionesAgrupadas = async (tId) => {
    if (!tId) return;
    const resGen = await fetchConToken(`/torneos/${tId}/posiciones`); if (resGen.ok) setPosicionesGeneral(await resGen.json());
  };

  const consultarAcumuladoLiga = async () => {
    const orgId = usuario?.user_metadata?.organizacion_id || torneosList[0]?.organizacion_id;
    if (!orgId) return;
    const res = await fetchConToken(`/acumulado-temporada?organizacion_id=${orgId}&temporada=${temporadaFiltro}`);
    if (res.ok) setAcumuladoLiga(await res.json());
  };

  const seleccionarEquipoModal = async (equipo) => {
    setEquipoSeleccionado(equipo); setJugadorEditandoId(null);
    setFormJugador({ cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', correo: '', telefono: '', numero_dorsal: '', foto_url: '', es_capitan: false });
    const res = await fetchConToken(`/equipos/${equipo.id}/jugadores`);
    if (res.ok) setJugadores(await res.json());
  };

  const guardarSede = async (e) => {
    e.preventDefault();
    const res = await fetchConToken(sedeEditando ? `/sedes/${sedeEditando.id}` : '/sedes', { method: sedeEditando ? 'PUT' : 'POST', body: JSON.stringify(formSede) });
    if (res.ok) { setMensaje(sedeEditando ? 'Sede actualizada.' : 'Sede registrada.'); setFormSede({ nombre: '', direccion: '' }); setSedeEditando(null); cargarDatos(); }
  };

  const eliminarSede = async (id) => {
    if (!window.confirm('¿Eliminar esta sede?')) return;
    const res = await fetchConToken(`/sedes/${id}`, { method: 'DELETE' }); if (res.ok) cargarDatos();
  };

  const guardarEquipo = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/equipos', { method: 'POST', body: JSON.stringify(formEquipo) });
    if (res.ok) { setMensaje('Equipo registrado.'); setFormEquipo({ nombre: '', categoria: 'Adulto 22+', tipo_genero: 'Mixto', logo_url: '' }); cargarDatos(); }
  };

  const guardarJugador = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    
    const datosLimpios = {
      ...formJugador,
      nombre: formJugador.nombre.trim(),
      apellido: formJugador.apellido.trim(),
      correo: formJugador.correo.toLowerCase().trim(),
      equipo_id: equipoSeleccionado.id
    };

    const res = await fetchConToken(jugadorEditandoId ? `/jugadores/${jugadorEditandoId}` : `/jugadores`, { method: jugadorEditandoId ? 'PUT' : 'POST', body: JSON.stringify(datosLimpios) });
    const data = await res.json();

    setIsSubmitting(false);

    if (res.ok) { setMensaje('Jugador guardado con éxito'); setFormJugador({ cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', correo: '', telefono: '', numero_dorsal: '', foto_url: '', es_capitan: false }); setJugadorEditandoId(null); seleccionarEquipoModal(equipoSeleccionado); }    else { mostrarToast(data.error, 'error'); }
  
  };

  const guardarPlantillaReglas = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/plantillas-reglas', {
      method: 'POST', body: JSON.stringify({ nombre: formReglas.nombre, descripcion: formReglas.descripcion, reglas: { puntos_victoria: parseInt(formReglas.puntos_victoria), puntos_empate: parseInt(formReglas.puntos_empate), puntos_derrota: parseInt(formReglas.puntos_derrota), limite_jugadores: parseInt(formReglas.limite_jugadores), meta_puntos: parseInt(formReglas.meta_puntos), tiempo_minutos: parseInt(formReglas.tiempo_minutos), tarjetas_suspension: parseInt(formReglas.tarjetas_suspension), esferas_por_equipo: parseInt(formReglas.esferas_por_equipo), politica_clasificacion: formReglas.politica_clasificacion }})
    });
    const data = await res.json();
    if (res.ok) { setMensaje('Plantilla guardada.'); cargarDatos(); } else { mostrarToast(data.error, 'error'); }
  };

  const validarDisponibilidadEquipos = (equipo1, equipo2, fechaHora) => {
    const conflicto = partidos.find(p => 
      p.fecha_hora === fechaHora && 
      (p.equipo_local_id == equipo1 || p.equipo_visita_id == equipo1 || 
      p.equipo_local_id == equipo2 || p.equipo_visita_id == equipo2)
    );
    if (conflicto) {
      mostrarToast('Conflicto: Al menos uno de los equipos ya tiene un encuentro agendado a esta hora.', 'error');
      return false;
    }
    return true;
  };

  const guardarPartidoSuelto = async (e) => {
    e.preventDefault();
    if (formPartidoSuelto.equipo_local_id === formPartidoSuelto.equipo_visita_id) return mostrarToast('El equipo local y visitante no pueden ser el mismo.', 'error');
    if (formPartidoSuelto.fecha_hora && formPartidoSuelto.fecha_hora < ahoraIsoLocal) return mostrarToast('La fecha y hora del encuentro no puede estar en el pasado.', 'error');
    if (!validarDisponibilidadEquipos(formPartidoSuelto.equipo_local_id, formPartidoSuelto.equipo_visita_id, formPartidoSuelto.fecha_hora)) return;
    const res = await fetchConToken('/partidos-sueltos', { method: 'POST', body: JSON.stringify(formPartidoSuelto) });
    const data = await res.json();
    if (res.ok) { 
      setMensaje('Partido agendado con éxito.'); 
      setFormPartidoSuelto({ equipo_local_id: '', equipo_visita_id: '', sede_id: '', arbitro_id: '', anotador_id: '', fecha_hora: '', plantilla_id: '' }); 
      cargarDatos();
    } else { mostrarToast(data.error, 'error'); }
  };

  const iniciarEdicionJugador = (j) => {
    setJugadorEditandoId(j.id);
    setFormJugador({ cedula: j.cedula || '', nombre: j.nombre || '', apellido: j.apellido || '', fecha_nacimiento: j.fecha_nacimiento ? j.fecha_nacimiento.split('T')[0] : '', correo: j.correo || '', telefono: j.telefono || '', numero_dorsal: j.numero_dorsal || '', foto_url: j.foto_url || '', es_capitan: equipoSeleccionado?.capitan_id === j.id });
  };

  const cambiarEstadoJugador = async (id, estadoActual) => {
    const nuevoEstado = estadoActual === 'Activo' ? 'Inactivo' : 'Activo';
    if (nuevoEstado === 'Inactivo' && equipoSeleccionado.capitan_id === id) {
      const otrosActivos = jugadores.filter(j => j.id !== id && j.estado === 'Activo');
      if (otrosActivos.length === 0) return mostrarToast('No puedes desactivar al único jugador (capitán). Registra a otro primero.', 'error');
      setModalCapitan({ visible: true, viejoId: id, equipoId: equipoSeleccionado.id, candidatos: otrosActivos, nuevoCapitanId: otrosActivos[0].id });
      return;
    }
    if (!window.confirm(`¿Cambiar estado a ${nuevoEstado}?`)) return;
    const res = await fetchConToken(`/jugadores/${id}/estado`, { method: 'PUT', body: JSON.stringify({ estado: nuevoEstado }) });
    if (res.ok) seleccionarEquipoModal(equipoSeleccionado);
  };

  const confirmarReemplazoCapitan = async (e) => {
    e.preventDefault();
    const res = await fetchConToken(`/jugadores/${modalCapitan.viejoId}/estado`, { 
      method: 'PUT', 
      body: JSON.stringify({ estado: 'Inactivo', nuevo_capitan_id: modalCapitan.nuevoCapitanId, equipo_id: modalCapitan.equipoId }) 
    });
    const data = await res.json();
    if (res.ok) {
      mostrarToast(data.mensaje || 'Capitán reemplazado con éxito.', 'exito');
      setModalCapitan({ visible: false, viejoId: null, equipoId: null, candidatos: [], nuevoCapitanId: '' });
      seleccionarEquipoModal(equipoSeleccionado);
      cargarDatos();
    } else mostrarToast(data.error || 'Error al reemplazar capitán.', 'error');
  };

  const iniciarTransferencia = (j) => {
    setModalTransferencia({ jugador: j, equipo_destino_id: '', numero_dorsal: j.numero_dorsal || '', motivo: '' });
  };

  const confirmarTransferencia = async (e) => {
    e.preventDefault();
    const m = modalTransferencia;
    if (!m || !m.jugador) return;
    if (!m.equipo_destino_id) return mostrarToast('Selecciona el equipo destino.', 'error');
    const dorsalNum = parseInt(m.numero_dorsal, 10);
    if (!dorsalNum || dorsalNum < 1 || dorsalNum > 99) return mostrarToast('El dorsal debe ser un número entre 1 y 99.', 'error');
    const res = await fetchConToken(`/jugadores/${m.jugador.id}/transferencia`, { method: 'POST', body: JSON.stringify({ equipo_destino_id: m.equipo_destino_id, numero_dorsal: dorsalNum, motivo: m.motivo || null }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      mostrarToast(data.mensaje || 'Jugador transferido con éxito.', 'exito');
      setModalTransferencia(null);
      await cargarDatos();
      if (equipoSeleccionado) await seleccionarEquipoModal(equipoSeleccionado);
    } else {
      mostrarToast(data.error || 'No se pudo transferir el jugador.', 'error');
    }
  };

  const generarEstructuraPartidosPersonalizada = () => {
    if (equiposSeleccionadosTorneo.length < 2) return mostrarToast('Debes seleccionar al menos 2 equipos.', 'error');
    let nuevosPartidos = [];
    const defaultSede = recursosTorneo.sedes[0]?.id || '';
    const defaultArbitro = recursosTorneo.arbitros.length === 1 ? recursosTorneo.arbitros[0].id : '';
    const defaultAnotador = recursosTorneo.anotadores.length === 1 ? recursosTorneo.anotadores[0].id : '';
    const sistema = formTorneo.sistema_clasificacion;

    categoriasSeleccionadas.forEach(cat => {
      let listaCat = equiposSeleccionadosTorneo.filter(id => {
        const eq = recursosTorneo.equipos.find(x => x.id === id);
        return `${eq.categoria} - ${eq.tipo_genero}` === cat;
      });
      listaCat.sort(() => Math.random() - 0.5); 
      if (listaCat.length < 2) return; 

      if (sistema === 'liga_semifinales') {
        for (let i = 0; i < listaCat.length; i++) for (let j = i + 1; j < listaCat.length; j++) nuevosPartidos.push({ local_id: listaCat[i], visita_id: listaCat[j], sede_id: defaultSede, arbitro_id: defaultArbitro, anotador_id: defaultAnotador, fecha_hora: '', fase: `Liga - ${cat}` });
        nuevosPartidos.push({ local_id: '', visita_id: '', sede_id: defaultSede, arbitro_id: defaultArbitro, anotador_id: defaultAnotador, fecha_hora: '', fase: `Semifinal 1 - ${cat}` });
        nuevosPartidos.push({ local_id: '', visita_id: '', sede_id: defaultSede, arbitro_id: defaultArbitro, anotador_id: defaultAnotador, fecha_hora: '', fase: `Semifinal 2 - ${cat}` });
        if (formTorneo.incluir_tercer_lugar) nuevosPartidos.push({ local_id: '', visita_id: '', sede_id: defaultSede, arbitro_id: defaultArbitro, anotador_id: defaultAnotador, fecha_hora: '', fase: `3er Lugar - ${cat}` });
        nuevosPartidos.push({ local_id: '', visita_id: '', sede_id: defaultSede, arbitro_id: defaultArbitro, anotador_id: defaultAnotador, fecha_hora: '', fase: `Gran Final - ${cat}` });
      } else if (sistema === 'liga_final_directa') {
        for (let i = 0; i < listaCat.length; i++) for (let j = i + 1; j < listaCat.length; j++) nuevosPartidos.push({ local_id: listaCat[i], visita_id: listaCat[j], sede_id: defaultSede, arbitro_id: defaultArbitro, anotador_id: defaultAnotador, fecha_hora: '', fase: `Liga - ${cat}` });
        nuevosPartidos.push({ local_id: '', visita_id: '', sede_id: defaultSede, arbitro_id: defaultArbitro, anotador_id: defaultAnotador, fecha_hora: '', fase: `Gran Final - ${cat}` });
      }
    });

    if(nuevosPartidos.length === 0) return mostrarToast('No hay suficientes equipos por categoría.', 'error');
    setPartidosIniciales(nuevosPartidos); setPasoTorneo(3);
  };

  // ===== LOTE P: TORNEOS FLASH =====
  // Las plantillas de reglas solo se cargan al abrir la sub pestaña
  // 'reglas'; en flash también se necesitan para el select opcional.
  useEffect(() => {
    if (subPestanaTorneo !== 'flash' || plantillasReglas.length > 0) return;
    fetchConToken('/plantillas-reglas')
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (Array.isArray(data)) setPlantillasReglas(data); })
      .catch(() => {});
  }, [subPestanaTorneo, plantillasReglas.length]);

  const participanteFlashVacio = () => ({ cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', telefono: '' });

  // Igual que el backend: M = max(2, redondeo(N / 4)) equipos
  const equiposEstimadosFlash = () => Math.max(2, Math.round(participantesFlash.filter(p => String(p.cedula || '').trim() !== '').length / 4));

  const buscarSugerenciasCedula = (cedula, idx) => {
    const limpio = String(cedula || '').replace(/\D/g, '');
    if (temporizadorAutocomplete.current) clearTimeout(temporizadorAutocomplete.current);
    if (limpio.length < 3) { setSugerenciasCedula({ visible: false, idx: -1, items: [] }); return; }
    temporizadorAutocomplete.current = setTimeout(async () => {
      try {
        const res = await fetchConToken('/autocomplete/cedula?q=' + encodeURIComponent(limpio));
        if (res.ok) {
          const data = await res.json();
          setSugerenciasCedula({ visible: true, idx, items: Array.isArray(data.resultados) ? data.resultados : [] });
        }
      } catch (err) { /* autocompletado silencioso */ }
    }, 350);
  };

  const elegirSugerenciaCedula = (s) => {
    const idxSel = sugerenciasCedula.idx;
    setParticipantesFlash(prev => prev.map((p, i) => i !== idxSel ? p : { ...p, cedula: s.cedula, nombre: s.nombre, apellido: s.apellido, fecha_nacimiento: s.fecha_nacimiento || '', telefono: s.telefono || '' }));
    setSugerenciasCedula({ visible: false, idx: -1, items: [] });
  };

  const actualizarParticipanteFlash = (idx, campo, valor) => {
    setParticipantesFlash(prev => prev.map((p, i) => i !== idx ? p : { ...p, [campo]: valor }));
    if (campo === 'cedula') buscarSugerenciasCedula(valor, idx);
  };

  const agregarParticipanteFlash = () => {
    if (participantesFlash.length >= 48) return mostrarToast('Un torneo flash admite máximo 48 asistentes.', 'error');
    setParticipantesFlash(prev => [...prev, participanteFlashVacio()]);
  };

  const quitarParticipanteFlash = (idx) => {
    if (participantesFlash.length <= 2) return mostrarToast('Deja al menos 2 filas para anotar asistentes.', 'error');
    setParticipantesFlash(prev => prev.filter((_, i) => i !== idx));
    setSugerenciasCedula({ visible: false, idx: -1, items: [] });
  };

  const reiniciarFormularioFlash = () => {
    setResultadoFlash(null);
    setFormFlash({ nombre: '', sede_id: '', fecha_hora_inicio: '', minutos_entre_partidos: 45, plantilla_id: '', arbitro_id: '', anotador_id: '', ida_y_vuelta: false });
    setParticipantesFlash([participanteFlashVacio(), participanteFlashVacio()]);
    setSugerenciasCedula({ visible: false, idx: -1, items: [] });
  };

  const crearTorneoFlash = async (e) => {
    e.preventDefault();
    if (creandoFlash) return;
    if (!formFlash.nombre.trim()) return mostrarToast('Escribe un nombre para el torneo flash.', 'error');
    if (!formFlash.fecha_hora_inicio) return mostrarToast('Selecciona la fecha y hora de inicio.', 'error');
    if (!formFlash.sede_id) return mostrarToast('Selecciona la instalación donde se jugará.', 'error');
    const asistentes = participantesFlash
      .map(p => ({ cedula: String(p.cedula || '').trim(), nombre: String(p.nombre || '').trim(), apellido: String(p.apellido || '').trim(), fecha_nacimiento: p.fecha_nacimiento || null, telefono: String(p.telefono || '').trim() || null }))
      .filter(p => p.cedula !== '' && p.nombre !== '');
    if (asistentes.length < 4) return mostrarToast('Inscribe al menos 4 asistentes con cédula y nombre: el sorteo los reparte en equipos.', 'error');
    if (asistentes.length > 48) return mostrarToast('Un torneo flash admite máximo 48 asistentes.', 'error');
    const cedulasAsistentes = asistentes.map(p => p.cedula);
    if (new Set(cedulasAsistentes).size !== cedulasAsistentes.length) return mostrarToast('Hay cédulas repetidas en la lista de asistentes.', 'error');
    const cedulaInvalida = asistentes.find(p => p.cedula.replace(/\D/g, '').length < 5 || p.cedula.replace(/\D/g, '').length > 8);
    if (cedulaInvalida) return mostrarToast('La cédula de ' + cedulaInvalida.nombre + ' debe tener entre 5 y 8 dígitos.', 'error');
    setCreandoFlash(true);
    try {
      const res = await fetchConToken('/torneos-flash', { method: 'POST', body: JSON.stringify({ ...formFlash, minutos_entre_partidos: parseInt(formFlash.minutos_entre_partidos) || 45, jugadores: asistentes }) });
      const data = await res.json();
      setCreandoFlash(false);
      if (res.ok) {
        setResultadoFlash(data);
        setSugerenciasCedula({ visible: false, idx: -1, items: [] });
        mostrarToast(data.mensaje || 'Torneo flash creado.', 'exito');
        cargarDatos();
      } else {
        mostrarToast(data.error || 'No se pudo crear el torneo flash.', 'error');
      }
    } catch (err) {
      setCreandoFlash(false);
      mostrarToast('Error de conexión al crear el torneo flash.', 'error');
    }
  };

  const guardarTorneoCompleto = async (e) => {
    e.preventDefault();
    if (formTorneo.fecha_fin && formTorneo.fecha_fin < formTorneo.fecha_inicio) return mostrarToast('La fecha de cierre no puede ser anterior a la fecha de inicio.', 'error');
    const res = await fetchConToken('/torneos', { method: 'POST', body: JSON.stringify({ ...formTorneo, categorias_permitidas: [`${formTorneo.categoria} - ${formTorneo.tipo_genero}`], partidos_iniciales: partidosIniciales }) });
    const data = await res.json();
    if (res.ok) { setMensaje('Torneo creado.'); setPartidosIniciales([]); setPasoTorneo(1); setSubPestanaTorneo('lista'); cargarDatos(); } else { mostrarToast(data.error, 'error'); }
  };

  const actualizarTorneoEdicion = async (e) => {
    e.preventDefault();
    if (torneoEditando.fecha_fin && torneoEditando.fecha_fin < torneoEditando.fecha_inicio) return mostrarToast('La fecha de cierre no puede ser anterior a la fecha de inicio.', 'error');
    const res = await fetchConToken(`/torneos/${torneoEditando.id}`, { method: 'PUT', body: JSON.stringify({ nombre: torneoEditando.nombre, fecha_inicio: torneoEditando.fecha_inicio, fecha_fin: torneoEditando.fecha_fin, estado: torneoEditando.reglas?.estado || 'Activo' }) });
    if (res.ok) { setMensaje('Torneo actualizado.'); setTorneoEditando(null); cargarDatos(); }
  };

  const guardarCredencial = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/crear-credencial', { method: 'POST', body: JSON.stringify(formCredencial) });
    const data = await res.json();
    if (res.ok) { setMensaje(data.mensaje); setFormCredencial({ nombre: '', apellido: '', cedula: '', email: '', rol: 'arbitro', equipo_id: '' }); cargarDatos(); } else { mostrarToast(data.error, 'error'); }
  };

  const resetearPasswordOperativo = async (userId, cedula, nombre) => {
    if (!window.confirm(`¿Restablecer contraseña para ${nombre}?`)) return;
    const res = await fetchConToken(`/usuarios/${userId}/reset-password`, { method: 'POST' });
    const data = await res.json(); if (res.ok) mostrarToast(data.mensaje, 'exito'); else mostrarToast(data.error, 'error');
  };

  const reasignarDelegado = async (equipoId, delegadoId) => {
    const res = await fetchConToken(`/equipos/${equipoId}/delegado`, { method: 'PUT', body: JSON.stringify({ delegado_id: delegadoId }) });
    if (res.ok) { setMensaje('Delegado reasignado.'); cargarDatos(); }
  };

  const cambiarClaveObligatoria = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/cambiar-password-obligatorio', { method: 'POST', body: JSON.stringify({ nueva_password: nuevaClave }) });
    if (res.ok) { mostrarToast('Contraseña actualizada.', 'exito'); setDebeCambiarPass(false); }
  };

const confirmarReagendar = async (e) => {
    e.preventDefault();
    if (modalReagendar.nuevaFecha && modalReagendar.nuevaFecha < ahoraIsoLocal) return mostrarToast('La nueva fecha y hora no puede estar en el pasado.', 'error');
    try {
      const res = await fetchConToken(`/partidos/${modalReagendar.partido.id}/reagendar`, { 
        method: 'PUT', 
        body: JSON.stringify({ nueva_fecha_hora: modalReagendar.nuevaFecha }) 
      });
      
      const data = await res.json();
      
      if (res.ok) { 
        mostrarToast('Partido reagendado exitosamente.', 'exito'); 
        setModalReagendar({ visible: false, partido: null, nuevaFecha: '' });
        cargarDatos(); 
      } else {
        mostrarToast(data.error || 'Error al intentar reagendar el partido.', 'error');
      }
    } catch (error) {
      mostrarToast('Error de conexión con el servidor al reagendar.', 'error');
    }
  };

  const confirmarEditarPartido = async (e) => {
    e.preventDefault();
    if (modalEditarPartido.fecha_hora && modalEditarPartido.fecha_hora < ahoraIsoLocal) return mostrarToast('La nueva fecha y hora no puede estar en el pasado.', 'error');
    const res = await fetchConToken(`/partidos/${modalEditarPartido.partido.id}/editar-oficiales`, { 
      method: 'PUT', 
      body: JSON.stringify({ 
        fecha_hora: modalEditarPartido.fecha_hora, 
        arbitro_id: modalEditarPartido.arbitro_id, 
        anotador_id: modalEditarPartido.anotador_id, 
        sede_id: modalEditarPartido.sede_id 
      }) 
    });
    const data = await res.json();
    if(res.ok) { 
      mostrarToast(data.mensaje, 'exito'); 
      setModalEditarPartido({ visible: false, partido: null, fecha_hora: '', arbitro_id: '', anotador_id: '', sede_id: '' }); 
      cargarDatos(); 
    } else { mostrarToast(data.error, 'error'); }
  };

  const exportarPlanillaFormato = async (partidoId, formato) => {
    try {
      setMensaje(`Generando archivo ${formato.toUpperCase()} de la planilla...`);
      const resPart = await fetchConToken(`/publico/partidos/${partidoId}`);
      const partidoData = await resPart.json();
      const resNom = await fetchConToken(`/publico/partidos/${partidoId}/nomina`);
      const nominaData = await resNom.json();

      const nombreArchivo = `Planilla_${partidoData.local_nombre}_vs_${partidoData.visita_nombre}`.replace(/\s+/g, '_');

      if (formato === 'json') {
        const blob = new Blob([JSON.stringify({ partido: partidoData, nomina: nominaData }, null, 2)], { type: 'application/json' });
        descargarBlob(blob, `${nombreArchivo}.json`);
      } else if (formato === 'csv') {
        let csv = `Encuentro,${partidoData.local_nombre} vs ${partidoData.visita_nombre}\nFecha,${partidoData.fecha_hora}\n\nCedula,Nombre,Apellido,Dorsal,Equipo\n`;
        nominaData.forEach(j => { csv += `${j.cedula},"${j.nombre}","${j.apellido}",${j.numero_dorsal},"${j.equipo_nombre || 'N/A'}"\n`; });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        descargarBlob(blob, `${nombreArchivo}.csv`);
      } else if (formato === 'excel') {
        let html = `<table border="1"><tr><th>Encuentro</th><th>${partidoData.local_nombre} vs ${partidoData.visita_nombre}</th></tr>`;
        html += `<tr><th>Fecha</th><th>${partidoData.fecha_hora}</th></tr></table><br/>`;
        html += `<table border="1"><tr><th>Cédula</th><th>Nombre</th><th>Apellido</th><th>Dorsal</th></tr>`;
        nominaData.forEach(j => { html += `<tr><td>${j.cedula}</td><td>${j.nombre}</td><td>${j.apellido}</td><td>${j.numero_dorsal}</td></tr>`; });
        html += `</table>`;
        const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
        descargarBlob(blob, `${nombreArchivo}.xls`);
      } else if (formato === 'pdf') {
        const pdf = new jsPDF();
        const pageWidth = pdf.internal.pageSize.getWidth();
        pdf.setFillColor(34, 78, 105); pdf.rect(0, 0, pageWidth, 22, 'F');
        let margenTexto = 14;
        if (orgData.logo_url && !orgData.logo_url.startsWith('data:image/webp')) {
          try {
            pdf.setFillColor(255, 255, 255); pdf.rect(6, 2.5, 18, 17, 'F');
            pdf.addImage(orgData.logo_url, orgData.logo_url.startsWith('data:image/png') ? 'PNG' : 'JPEG', 7, 3.5, 16, 15);
            margenTexto = 28;
          } catch (e) { margenTexto = 14; }
        }
        pdf.setTextColor(255, 255, 255); pdf.setFontSize(14); pdf.text('CONMINGO · PLANILLA OFICIAL', margenTexto, 10); pdf.setFontSize(9); pdf.text('Documento pre-impreso del encuentro', margenTexto, 17);
        pdf.setTextColor(70, 45, 30); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
        pdf.text(`${partidoData.local_nombre || 'Por definir'} vs ${partidoData.visita_nombre || 'Por definir'}`, 14, 32);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
        pdf.text(`Fecha: ${partidoData.fecha_hora}   |   Generado: ${new Date().toLocaleString('es-VE')}`, 14, 38);
        autoTable(pdf, { startY: 44, head: [['Cédula', 'Nombre', 'Apellido', 'Dorsal', 'Equipo']], body: nominaData.map(j => [j.cedula ?? '—', j.nombre ?? '—', j.apellido ?? '—', j.numero_dorsal ?? '—', j.equipo_nombre || 'N/A']), styles: { fontSize: 8 }, headStyles: { fillColor: [34, 78, 105] } });
        const filaFirmas = (pdf.lastAutoTable ? pdf.lastAutoTable.finalY : 60) + 30;
        pdf.setDrawColor(120); pdf.line(14, filaFirmas, 80, filaFirmas); pdf.line(120, filaFirmas, 186, filaFirmas);
        pdf.setFontSize(8); pdf.setTextColor(100); pdf.text('Firma Árbitro', 14, filaFirmas + 5); pdf.text('Firma Anotador', 120, filaFirmas + 5);
        pdf.save(`${nombreArchivo}.pdf`);
      }
      setMensaje('');
    } catch (e) { setMensaje('Error al exportar la planilla.'); }
  };

  const exportarReporteEstadisticas = (formato) => {
    if (!estadisticas) return mostrarToast('No hay datos estadísticos cargados.', 'error');
    const nombreArchivo = `Reporte_Estadisticas_Liga_${temporadaFiltro}`;

    if (formato === 'json') {
      const blob = new Blob([JSON.stringify(estadisticas, null, 2)], { type: 'application/json' });
      descargarBlob(blob, `${nombreArchivo}.json`);
    } else if (formato === 'csv') {
      let csv = `Metrica,Valor\nPartidos Jugados,${estadisticas.partidos_jugados}\nTorneos Totales,${estadisticas.total_torneos}\nEquipos Inscritos,${estadisticas.total_equipos}\nJugadores Activos,${estadisticas.total_jugadores}\nTarjetas Acumuladas,${estadisticas.total_tarjetas}\n\nJugador,Equipo,Jugadas Efectivas\n`;
      estadisticas.mejores_jugadores.forEach(j => { csv += `"${j.nombre} ${j.apellido}","${j.equipo}",${j.efectivas}\n`; });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      descargarBlob(blob, `${nombreArchivo}.csv`);
    } else if (formato === 'excel') {
      let html = `<table border="1"><tr><th>Métrica</th><th>Valor</th></tr>`;
      html += `<tr><td>Partidos Jugados</td><td>${estadisticas.partidos_jugados}</td></tr>`;
      html += `<tr><td>Torneos Totales</td><td>${estadisticas.total_torneos}</td></tr>`;
      html += `<tr><td>Equipos Inscritos</td><td>${estadisticas.total_equipos}</td></tr>`;
      html += `<tr><td>Jugadores Activos</td><td>${estadisticas.total_jugadores}</td></tr>`;
      html += `<tr><td>Tarjetas Acumuladas</td><td>${estadisticas.total_tarjetas}</td></tr></table><br/>`;
      html += `<table border="1"><tr><th>Jugador</th><th>Equipo</th><th>Efectivas</th></tr>`;
      estadisticas.mejores_jugadores.forEach(j => { html += `<tr><td>${j.nombre} ${j.apellido}</td><td>${j.equipo}</td><td>${j.efectivas}</td></tr>`; });
      html += `</table>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
      descargarBlob(blob, `${nombreArchivo}.xls`);
    } else if (formato === 'pdf') {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      pdf.setFillColor(34, 78, 105); pdf.rect(0, 0, pageWidth, 22, 'F');
      let margenTexto = 14;
      if (orgData.logo_url && !orgData.logo_url.startsWith('data:image/webp')) {
        try {
          pdf.setFillColor(255, 255, 255); pdf.rect(6, 2.5, 18, 17, 'F');
          pdf.addImage(orgData.logo_url, orgData.logo_url.startsWith('data:image/png') ? 'PNG' : 'JPEG', 7, 3.5, 16, 15);
          margenTexto = 28;
        } catch (e) { margenTexto = 14; }
      }
      pdf.setTextColor(255, 255, 255); pdf.setFontSize(14); pdf.text('CONMINGO · REPORTE OFICIAL', margenTexto, 10); pdf.setFontSize(9); pdf.text('Estadísticas de la liga', margenTexto, 17);
      pdf.setTextColor(70, 45, 30); pdf.setFontSize(8);
      pdf.text(`Usuario: ${usuario?.email || usuario?.nombre || usuario?.username}   |   Generado: ${new Date().toLocaleString('es-VE')}   |   Temporada: ${temporadaFiltro}`, 14, 30);
      autoTable(pdf, { startY: 36, head: [['Métrica', 'Valor']], body: [['Partidos Jugados', estadisticas.partidos_jugados ?? '—'], ['Torneos Totales', estadisticas.total_torneos ?? '—'], ['Equipos Inscritos', estadisticas.total_equipos ?? '—'], ['Jugadores Activos', estadisticas.total_jugadores ?? '—'], ['Tarjetas Acumuladas', estadisticas.total_tarjetas ?? '—']], styles: { fontSize: 8 }, headStyles: { fillColor: [34, 78, 105] } });
      if (estadisticas.mejores_jugadores?.length) {
        autoTable(pdf, { startY: (pdf.lastAutoTable ? pdf.lastAutoTable.finalY : 60) + 8, head: [['Jugador', 'Equipo', 'Jugadas efectivas']], body: estadisticas.mejores_jugadores.map(j => [`${j.nombre} ${j.apellido}`, j.equipo || '—', j.efectivas ?? '—']), styles: { fontSize: 8 }, headStyles: { fillColor: [34, 78, 105] } });
      }
      pdf.save(`${nombreArchivo}.pdf`);
    }
  };

  const descargarBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const eliminarEquipo = async (id, nombre) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar permanentemente el equipo "${nombre}"?`)) return;
    const res = await fetchConToken(`/equipos/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      mostrarToast(data.mensaje, 'exito');
      if (equipoSeleccionado?.id === id) setEquipoSeleccionado(null);
      cargarDatos();
    } else mostrarToast(data.error, 'error');
  };

  // Íconos SVG para la barra lateral
  const NavIcon = ({ pestanaId }) => {
    switch (pestanaId) {
      case 'equipos': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
      case 'sedes': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
      case 'credenciales': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" /></svg>;
      case 'reglas': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
      case 'torneos': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>;
      case 'estadisticas': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
      case 'historial': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
      case 'bitacora': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5h6m-8 4h10m-10 4h6m-6 4h10M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /></svg>;
      default: return null;
    }
  };

  const filasSedes = filteredRows('sedes', sedes, ['nombre'], []);
  const filasEquipos = filteredRows('equipos', equipos, ['categoria', 'tipo_genero'], []);
  const filasNomina = filteredRows('nomina', jugadores, ['genero', 'sexo'], ['fecha_nacimiento']);
  const credencialesConEquipo = usuariosOperativos.map(usuarioOperativo => ({
    ...usuarioOperativo,
    equipo_filtro: equipos.filter(equipo => String(equipo.delegado_id_usuario) === String(usuarioOperativo.id)).map(equipo => equipo.nombre),
  }));
  const filasCredenciales = filteredRows('credenciales', credencialesConEquipo, ['rol', 'equipo_filtro'], []);
  const filasReglas = filteredRows('reglas', plantillasReglas, [], ['creado_en']);
  const torneosConEquipos = torneosList.map(torneo => ({
    ...torneo,
    equipos_filtro: [...new Set((torneo.partidos || []).flatMap(partido => [partido.local_nombre, partido.visita_nombre]).filter(Boolean))],
  }));
  const filasTorneos = filteredRows('torneos', torneosConEquipos, ['categoria', 'tipo_genero', 'temporada', 'equipos_filtro'], ['fecha_inicio', 'fecha_fin']);
  const partidosFinalizados = partidos.filter(p => p.estado === 'Finalizado').map(partido => ({
    ...partido,
    resultado_filtro: partido.marcador_local === partido.marcador_visita ? 'Empate' : partido.marcador_local > partido.marcador_visita ? 'Ganador local' : 'Ganador visitante',
  }));
  const filasHistorial = filteredRows('historial', partidosFinalizados, ['torneo_nombre', 'local_nombre', 'visita_nombre', 'resultado_filtro'], ['fecha_hora']);
  const filasSuspendidos = filteredRows('suspendidos', partidos.filter(p => p.estado === 'Suspendido'), ['estado', 'fase'], ['fecha_hora']);
const bitacoraConTexto = bitacora.map(evento => ({
  ...evento,
  usuario: [evento.usuario_nombre, evento.usuario_apellido].filter(Boolean).join(' ') || evento.usuario_email || 'Usuario',
  fecha_hora: evento.fecha,
  accion_legible: evento.accion_descripcion || evento.accion || 'Acción no especificada',
  recurso_legible: evento.tabla === 'admin-liga' ? 'Módulo administrador de liga' : (evento.tabla || 'No especificado'),
  }));
  const filasBitacora = filteredRows('bitacora', bitacoraConTexto, ['accion', 'tabla', 'usuario_rol', 'usuario'], ['fecha_hora']);

  // Filtrado de delegados que ya están asignados a un equipo
  const delegadosOcupados = equipos.map(eq => String(eq.delegado_id_usuario)).filter(id => id !== 'null' && id !== 'undefined' && id !== '');

  return (
    <div className="flex h-screen w-full bg-brand-cream font-sans overflow-hidden">
      <SistemaMensajeria usuario={usuario} token={token} />
      <ToastContainer toasts={toasts} onCerrar={cerrarToast} />

      {/* MODALES REUTILIZABLES */}
      {modalCapitan.visible && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-red-600 mb-2 flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              Reemplazo de Capitán Requerido
            </h3>
            <p className="text-sm text-brand-brown/80 mb-4">Estás desactivando al capitán del equipo. Todo equipo debe tener un capitán activo. Selecciona su reemplazo:</p>
            <form onSubmit={confirmarReemplazoCapitan} className="space-y-4">
              <select className="w-full p-2 border border-brand-gold/30 rounded focus:ring-brand-rust focus:border-brand-rust" value={modalCapitan.nuevoCapitanId} onChange={e => setModalCapitan({...modalCapitan, nuevoCapitanId: e.target.value})} required>
                {modalCapitan.candidatos.map(c => <option key={c.id} value={c.id}>{c.nombre} {c.apellido} (Dorsal #{c.numero_dorsal})</option>)}
              </select>
              <div className="flex gap-3">
                <button type="submit" className="flex-1 bg-brand-rust text-white py-2 rounded font-semibold hover:bg-brand-brown transition-colors">Asignar y Continuar</button>
                <button type="button" onClick={() => setModalCapitan({...modalCapitan, visible: false})} className="flex-1 bg-gray-200 text-brand-brown py-2 rounded font-semibold hover:bg-gray-300 transition-colors">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE TRANSFERENCIA DE JUGADOR (LOTE N) */}
      {modalTransferencia && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-brand-brown mb-2">Transferir Jugador</h3>
            <p className="text-sm text-brand-brown/80 mb-4">
              {modalTransferencia.jugador.nombre} {modalTransferencia.jugador.apellido} — Dorsal #{modalTransferencia.jugador.numero_dorsal || '—'}
            </p>
            <form onSubmit={confirmarTransferencia} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-brand-brown/70 mb-1">Equipo destino</label>
                <select className="w-full p-2 border border-brand-gold/30 rounded focus:ring-brand-rust focus:border-brand-rust" value={modalTransferencia.equipo_destino_id} onChange={e => setModalTransferencia({...modalTransferencia, equipo_destino_id: e.target.value})} required>
                  <option value="">Seleccione equipo destino...</option>
                  {equipos.filter(eq => eq.id !== equipoSeleccionado?.id).map(eq => <option key={eq.id} value={eq.id}>{eq.nombre}{eq.categoria ? ' (' + eq.categoria + ' • ' + eq.tipo_genero + ')' : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-brand-brown/70 mb-1">Dorsal en el equipo destino (1-99)</label>
                <input type="number" min="1" max="99" className="w-full p-2 border border-brand-gold/30 rounded focus:ring-brand-rust focus:border-brand-rust" value={modalTransferencia.numero_dorsal} onChange={e => setModalTransferencia({...modalTransferencia, numero_dorsal: e.target.value})} required />
              </div>
              <div>
                <label className="block text-xs font-bold text-brand-brown/70 mb-1">Motivo (opcional, queda en la bitácora)</label>
                <textarea rows="2" className="w-full p-2 border border-brand-gold/30 rounded focus:ring-brand-rust focus:border-brand-rust" value={modalTransferencia.motivo} onChange={e => setModalTransferencia({...modalTransferencia, motivo: e.target.value})}></textarea>
              </div>
              <div className="flex gap-3">
                <button type="submit" className="flex-1 bg-brand-rust text-white py-2 rounded font-semibold hover:bg-brand-brown transition-colors">Transferir</button>
                <button type="button" onClick={() => setModalTransferencia(null)} className="flex-1 bg-gray-200 text-brand-brown py-2 rounded font-semibold hover:bg-gray-300 transition-colors">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalReagendar.visible && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-brand-brown mb-1">Reagendar Partido</h3>
            <p className="text-sm text-brand-brown/70 mb-4">{modalReagendar.partido.local_nombre} vs {modalReagendar.partido.visita_nombre}</p>
            <form onSubmit={confirmarReagendar} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-brand-brown mb-1">Nueva fecha y hora:</label>
                <input type="datetime-local" min={ahoraIsoLocal} className="w-full p-2 border border-brand-gold/30 rounded focus:ring-brand-rust focus:border-brand-rust" value={modalReagendar.nuevaFecha} onChange={e => setModalReagendar({...modalReagendar, nuevaFecha: e.target.value})} required />
              </div>
              <div className="flex gap-3">
                <button type="submit" className="flex-1 bg-brand-blue text-white py-2 rounded font-semibold hover:bg-brand-brown transition-colors">Confirmar Fecha</button>
                <button type="button" onClick={() => setModalReagendar({ visible: false, partido: null, nuevaFecha: '' })} className="flex-1 bg-gray-200 text-brand-brown py-2 rounded font-semibold hover:bg-gray-300 transition-colors">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalEditarPartido.visible && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-brand-brown mb-1">Editar Partido Programado</h3>
            <p className="text-sm text-brand-brown/70 mb-4">{modalEditarPartido.partido.local_nombre} vs {modalEditarPartido.partido.visita_nombre}</p>
            <form onSubmit={confirmarEditarPartido} className="space-y-3">
              <input type="datetime-local" min={ahoraIsoLocal} className="w-full p-2 border border-brand-gold/30 rounded" value={modalEditarPartido.fecha_hora} onChange={e => setModalEditarPartido({...modalEditarPartido, fecha_hora: e.target.value})} required />
              <select className="w-full p-2 border border-brand-gold/30 rounded" value={modalEditarPartido.sede_id} onChange={e => setModalEditarPartido({...modalEditarPartido, sede_id: e.target.value})} required><option value="">-- Sede --</option>{recursosTorneo.sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
              <select className="w-full p-2 border border-brand-gold/30 rounded" value={modalEditarPartido.arbitro_id} onChange={e => setModalEditarPartido({...modalEditarPartido, arbitro_id: e.target.value})}><option value="">-- Árbitro --</option>{recursosTorneo.arbitros.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}</select>
              <select className="w-full p-2 border border-brand-gold/30 rounded" value={modalEditarPartido.anotador_id} onChange={e => setModalEditarPartido({...modalEditarPartido, anotador_id: e.target.value})}><option value="">-- Anotador --</option>{recursosTorneo.anotadores.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}</select>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-brand-blue text-white py-2 rounded font-semibold hover:bg-brand-brown transition-colors">Guardar</button>
                <button type="button" onClick={() => setModalEditarPartido({ visible: false })} className="flex-1 bg-gray-200 text-brand-brown py-2 rounded font-semibold hover:bg-gray-300 transition-colors">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {debeCambiarPass && (
        <div className="fixed inset-0 bg-black/90 flex justify-center items-center z-60 p-4">
          <div className="bg-white p-8 rounded-xl w-full max-w-sm shadow-2xl">
            <h3 className="text-xl font-bold text-brand-brown mb-4 flex items-center gap-2">
              <svg className="w-6 h-6 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7z" /></svg>
              Actualización Obligatoria
            </h3>
            <form onSubmit={cambiarClaveObligatoria} className="space-y-4">
              <input type="password" placeholder="Nueva Contraseña (mín 6 chars)" className="w-full p-3 border border-brand-gold/30 rounded focus:ring-brand-rust focus:border-brand-rust" value={nuevaClave} onChange={e => setNuevaClave(e.target.value)} required minLength={6} />
              <button type="submit" className="w-full bg-brand-rust text-white py-3 rounded font-bold hover:bg-brand-brown transition-colors">Actualizar Contraseña</button>
            </form>
          </div>
        </div>
      )}

  {/* C2: barra lateral retraible como componente compartido */}
      <Sidebar
        logoUrl={orgData.logo_url}
        titulo={orgData.nombre}
        subtitulo="Admin. de Liga"
        grupos={[
          { etiqueta: 'General', items: [
            { id: 'torneos', label: 'Torneos Activos' },
            { id: 'equipos', label: 'Equipos y Nóminas' },
            { id: 'sedes', label: 'Sedes Deportivas' },
          ]},
          { etiqueta: 'Administración', items: [
            { id: 'credenciales', label: 'Credenciales' },
            { id: 'reglas', label: 'Plantillas y Reglas' },
            { id: 'estadisticas', label: 'Estadísticas Globales' },
            { id: 'historial', label: 'Historial / Archivo' },
            { id: 'bitacora', label: 'Bitácora de actividad' },
          ]},
        ]}
        pestana={pestana}
        onPestana={cambiarPestanaConAnimacion}
        animandoBoton={animandoBoton}
        renderIcono={(id) => <NavIcon pestanaId={id} />}
        menuAbierto={menuAbierto}
        onCerrarMenu={() => setMenuAbierto(false)}
        claveColapso="adminLigaSidebarColapsada"
      />

      {/* ÁREA DE CONTENIDO PRINCIPAL */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-brand-cream relative overflow-y-auto"> {/* INSERCIÓN: overflow-y-auto */}
        
        {/* HEADER SUPERIOR */}
        <header className="h-16 sm:h-20 bg-white border-b border-brand-gold/20 flex items-center justify-between px-4 sm:px-6 shadow-sm shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setMenuAbierto(true)} className="md:hidden p-2 text-brand-brown hover:bg-brand-cream rounded-md">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <h2 className="text-2xl font-bold text-brand-brown hidden sm:block">
              {pestana.charAt(0).toUpperCase() + pestana.slice(1)}
            </h2>
          </div>
          
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 bg-brand-blue/10 text-brand-blue hover:bg-brand-blue hover:text-white px-4 py-2 rounded-lg font-semibold text-sm cursor-pointer transition-colors shadow-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              Actualizar Logo
              <input type="file" accept="image/*" onChange={subirLogoOrganizacion} className="hidden" />
            </label>
            <button onClick={cerrarSesion} className="flex items-center gap-2 px-4 py-2 bg-brand-brown text-brand-cream hover:bg-brand-rust rounded-lg font-semibold text-sm transition-colors shadow-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Cerrar Sesión</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-8">

            {mensaje && (
              <div className="mb-6 bg-green-50 border-l-4 border-green-500 p-4 rounded shadow-sm flex items-center gap-3 animate-fade-in">
                <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                <p className="text-sm font-medium text-green-800">{mensaje}</p>
              </div>
            )}

            {/* === VISTA: SEDES === */}
            {pestana === 'sedes' && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                  <h3 className="text-lg font-bold text-brand-brown mb-4 flex items-center gap-2">
                    <NavIcon pestanaId="sedes" />
                    {sedeEditando ? 'Editar Sede Deportiva' : 'Registrar Nueva Sede'}
                  </h3>
                  <form onSubmit={guardarSede} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <CampoTexto etiqueta="Nombre de la Sede" valor={formSede.nombre} onChange={e => setFormSede({...formSede, nombre: e.target.value})} requerido />
                    <CampoTexto etiqueta="Dirección / Ubicación" valor={formSede.direccion} onChange={e => setFormSede({...formSede, direccion: e.target.value})} />
                    <div className="md:col-span-2 flex gap-3">
                      <button type="submit" className="bg-brand-rust text-white px-6 py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md">{sedeEditando ? 'Actualizar Sede' : 'Guardar Sede'}</button>
                      {sedeEditando && <button type="button" onClick={() => { setSedeEditando(null); setFormSede({ nombre: '', direccion: '' }); }} className="bg-gray-200 text-brand-brown px-6 py-3 rounded-lg font-bold hover:bg-gray-300 transition-colors">Cancelar</button>}
                    </div>
                  </form>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <h3 className="text-lg font-bold text-brand-brown">Listado de Sedes</h3>
                    <div className="relative w-full sm:w-64">
                      <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      <input type="text" placeholder="Buscar sede..." className="w-full pl-10 pr-3 py-2 bg-white border border-brand-gold/40 rounded-lg text-sm text-brand-brown outline-none transition focus:border-brand-rust focus:ring-2 focus:ring-brand-gold/20 shadow-sm" value={busquedaSedes} onChange={e => setBusquedaSedes(e.target.value)} />
                    </div>
                  </div>
                  <TableTools reportContext={{ usuario: usuario?.email || usuario?.nombre || usuario?.username }} logoUrl={orgData.logo_url} rows={sedes} filteredRows={filasSedes} filter={getFilter('sedes')} setFilter={setTableFilter('sedes')} columns={[{ key: 'nombre', label: 'Sede' }, { key: 'direccion', label: 'Dirección' }]} filename="sedes_filtradas" />
                      <div className="overflow-x-auto">
                        <table className="tabla-admin">
                      <thead>
                        <tr>
                          <th>Sede</th>
                          <th>Dirección</th>
                          <th className="text-center w-32">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filasSedes.filter(s => s.nombre.toLowerCase().includes(busquedaSedes.toLowerCase())).map(s => (
                          <tr key={s.id} className="group">
                            <td className="font-bold">{s.nombre}</td>
                            <td className="text-brand-brown/80">{s.direccion || 'Sin dirección'}</td>
                            <td className="flex gap-2 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => { setSedeEditando(s); setFormSede({ nombre: s.nombre, direccion: s.direccion || '' }); }} className="p-2 bg-brand-blue/10 text-brand-blue hover:bg-brand-blue hover:text-white rounded transition-colors" title="Editar"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                              <button onClick={() => eliminarSede(s.id)} className="p-2 bg-red-100 text-red-600 hover:bg-red-600 hover:text-white rounded transition-colors" title="Eliminar"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* === VISTA: REGLAS === */}
            {pestana === 'reglas' && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                  <h3 className="text-lg font-bold text-brand-brown mb-4 flex items-center gap-2">
                    <NavIcon pestanaId="reglas" />
                    Plantillas de Reglas y Puntuación
                  </h3>
                  <form onSubmit={guardarPlantillaReglas} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="md:col-span-2 lg:col-span-4 space-y-4">
                      <CampoTexto etiqueta="Nombre de la Plantilla" ayuda="Ej. Reglas Oficiales 2026" valor={formReglas.nombre} onChange={e => setFormReglas({...formReglas, nombre: e.target.value})} requerido />
                      <textarea placeholder="Descripción o detalles adicionales" className="w-full p-3 bg-brand-cream/30 border border-brand-gold/30 rounded-lg focus:ring-brand-rust resize-none h-20" value={formReglas.descripcion} onChange={e => setFormReglas({...formReglas, descripcion: e.target.value})} />
                    </div>
                    
                    <CampoTexto etiqueta="Puntos Victoria" tipo="number" valor={formReglas.puntos_victoria} onChange={e => setFormReglas({...formReglas, puntos_victoria: e.target.value})} requerido />
                    <CampoTexto etiqueta="Puntos Empate" tipo="number" valor={formReglas.puntos_empate} onChange={e => setFormReglas({...formReglas, puntos_empate: e.target.value})} requerido />
                    <CampoTexto etiqueta="Puntos Derrota" tipo="number" valor={formReglas.puntos_derrota} onChange={e => setFormReglas({...formReglas, puntos_derrota: e.target.value})} requerido />
                    <CampoTexto etiqueta="Límite Jugadores" tipo="number" min="1" valor={formReglas.limite_jugadores} onChange={e => setFormReglas({...formReglas, limite_jugadores: e.target.value})} requerido />
                    <CampoTexto etiqueta="Meta Tantos" tipo="number" min="1" valor={formReglas.meta_puntos} onChange={e => setFormReglas({...formReglas, meta_puntos: e.target.value})} requerido />
                    <CampoTexto etiqueta="Tiempo (Min)" tipo="number" min="1" valor={formReglas.tiempo_minutos} onChange={e => setFormReglas({...formReglas, tiempo_minutos: e.target.value})} requerido />
                    <CampoTexto etiqueta="Tarjetas Suspensión" tipo="number" min="0" valor={formReglas.tarjetas_suspension} onChange={e => setFormReglas({...formReglas, tarjetas_suspension: e.target.value})} requerido />
                    <CampoTexto etiqueta="Esferas por Equipo" tipo="number" min="1" title="Tope de lanzamientos permitidos por equipo en cada mano" valor={formReglas.esferas_por_equipo} onChange={e => setFormReglas({...formReglas, esferas_por_equipo: e.target.value})} requerido />
                    
                    <div className="space-y-1 lg:col-span-1">
                      <label className="text-xs font-bold text-brand-brown/70 uppercase">Política Llaves</label>
                      <select className="w-full p-2 border border-brand-gold/30 rounded-lg" value={formReglas.politica_clasificacion} onChange={e => setFormReglas({...formReglas, politica_clasificacion: e.target.value})}>
                        <option value="ganador_vs_ganador">Ganador vs Ganador</option>
                        <option value="perdedor_vs_perdedor">Consolación</option>
                        <option value="cruzado">Cruce Olímpico</option>
                      </select>
                    </div>

                    <div className="md:col-span-2 lg:col-span-4 mt-2">
                      <button type="submit" className="bg-brand-blue text-white px-6 py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md">Guardar Plantilla de Reglas</button>
                    </div>
                  </form>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                  <h3 className="text-lg font-bold text-brand-brown mb-4">Plantillas Registradas</h3>
                  <TableTools reportContext={{ usuario: usuario?.email || usuario?.nombre || usuario?.username }} logoUrl={orgData.logo_url} rows={plantillasReglas} filteredRows={filasReglas} filter={getFilter('reglas')} setFilter={setTableFilter('reglas')} columns={[{ key: 'nombre', label: 'Nombre' }, { key: 'descripcion', label: 'Descripción' }, { key: 'creado_en', label: 'Creado' }]} dateFields={["creado_en"]} filename="plantillas_reglas_filtradas" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {plantillasReglas.length === 0 ? (
                      <div className="col-span-full text-center py-8 text-brand-brown/50">No hay plantillas registradas.</div>
                    ) : filasReglas.map(pr => (
                      <div key={pr.id} className="p-4 border border-brand-gold/30 rounded-lg hover:border-brand-blue transition-colors bg-brand-cream/10">
                        <h4 className="font-bold text-brand-brown mb-1">{pr.nombre}</h4>
                        <p className="text-xs text-brand-brown/70 mb-3 line-clamp-2">{pr.descripcion || 'Sin descripción'}</p>
                        <div className="flex flex-wrap gap-2 text-xs font-semibold text-brand-brown/80">
                          <span className="bg-white px-2 py-1 rounded border border-brand-gold/20">V/E/D: {pr.reglas?.puntos_victoria}/{pr.reglas?.puntos_empate}/{pr.reglas?.puntos_derrota}</span>
                          <span className="bg-white px-2 py-1 rounded border border-brand-gold/20">Jugadores: {pr.reglas?.limite_jugadores}</span>
                          <span className="bg-white px-2 py-1 rounded border border-brand-gold/20">Meta: {pr.reglas?.meta_puntos} pts</span>
                          <span className="bg-white px-2 py-1 rounded border border-brand-gold/20">Tiempo: {pr.reglas?.tiempo_minutos}m</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* === VISTA: EQUIPOS === */}
            {pestana === 'equipos' && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                  <h3 className="text-lg font-bold text-brand-brown mb-4 flex items-center gap-2">
                    <NavIcon pestanaId="equipos" />
                    Registrar Nuevo Equipo
                  </h3>
                  <form onSubmit={guardarEquipo} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <CampoTexto etiqueta="Nombre del Equipo" className="flex-1" valor={formEquipo.nombre} onChange={e => setFormEquipo({...formEquipo, nombre: e.target.value})} requerido />
                    <select className="p-3 bg-brand-cream/30 border border-brand-gold/30 rounded-lg focus:ring-brand-rust" value={formEquipo.categoria} onChange={e => setFormEquipo({...formEquipo, categoria: e.target.value})}>
                      <option value="Pre-Infantil (<8)">Pre-Infantil (&lt;8)</option>
                      <option value="Infantil (8-13)">Infantil (8-13)</option>
                      <option value="Adulto 22+">Adulto 22+</option>
                      <option value="Libre">Libre / Ejecutivos</option>
                    </select>
                    <select className="p-3 bg-brand-cream/30 border border-brand-gold/30 rounded-lg focus:ring-brand-rust" value={formEquipo.tipo_genero} onChange={e => setFormEquipo({...formEquipo, tipo_genero: e.target.value})}>
                      <option value="Mixto">Mixto</option>
                      <option value="Femenino">Femenino</option>
                      <option value="Masculino">Masculino</option>
                    </select>
                    <button type="submit" className="w-full min-w-0 bg-brand-rust text-white px-4 py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md whitespace-normal sm:col-span-2 lg:col-span-1">Guardar Equipo</button>
                  </form>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <h3 className="text-lg font-bold text-brand-brown">Listado de Equipos</h3>
                    <div className="relative w-full sm:w-64">
                      <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      <input type="text" placeholder="Buscar equipo..." className="w-full pl-10 pr-3 py-2 bg-white border border-brand-gold/40 rounded-lg text-sm text-brand-brown outline-none transition focus:border-brand-rust focus:ring-2 focus:ring-brand-gold/20 shadow-sm" value={busquedaEquipos} onChange={e => setBusquedaEquipos(e.target.value)} />
                    </div>
                  </div>
                  <TableTools reportContext={{ usuario: usuario?.email || usuario?.nombre || usuario?.username }} logoUrl={orgData.logo_url} rows={equipos} filteredRows={filasEquipos} filter={getFilter('equipos')} setFilter={setTableFilter('equipos')} columns={[{ key: 'nombre', label: 'Equipo' }, { key: 'categoria', label: 'Categoría' }, { key: 'tipo_genero', label: 'Género' }]} categoryFields={["categoria", "tipo_genero"]} filename="equipos_filtrados" />
                  
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filasEquipos.filter(e => e.nombre.toLowerCase().includes(busquedaEquipos.toLowerCase())).map(e => (
                      <div key={e.id} className={`p-5 rounded-xl border transition-all ${equipoSeleccionado?.id === e.id ? 'border-brand-rust bg-brand-rust/5 shadow-md ring-1 ring-brand-rust' : 'border-brand-gold/30 bg-white hover:border-brand-blue hover:shadow-sm'}`}>
                        <div className="flex justify-between items-start mb-3">
                          <h4 className="font-bold text-brand-brown text-lg">{e.nombre}</h4>
                          <span className="text-xs font-semibold bg-brand-cream text-brand-brown px-2 py-1 rounded-full border border-brand-gold/20">{e.categoria} • {e.tipo_genero.charAt(0)}</span>
                        </div>
                        <div className="mb-4">
                          <label className="text-xs font-semibold text-brand-brown/70 block mb-1">Delegado del Equipo:</label>
                          <div className="w-full p-2 text-sm bg-brand-cream/10 border border-brand-gold/30 rounded text-brand-brown font-medium flex items-center gap-2">
                            {(() => {
                              const delegado = usuariosOperativos.find(u => String(u.id) === String(e.delegado_id_usuario));
                              return delegado ? (
                                <>
                                  <svg className="w-4 h-4 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                  {delegado.nombre} {delegado.apellido}
                                </>
                              ) : (
                                <span className="text-brand-brown/50 italic">-- Sin Delegado --</span>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => seleccionarEquipoModal(e)} className="flex-1 bg-brand-blue text-white py-2 rounded text-sm font-semibold hover:bg-brand-brown transition-colors flex items-center justify-center gap-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg> Nómina</button>
                          <button onClick={() => eliminarEquipo(e.id, e.nombre)} className="px-3 bg-red-100 text-red-600 rounded hover:bg-red-600 hover:text-white transition-colors flex items-center justify-center"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* GESTIÓN DE NÓMINA (EQUIPO SELECCIONADO) */}
                  {equipoSeleccionado && (
                    <div className="mt-8 p-6 bg-brand-blue/5 border border-brand-blue/20 rounded-xl relative animate-slide-up">
                      <button onClick={() => setEquipoSeleccionado(null)} className="absolute top-4 right-4 text-brand-brown/50 hover:text-brand-rust"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
                      
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                        <h4 className="text-xl font-bold text-brand-brown flex items-center gap-2">
                          {jugadorEditandoId ? <svg className="w-5 h-5 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg> : <svg className="w-5 h-5 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
                          {jugadorEditandoId ? 'Modificar Jugador' : `Nómina: ${equipoSeleccionado.nombre}`}
                        </h4>
                        <label className="flex items-center gap-2 bg-brand-gold text-brand-brown hover:bg-brand-rust hover:text-white px-4 py-2 rounded-lg font-semibold text-sm cursor-pointer transition-colors shadow-sm">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                          Subir Fotos (Lote)
                          <input type="file" multiple accept="image/*" onChange={manejarBatchUploadJugadores} className="hidden" />
                        </label>
                      </div>

                      <TableTools reportContext={{ usuario: usuario?.email || usuario?.nombre || usuario?.username }} logoUrl={orgData.logo_url} rows={jugadores} filteredRows={filasNomina} filter={getFilter('nomina')} setFilter={setTableFilter('nomina')} columns={[{ key: 'numero_dorsal', label: 'Dorsal' }, { key: 'nombre', label: 'Nombre' }, { key: 'apellido', label: 'Apellido' }, { key: 'cedula', label: 'Cédula' }, { key: 'genero', label: 'Género' }, { key: 'fecha_nacimiento', label: 'Fecha de nacimiento' }]} categoryFields={["genero", "sexo", "tipo_genero", "categoria"]} dateFields={["fecha_nacimiento"]} filename="nomina_filtrada" />
                      <form onSubmit={guardarJugador} className="bg-white p-5 rounded-lg border border-brand-gold/30 shadow-sm mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <CampoTexto etiqueta="Cédula (5-8 dígitos)" pattern="\d{5,8}" valor={formJugador.cedula} onChange={e => setFormJugador({...formJugador, cedula: e.target.value})} requerido />
                        <CampoTexto etiqueta="Nombre" valor={formJugador.nombre} onChange={e => setFormJugador({...formJugador, nombre: e.target.value})} requerido />
                        <CampoTexto etiqueta="Apellido" valor={formJugador.apellido} onChange={e => setFormJugador({...formJugador, apellido: e.target.value})} requerido />
                        <CampoTexto etiqueta="Fecha de nacimiento" tipo="date" max={hoyStr} valor={formJugador.fecha_nacimiento} onChange={e => setFormJugador({...formJugador, fecha_nacimiento: e.target.value})} requerido />
                        <CampoTexto etiqueta="Correo" tipo="email" valor={formJugador.correo} onChange={e => setFormJugador({...formJugador, correo: e.target.value})} requerido />
                        <CampoTexto etiqueta="Teléfono" tipo="tel" pattern="[0-9\-\+ ]+" title="Solo se permiten números, espacios, guiones y el signo +" valor={formJugador.telefono} onChange={e => setFormJugador({...formJugador, telefono: e.target.value})} requerido />
                        <CampoTexto etiqueta="Dorsal" tipo="number" min="1" max="99" valor={formJugador.numero_dorsal} onChange={e => setFormJugador({...formJugador, numero_dorsal: e.target.value})} requerido />

                        <div className="flex items-center gap-3 bg-brand-cream/20 px-3 rounded border border-brand-gold/30">
                          <label className="flex items-center gap-2 text-sm font-semibold text-brand-brown cursor-pointer flex-1">
                            <input type="checkbox" className="w-4 h-4 text-brand-rust rounded focus:ring-brand-rust" checked={formJugador.es_capitan} onChange={e => setFormJugador({...formJugador, es_capitan: e.target.checked})} />
                            Es Capitán
                          </label>
                        </div>

                        <div className="lg:col-span-4 flex flex-col sm:flex-row gap-3 items-center">
                          <label className="text-sm font-semibold flex items-center gap-2 flex-1">
                              Foto Individual: 
                              <input type="file" accept="image/*" onChange={async e => { const f = e.target.files[0]; if(f) setFormJugador({...formJugador, foto_url: await toBase64(f)}); }} className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-brand-blue/10 file:text-brand-blue hover:file:bg-brand-blue/20" />
                            </label>
                          <div className="flex gap-2 w-full sm:w-auto">
                            <button type="submit" disabled={isSubmitting} className={`flex-1 sm:flex-none text-white px-6 py-2.5 rounded font-bold transition-colors shadow-md ${isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-rust hover:bg-brand-brown'}`}>
                              {isSubmitting ? 'Guardando...' : (jugadorEditandoId ? 'Actualizar Jugador' : 'Registrar Jugador')}
                            </button>
                            {jugadorEditandoId && <button type="button" onClick={() => { setJugadorEditandoId(null); setFormJugador({ cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', correo: '', telefono: '', numero_dorsal: '', foto_url: '', es_capitan: false }); }} className="px-6 py-2.5 bg-gray-200 text-brand-brown rounded font-bold hover:bg-gray-300">Cancelar</button>}
                          </div>
                        </div>
                      </form>

                    <div className="overflow-x-auto">
                      <table className="tabla-admin">
                        <thead>
                          <tr>
                            <th className="w-16 text-center"></th>
                            <th className="text-center">Dorsal</th>
                            <th>Jugador</th>
                            <th>Cédula</th>
                            <th className="text-center">Estado</th>
                            <th className="text-center">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {jugadores.length === 0 ? (
                            <tr>
                              <td colSpan="6" className="text-center p-4 text-brand-brown/60">
                                No hay jugadores registrados en esta nómina.
                              </td>
                            </tr>
                          ) : filasNomina.map(j => (
                            <tr key={j.id} className={j.estado !== 'Activo' ? 'opacity-60 bg-gray-50' : ''}>
                              <td className="text-center font-bold text-brand-rust text-lg">#{j.numero_dorsal}</td>
                              <td>
                                <div className="flex items-center gap-3">
                                  {j.foto_url ? (
                                    <FotoJugador src={j.foto_url} nombre={`${j.nombre} ${j.apellido}`} className="w-8 h-8 rounded-full border border-brand-gold/50" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-brand-cream flex items-center justify-center text-xs font-bold text-brand-brown border border-brand-gold/50">
                                      {j.nombre.charAt(0)}{j.apellido.charAt(0)}
                                    </div>
                                  )}
                                  <div className="font-bold">
                                    {j.nombre} {j.apellido}
                                    {equipoSeleccionado.capitan_id === j.id && (
                                      <span className="ml-2 text-xs bg-brand-gold text-brand-brown px-2 py-0.5 rounded-full uppercase tracking-wider">
                                        Capitán
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="text-brand-brown/80 font-medium">{j.cedula}</td>
                              <td className="text-center">
                                <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${j.estado === 'Activo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {j.estado}
                                </span>
                              </td>
                              <td className="p-2">
                                <div className="flex flex-wrap justify-center gap-2">
                                <button type="button" onClick={() => iniciarEdicionJugador(j)} className="min-w-0 flex-1 px-3 py-1.5 bg-brand-blue/10 text-brand-blue hover:bg-brand-blue hover:text-white rounded text-xs font-bold transition-colors shadow-sm sm:flex-none">
                                  Editar
                                </button>
                                <button type="button" onClick={() => cambiarEstadoJugador(j.id, j.estado)} className={`px-3 py-1.5 rounded text-xs font-bold transition-colors shadow-sm ${j.estado === 'Activo' ? 'bg-red-100 text-red-600 hover:bg-red-600 hover:text-white' : 'bg-green-100 text-green-700 hover:bg-green-600 hover:text-white'}`}>
                                  {j.estado === 'Activo' ? 'Desactivar' : 'Activar'}
                                </button>
                                <button type="button" onClick={() => iniciarTransferencia(j)} className="px-3 py-1.5 bg-brand-rust/10 text-brand-rust hover:bg-brand-rust hover:text-white rounded text-xs font-bold transition-colors shadow-sm">
                                  Transferir
                                </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === VISTA: CREDENCIALES === */}
            {pestana === 'credenciales' && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20 flex flex-col lg:flex-row gap-8">
                  
                  <div className="lg:w-1/3 space-y-4">
                    <h3 className="text-lg font-bold text-brand-brown flex items-center gap-2">
                      <NavIcon pestanaId="credenciales" />
                      Nueva Credencial
                    </h3>
                    <p className="text-sm text-brand-brown/70 leading-relaxed">Genera accesos para el personal operativo (Árbitros, Anotadores y Delegados). Ingresa la cédula primero para verificar si el usuario ya existe.</p>
                    
                    <form onSubmit={guardarCredencial} className="space-y-4 bg-brand-cream/20 p-5 rounded-lg border border-brand-gold/20">
                      <CampoTexto etiqueta="Cédula" ayuda="Ej: 12345678" valor={formCredencial.cedula} onChange={e => setFormCredencial({...formCredencial, cedula: e.target.value.replace(/\D/g, '')})} onBlur={async (e) => { const ced = e.target.value; if(ced.length >= 5) { const res = await fetchConToken(`/verificar-cedula/${ced}`); const data = await res.json(); if(data.existe) { mostrarToast(`Usuario encontrado: ${data.usuario.nombre} ${data.usuario.apellido}.`, 'exito'); setFormCredencial(prev => ({...prev, nombre: data.usuario.nombre, apellido: data.usuario.apellido, email: data.usuario.email})); } } }} requerido />

                      <div>
                        <label className="block text-xs font-bold text-brand-brown uppercase mb-1">Rol Operativo</label>
                        <select className="w-full p-2.5 border border-brand-gold/30 rounded focus:ring-brand-rust" value={formCredencial.rol} onChange={e => setFormCredencial({...formCredencial, rol: e.target.value, equipo_id: ''})}>
                          <option value="arbitro">Árbitro</option>
                          <option value="anotador">Anotador</option>
                          <option value="delegado de equipo">Delegado de Equipo</option>
                        </select>
                      </div>

                      {formCredencial.rol === 'delegado de equipo' && (
                        <div className="animate-fade-in">
                          <label className="block text-xs font-bold uppercase mb-1 text-brand-rust">Asignar Equipo</label>
                          <select className="w-full p-2.5 border border-brand-rust/50 rounded focus:ring-brand-rust bg-brand-rust/5" value={formCredencial.equipo_id} onChange={e => { const id = e.target.value; const eq = equipos.find(x => String(x.id) === String(id)); if(eq && eq.capitan_cedula){ setFormCredencial(p => ({...p, equipo_id: id, cedula: eq.capitan_cedula, nombre: eq.capitan_nombre, apellido: eq.capitan_apellido, email: eq.capitan_correo})); } else { setFormCredencial(p => ({...p, equipo_id: id})); } }} required>
                            <option value="">-- Seleccionar Equipo --</option>
                            {equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.nombre} {eq.capitan_nombre ? `(Cap: ${eq.capitan_nombre})` : ''}</option>)}
                          </select>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <CampoTexto etiqueta="Nombre" valor={formCredencial.nombre} onChange={e => setFormCredencial({...formCredencial, nombre: e.target.value})} requerido />
                        <CampoTexto etiqueta="Apellido" valor={formCredencial.apellido} onChange={e => setFormCredencial({...formCredencial, apellido: e.target.value})} requerido />
                      </div>

                      <CampoTexto etiqueta="Correo Electrónico" tipo="email" valor={formCredencial.email} onChange={e => setFormCredencial({...formCredencial, email: e.target.value})} requerido />

                      <button type="submit" className="w-full bg-brand-rust text-white py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md mt-2">Generar Credencial</button>
                    </form>
                  </div>

                  <div className="lg:w-2/3">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                      <h3 className="text-lg font-bold text-brand-brown">Usuarios Operativos en la Liga</h3>
                      <div className="relative w-full sm:w-64">
                        <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                        <input type="text" placeholder="Buscar credencial..." className="w-full pl-10 pr-3 py-2 bg-white border border-brand-gold/40 rounded-lg text-sm text-brand-brown outline-none transition focus:border-brand-rust focus:ring-2 focus:ring-brand-gold/20 shadow-sm" value={busquedaCredenciales} onChange={e => setBusquedaCredenciales(e.target.value)} />
                      </div>
                    </div>

                    <TableTools reportContext={{ usuario: usuario?.email || usuario?.nombre || usuario?.username }} logoUrl={orgData.logo_url} rows={usuariosOperativos} filteredRows={filasCredenciales} filter={getFilter('credenciales')} setFilter={setTableFilter('credenciales')} columns={[{ key: 'nombre', label: 'Nombre' }, { key: 'apellido', label: 'Apellido' }, { key: 'cedula', label: 'Cédula' }, { key: 'email', label: 'Correo' }, { key: 'rol', label: 'Rol' }, { key: 'equipo_filtro', label: 'Equipo' }]} categoryFields={["rol", "equipo_filtro"]} filename="credenciales_filtradas" />
                    <div className="overflow-x-auto border border-brand-gold/20 rounded-lg">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-brand-cream text-brand-brown uppercase tracking-wider text-xs">
                          <tr>
                            <th className="p-3 font-semibold">Usuario</th>
                            <th className="p-3 font-semibold">Rol</th>
                            <th className="p-3 font-semibold">Contacto</th>
                            <th className="p-3 font-semibold text-center">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-gold/20">
                          {filasCredenciales.filter(u => `${u.nombre} ${u.apellido} ${u.cedula} ${u.email} ${(u.equipo_filtro || []).join(' ')}`.toLowerCase().includes(busquedaCredenciales.toLowerCase())).map(u => (
                            <tr key={u.id} className="hover:bg-brand-cream/10">
                              <td className="p-3 font-bold text-brand-brown">{u.nombre} {u.apellido}</td>
                              <td className="p-3"><span className="px-2 py-1 bg-brand-blue/10 text-brand-blue rounded text-xs font-bold uppercase">{u.rol}</span></td>
                              <td className="p-3 text-xs text-brand-brown/70"><div>{u.cedula}</div><div>{u.email}</div></td>
                              <td className="p-3 flex justify-center gap-2">
                                <button onClick={() => resetearPasswordOperativo(u.id, u.cedula, u.nombre)} className="px-3 py-1.5 bg-brand-gold text-brand-brown hover:bg-brand-brown hover:text-brand-gold rounded text-xs font-bold transition-colors shadow-sm">Reset Clave</button>
                                <button onClick={async () => { if (!window.confirm(`¿Remover acceso para ${u.nombre}?`)) return; const res = await fetchConToken(`/remover-credencial/${u.id}`, { method: 'DELETE' }); const data = await res.json(); if (res.ok) mostrarToast(data.mensaje, 'exito'); else mostrarToast(data.error, 'error'); cargarDatos(); }} className="px-3 py-1.5 bg-red-100 text-red-600 hover:bg-red-600 hover:text-white rounded text-xs font-bold transition-colors">Remover</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* === VISTA: ESTADISTICAS === */}
            {pestana === 'estadisticas' && estadisticas && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <h3 className="text-xl font-bold text-brand-brown flex items-center gap-2">
                    <NavIcon pestanaId="estadisticas" />
                    Panel Analítico Global
                  </h3>
                  <select value="" onChange={event => { const formato = event.target.value; if (formato) exportarReporteEstadisticas(formato); }} className="w-full min-h-10 rounded-lg border border-brand-gold/40 bg-white px-4 py-2 text-sm font-bold text-brand-brown focus:border-brand-rust focus:outline-none sm:w-52">
                    <option value="">Descargar reporte</option>
                    <option value="pdf">Descargar PDF</option>
                    <option value="excel">Descargar Excel</option>
                    <option value="csv">Descargar CSV</option>
                    <option value="json">Descargar JSON</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {[
                    { label: 'Partidos Jugados', value: estadisticas.partidos_jugados, color: 'text-brand-blue' },
                    { label: 'Torneos Totales', value: estadisticas.total_torneos, color: 'text-brand-rust' },
                    { label: 'Equipos Inscritos', value: estadisticas.total_equipos, color: 'text-brand-gold' },
                    { label: 'Jugadores Activos', value: estadisticas.total_jugadores, color: 'text-brand-brown' },
                    { label: 'Tarjetas Mostradas', value: estadisticas.total_tarjetas, color: 'text-red-500' }
                  ].map((stat, i) => (
                    <div key={i} className="bg-white p-5 rounded-xl border border-brand-gold/20 shadow-sm text-center">
                      <h4 className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">{stat.label}</h4>
                      <p className={`text-4xl font-extrabold ${stat.color}`}>{stat.value}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-white p-6 rounded-xl border border-brand-gold/20 shadow-sm">
                  <h3 className="text-lg font-bold text-brand-brown mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-brand-gold" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                    Top 10 Jugadores (Jugadas Efectivas)
                  </h3>
                  <div className="overflow-x-auto mt-4">
                    <table className="tabla-admin">
                      <thead>
                        <tr>
                          <th>Posición</th>
                          <th>Jugador</th>
                          <th>Equipo</th>
                          <th className="text-right">Efectividad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estadisticas.mejores_jugadores.map((j, i) => (
                          <tr key={i}>
                            <td className="font-bold text-brand-brown/50">#{i + 1}</td>
                            <td className="font-bold">{j.nombre} {j.apellido}</td>
                            <td className="text-brand-brown/80">{j.equipo}</td>
                            <td className="text-right font-bold text-brand-blue">{j.efectivas} pts</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>    
                </div>
              </div>
            )}

            {/* === VISTA: HISTORIAL === */}
            {pestana === 'historial' && (
              <div className="space-y-8 animate-fade-in">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                  <h3 className="text-lg font-bold text-brand-brown mb-4 flex items-center gap-2">
                    <NavIcon pestanaId="historial" />
                    Archivo Documental y Resultados Finalizados
                  </h3>
                  <TableTools reportContext={{ usuario: usuario?.email || usuario?.nombre || usuario?.username }} logoUrl={orgData.logo_url} rows={partidos.filter(p => p.estado === 'Finalizado')} filteredRows={filasHistorial} filter={getFilter('historial')} setFilter={setTableFilter('historial')} columns={[{ key: 'fecha_hora', label: 'Fecha' }, { key: 'torneo_nombre', label: 'Torneo' }, { key: 'local_nombre', label: 'Local' }, { key: 'visita_nombre', label: 'Visitante' }, { key: 'marcador_local', label: 'Marcador local' }, { key: 'marcador_visita', label: 'Marcador visitante' }, { key: 'resultado_filtro', label: 'Resultado' }]} categoryFields={["torneo_nombre", "local_nombre", "visita_nombre", "resultado_filtro"]} dateFields={["fecha_hora"]} filename="historial_filtrado" />
                  <div className="overflow-x-auto">
                    <table className="tabla-admin whitespace-nowrap">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Torneo</th>
                          <th className="text-center">Encuentro</th>
                          <th className="text-center">Marcador</th>
                          <th className="text-center">Descargas y Actas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partidos.filter(p => p.estado === 'Finalizado').length === 0 ? (
                          <tr><td colSpan={5} className="text-center p-6 text-brand-brown/50">No hay historial disponible.</td></tr>
                        ) : filasHistorial.map(p => (
                          <tr key={p.id}>
                            <td className="text-brand-brown/80">{new Date(p.fecha_hora).toLocaleString('es-VE')}</td>
                            <td className="font-semibold">{p.torneo_nombre}</td>
                            <td className="text-center"><strong>{p.local_nombre}</strong> <span className="text-brand-rust mx-1">vs</span> <strong>{p.visita_nombre}</strong></td>
                            <td className="text-center font-black text-lg">{p.marcador_local !== null ? `${p.marcador_local} - ${p.marcador_visita}` : 'N/A'}</td>
                            <td className="flex justify-center gap-2">
                              <button onClick={() => window.open(`/?vista=puntajes&partido_id=${p.id}`, '_blank')} className="bg-brand-blue/10 hover:bg-brand-blue text-brand-blue hover:text-white px-3 py-1.5 rounded text-xs font-bold transition-colors flex items-center gap-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg> Acta Visual</button>
                              <button onClick={() => exportarPlanillaFormato(p.id, 'excel')} className="bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">Excel</button>
                              <button onClick={() => exportarPlanillaFormato(p.id, 'csv')} className="bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">CSV</button>
                              <button onClick={() => exportarPlanillaFormato(p.id, 'pdf')} className="bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">PDF</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* === VISTA: BITÁCORA DE ACTIVIDAD === */}
            {pestana === 'bitacora' && (
              <div className="space-y-8 animate-fade-in">
                <div className="rounded-xl border border-brand-gold/20 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="flex items-center gap-2 text-lg font-bold text-brand-brown"><NavIcon pestanaId="bitacora" /> Bitácora de actividad</h3>
                      <p className="mt-1 text-sm text-brand-brown/65">Registro de acciones realizadas por los usuarios de esta organización.</p>
                    </div>
                    <span className="rounded-full bg-brand-cream px-3 py-1 text-xs font-bold text-brand-brown">Máximo 500 eventos recientes</span>
                  </div>
                  <TableTools reportContext={{ usuario: usuario?.email || usuario?.nombre || usuario?.username }} logoUrl={orgData.logo_url} rows={bitacoraConTexto} filteredRows={filasBitacora} filter={getFilter('bitacora')} setFilter={setTableFilter('bitacora')} columns={[{ key: 'fecha_hora', label: 'Fecha y hora' }, { key: 'usuario', label: 'Usuario' }, { key: 'usuario_rol', label: 'Rol' }, { key: 'accion', label: 'Acción' }, { key: 'tabla', label: 'Recurso' }, { key: 'ip', label: 'IP' }]} categoryFields={["accion", "tabla", "usuario_rol", "usuario"]} dateFields={["fecha_hora"]} filename="bitacora_organizacion" />
                  <div className="overflow-x-auto rounded-lg border border-brand-gold/15">
                    <table className="tabla-admin min-w-[760px] whitespace-nowrap">
                      <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Rol</th><th>Qué hizo</th><th>Recurso consultado</th><th>IP</th></tr></thead>
                      <tbody>
                        {filasBitacora.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-brand-brown/50">No hay eventos que coincidan con los filtros.</td></tr> : filasBitacora.map(evento => <tr key={evento.id}><td>{new Date(evento.fecha_hora).toLocaleString('es-VE')}</td><td className="font-semibold">{evento.usuario}</td><td>{evento.usuario_rol || '—'}</td><td className="max-w-[360px] whitespace-normal font-semibold leading-snug text-brand-rust" title={evento.accion}>{evento.accion_legible}</td><td>{evento.recurso_legible}</td><td>{evento.ip || '—'}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* === VISTA: TORNEOS Y COMPETICIONES (Compleja) === */}
            {pestana === 'torneos' && (
              <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm animate-fade-in">
                
                <div className="flex flex-wrap gap-1 bg-brand-cream/30 p-2 border-b border-brand-gold/20">
                  {[
                    { id: 'lista', label: 'Torneos Activos' },
                    { id: 'crear', label: 'Nuevo Torneo' },
                    { id: 'flash', label: 'Torneo Flash' },
                    { id: 'partido-suelto', label: 'Partido Suelto' },
                    { id: 'posiciones', label: 'Posiciones y Grupos' },
                    { id: 'acumulado', label: 'Acumulado Anual' },
                    { id: 'calendario', label: 'Calendario' }
                  ].map(sub => (
                    <button 
                      key={sub.id} 
                      onClick={() => setSubPestanaTorneo(sub.id)} 
                      className={`min-h-10 rounded-lg border px-4 py-2 text-sm font-bold transition-colors ${subPestanaTorneo === sub.id ? 'border-brand-gold/30 bg-white text-brand-rust shadow-sm' : 'border-transparent text-brand-brown/70 hover:border-brand-gold/20 hover:bg-white/70 hover:text-brand-brown'}`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>

<div className="p-4 sm:p-6">
  {/* SUB PESTAÑA LISTA */}
                  {subPestanaTorneo === 'lista' && (
                    <div className="space-y-6">

                      {/* ALERTA PARTIDOS SUSPENDIDOS DENTRO DE TORNEOS */}
                      {partidos.filter(p => p.estado === 'Suspendido').length > 0 && (
                        <div className="bg-red-50 border border-red-200 p-6 rounded-xl shadow-sm mb-8 animate-fade-in">
                          <h3 className="text-lg font-bold text-red-700 mb-4 flex items-center gap-2">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            Partidos Suspendidos (Requieren Acción)
                          </h3>
                          <TableTools reportContext={{ usuario: usuario?.email || usuario?.nombre || usuario?.username }} logoUrl={orgData.logo_url} rows={partidos.filter(p => p.estado === 'Suspendido')} filteredRows={filasSuspendidos} filter={getFilter('suspendidos')} setFilter={setTableFilter('suspendidos')} columns={[{ key: 'fecha_hora', label: 'Fecha' }, { key: 'torneo_nombre', label: 'Torneo' }, { key: 'local_nombre', label: 'Local' }, { key: 'visita_nombre', label: 'Visitante' }, { key: 'fase', label: 'Fase' }]} categoryFields={["fase", "estado"]} dateFields={["fecha_hora"]} filename="partidos_suspendidos_filtrados" />
                          <div className="overflow-x-auto bg-white rounded-lg border border-red-100">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-red-100 text-red-800">
                                <tr><th className="p-3">Fecha Original</th><th className="p-3">Torneo</th><th className="p-3">Encuentro</th><th className="p-3 text-center">Acciones</th></tr>
                              </thead>
                              <tbody className="divide-y divide-red-50">
                                {filasSuspendidos.map(p => (
                                  <tr key={p.id}>
                                    <td className="p-3 text-brand-brown/80">{new Date(p.fecha_hora).toLocaleString('es-VE')}</td>
                                    <td className="p-3 font-semibold text-brand-brown">{p.torneo_nombre}</td>
                                    <td className="p-3 font-bold text-brand-brown">{p.local_nombre || 'Por definir'} vs {p.visita_nombre || 'Por definir'}</td>
                                    <td className="p-3 text-center">
                                      <button onClick={() => setModalReagendar({ visible: true, partido: p, nuevaFecha: p.fecha_hora.slice(0, 16) })} className="bg-brand-blue hover:bg-brand-brown text-white px-4 py-1.5 rounded text-xs font-bold transition-colors">Reagendar</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <TableTools reportContext={{ usuario: usuario?.email || usuario?.nombre || usuario?.username }} logoUrl={orgData.logo_url} rows={torneosList} filteredRows={filasTorneos} filter={getFilter('torneos')} setFilter={setTableFilter('torneos')} columns={[{ key: 'nombre', label: 'Torneo' }, { key: 'categoria', label: 'Categoría' }, { key: 'tipo_genero', label: 'Género' }, { key: 'temporada', label: 'Temporada' }, { key: 'equipos_filtro', label: 'Equipos participantes' }, { key: 'fecha_inicio', label: 'Inicio' }, { key: 'fecha_fin', label: 'Fin' }]} categoryFields={["categoria", "tipo_genero", "temporada", "equipos_filtro"]} dateFields={["fecha_inicio", "fecha_fin"]} filename="torneos_filtrados" />
                      {filasTorneos.filter(t => t.fecha_fin >= hoyStr && t.reglas?.estado !== 'Suspendido').length === 0 ? (
                        <div className="text-center py-12 bg-brand-cream/10 rounded-xl border border-brand-gold/20">
                          <svg className="w-16 h-16 mx-auto text-brand-gold/50 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                          <p className="text-brand-brown/60 font-medium">No hay torneos activos o próximos.</p>
                        </div>
                      ) : filasTorneos.filter(t => t.fecha_fin >= hoyStr && t.reglas?.estado !== 'Suspendido').map(t => (
                        <div key={t.id} className="border border-brand-gold/30 rounded-xl overflow-hidden shadow-sm">
                          <div className="bg-brand-brown p-4 flex justify-between items-center text-white">
                            <h4 className="font-bold text-lg">{t.nombre} <span className="text-brand-gold text-sm font-normal ml-2">({t.fecha_inicio} al {t.fecha_fin})</span></h4>
                            <button onClick={() => setTorneoEditando(t)} className="p-2 hover:bg-white/10 rounded transition-colors"><svg className="w-5 h-5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                          </div>
                          <div className="p-4 bg-white">
                            {t.partidos && t.partidos.length > 0 ? (
                              <div className="overflow-x-auto">
                                <table className="tabla-admin">
                                  <thead>
                                    <tr>
                                      <th>Fase</th>
                                      <th>Encuentro</th>
                                      <th>Fecha / Hora</th>
                                      <th>Sede</th>
                                      <th className="text-center">Ajustes</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {t.partidos.filter(p => p.estado === 'Agendado' || p.estado === 'En Curso').map(p => (
                                      <tr key={p.id}>
                                        <td className="font-semibold text-brand-rust">{p.fase}</td>
                                        <td className="font-bold">{p.local_nombre || '?'} vs {p.visita_nombre || '?'}</td>
                                        <td className="text-brand-brown/80">{new Date(p.fecha_hora).toLocaleString('es-VE')}</td>
                                        <td className="text-brand-brown/80">{p.sede_nombre || 'Principal'}</td>
                                        <td className="text-center">
                                          <button onClick={() => setModalEditarPartido({ visible: true, partido: p, fecha_hora: p.fecha_hora.slice(0, 16), arbitro_id: p.arbitro_id || '', anotador_id: p.anotador_id || '', sede_id: p.sede_id || '' })} className="bg-brand-blue/10 text-brand-blue hover:bg-brand-blue hover:text-white px-3 py-1 rounded text-xs font-bold transition-colors">Modificar</button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : <p className="text-sm text-brand-brown/60 text-center py-4">No hay partidos programados.</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SUB PESTAÑA CREAR */}
                  {subPestanaTorneo === 'crear' && (
                    <div className="max-w-4xl mx-auto">
                      
                      {/* Indicador de Pasos */}
                      <div className="flex items-center justify-between mb-8 relative">
                        <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-brand-gold/30 -z-10"></div>
                        {[1, 2, 3].map(step => (
                          <div key={step} className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${pasoTorneo >= step ? 'bg-brand-rust text-white shadow-md ring-4 ring-white' : 'bg-brand-cream text-brand-brown/50 border border-brand-gold/30'}`}>
                            {step}
                          </div>
                        ))}
                      </div>

                      {pasoTorneo === 1 && (
                        <div className="space-y-5 animate-slide-up">
                          <h4 className="text-xl font-bold text-brand-brown border-b border-brand-gold/30 pb-2">Configuración Estructural</h4>
                          <CampoTexto etiqueta="Nombre Oficial del Torneo" valor={formTorneo.nombre} onChange={e => setFormTorneo({...formTorneo, nombre: e.target.value})} requerido />
                          <div className="flex flex-col sm:flex-row gap-4">
                            <CampoTexto className="flex-1" etiqueta="Inicio" tipo="date" min={hoyStr} valor={formTorneo.fecha_inicio} onChange={e => setFormTorneo({...formTorneo, fecha_inicio: e.target.value})} requerido />
                            <CampoTexto className="flex-1" etiqueta="Cierre" tipo="date" min={formTorneo.fecha_inicio || hoyStr} valor={formTorneo.fecha_fin} onChange={e => setFormTorneo({...formTorneo, fecha_fin: e.target.value})} requerido />
                          </div>
                          
                          <div className="bg-brand-cream/20 p-4 rounded-lg border border-brand-gold/30">
                            <label className="block text-sm font-bold text-brand-brown mb-3">Categorías Convocadas:</label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {[...new Set(recursosTorneo.equipos.map(e => `${e.categoria} - ${e.tipo_genero}`))].map(cat => (
                                <label key={cat} className="flex items-center gap-3 cursor-pointer bg-white p-2 rounded border border-brand-gold/20 hover:border-brand-rust transition-colors">
                                  <input type="checkbox" className="w-4 h-4 text-brand-rust focus:ring-brand-rust rounded" checked={categoriasSeleccionadas.includes(cat)} onChange={e => { if(e.target.checked) setCategoriasSeleccionadas([...categoriasSeleccionadas, cat]); else setCategoriasSeleccionadas(categoriasSeleccionadas.filter(c => c !== cat)); }} /> 
                                  <span className="text-sm font-medium text-brand-brown">{cat}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="text-sm font-bold text-brand-brown">Método de Clasificación:
                              <select className="w-full mt-1 p-3 border border-brand-gold/30 rounded font-normal" value={formTorneo.sistema_clasificacion} onChange={e => setFormTorneo({...formTorneo, sistema_clasificacion: e.target.value})}>
                                <option value="liga_semifinales">Liga Regular + Semifinales (Top 4)</option>
                                <option value="dos_grupos">Dos Grupos (A y B)</option>
                                <option value="liga_final_directa">Liga directo a Final (Top 2)</option>
                              </select>
                            </label>
                            <label className="text-sm font-bold text-brand-brown">Plantilla Disciplinaria (Reglamento):
                              <select className="w-full mt-1 p-3 border border-brand-gold/30 rounded font-normal" value={formTorneo.plantilla_id} onChange={e => setFormTorneo({...formTorneo, plantilla_id: e.target.value})} required>
                                <option value="">-- Seleccionar --</option>
                                {plantillasReglas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                              </select>
                            </label>
                          </div>

                          <div className="flex justify-end pt-4">
                            <button type="button" onClick={() => { if (!formTorneo.nombre || !formTorneo.fecha_inicio || !formTorneo.fecha_fin || !formTorneo.plantilla_id) { mostrarToast('Completa todos los campos', 'error'); return; } if (formTorneo.fecha_fin < formTorneo.fecha_inicio) { mostrarToast('La fecha de cierre no puede ser anterior a la de inicio.', 'error'); return; } if(categoriasSeleccionadas.length === 0) return mostrarToast('Selecciona al menos una categoría', 'error'); setPasoTorneo(2); }} className="bg-brand-rust text-white px-8 py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md">Continuar al Draft</button>
                          </div>
                        </div>
                      )}

                      {pasoTorneo === 2 && (
                        <div className="space-y-5 animate-slide-up">
                          <h4 className="text-xl font-bold text-brand-brown border-b border-brand-gold/30 pb-2">Selección de Franquicias (Draft)</h4>
                          <p className="text-sm text-brand-brown/70 bg-brand-cream/30 p-3 rounded border border-brand-gold/20">Selecciona los equipos que participarán. El sistema bloquea a los que no cumplen con el quórum mínimo exigido por la plantilla.</p>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {recursosTorneo.equipos.filter(e => categoriasSeleccionadas.includes(`${e.categoria} - ${e.tipo_genero}`)).map(eq => {
                              const plantillaSel = plantillasReglas.find(p => p.id === parseInt(formTorneo.plantilla_id));
                              const minimoRequerido = plantillaSel?.reglas?.limite_jugadores || 4;
                              const faltantes = Math.max(0, minimoRequerido - parseInt(eq.total_jugadores_activos || 0));
                              const cumpleNomina = faltantes === 0;

                              return (
                                <label key={eq.id} className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer ${cumpleNomina ? (equiposSeleccionadosTorneo.includes(eq.id) ? 'border-brand-rust bg-brand-rust/5' : 'border-brand-gold/30 bg-white hover:border-brand-blue') : 'border-red-300 bg-red-50/50 cursor-not-allowed opacity-70'}`}>
                                  <input type="checkbox" className="mt-1 w-5 h-5 text-brand-rust focus:ring-brand-rust rounded" disabled={!cumpleNomina} checked={equiposSeleccionadosTorneo.includes(eq.id)} onChange={e => { if (e.target.checked) setEquiposSeleccionadosTorneo([...equiposSeleccionadosTorneo, eq.id]); else setEquiposSeleccionadosTorneo(equiposSeleccionadosTorneo.filter(id => id !== eq.id)); }} />
                                  <div>
                                    <div className="font-bold text-brand-brown text-lg leading-tight">{eq.nombre}</div>
                                    <div className={`text-xs font-semibold mt-1 ${cumpleNomina ? 'text-green-600' : 'text-red-600'}`}>{cumpleNomina ? `Roster validado (${eq.total_jugadores_activos} actvs)` : `Déficit de roster (Faltan ${faltantes})`}</div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                          <div className="flex justify-between pt-4 border-t border-brand-gold/20">
                            <button type="button" onClick={() => setPasoTorneo(1)} className="bg-brand-cream text-brand-brown border border-brand-gold px-6 py-2 rounded-lg font-bold hover:bg-white transition-colors">Regresar</button>
                            <button type="button" onClick={generarEstructuraPartidosPersonalizada} className="bg-brand-rust text-white px-8 py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md">Autogenerar Calendario Base</button>
                          </div>
                        </div>
                      )}

                      {pasoTorneo === 3 && (
                        <div className="space-y-5 animate-slide-up">
                          <h4 className="text-xl font-bold text-brand-brown border-b border-brand-gold/30 pb-2">Logística del Calendario</h4>
                          <p className="text-sm text-brand-brown/70">Ajusta la hora, sede y árbitros de cada encuentro autogenerado. Las llaves finales se rellenarán automáticamente al terminar la fase regular.</p>
                          
                          <div className="space-y-4">
                            {partidosIniciales.map((p, index) => {
                              const esPrimeraFase = p.fase.includes('Fase Regular') || p.fase.includes('Grupo');
                              return (
                                <div key={index} className="bg-white border border-brand-gold/30 rounded-xl p-5 shadow-sm hover:border-brand-blue transition-colors">
                                  <div className="text-xs font-bold text-brand-blue uppercase tracking-wider mb-3 pb-2 border-b border-brand-cream">{p.fase}</div>
                                  
                                  {esPrimeraFase ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                      <div className="text-center p-3 bg-brand-cream/30 rounded-lg border border-brand-gold/20"><select className="w-full text-sm font-bold bg-transparent focus:outline-none" value={p.local_id} onChange={e => { const arr = [...partidosIniciales]; arr[index].local_id = e.target.value; setPartidosIniciales(arr); }}><option value="">-- Local --</option>{equiposSeleccionadosTorneo.map(idEq => { const eqObj = equipos.find(x => x.id === idEq); return <option key={idEq} value={idEq}>{eqObj?.nombre}</option>; })}</select></div>
                                      <div className="text-center p-3 bg-brand-cream/30 rounded-lg border border-brand-gold/20"><select className="w-full text-sm font-bold bg-transparent focus:outline-none" value={p.visita_id} onChange={e => { const arr = [...partidosIniciales]; arr[index].visita_id = e.target.value; setPartidosIniciales(arr); }}><option value="">-- Visita --</option>{equiposSeleccionadosTorneo.map(idEq => { const eqObj = equipos.find(x => x.id === idEq); return <option key={idEq} value={idEq}>{eqObj?.nombre}</option>; })}</select></div>
                                    </div>
                                  ) : (
                                    <div className="text-center py-4 bg-brand-cream/20 rounded-lg border border-brand-gold/20 mb-4 text-sm font-semibold text-brand-brown/60">Enfrentamiento condicionado por resultados previos.</div>
                                  )}

                                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                    <select className="p-2 border border-brand-gold/30 rounded text-sm focus:ring-brand-rust" value={p.sede_id} onChange={e => { const arr = [...partidosIniciales]; arr[index].sede_id = e.target.value; setPartidosIniciales(arr); }} required><option value="">-- Sede --</option>{recursosTorneo.sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
                                    <select className="p-2 border border-brand-gold/30 rounded text-sm focus:ring-brand-rust" value={p.arbitro_id} onChange={e => { const arr = [...partidosIniciales]; arr[index].arbitro_id = e.target.value; setPartidosIniciales(arr); }}><option value="">-- Árbitro --</option>{recursosTorneo.arbitros.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}</select>
                                    <select className="p-2 border border-brand-gold/30 rounded text-sm focus:ring-brand-rust" value={p.anotador_id} onChange={e => { const arr = [...partidosIniciales]; arr[index].anotador_id = e.target.value; setPartidosIniciales(arr); }}><option value="">-- Anotador --</option>{recursosTorneo.anotadores.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}</select>
                                    <input type="datetime-local" min={`${formTorneo.fecha_inicio}T00:00`} max={`${formTorneo.fecha_fin}T23:59`} className="p-2 border border-brand-gold/30 rounded text-sm focus:ring-brand-rust" value={p.fecha_hora} onChange={e => { const arr = [...partidosIniciales]; arr[index].fecha_hora = e.target.value; setPartidosIniciales(arr); }} required />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex justify-between pt-4 border-t border-brand-gold/20">
                            <button type="button" onClick={() => setPasoTorneo(2)} className="bg-brand-cream text-brand-brown border border-brand-gold px-6 py-2 rounded-lg font-bold hover:bg-white transition-colors">Modificar Franquicias</button>
                            <button type="button" onClick={guardarTorneoCompleto} className="bg-brand-blue hover:bg-brand-brown text-white px-8 py-3 rounded-lg font-bold transition-colors shadow-md">Desplegar Competición Oficial</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SUB PESTAÑA PARTIDO SUELTO */}
                  {/* LOTE P: SUB PESTAÑA TORNEO FLASH */}
                  {subPestanaTorneo === 'flash' && (
                    <div className="max-w-4xl mx-auto animate-fade-in">
                      {resultadoFlash ? (
                        <div className="space-y-6">
                          <div className="bg-white p-6 rounded-xl border border-brand-gold/30 shadow-sm text-center animate-slide-up">
                            <h3 className="text-xl font-bold text-brand-brown mb-1">{resultadoFlash.torneo ? resultadoFlash.torneo.nombre : formFlash.nombre}</h3>
                            <p className="text-sm text-brand-brown/70 mb-4">{resultadoFlash.mensaje}</p>
                            <div className="flex flex-wrap justify-center gap-3">
                              <button type="button" onClick={() => setSubPestanaTorneo('lista')} className="bg-brand-rust text-white px-6 py-2.5 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-sm">Ver Torneos</button>
                              <button type="button" onClick={reiniciarFormularioFlash} className="border border-brand-gold/40 text-brand-brown px-6 py-2.5 rounded-lg font-bold hover:bg-brand-cream/30 transition-colors">Armar otro flash</button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white p-4 rounded-xl border border-brand-gold/20 shadow-sm">
                              <h4 className="font-bold text-brand-brown mb-3 border-b border-brand-gold/30 pb-2">Equipos armados por el sorteo</h4>
                              <div className="space-y-2">
                                {(resultadoFlash.equipos || []).map((eq, i) => (
                                  <div key={i} className="bg-brand-cream/20 rounded-lg p-2.5 border border-brand-gold/20">
                                    <div className="text-sm font-bold text-brand-rust">{eq.nombre}</div>
                                    <div className="text-xs text-brand-brown/70">{(eq.jugadores || []).join(', ')}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="bg-white p-4 rounded-xl border border-brand-gold/20 shadow-sm">
                              <h4 className="font-bold text-brand-brown mb-3 border-b border-brand-gold/30 pb-2">Orden del Sorteo de Asistentes</h4>
                              <ol className="space-y-2 max-h-72 overflow-y-auto pr-1">
                                {(resultadoFlash.sorteo || []).map(s => (
                                  <li key={s.posicion} className="text-sm text-brand-brown flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-full bg-brand-cream text-brand-brown text-xs font-bold flex items-center justify-center shrink-0">{s.posicion}</span>
                                    {s.persona}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          </div>
                          <div className="bg-white p-4 rounded-xl border border-brand-gold/20 shadow-sm">
                            <h4 className="font-bold text-brand-brown mb-3 border-b border-brand-gold/30 pb-2">Fixture (Todos contra Todos)</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {(resultadoFlash.fixture || []).map((p, i) => (
                                <div key={i} className="text-xs bg-brand-cream/20 rounded-lg p-2.5 border border-brand-gold/20">
                                  <div className="font-bold text-brand-rust mb-1">Jornada {p.jornada}</div>
                                  <div className="text-brand-brown font-semibold">{p.local} <span className="text-brand-brown/50">vs</span> {p.visita}</div>
                                  <div className="text-brand-brown/60">{String(p.fecha_hora).replace('T', ' ')}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <form onSubmit={crearTorneoFlash} className="space-y-5 bg-white p-4 sm:p-8 rounded-xl border border-brand-gold/30 shadow-sm">
                          <h3 className="text-xl font-bold text-brand-brown mb-1 text-center">Torneo Flash</h3>
                          <p className="text-sm text-brand-brown/70 text-center mb-6">Anota a los asistentes del día, sortéalos y deja que el sistema arme los equipos y el calendario todos contra todos.</p>

                          <CampoTexto etiqueta="Nombre del Torneo" ayuda="Ej. Flash Sabatino" valor={formFlash.nombre} onChange={e => setFormFlash({ ...formFlash, nombre: e.target.value })} requerido />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <CampoTexto etiqueta="Inicio" tipo="datetime-local" min={ahoraIsoLocal} valor={formFlash.fecha_hora_inicio} onChange={e => setFormFlash({ ...formFlash, fecha_hora_inicio: e.target.value })} requerido />
                            <CampoSelect etiqueta="Instalación" valor={formFlash.sede_id} onChange={e => setFormFlash({ ...formFlash, sede_id: e.target.value })} requerido>
                              <option value="">-- Seleccionar --</option>
                              {recursosTorneo.sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                            </CampoSelect>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <CampoTexto etiqueta="Minutos entre partidos" tipo="number" min="10" max="240" valor={formFlash.minutos_entre_partidos} onChange={e => setFormFlash({ ...formFlash, minutos_entre_partidos: e.target.value })} requerido />
                            <CampoSelect className="sm:col-span-2" etiqueta="Plantilla de Reglas (opcional)" valor={formFlash.plantilla_id} onChange={e => setFormFlash({ ...formFlash, plantilla_id: e.target.value })}>
                              <option value="">-- Sin plantilla --</option>
                              {plantillasReglas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                            </CampoSelect>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <CampoSelect etiqueta="Árbitro (opcional)" valor={formFlash.arbitro_id} onChange={e => setFormFlash({ ...formFlash, arbitro_id: e.target.value })}>
                              <option value="">-- Sin árbitro --</option>
                              {recursosTorneo.arbitros.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}
                            </CampoSelect>
                            <CampoSelect etiqueta="Anotador (opcional)" valor={formFlash.anotador_id} onChange={e => setFormFlash({ ...formFlash, anotador_id: e.target.value })}>
                              <option value="">-- Sin anotador --</option>
                              {recursosTorneo.anotadores.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}
                            </CampoSelect>
                          </div>
                          <label className="flex items-center gap-3 cursor-pointer bg-brand-cream/20 p-3 rounded-lg border border-brand-gold/20">
                            <input type="checkbox" className="w-4 h-4 text-brand-rust focus:ring-brand-rust rounded" checked={formFlash.ida_y_vuelta} onChange={e => setFormFlash({ ...formFlash, ida_y_vuelta: e.target.checked })} />
                            <span className="text-sm font-semibold text-brand-brown">Ida y vuelta (cada pareja juega dos veces)</span>
                          </label>

                          <div>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                              <h4 className="text-sm font-bold text-brand-brown">Asistentes del día</h4>
                              <span className="text-xs font-bold bg-brand-cream text-brand-brown px-3 py-1.5 rounded-full border border-brand-gold/30">{participantesFlash.filter(p => String(p.cedula || '').trim() !== '').length} asistentes → {equiposEstimadosFlash()} equipos</span>
                            </div>
                            <div className="space-y-2">
                              {participantesFlash.map((p, i) => (
                                <div key={i} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-start">
                                  <div className="relative">
                                    <CampoTexto etiqueta="Cédula" ayuda="Autocompleta" inputMode="numeric" valor={p.cedula} onChange={e => actualizarParticipanteFlash(i, 'cedula', e.target.value)} />
                                    {sugerenciasCedula.visible && sugerenciasCedula.idx === i && sugerenciasCedula.items.length > 0 && (
                                      <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-brand-gold/40 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                        {sugerenciasCedula.items.map(s => (
                                          <button type="button" key={s.cedula + '-' + s.origen} onClick={() => elegirSugerenciaCedula(s)} className="w-full text-left px-3 py-2 text-xs hover:bg-brand-cream/40 border-b border-brand-gold/10">
                                            <span className="font-bold text-brand-brown">{s.cedula}</span> — {s.nombre} {s.apellido}
                                            {s.de_mi_liga && <span className="ml-2 bg-brand-rust/10 text-brand-rust px-2 py-0.5 rounded-full text-xs font-bold">Tu liga</span>}
                                            {!s.de_mi_liga && <span className="ml-2 text-brand-brown/40">Otra liga</span>}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <CampoTexto etiqueta="Nombre" valor={p.nombre} onChange={e => actualizarParticipanteFlash(i, 'nombre', e.target.value)} />
                                  <CampoTexto etiqueta="Apellido" valor={p.apellido} onChange={e => actualizarParticipanteFlash(i, 'apellido', e.target.value)} />
                                  <CampoTexto etiqueta="Fecha de nacimiento" tipo="date" valor={p.fecha_nacimiento} onChange={e => actualizarParticipanteFlash(i, 'fecha_nacimiento', e.target.value)} />
                                  <CampoTexto etiqueta="Teléfono" tipo="tel" valor={p.telefono} onChange={e => actualizarParticipanteFlash(i, 'telefono', e.target.value)} />
                                  <button type="button" onClick={() => quitarParticipanteFlash(i)} className="text-red-600 hover:bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs font-bold transition-colors" title="Quitar asistente">✕</button>
                                </div>
                              ))}
                            </div>
                            <button type="button" onClick={agregarParticipanteFlash} className="mt-3 w-full border-2 border-dashed border-brand-gold/40 text-brand-brown/70 rounded-xl py-3 text-sm font-bold hover:border-brand-rust hover:text-brand-rust transition-colors">+ Agregar asistente</button>
                            <p className="text-xs text-brand-brown/50 mt-2 text-center">El sorteo Fisher-Yates reparte a los asistentes en equipos de ≈4 y arma el todos contra todos.</p>
                          </div>

                          <button type="submit" disabled={creandoFlash} className="w-full bg-brand-rust text-white py-3.5 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed">{creandoFlash ? 'Sorteando...' : 'Sortear y Crear Torneo Flash'}</button>
                        </form>
                      )}
                    </div>
                  )}

                  {subPestanaTorneo === 'partido-suelto' && (
                    <div className="max-w-2xl mx-auto bg-white p-4 sm:p-8 rounded-xl border border-brand-gold/30 shadow-sm animate-fade-in">
                      <h3 className="text-xl font-bold text-brand-brown mb-2 text-center">Agendar Encuentro Rápido</h3>
                      <p className="text-sm text-brand-brown/70 text-center mb-6">Ideal para amistosos o pruebas. Se archivará en el historial global sin afectar puntuaciones de torneos.</p>
                      
                      <form onSubmit={guardarPartidoSuelto} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <CampoSelect etiqueta="Equipo Local" valor={formPartidoSuelto.equipo_local_id} onChange={e => setFormPartidoSuelto({...formPartidoSuelto, equipo_local_id: e.target.value})} requerido>
                            <option value="">-- Seleccionar --</option>
                            {recursosTorneo.equipos.map(eq => (
                              <option key={eq.id} value={eq.id}>
                                {eq.nombre}
                              </option>
                            ))}
                          </CampoSelect>
                          <CampoSelect etiqueta="Equipo Visitante" valor={formPartidoSuelto.equipo_visita_id} onChange={e => setFormPartidoSuelto({...formPartidoSuelto, equipo_visita_id: e.target.value})} requerido>
                            <option value="">-- Seleccionar --</option>
                            {recursosTorneo.equipos.map(eq => (
                              <option key={eq.id} value={eq.id}>
                                {eq.nombre}
                              </option>
                            ))}
                          </CampoSelect>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <CampoSelect etiqueta="Instalación" valor={formPartidoSuelto.sede_id} onChange={e => setFormPartidoSuelto({...formPartidoSuelto, sede_id: e.target.value})} requerido>
                            <option value="">-- Seleccionar --</option>
                            {recursosTorneo.sedes.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.nombre}
                              </option>
                            ))}
                          </CampoSelect>
                          <CampoSelect etiqueta="Plantilla de Reglas" valor={formPartidoSuelto.plantilla_id} onChange={e => setFormPartidoSuelto({...formPartidoSuelto, plantilla_id: e.target.value})} requerido>
                            <option value="">-- Seleccionar --</option>
                            {plantillasReglas.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.nombre}
                              </option>
                            ))}
                          </CampoSelect>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <CampoSelect etiqueta="Árbitro Asignado" valor={formPartidoSuelto.arbitro_id} onChange={e => setFormPartidoSuelto({...formPartidoSuelto, arbitro_id: e.target.value})} requerido>
                            <option value="">-- Seleccionar --</option>
                            {recursosTorneo.arbitros.map(a => (
                              <option key={a.id} value={a.id}>
                                {a.nombre} {a.apellido}
                              </option>
                            ))}
                          </CampoSelect>
                          <CampoSelect etiqueta="Anotador Asignado" valor={formPartidoSuelto.anotador_id} onChange={e => setFormPartidoSuelto({...formPartidoSuelto, anotador_id: e.target.value})} requerido>
                            <option value="">-- Seleccionar --</option>
                            {recursosTorneo.anotadores.map(a => (
                              <option key={a.id} value={a.id}>
                                {a.nombre} {a.apellido}
                              </option>
                            ))}
                          </CampoSelect>
                        </div>
                        <CampoTexto etiqueta="Fecha y hora del encuentro" tipo="datetime-local" min={ahoraIsoLocal} valor={formPartidoSuelto.fecha_hora} onChange={e => setFormPartidoSuelto({...formPartidoSuelto, fecha_hora: e.target.value})} requerido />
                        <button type="submit" className="w-full bg-brand-rust text-white py-3.5 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md mt-4">Confirmar Agendamiento</button>
                      </form>
                    </div>
                  )}

                  {/* SUB PESTAÑA POSICIONES */}
                  {subPestanaTorneo === 'posiciones' && (
                    <div className="animate-fade-in">
                      <div className="bg-brand-cream/30 p-4 border border-brand-gold/30 rounded-lg mb-6 flex flex-col sm:flex-row items-center gap-4">
                        <label className="font-bold text-brand-brown whitespace-nowrap">Analizar Torneo:</label>
                        <select className="flex-1 w-full p-2 border border-brand-gold/30 rounded focus:ring-brand-rust" value={torneoPosicionesId} onChange={e => { setTorneoPosicionesId(e.target.value); consultarPosicionesAgrupadas(e.target.value); }}>
                          <option value="">-- Seleccione una competición --</option>
                          {torneosList.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                        </select>
                      </div>

                      {torneoPosicionesId ? (
                        <div className="space-y-6">
                          {[...new Set(posicionesGeneral.map(p => `${p.categoria} - ${p.tipo_genero}`))].map(catName => {
                            const equiposDeCat = posicionesGeneral.filter(p => `${p.categoria} - ${p.tipo_genero}` === catName);
                            if(equiposDeCat.length === 0) return null;
                            return (
                              <div key={catName} className="bg-white rounded-xl shadow-sm border border-brand-gold/30 overflow-hidden">
                                <h4 className="bg-brand-brown text-brand-cream px-4 py-3 font-bold">{catName}</h4>
                                <div className="overflow-x-auto">
                                  <table className="tabla-admin">
                                    <thead>
                                      <tr>
                                        <th>Pos</th>
                                        <th>Equipo</th>
                                        <th className="text-center">Pts</th>
                                        <th className="text-center">Diff</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {equiposDeCat.map((pos, idx) => (
                                        <tr key={idx} className={idx < 4 ? 'bg-brand-blue/5' : ''}>
                                          <td className="font-bold text-brand-brown/50 pl-5">{idx + 1}</td>
                                          <td className="font-bold">{pos.equipo_nombre}</td>
                                          <td className="text-center font-black text-brand-rust text-base">{pos.total_puntos}</td>
                                          <td className="text-center text-brand-brown/70">{pos.diff_tantos > 0 ? `+${pos.diff_tantos}` : pos.diff_tantos}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                          {posicionesGeneral.length === 0 && <p className="text-center text-brand-brown/50 py-10">No hay datos suficientes para calcular posiciones.</p>}
                        </div>
                      ) : (
                        <div className="text-center py-16 text-brand-brown/50 border-2 border-dashed border-brand-gold/30 rounded-xl">Seleccione un torneo para procesar sus tablas.</div>
                      )}
                    </div>
                  )}

                  {/* SUB PESTAÑA ACUMULADO */}
                  {subPestanaTorneo === 'acumulado' && (
                    <div className="animate-fade-in">
                      <div className="bg-brand-cream/30 p-4 border border-brand-gold/30 rounded-lg mb-6 flex flex-col sm:flex-row items-center gap-4">
                        <input type="text" placeholder="Temporada (Ej. 2026)" className="flex-1 w-full p-2 border border-brand-gold/30 rounded focus:ring-brand-rust" value={temporadaFiltro} onChange={e => setTemporadaFiltro(e.target.value)} />
                        <button onClick={consultarAcumuladoLiga} className="w-full sm:w-auto px-6 py-2 bg-brand-blue text-white font-bold rounded-lg hover:bg-brand-brown transition-colors">Calcular Rendimiento Anual</button>
                      </div>

                      <div className="bg-white rounded-xl shadow-sm border border-brand-gold/30 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="tabla-admin">
                            <thead>
                              <tr>
                                <th>Rank</th>
                                <th>Franquicia</th>
                                <th className="text-center">Score Global</th>
                                <th className="text-center">Torneos</th>
                                <th className="text-center">Índice Asistencia</th>
                              </tr>
                            </thead>
                            <tbody>
                              {acumuladoLiga.length === 0 ? (
                                <tr><td colSpan={5} className="text-center p-8 text-brand-brown/50">Ejecuta la consulta para visualizar el ranking.</td></tr>
                              ) : (
                                acumuladoLiga.map((ac, idx) => (
                                  <tr key={idx}>
                                    <td className="font-bold text-brand-brown/40">#{idx + 1}</td>
                                    <td className="font-bold text-base">{ac.nombre}</td>
                                    <td className="text-center font-black text-brand-rust text-lg">{ac.total_puntos}</td>
                                    <td className="text-center text-brand-brown/80">{ac.torneos_jugados}</td>
                                    <td className="text-center">
                                      <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold">{ac.torneos_jugados} / {ac.total_torneos_temporada} (OK)</span>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* LOTE L: SUB PESTAÑA CALENDARIO */}
                  {subPestanaTorneo === 'calendario' && (() => {
                    const detallesTorneo = Object.fromEntries(torneosList.flatMap(t => (t.partidos || []).map(p => [p.id, p])));
                    return (
                      <div className="animate-fade-in space-y-4">
                        <CalendarioPartidos
                          partidos={partidos}
                          sedesPorPartido={Object.fromEntries(Object.entries(detallesTorneo).map(par => [par[0], par[1].sede_nombre]).filter(par => !!par[1]))}
                          onEditar={(p) => setModalEditarPartido({ visible: true, partido: p, fecha_hora: p.fecha_hora.slice(0, 16), arbitro_id: p.arbitro_id || '', anotador_id: p.anotador_id || '', sede_id: detallesTorneo[p.id]?.sede_id || '' })}
                          onReagendar={(p) => setModalReagendar({ visible: true, partido: p, nuevaFecha: p.fecha_hora.slice(0, 16) })}
                        />
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
      </main>
    </div>
  );
}
