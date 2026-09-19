import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { io } from 'socket.io-client';
import SistemaMensajeria from './SistemaMensajeria';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function AdminLigaDashboard({ usuario, cerrarSesion }) {
  
  const [pestana, setPestana] = useState(localStorage.getItem('adminLigaPestana') || 'equipos');

  useEffect(() => {
    localStorage.setItem('adminLigaPestana', pestana);
  }, [pestana]);

  const [mensaje, setMensaje] = useState('');
  const [debeCambiarPass, setDebeCambiarPass] = useState(false);
  const [nuevaClave, setNuevaClave] = useState('');

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

  // Estados de Mensajería (Socket.io)
  const [mensajeriaAbierta, setMensajeriaAbierta] = useState(false);
  const [mensajes, setMensajes] = useState([]);
  const [nuevoMensaje, setNuevoMensaje] = useState('');
  const [destinatariosSeleccionados, setDestinatariosSeleccionados] = useState([]);
  const [notificaciones, setNotificaciones] = useState(0);
  const socketRef = useRef(null);

  // Estados para consulta de posiciones agrupadas y acumulados
  const [posicionesGrupoA, setPosicionesGrupoA] = useState([]);
  const [posicionesGrupoB, setPosicionesGrupoB] = useState([]);
  const [posicionesGeneral, setPosicionesGeneral] = useState([]);
  const [torneoPosicionesId, setTorneoPosicionesId] = useState('');
  const [acumuladoLiga, setAcumuladoLiga] = useState([]);
  const [temporadaFiltro, setTemporadaFiltro] = useState('2026');

  // Estados para edición
  const [modalCapitan, setModalCapitan] = useState({ visible: false, viejoId: null, equipoId: null, candidatos: [] });
  const [categoriasSeleccionadas, setCategoriasSeleccionadas] = useState([]);
  const [jugadorEditandoId, setJugadorEditandoId] = useState(null);
  const [sedeEditando, setSedeEditando] = useState(null);
  const [torneoEditando, setTorneoEditando] = useState(null);
  const [modalForzar, setModalForzar] = useState({ visible: false, partido: null, ganadorId: '', motivo: '', password: '' });
  
  // NUEVO: Estado para el Modal de Reagendar
  const [modalReagendar, setModalReagendar] = useState({ visible: false, partido: null, nuevaFecha: '' });

  // Formularios
  const [formSede, setFormSede] = useState({ nombre: '', direccion: '' });
  const [formEquipo, setFormEquipo] = useState({ nombre: '', categoria: 'Adulto 22+', tipo_genero: 'Mixto', logo_url: '' });
  
  const [busquedaSedes, setBusquedaSedes] = useState('');
  const [busquedaEquipos, setBusquedaEquipos] = useState('');
  const [busquedaJugadores, setBusquedaJugadores] = useState('');
  const [busquedaCredenciales, setBusquedaCredenciales] = useState('');
  const [modalEditarPartido, setModalEditarPartido] = useState({ visible: false, partido: null, fecha_hora: '', arbitro_id: '', anotador_id: '', sede_id: '' });
  
  const [formJugador, setFormJugador] = useState({ cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', correo: '', telefono: '', numero_dorsal: '', foto_url: '', es_capitan: false });
  const [formCredencial, setFormCredencial] = useState({ nombre: '', apellido: '', cedula: '', email: '', rol: 'arbitro', equipo_id: '' });
  
  const [formPartidoSuelto, setFormPartidoSuelto] = useState({ equipo_local_id: '', equipo_visita_id: '', sede_id: '', arbitro_id: '', anotador_id: '', fecha_hora: '' });
  const [formReglas, setFormReglas] = useState({ nombre: '', descripcion: '', puntos_victoria: 3, puntos_empate: 1, puntos_derrota: 0, limite_jugadores: 8, meta_puntos: 15, tiempo_minutos: 60, tarjetas_suspension: 2, politica_clasificacion: 'ganador_vs_ganador' });
  const [subPestanaTorneo, setSubPestanaTorneo] = useState('lista');
  const [pasoTorneo, setPasoTorneo] = useState(1);
  const [formTorneo, setFormTorneo] = useState({ nombre: '', fecha_inicio: '', fecha_fin: '', plantilla_id: '', categoria: 'Adulto 22+', tipo_genero: 'Mixto', sistema_clasificacion: 'liga_semifinales', opcion_grupos: 'cruc_semis', incluir_tercer_lugar: true, temporada: '2026' });
  const [equiposSeleccionadosTorneo, setEquiposSeleccionadosTorneo] = useState([]);
  const [partidosIniciales, setPartidosIniciales] = useState([]);

  const hoyStr = new Date().toISOString().split('T')[0];
  const ahora = new Date();
  const ahoraIsoLocal = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}T${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  
  const fetchConToken = async (endpoint, options = {}) => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) return { ok: false, status: 401, json: async () => ({ error: 'Sesión no válida' }) };
      const response = await fetch(`${API_URL}/admin-liga${endpoint}`, { ...options, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, ...options.headers } });
      if (response.status === 401) setMensaje('⚠️ Tu sesión ha expirado.');
      return response;
    } catch (err) { return { ok: false, status: 500, json: async () => ({ error: 'Error de conexión.' }) }; }
  };

// NUEVA FUNCIÓN PARA CONVERTIR ARCHIVOS A BASE64
  const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });

  // NUEVA FUNCIÓN PARA SUBIR LOGO DE LA ORGANIZACIÓN
  const subirLogoOrganizacion = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await toBase64(file);
    const res = await fetchConToken('/mi-organizacion/logo', { method: 'PUT', body: JSON.stringify({ logo_url: base64 }) });
    if (res.ok) alert('Logo actualizado correctamente'); else alert('Error subiendo logo');
  };

  // NUEVA FUNCIÓN PARA SUBIDA MASIVA DE FOTOS POR LOTE (NOMBRE = CÉDULA)
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
      alert(data.mensaje); setMensaje('');
      const resEq = await fetchConToken(`/equipos/${equipoSeleccionado.id}/jugadores`);
      if (resEq.ok) setJugadores(await resEq.json());
    } else { alert(data.error); setMensaje(''); }
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
      } else if (pestana === 'estadisticas') {
        const res = await fetchConToken('/estadisticas'); if (res.ok) setEstadisticas(await res.json());
      } else if (pestana === 'historial') {
        const res = await fetchConToken('/partidos-finalizados'); if (res.ok) setPartidos(await res.json());
      }
    } catch (e) { setMensaje('Error cargando datos del servidor.'); }
  };

  useEffect(() => {
    socketRef.current = io(SOCKET_URL);
    
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.debe_cambiar_password) setDebeCambiarPass(true);
    });

    return () => socketRef.current?.disconnect();
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
    const resA = await fetchConToken(`/torneos/${tId}/posiciones?grupo=A`); if (resA.ok) setPosicionesGrupoA(await resA.json());
    const resB = await fetchConToken(`/torneos/${tId}/posiciones?grupo=B`); if (resB.ok) setPosicionesGrupoB(await resB.json());
    const resGen = await fetchConToken(`/torneos/${tId}/posiciones`); if (resGen.ok) setPosicionesGeneral(await resGen.json());
  };

  const consultarAcumuladoLiga = async () => {
    const orgId = usuario?.organizacion_id || (torneosList[0]?.organizacion_id);
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

  const removerCredencial = async (id, nombre) => {
      if (!window.confirm(`¿Estás seguro de remover el acceso a la liga para ${nombre}?`)) return;
      const res = await fetchConToken(`/remover-credencial/${id}`, { method: 'DELETE' });
      const data = await res.json();
      alert(data.mensaje);
      cargarDatos();
    };

  const guardarEquipo = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/equipos', { method: 'POST', body: JSON.stringify(formEquipo) });
    if (res.ok) { setMensaje('Equipo registrado.'); setFormEquipo({ nombre: '', categoria: 'Adulto 22+', tipo_genero: 'Mixto', logo_url: '' }); cargarDatos(); }
  };

  const guardarJugador = async (e) => {
    e.preventDefault();
    const res = await fetchConToken(jugadorEditandoId ? `/jugadores/${jugadorEditandoId}` : `/jugadores`, { method: jugadorEditandoId ? 'PUT' : 'POST', body: JSON.stringify({ ...formJugador, equipo_id: equipoSeleccionado.id }) });
    const data = await res.json();
    if (res.ok) { setMensaje('Éxito'); setFormJugador({ cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', correo: '', telefono: '', numero_dorsal: '', foto_url: '', es_capitan: false }); setJugadorEditandoId(null); seleccionarEquipoModal(equipoSeleccionado); } 
    else { alert(data.error); }
  };

  const guardarPlantillaReglas = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/plantillas-reglas', {
      method: 'POST', body: JSON.stringify({ nombre: formReglas.nombre, descripcion: formReglas.descripcion, reglas: { puntos_victoria: parseInt(formReglas.puntos_victoria), puntos_empate: parseInt(formReglas.puntos_empate), puntos_derrota: parseInt(formReglas.puntos_derrota), limite_jugadores: parseInt(formReglas.limite_jugadores), meta_puntos: parseInt(formReglas.meta_puntos), tiempo_minutos: parseInt(formReglas.tiempo_minutos), tarjetas_suspension: parseInt(formReglas.tarjetas_suspension), politica_clasificacion: formReglas.politica_clasificacion }})
    });
    const data = await res.json();
    if (res.ok) { setMensaje('Plantilla guardada.'); cargarDatos(); } else { alert(data.error); }
  };

  const validarDisponibilidadEquipos = (equipo1, equipo2, fechaHora) => {
    const conflicto = partidos.find(p => 
      p.fecha_hora === fechaHora && 
      (p.equipo_local_id == equipo1 || p.equipo_visita_id == equipo1 || 
      p.equipo_local_id == equipo2 || p.equipo_visita_id == equipo2)
    );
    if (conflicto) {
      alert(`⚠️ Conflicto: Al menos uno de los equipos ya tiene el encuentro "${conflicto.local_nombre} vs ${conflicto.visita_nombre}" agendado a esta misma hora.`);
      return false;
    }
    return true;
  };

  const guardarPartidoSuelto = async (e) => {
    e.preventDefault();
    if (formPartidoSuelto.equipo_local_id === formPartidoSuelto.equipo_visita_id) return alert('El equipo local y visitante no pueden ser el mismo.');
    if (!validarDisponibilidadEquipos(formPartidoSuelto.equipo_local_id, formPartidoSuelto.equipo_visita_id, formPartidoSuelto.fecha_hora)) return;
    const res = await fetchConToken('/partidos-sueltos', { method: 'POST', body: JSON.stringify(formPartidoSuelto) });
    const data = await res.json();
    if (res.ok) { setMensaje('Partido agendado con éxito.'); setFormPartidoSuelto({ equipo_local_id: '', equipo_visita_id: '', sede_id: '', arbitro_id: '', anotador_id: '', fecha_hora: '' }); cargarDatos(); } 
    else { alert(data.error); }
  };

  const iniciarEdicionJugador = (j) => {
    setJugadorEditandoId(j.id);
    setFormJugador({ cedula: j.cedula || '', nombre: j.nombre || '', apellido: j.apellido || '', fecha_nacimiento: j.fecha_nacimiento ? j.fecha_nacimiento.split('T')[0] : '', correo: j.correo || '', telefono: j.telefono || '', numero_dorsal: j.numero_dorsal || '', foto_url: j.foto_url || '', es_capitan: equipoSeleccionado?.capitan_id === j.id });
  };

const cambiarEstadoJugador = async (id, estadoActual) => {
    const nuevoEstado = estadoActual === 'Activo' ? 'Inactivo' : 'Activo';
    
    // VALIDACIÓN: Si estamos desactivando al capitán
    if (nuevoEstado === 'Inactivo' && equipoSeleccionado.capitan_id === id) {
      const otrosActivos = jugadores.filter(j => j.id !== id && j.estado === 'Activo');
      if (otrosActivos.length === 0) return alert('No puedes desactivar al único jugador (capitán). Registra a otro primero.');
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
    
    if (res.ok) {
      alert('Capitán reemplazado exitosamente.');
      setModalCapitan({ visible: false, viejoId: null, equipoId: null, candidatos: [], nuevoCapitanId: '' });
      seleccionarEquipoModal(equipoSeleccionado);
      
      if(window.confirm('¿Deseas generar inmediatamente las credenciales de Delegado para el nuevo capitán? (Esto reemplazará al delegado anterior del equipo)')) {
        const nuevoCap = modalCapitan.candidatos.find(j => j.id === parseInt(modalCapitan.nuevoCapitanId));
        setFormCredencial({ nombre: nuevoCap.nombre, apellido: nuevoCap.apellido, cedula: nuevoCap.cedula, email: nuevoCap.correo || '', rol: 'delegado de equipo', equipo_id: modalCapitan.equipoId });
        setPestana('credenciales'); // Redirige a credenciales
      }
    }
  };

  const generarEstructuraPartidosPersonalizada = () => {
    if (equiposSeleccionadosTorneo.length < 2) return alert('Debes seleccionar al menos 2 equipos.');
    
    let nuevosPartidos = [];
    const defaultSede = recursosTorneo.sedes[0]?.id || '';
    const defaultArbitro = recursosTorneo.arbitros.length === 1 ? recursosTorneo.arbitros[0].id : '';
    const defaultAnotador = recursosTorneo.anotadores.length === 1 ? recursosTorneo.anotadores[0].id : '';
    const sistema = formTorneo.sistema_clasificacion;

    // ITERAR POR CADA CATEGORÍA SELECCIONADA
    categoriasSeleccionadas.forEach(cat => {
      let listaCat = equiposSeleccionadosTorneo.filter(id => {
        const eq = recursosTorneo.equipos.find(x => x.id === id);
        return `${eq.categoria} - ${eq.tipo_genero}` === cat;
      });
      listaCat.sort(() => Math.random() - 0.5); // Randomizar orden

      if (listaCat.length < 2) return; // Si hay 1 o 0 equipos en esta categoría, no se puede hacer torneo

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
      // (Puedes agregar aquí la lógica de 'dos_grupos' replicada para `listaCat` si la utilizas)
    });

    if(nuevosPartidos.length === 0) return alert('No hay suficientes equipos por categoría para generar partidos.');
    setPartidosIniciales(nuevosPartidos); setPasoTorneo(3);
  };

  const guardarTorneoCompleto = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/torneos', { method: 'POST', body: JSON.stringify({ ...formTorneo, categorias_permitidas: [`${formTorneo.categoria} - ${formTorneo.tipo_genero}`], partidos_iniciales: partidosIniciales }) });
    const data = await res.json();
    if (res.ok) { setMensaje('Torneo creado.'); setPartidosIniciales([]); setPasoTorneo(1); setSubPestanaTorneo('lista'); cargarDatos(); } else { alert(data.error); }
  };

  const actualizarTorneoEdicion = async (e) => {
    e.preventDefault();
    const res = await fetchConToken(`/torneos/${torneoEditando.id}`, { method: 'PUT', body: JSON.stringify({ nombre: torneoEditando.nombre, fecha_inicio: torneoEditando.fecha_inicio, fecha_fin: torneoEditando.fecha_fin, estado: torneoEditando.reglas?.estado || 'Activo' }) });
    if (res.ok) { setMensaje('Torneo actualizado.'); setTorneoEditando(null); cargarDatos(); }
  };

  const guardarCredencial = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/crear-credencial', { method: 'POST', body: JSON.stringify(formCredencial) });
    const data = await res.json();
    if (res.ok) { setMensaje(data.mensaje); setFormCredencial({ nombre: '', apellido: '', cedula: '', email: '', rol: 'arbitro', equipo_id: '' }); cargarDatos(); } else { alert(data.error); }
  };

  const resetearPasswordOperativo = async (userId, cedula, nombre) => {
    if (!window.confirm(`¿Restablecer contraseña para ${nombre}?`)) return;
    const res = await fetchConToken(`/usuarios/${userId}/reset-password`, { method: 'POST' });
    const data = await res.json(); if (res.ok) alert(data.mensaje); else alert(data.error);
  };

  const reasignarDelegado = async (equipoId, delegadoId) => {
    const res = await fetchConToken(`/equipos/${equipoId}/delegado`, { method: 'PUT', body: JSON.stringify({ delegado_id: delegadoId }) });
    if (res.ok) { setMensaje('Delegado reasignado.'); cargarDatos(); }
  };

  const cambiarClaveObligatoria = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/cambiar-password-obligatorio', { method: 'POST', body: JSON.stringify({ nueva_password: nuevaClave }) });
    if (res.ok) { alert('Contraseña actualizada.'); setDebeCambiarPass(false); }
  };

  // NUEVA FUNCIÓN PARA CONFIRMAR LA FECHA DEL MODAL
  const confirmarReagendar = async (e) => {
    e.preventDefault();
    const res = await fetchConToken(`/partidos/${modalReagendar.partido.id}/reagendar`, { 
      method: 'PUT', 
      body: JSON.stringify({ nueva_fecha_hora: modalReagendar.nuevaFecha }) 
    });
    if (res.ok) { 
      alert('Partido Reagendado Exitosamente'); 
      setModalReagendar({ visible: false, partido: null, nuevaFecha: '' });
      cargarDatos(); 
    }
  };

// NUEVA FUNCIÓN PARA GUARDAR LA EDICIÓN DE OFICIALES/FECHA DE UN PARTIDO
  const confirmarEditarPartido = async (e) => {
    e.preventDefault();
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
      alert(data.mensaje); 
      setModalEditarPartido({ visible: false, partido: null, fecha_hora: '', arbitro_id: '', anotador_id: '', sede_id: '' }); 
      cargarDatos(); 
    } else { alert(data.error); }
  };

  const abrirModalForzarGanador = (partido) => {
    setModalForzar({ 
      visible: true, 
      partido, 
      ganadorId: partido.equipo_local_id,
      motivo: '', 
      password: '' 
    });
  };

  const confirmarForzarGanador = async (e) => {
    e.preventDefault();
    const res = await fetchConToken(`/partidos/${modalForzar.partido.id}/forzar-ganador`, { 
      method: 'POST', 
      body: JSON.stringify({ 
        ganador_id: modalForzar.ganadorId, 
        motivo: modalForzar.motivo,
        admin_password: modalForzar.password
      }) 
    });
    
    const data = await res.json();
    if (res.ok) {
      socketRef.current.emit('notificacion_oficiales_partido', {
        arbitro_id: modalForzar.partido.arbitro_id,
        anotador_id: modalForzar.partido.anotador_id,
        mensaje: `⚠️ El administrador ha forzado el resultado del encuentro: ${modalForzar.partido.local_nombre} vs ${modalForzar.partido.visita_nombre}.`
      });
      alert('Resultado forzado correctamente.');
      setModalForzar({ visible: false, partido: null, ganadorId: '', motivo: '', password: '' });
      cargarDatos();
    } else {
      alert(data.error || 'Contraseña incorrecta o error al procesar.');
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto', padding: '10px' }}>
      <SistemaMensajeria usuario={usuario} token={token} />

      {/* MODAL REEMPLAZO OBLIGATORIO DE CAPITÁN */}
        {modalCapitan.visible && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
            <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', maxWidth: '400px', width: '90%' }}>
              <h3 style={{ marginTop: 0, color: '#E53E3E' }}>⚠️ Reemplazo de Capitán Requerido</h3>
              <p style={{ fontSize: '0.9em', color: '#4A5568' }}>Estás desactivando al capitán del equipo. Todo equipo debe tener un capitán activo. Selecciona su reemplazo:</p>
              <form onSubmit={confirmarReemplazoCapitan} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <select value={modalCapitan.nuevoCapitanId} onChange={e => setModalCapitan({...modalCapitan, nuevoCapitanId: e.target.value})} required style={{ padding: '8px' }}>
                  {modalCapitan.candidatos.map(c => <option key={c.id} value={c.id}>{c.nombre} {c.apellido} (Dorsal #{c.numero_dorsal})</option>)}
                </select>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button type="submit" style={{ flex: 1, background: '#3182CE', color: 'white', padding: '10px' }}>Asignar y Continuar</button>
                  <button type="button" onClick={() => setModalCapitan({...modalCapitan, visible: false})} style={{ flex: 1, padding: '10px' }}>Cancelar Desactivación</button>
                </div>
              </form>
            </div>
          </div>
        )}

      {/* MODAL REAGENDAR PARTIDO (Con selector dinámico de calendario) */}
      {modalReagendar.visible && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', maxWidth: '450px', width: '90%' }}>
            <h3 style={{ marginTop: 0 }}>📅 Reagendar Partido</h3>
            <p style={{ fontSize: '0.9em', color: '#4A5568' }}>{modalReagendar.partido.local_nombre} vs {modalReagendar.partido.visita_nombre}</p>
            
            <form onSubmit={confirmarReagendar} style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '15px' }}>
              <label style={{ fontSize: '0.9em', fontWeight: 'bold' }}>Selecciona la nueva fecha y hora:
                <input 
                  type="datetime-local" 
                  min={ahoraIsoLocal} 
                  value={modalReagendar.nuevaFecha} 
                  onChange={e => setModalReagendar({...modalReagendar, nuevaFecha: e.target.value})} 
                  required 
                  style={{ width: '100%', padding: '10px', marginTop: '5px', borderRadius: '4px', border: '1px solid #CBD5E0' }} 
                />
              </label>
              
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" style={{ flex: 1, background: '#3182CE', color: 'white', border: 'none', padding: '10px', borderRadius: '4px' }}>Confirmar Fecha</button>
                <button type="button" onClick={() => setModalReagendar({ visible: false, partido: null, nuevaFecha: '' })} style={{ flex: 1, padding: '10px', borderRadius: '4px' }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalEditarPartido.visible && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', maxWidth: '450px', width: '90%' }}>
            <h3 style={{ marginTop: 0 }}>✏️ Editar Partido Programado</h3>
            <p style={{ fontSize: '0.9em', color: '#4A5568' }}>{modalEditarPartido.partido.local_nombre} vs {modalEditarPartido.partido.visita_nombre}</p>
            
            <form onSubmit={confirmarEditarPartido} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px' }}>
              <input type="datetime-local" min={ahoraIsoLocal} value={modalEditarPartido.fecha_hora} onChange={e => setModalEditarPartido({...modalEditarPartido, fecha_hora: e.target.value})} required style={{ padding: '8px' }} />
              <select value={modalEditarPartido.sede_id} onChange={e => setModalEditarPartido({...modalEditarPartido, sede_id: e.target.value})} required style={{ padding: '8px' }}><option value="">-- Sede --</option>{recursosTorneo.sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
              <select value={modalEditarPartido.arbitro_id} onChange={e => setModalEditarPartido({...modalEditarPartido, arbitro_id: e.target.value})} style={{ padding: '8px' }}><option value="">-- Árbitro --</option>{recursosTorneo.arbitros.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}</select>
              <select value={modalEditarPartido.anotador_id} onChange={e => setModalEditarPartido({...modalEditarPartido, anotador_id: e.target.value})} style={{ padding: '8px' }}><option value="">-- Anotador --</option>{recursosTorneo.anotadores.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}</select>
              
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" style={{ flex: 1, background: '#3182CE', color: 'white', padding: '10px' }}>Guardar Cambios</button>
                <button type="button" onClick={() => setModalEditarPartido({ visible: false })} style={{ flex: 1, padding: '10px' }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {debeCambiarPass && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', maxWidth: '400px', width: '90%' }}>
            <h3>🔒 Cambio Obligatorio de Contraseña</h3>
            <form onSubmit={cambiarClaveObligatoria} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <input type="password" placeholder="Nueva Contraseña (mín 6 chars)" value={nuevaClave} onChange={e => setNuevaClave(e.target.value)} required minLength={6} />
              <button type="submit">Actualizar Contraseña</button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL FORZAR GANADOR */}
      {modalForzar.visible && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', maxWidth: '450px', width: '90%' }}>
            <h3 style={{ color: '#E53E3E', marginTop: 0 }}>⚠️ Forzar Resultado del Partido</h3>
            <p style={{ fontSize: '0.9em', color: '#4A5568' }}>{modalForzar.partido.local_nombre} vs {modalForzar.partido.visita_nombre}</p>
            
            <form onSubmit={confirmarForzarGanador} style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '15px' }}>
              <label>Seleccionar Equipo Ganador:
                <select 
                  value={modalForzar.ganadorId} 
                  onChange={e => setModalForzar({...modalForzar, ganadorId: e.target.value})}
                  style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                >
                  <option value={modalForzar.partido.equipo_local_id}>{modalForzar.partido.local_nombre}</option>
                  <option value={modalForzar.partido.equipo_visita_id}>{modalForzar.partido.visita_nombre}</option>
                </select>
              </label>
              
              <input type="text" placeholder="Motivo técnico de la modificación" value={modalForzar.motivo} onChange={e => setModalForzar({...modalForzar, motivo: e.target.value})} required style={{ padding: '8px' }} />
              <input type="password" placeholder="Ingresa tu contraseña de Admin" value={modalForzar.password} onChange={e => setModalForzar({...modalForzar, password: e.target.value})} required style={{ padding: '8px' }} />
              
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" style={{ flex: 1, background: '#E53E3E', color: 'white', border: 'none', padding: '10px' }}>Forzar Ganador</button>
                <button type="button" onClick={() => setModalForzar({...modalForzar, visible: false})} style={{ flex: 1, padding: '10px' }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HEADER PRINCIPAL */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h2>🏆 Panel de Administrador de Liga</h2>
          <label style={{ cursor: 'pointer', background: '#E2E8F0', padding: '5px 10px', borderRadius: '4px', fontSize: '0.85em', fontWeight: 'bold' }}>
            🖼️ Subir Logo
            <input type="file" accept="image/*" onChange={subirLogoOrganizacion} style={{ display: 'none' }} />
          </label>
        </div>
        <button onClick={cerrarSesion}>Cerrar Sesión</button>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
        {['equipos', 'sedes', 'credenciales', 'reglas', 'torneos', 'estadisticas', 'historial'].map((p) => (
          <button key={p} onClick={() => setPestana(p)} style={{ padding: '8px 14px', cursor: 'pointer', fontWeight: pestana === p ? 'bold' : 'normal', borderBottom: pestana === p ? '3px solid #2B6CB0' : 'none', background: pestana === p ? '#EBF8FF' : 'transparent' }}>
            {p.toUpperCase()}
          </button>
        ))}
      </div>

      {mensaje && <div style={{ padding: '10px', marginBottom: '15px', borderRadius: '4px', backgroundColor: '#EBF8FF', color: '#2B6CB0' }}>{mensaje}</div>}

      {/* SEDES */}
      {pestana === 'sedes' && (
        <div>
          <h3>🏟️ {sedeEditando ? '✏️ Editar Sede' : 'Registrar Nueva Sede'}</h3>
          <form onSubmit={guardarSede} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
            <input type="text" placeholder="Nombre de la Sede" value={formSede.nombre} onChange={e => setFormSede({...formSede, nombre: e.target.value})} required />
            <input type="text" placeholder="Dirección / Ubicación" value={formSede.direccion} onChange={e => setFormSede({...formSede, direccion: e.target.value})} />
            <div style={{ gridColumn: 'span 2', display: 'flex', gap: '10px' }}>
              <button type="submit" style={{ flex: 1 }}>{sedeEditando ? 'Actualizar Sede' : 'Guardar Sede'}</button>
              {sedeEditando && <button type="button" onClick={() => { setSedeEditando(null); setFormSede({ nombre: '', direccion: '' }); }}>Cancelar</button>}
            </div>
          </form>

<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3>Listado de Sedes</h3>
            <input type="text" placeholder="🔍 Buscar sede..." value={busquedaSedes} onChange={e => setBusquedaSedes(e.target.value)} style={{ padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}/>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                <th style={{ padding: '8px' }}>Sede</th>
                <th style={{ padding: '8px' }}>Dirección</th>
                <th style={{ padding: '8px' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sedes.filter(s => s.nombre.toLowerCase().includes(busquedaSedes.toLowerCase())).map(s => (
                <tr key={s.id}>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}><strong>{s.nombre}</strong></td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{s.direccion || 'Sin dirección'}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px', display: 'flex', gap: '5px' }}>
                    <button onClick={() => { setSedeEditando(s); setFormSede({ nombre: s.nombre, direccion: s.direccion || '' }); }} style={{ background: '#3182CE', color: 'white', border: 'none', padding: '4px 8px' }}>Editar</button>
                    <button onClick={() => eliminarSede(s.id)} style={{ background: '#E53E3E', color: 'white', border: 'none', padding: '4px 8px' }}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PLANTILLAS DE REGLAS (UNIFICADAS) */}
      {pestana === 'reglas' && (
        <div>
          <h3>📋 Plantillas de Reglas Parametrizables y de Puntuación</h3>
          <form onSubmit={guardarPlantillaReglas} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxWidth: '650px', marginBottom: '30px' }}>
            <input type="text" placeholder="Nombre Plantilla (Ej. Reglas Oficiales 2026)" value={formReglas.nombre} onChange={e => setFormReglas({...formReglas, nombre: e.target.value})} required style={{ gridColumn: 'span 2' }} />
            <textarea placeholder="Descripción o detalles adicionales" value={formReglas.descripcion} onChange={e => setFormReglas({...formReglas, descripcion: e.target.value})} rows="2" style={{ gridColumn: 'span 2', padding: '6px' }} />
            
            <label style={{ fontSize: '0.85em' }}>Puntos x Victoria: <input type="number" value={formReglas.puntos_victoria} onChange={e => setFormReglas({...formReglas, puntos_victoria: e.target.value})} style={{ width: '100%', marginTop: '3px' }} required /></label>
            <label style={{ fontSize: '0.85em' }}>Puntos x Empate: <input type="number" value={formReglas.puntos_empate} onChange={e => setFormReglas({...formReglas, puntos_empate: e.target.value})} style={{ width: '100%', marginTop: '3px' }} required /></label>
            <label style={{ fontSize: '0.85em' }}>Puntos x Derrota: <input type="number" value={formReglas.puntos_derrota} onChange={e => setFormReglas({...formReglas, puntos_derrota: e.target.value})} style={{ width: '100%', marginTop: '3px' }} required /></label>
            <label style={{ fontSize: '0.85em' }}>Límite Jugadores: <input type="number" min="1" value={formReglas.limite_jugadores} onChange={e => setFormReglas({...formReglas, limite_jugadores: e.target.value})} style={{ width: '100%', marginTop: '3px' }} required /></label>
            <label style={{ fontSize: '0.85em' }}>Meta Tantos: <input type="number" min="1" value={formReglas.meta_puntos} onChange={e => setFormReglas({...formReglas, meta_puntos: e.target.value})} style={{ width: '100%', marginTop: '3px' }} required /></label>
            <label style={{ fontSize: '0.85em' }}>Tiempo (Min): <input type="number" min="1" value={formReglas.tiempo_minutos} onChange={e => setFormReglas({...formReglas, tiempo_minutos: e.target.value})} style={{ width: '100%', marginTop: '3px' }} required /></label>
            <label style={{ fontSize: '0.85em' }}>Tarjetas Suspensión: <input type="number" min="0" value={formReglas.tarjetas_suspension} onChange={e => setFormReglas({...formReglas, tarjetas_suspension: e.target.value})} style={{ width: '100%', marginTop: '3px' }} required /></label>

            <label style={{ gridColumn: 'span 2', fontSize: '0.85em' }}>Política de Clasificación / Llaves:
              <select value={formReglas.politica_clasificacion} onChange={e => setFormReglas({...formReglas, politica_clasificacion: e.target.value})} style={{ width: '100%', marginTop: '3px', padding: '6px' }}>
                <option value="ganador_vs_ganador">Ganador vs Ganador</option>
                <option value="perdedor_vs_perdedor">Perdedor vs Perdedor (Consolación)</option>
                <option value="cruzado">Cruce Olímpico</option>
              </select>
            </label>

            <button type="submit" style={{ gridColumn: 'span 2', background: '#2B6CB0', color: 'white', padding: '10px' }}>Guardar Plantilla de Reglas</button>
          </form>

          <h3>Listado de Plantillas Registradas</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                <th style={{ padding: '8px' }}>Nombre</th>
                <th style={{ padding: '8px' }}>Puntuación (V / E / D)</th>
                <th style={{ padding: '8px' }}>Parámetros de Partido & Disciplina</th>
              </tr>
            </thead>
            <tbody>
              {plantillasReglas.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: '15px', color: '#666' }}>No hay plantillas de reglas registradas.</td></tr>
              ) : (
                plantillasReglas.map(pr => (
                  <tr key={pr.id}>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}><strong>{pr.nombre}</strong><br/><small>{pr.descripcion}</small></td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{pr.reglas?.puntos_victoria ?? 3}p | {pr.reglas?.puntos_empate ?? 1}p | {pr.reglas?.puntos_derrota ?? 0}p</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                      Máx. Jugadores: {pr.reglas?.limite_jugadores} | Meta: {pr.reglas?.meta_puntos} pts | Tiempo: {pr.reglas?.tiempo_minutos} min | Suspensión: {pr.reglas?.tarjetas_suspension} tjs
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* EQUIPOS Y JUGADORES */}
      {pestana === 'equipos' && (
        <div>
          <h3>🛡️ Registrar Nuevo Equipo</h3>
          <form onSubmit={guardarEquipo} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
            <input type="text" placeholder="Nombre Equipo" value={formEquipo.nombre} onChange={e => setFormEquipo({...formEquipo, nombre: e.target.value})} required />
            <select value={formEquipo.categoria} onChange={e => setFormEquipo({...formEquipo, categoria: e.target.value})}>
              <option value="Pre-Infantil (<8)">Pre-Infantil (&lt;8)</option>
              <option value="Infantil (8-13)">Infantil (8-13)</option>
              <option value="Adulto 22+">Adulto 22+</option>
              <option value="Libre">Libre / Ejecutivos</option>
            </select>
            <select value={formEquipo.tipo_genero} onChange={e => setFormEquipo({...formEquipo, tipo_genero: e.target.value})}>
              <option value="Mixto">Mixto</option>
              <option value="Femenino">Femenino</option>
              <option value="Masculino">Masculino</option>
            </select>
          <button type="submit" style={{ gridColumn: 'span 3' }}>Guardar Equipo</button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h3>Listado de Equipos</h3>
          <input type="text" placeholder="🔍 Buscar equipo..." value={busquedaEquipos} onChange={e => setBusquedaEquipos(e.target.value)} style={{ padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}/>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
          <thead>
            <tr style={{ background: '#eee' }}>
              <th style={{ padding: '8px' }}>Equipo</th>
              <th style={{ padding: '8px' }}>Categoría / Género</th>
              <th style={{ padding: '8px' }}>Delegado Actual</th>
              <th style={{ padding: '8px' }}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {equipos.filter(e => e.nombre.toLowerCase().includes(busquedaEquipos.toLowerCase())).map(e => (
              <tr key={e.id}>
                <td style={{ border: '1px solid #ddd', padding: '8px' }}><strong>{e.nombre}</strong></td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{e.categoria} - {e.tipo_genero}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                    <select value={e.delegado_id_usuario || ''} onChange={ev => reasignarDelegado(e.id, ev.target.value)}>
                      <option value="">-- Sin Delegado --</option>
                      {usuariosOperativos.filter(u => u.rol?.toLowerCase().includes('delegado')).map(u => (
                        <option key={u.id} value={u.id}>{u.nombre} {u.apellido}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                    <button onClick={() => seleccionarEquipoModal(e)}>👥 Nómina</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {equipoSeleccionado && (
            <div style={{ marginTop: '30px', border: '1px solid #2B6CB0', padding: '15px', borderRadius: '6px', background: '#F7FAFC' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4>{jugadorEditandoId ? '✏️ Modificar Jugador' : `Nómina de: ${equipoSeleccionado.nombre}`}</h4>
                <label style={{ background: '#38A169', color: 'white', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em' }}>
                  📁 Subida Masiva de Fotos (Lote)
                  <input type="file" multiple accept="image/*" onChange={manejarBatchUploadJugadores} style={{ display: 'none' }} />
                </label>
              </div>
              <p style={{ fontSize: '0.75em', color: '#666', marginTop: 2 }}>*Nombra tus archivos con la cédula del jugador (Ej: 12345678.jpg)</p>
              <form onSubmit={guardarJugador} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '15px', marginBottom: '15px' }}>
                <input type="text" placeholder="Cédula (5-8 dígitos)" pattern="\d{5,8}" value={formJugador.cedula} onChange={e => setFormJugador({...formJugador, cedula: e.target.value})} required />
                <input type="text" placeholder="Nombre" value={formJugador.nombre} onChange={e => setFormJugador({...formJugador, nombre: e.target.value})} required />
                <input type="text" placeholder="Apellido" value={formJugador.apellido} onChange={e => setFormJugador({...formJugador, apellido: e.target.value})} required />
                <input type="date" max={hoyStr} value={formJugador.fecha_nacimiento} onChange={e => setFormJugador({...formJugador, fecha_nacimiento: e.target.value})} required />
                <input type="email" placeholder="Correo Obligatorio" value={formJugador.correo} onChange={e => setFormJugador({...formJugador, correo: e.target.value})} required />
                <input type="text" placeholder="Teléfono Obligatorio" value={formJugador.telefono} onChange={e => setFormJugador({...formJugador, telefono: e.target.value})} required />
                <input type="number" min="1" placeholder="Dorsal Positivo" value={formJugador.numero_dorsal} onChange={e => setFormJugador({...formJugador, numero_dorsal: e.target.value})} required />
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <input type="checkbox" checked={formJugador.es_capitan} onChange={e => setFormJugador({...formJugador, es_capitan: e.target.checked})} /> Capitán
                </label>
                <div style={{ gridColumn: 'span 2', display: 'flex', gap: '5px' }}>
                  <button type="submit" style={{ flex: 1 }}>{jugadorEditandoId ? 'Actualizar Jugador' : 'Registrar Jugador'}</button>
                  {jugadorEditandoId && <button type="button" onClick={() => { setJugadorEditandoId(null); setFormJugador({ cedula: '', nombre: '', apellido: '', fecha_nacimiento: '', correo: '', telefono: '', numero_dorsal: '', foto_url: '', es_capitan: false }); }}>Cancelar</button>}
                </div>
              </form>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
                <thead>
                  <tr style={{ background: '#E2E8F0' }}>
                    <th style={{ padding: '6px' }}>Estado</th>
                    <th style={{ padding: '6px' }}>Dorsal</th>
                    <th style={{ padding: '6px' }}>Jugador</th>
                    <th style={{ padding: '6px' }}>Cédula</th>
                    <th style={{ padding: '6px' }}>Contacto</th>
                    <th style={{ padding: '6px' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {jugadores.map(j => (
                    <tr key={j.id} style={{ opacity: j.estado === 'Inactivo' ? 0.6 : 1, background: j.estado === 'Inactivo' ? '#EDF2F7' : 'transparent' }}>
                      <td style={{ padding: '6px', textAlign: 'center' }}>{j.estado === 'Activo' ? '🟢 Activo' : '🔴 Inactivo'}</td>
                      <td style={{ padding: '6px', textAlign: 'center' }}><strong>#{j.numero_dorsal}</strong></td>
                      <td style={{ padding: '6px' }}>{j.nombre} {j.apellido} {equipoSeleccionado.capitan_id === j.id && '⭐'}</td>
                      <td style={{ padding: '6px' }}>{j.cedula}</td>
                      <td style={{ padding: '6px' }}>{j.correo} / {j.telefono}</td>
                      <td style={{ padding: '6px', display: 'flex', gap: '4px' }}>
                        <button onClick={() => iniciarEdicionJugador(j)} style={{ background: '#3182CE', color: 'white', border: 'none', padding: '3px 6px' }}>Editar</button>
                        <button onClick={() => cambiarEstadoJugador(j.id, j.estado)} style={{ background: j.estado === 'Activo' ? '#E53E3E' : '#38A169', color: 'white', border: 'none', padding: '3px 6px' }}>
                          {j.estado === 'Activo' ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CREDENCIALES */}
      {pestana === 'credenciales' && (
        <div>
          <h3>👤 Crear Credencial y Gestión de Usuarios Operativos</h3>
            <form onSubmit={guardarCredencial} style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '500px', marginBottom: '30px' }}>
              {/* 1. CEDULA PRIMERO CON VALIDACION NUMÉRICA */}
              <input 
                type="text" 
                placeholder="Cédula (Ingrese para verificar existencia)" 
                value={formCredencial.cedula} 
                onChange={e => setFormCredencial({...formCredencial, cedula: e.target.value.replace(/\D/g, '')})} 
                onBlur={async (e) => {
                  if(e.target.value.length >= 5) {
                    const res = await fetchConToken(`/verificar-cedula/${e.target.value}`);
                    const data = await res.json();
                    if(data.existe) {
                      alert(`✅ Usuario encontrado: ${data.usuario.nombre} ${data.usuario.apellido}. Al guardar, será asociado a tu liga.`);
                      setFormCredencial(prev => ({...prev, nombre: data.usuario.nombre, apellido: data.usuario.apellido, email: data.usuario.email}));
                    }
                  }
                }}
                required 
              />

              <select value={formCredencial.rol} onChange={e => setFormCredencial({...formCredencial, rol: e.target.value, equipo_id: ''})}>
                <option value="arbitro">Árbitro</option>
                <option value="anotador">Anotador</option>
                <option value="delegado de equipo">Delegado de Equipo</option>
              </select>

              {/* (Mantén el Select de equipo_id del delegado aquí) */}
              
              <input type="text" placeholder="Nombre" value={formCredencial.nombre} onChange={e => setFormCredencial({...formCredencial, nombre: e.target.value})} required />
              <input type="text" placeholder="Apellido" value={formCredencial.apellido} onChange={e => setFormCredencial({...formCredencial, apellido: e.target.value})} required />
              <input type="email" placeholder="Correo Electrónico" value={formCredencial.email} onChange={e => setFormCredencial({...formCredencial, email: e.target.value})} required />

          <button type="submit">Generar / Asociar Credencial</button>
            </form>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3>Listado de Usuarios Operativos Registrados en la Liga</h3>
            <input type="text" placeholder="🔍 Buscar credencial..." value={busquedaCredenciales} onChange={e => setBusquedaCredenciales(e.target.value)} style={{ padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}/>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                <th style={{ padding: '8px' }}>Usuario</th>
                <th style={{ padding: '8px' }}>Rol</th>
                <th style={{ padding: '8px' }}>Cédula</th>
                <th style={{ padding: '8px' }}>Correo</th>
                <th style={{ padding: '8px' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {usuariosOperativos.filter(u => `${u.nombre} ${u.apellido} ${u.cedula} ${u.email}`.toLowerCase().includes(busquedaCredenciales.toLowerCase())).map(u => (
                <tr key={u.id}>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}><strong>{u.nombre} {u.apellido}</strong></td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{u.rol}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{u.cedula}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{u.email}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                    <button onClick={() => resetearPasswordOperativo(u.id, u.cedula, u.nombre)}>Reset Clave</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TORNEOS Y CLASIFICACIÓN */}
      {pestana === 'torneos' && (
        <div style={{ background: '#FFF', border: '1px solid #CBD5E0', padding: '20px', borderRadius: '6px' }}>
          
          {torneoEditando && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1500 }}>
              <div style={{ background: '#fff', padding: '25px', borderRadius: '8px', maxWidth: '450px', width: '90%' }}>
                <h3>✏️ Editar Torneo: {torneoEditando.nombre}</h3>
                <form onSubmit={actualizarTorneoEdicion} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <input type="text" value={torneoEditando.nombre} onChange={e => setTorneoEditando({...torneoEditando, nombre: e.target.value})} required />
                  <label>Fecha Inicio: <input type="date" value={torneoEditando.fecha_inicio} onChange={e => setTorneoEditando({...torneoEditando, fecha_inicio: e.target.value})} required /></label>
                  <label>Fecha Fin: <input type="date" value={torneoEditando.fecha_fin} onChange={e => setTorneoEditando({...torneoEditando, fecha_fin: e.target.value})} required /></label>
                  <label>Estado:
                    <select value={torneoEditando.reglas?.estado || 'Activo'} onChange={e => setTorneoEditando({...torneoEditando, reglas: { ...torneoEditando.reglas, estado: e.target.value }})}>
                      <option value="Activo">Activo</option>
                      <option value="Suspendido">Suspendido</option>
                    </select>
                  </label>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <button type="submit">Guardar Cambios</button>
                    <button type="button" onClick={() => setTorneoEditando(null)}>Cancelar</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
            <button onClick={() => setSubPestanaTorneo('lista')} style={{ fontWeight: subPestanaTorneo === 'lista' ? 'bold' : 'normal' }}>📋 Torneos Activos</button>
            <button onClick={() => setSubPestanaTorneo('crear')} style={{ fontWeight: subPestanaTorneo === 'crear' ? 'bold' : 'normal' }}>➕ Crear Nuevo Torneo</button>
            <button onClick={() => setSubPestanaTorneo('partido-suelto')} style={{ fontWeight: subPestanaTorneo === 'partido-suelto' ? 'bold' : 'normal' }}>⚡ Agendar Partido Suelto</button>
            <button onClick={() => setSubPestanaTorneo('posiciones')} style={{ fontWeight: subPestanaTorneo === 'posiciones' ? 'bold' : 'normal' }}>📊 Posiciones y Grupos</button>
            <button onClick={() => setSubPestanaTorneo('acumulado')} style={{ fontWeight: subPestanaTorneo === 'acumulado' ? 'bold' : 'normal' }}>🏅 Acumulado Anual</button>
            <button onClick={() => setSubPestanaTorneo('historial')} style={{ fontWeight: subPestanaTorneo === 'historial' ? 'bold' : 'normal' }}>📜 Historial</button>
          </div>

          {/* VISTA 1: TORNEOS ACTIVOS / PRÓXIMOS Y PARTIDOS SUSPENDIDOS */}
          {subPestanaTorneo === 'lista' && (
            <div>
              <div style={{ marginBottom: '25px', background: '#FFF5F5', border: '1px solid #FEB2B2', padding: '15px', borderRadius: '6px' }}>
                <h3 style={{ color: '#C53030', marginTop: 0 }}>🚨 Partidos Suspendidos (Requieren Acción)</h3>
                {torneosList.flatMap(t => t.partidos || []).filter(p => p.estado === 'Suspendido').length === 0 ? (
                  <p style={{ color: '#666', fontSize: '0.9em', margin: 0 }}>No hay partidos suspendidos en este momento.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em', background: '#FFF', marginTop: '10px' }}>
                    <thead>
                      <tr style={{ background: '#FED7D7', color: '#C53030' }}>
                        <th style={{ padding: '6px' }}>Fecha Original</th>
                        <th style={{ padding: '6px' }}>Encuentro</th>
                        <th style={{ padding: '6px' }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {torneosList.flatMap(t => (t.partidos || []).map(p => ({ ...p, torneo_nombre: t.nombre }))).filter(p => p.estado === 'Suspendido').map(p => (
                        <tr key={p.id}>
                          <td style={{ border: '1px solid #ddd', padding: '6px' }}>{new Date(p.fecha_hora).toLocaleString('es-VE')} ({p.torneo_nombre})</td>
                          <td style={{ border: '1px solid #ddd', padding: '6px' }}>{p.local_nombre || 'Por definir'} vs {p.visita_nombre || 'Por definir'}</td>
                          <td style={{ border: '1px solid #ddd', padding: '6px', display: 'flex', gap: '5px', justifyContent: 'center' }}>
                            <button onClick={() => setModalReagendar({ visible: true, partido: p, nuevaFecha: p.fecha_hora.slice(0, 16) })} style={{ background: '#3182CE', color: '#FFF', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>📅 Reagendar</button>
                            <button onClick={async () => { if(window.confirm('¿Cancelar definitivamente este partido?')) { await fetchConToken(`/partidos/${p.id}/cancelar`, { method: 'PUT' }); cargarDatos(); } }} style={{ background: '#E53E3E', color: '#FFF', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}>❌ Cancelar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <h3>📋 Torneos Activos y Próximos</h3>
              {torneosList.filter(t => t.fecha_fin >= hoyStr && t.reglas?.estado !== 'Suspendido').length === 0 ? (
                <p style={{ color: '#666', padding: '15px' }}>No hay torneos activos o próximos.</p>
              ) : (
                torneosList.filter(t => t.fecha_fin >= hoyStr && t.reglas?.estado !== 'Suspendido').map(t => (
                  <div key={t.id} style={{ border: '1px solid #CBD5E0', borderRadius: '6px', padding: '15px', marginBottom: '20px', background: '#F8FAFC' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <h4 style={{ margin: 0 }}>🏆 {t.nombre} ({t.fecha_inicio} al {t.fecha_fin})</h4>
                      <div>
                        <button onClick={() => setTorneoEditando(t)} style={{ marginRight: '8px' }}>✏️ Editar</button>
                      </div>
                    </div>

                  <h5 style={{ margin: '10px 0 5px 0', color: '#2B6CB0' }}>Partidos Agendados:</h5>
                    {t.partidos && t.partidos.length > 0 ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em', background: '#FFF' }}>
                        <thead>
                          <tr style={{ background: '#E2E8F0' }}>
                            <th style={{ padding: '6px' }}>Fase</th>
                            <th style={{ padding: '6px' }}>Encuentro</th>
                            <th style={{ padding: '6px' }}>Fecha y Hora</th>
                            <th style={{ padding: '6px' }}>Sede</th>
                            <th style={{ padding: '6px' }}>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {t.partidos.filter(p => p.estado === 'Agendado' || p.estado === 'En Curso').map(p => (
                            <tr key={p.id}>
                              <td style={{ border: '1px solid #ddd', padding: '6px' }}><strong>{p.fase}</strong></td>
                              <td style={{ border: '1px solid #ddd', padding: '6px' }}>{p.local_nombre || 'Por definir'} vs {p.visita_nombre || 'Por definir'}</td>
                              <td style={{ border: '1px solid #ddd', padding: '6px' }}>{new Date(p.fecha_hora).toLocaleString('es-VE')}</td>
                              <td style={{ border: '1px solid #ddd', padding: '6px' }}>{p.sede_nombre || 'Sede principal'}</td>
                              <td style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'center' }}>
                                <button onClick={() => setModalEditarPartido({ visible: true, partido: p, fecha_hora: p.fecha_hora.slice(0, 16), arbitro_id: p.arbitro_id || '', anotador_id: p.anotador_id || '', sede_id: p.sede_id || '' })} style={{ padding: '3px 8px', fontSize: '0.9em' }}>✏️ Editar Oficiales/Fecha</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p style={{ fontSize: '0.85em', color: '#718096' }}>No hay partidos programados para este torneo.</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* VISTA 2: CREAR NUEVO TORNEO */}
          {subPestanaTorneo === 'crear' && (
            <div>
              {pasoTorneo === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '600px' }}>
                  <h4>Paso 1: Datos Generales, Categoría y Método Dinámico de Clasificación</h4>
                  <input type="text" placeholder="Nombre del Torneo" value={formTorneo.nombre} onChange={e => setFormTorneo({...formTorneo, nombre: e.target.value})} required />
                  
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <label style={{ flex: 1 }}>Fecha Inicio: <input type="date" min={hoyStr} value={formTorneo.fecha_inicio} onChange={e => setFormTorneo({...formTorneo, fecha_inicio: e.target.value})} style={{ width: '100%' }} required /></label>
                    <label style={{ flex: 1 }}>Fecha Fin: <input type="date" min={formTorneo.fecha_inicio || hoyStr} value={formTorneo.fecha_fin} onChange={e => setFormTorneo({...formTorneo, fecha_fin: e.target.value})} style={{ width: '100%' }} required /></label>
                  </div>

                  <label style={{ fontWeight: 'bold' }}>Categorías que participarán en este torneo:</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', background: '#F7FAFC', padding: '10px', border: '1px solid #E2E8F0', borderRadius: '6px' }}>
                    {[...new Set(recursosTorneo.equipos.map(e => `${e.categoria} - ${e.tipo_genero}`))].map(cat => (
                      <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input 
                          type="checkbox" 
                          checked={categoriasSeleccionadas.includes(cat)}
                          onChange={e => {
                            if(e.target.checked) setCategoriasSeleccionadas([...categoriasSeleccionadas, cat]);
                            else setCategoriasSeleccionadas(categoriasSeleccionadas.filter(c => c !== cat));
                          }} 
                        /> {cat}
                      </label>
                    ))}
                  </div>

                  <label>Método de Clasificación:
                    <select value={formTorneo.sistema_clasificacion} onChange={e => setFormTorneo({...formTorneo, sistema_clasificacion: e.target.value})} style={{ width: '100%', marginTop: '5px', padding: '6px' }}>
                      <option value="liga_semifinales">1. Formato de Liga (Todos vs Todos) y Semifinales (Top 4)</option>
                      <option value="dos_grupos">2. Formato de Dos Grupos / Triangular (A y B)</option>
                      <option value="liga_final_directa">3. Formato de Liga directo a la Final (Top 2)</option>
                    </select>
                  </label>

                  {formTorneo.sistema_clasificacion === 'dos_grupos' && (
                    <label>Estrategia (Dos Grupos):
                      <select value={formTorneo.opcion_grupos} onChange={e => setFormTorneo({...formTorneo, opcion_grupos: e.target.value})} style={{ width: '100%', marginTop: '5px', padding: '6px' }}>
                        <option value="final_directa">1° de cada grupo pasa directo a la Gran Final</option>
                        <option value="cruc_semis">Top 2 de cada grupo avanzan a Semifinales Cruzadas</option>
                      </select>
                    </label>
                  )}

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="checkbox" checked={formTorneo.incluir_tercer_lugar} onChange={e => setFormTorneo({...formTorneo, incluir_tercer_lugar: e.target.checked})} />
                    Incluir Partido por el Tercer Lugar (perdedores de semifinales)
                  </label>

                  <select value={formTorneo.plantilla_id} onChange={e => setFormTorneo({...formTorneo, plantilla_id: e.target.value})} required>
                    <option value="">-- Selecciona Plantilla de Reglas --</option>
                    {plantillasReglas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>

                  <button type="button" onClick={() => {
                    if (!formTorneo.nombre || !formTorneo.fecha_inicio || !formTorneo.fecha_fin || !formTorneo.plantilla_id) {
                      alert('Completa todos los campos del Paso 1.'); return;
                    }
                    if (formTorneo.fecha_inicio < hoyStr) {
                      alert('La fecha de inicio no puede ser pasada.'); return;
                    }
                    if(categoriasSeleccionadas.length === 0) return alert('Selecciona al menos una categoría');
                    setPasoTorneo(2);
                  }} style={{ background: '#2B6CB0', color: 'white', padding: '10px' }}>Siguiente: Seleccionar Equipos ➡️</button>
                </div>
              )}

              {/* PASO 2 CON VALIDACIÓN DE JUGADORES */}
              {pasoTorneo === 2 && (
                <div>
                  <h4>Paso 2: Seleccionar Equipos ({formTorneo.categoria} - {formTorneo.tipo_genero})</h4>
                  <p style={{ fontSize: '0.85em', color: '#666' }}>Los equipos marcados en rojo no cuentan con el mínimo de jugadores activos requeridos por la plantilla.</p>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                    {recursosTorneo.equipos
                      .filter(e => categoriasSeleccionadas.includes(`${e.categoria} - ${e.tipo_genero}`))
                      .map(eq => {
                        const plantillaSel = plantillasReglas.find(p => p.id === parseInt(formTorneo.plantilla_id));
                        const minimoRequerido = plantillaSel?.reglas?.limite_jugadores || 4;
                        const faltantes = Math.max(0, minimoRequerido - parseInt(eq.total_jugadores_activos || 0));
                        const cumpleNomina = faltantes === 0;

                        return (
                          <label key={eq.id} style={{ 
                            border: `1px solid ${cumpleNomina ? '#CBD5E0' : '#E53E3E'}`, 
                            padding: '10px', 
                            borderRadius: '4px', 
                            background: cumpleNomina ? '#FFF' : '#FFF5F5',
                            display: 'flex', flexDirection: 'column', gap: '5px' 
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input 
                                type="checkbox" 
                                checked={equiposSeleccionadosTorneo.includes(eq.id)}
                                onChange={e => {
                                  if (e.target.checked) setEquiposSeleccionadosTorneo([...equiposSeleccionadosTorneo, eq.id]);
                                  else setEquiposSeleccionadosTorneo(equiposSeleccionadosTorneo.filter(id => id !== eq.id));
                                }} 
                              />
                              <strong>{eq.nombre}</strong>
                            </div>
                            <span style={{ fontSize: '0.75em', color: cumpleNomina ? '#38A169' : '#E53E3E', fontWeight: 'bold' }}>
                              {cumpleNomina ? '✅ Nómina completa' : `⚠️ Faltan ${faltantes} jugadores (Activos: ${eq.total_jugadores_activos})`}
                            </span>
                          </label>
                        );
                      })}
                  </div>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button" onClick={() => setPasoTorneo(1)}>⬅️ Volver</button>
                    <button type="button" onClick={() => {
                      const equiposIncompletos = equiposSeleccionadosTorneo.filter(id => {
                        const eq = recursosTorneo.equipos.find(x => x.id === id);
                        const plantillaSel = plantillasReglas.find(p => p.id === parseInt(formTorneo.plantilla_id));
                        const minimoRequerido = plantillaSel?.reglas?.limite_jugadores || 4;
                        return parseInt(eq?.total_jugadores_activos || 0) < minimoRequerido;
                      });
                      if (equiposIncompletos.length > 0) {
                        if (!window.confirm('Hay equipos seleccionados que no cumplen con el mínimo de jugadores requeridos. ¿Deseas continuar de todas formas?')) return;
                      }
                      generarEstructuraPartidosPersonalizada();
                    }} style={{ background: '#2B6CB0', color: 'white', padding: '10px 20px' }}>Calcular y Generar Partidos ⚡</button>
                  </div>
                </div>
              )}

              {pasoTorneo === 3 && (
                <div>
                  <h4>Paso 3: Programar Fechas, Horas, Sedes y Oficiales</h4>
                  <p style={{ fontSize: '0.85em', color: '#666' }}>Los partidos de la fase regular permiten cambiar equipos; las fases calculadas por el sistema son fijas.</p>
                  
                  {partidosIniciales.map((p, index) => {
                    const esPrimeraFase = p.fase.includes('Fase Regular') || p.fase.includes('Grupo');

                    return (
                      <div key={index} style={{ border: '1px solid #CBD5E0', padding: '12px', borderRadius: '6px', marginBottom: '10px', background: '#F7FAFC' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                          <strong>[{p.fase}]</strong>
                        </div>

                        {esPrimeraFase ? (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
                            <label style={{ fontSize: '0.85em' }}>Local:
                              <select value={p.local_id} onChange={e => {
                                const arr = [...partidosIniciales]; arr[index].local_id = e.target.value; setPartidosIniciales(arr);
                              }} style={{ width: '100%', marginTop: '3px' }}>
                                <option value="">-- Seleccionar Equipo --</option>
                                {equiposSeleccionadosTorneo.map(idEq => {
                                  const eqObj = equipos.find(x => x.id === idEq);
                                  return <option key={idEq} value={idEq}>{eqObj?.nombre}</option>;
                                })}
                              </select>
                            </label>

                            <label style={{ fontSize: '0.85em' }}>Visita:
                              <select value={p.visita_id} onChange={e => {
                                const arr = [...partidosIniciales]; arr[index].visita_id = e.target.value; setPartidosIniciales(arr);
                              }} style={{ width: '100%', marginTop: '3px' }}>
                                <option value="">-- Seleccionar Equipo --</option>
                                {equiposSeleccionadosTorneo.map(idEq => {
                                  const eqObj = equipos.find(x => x.id === idEq);
                                  return <option key={idEq} value={idEq}>{eqObj?.nombre}</option>;
                                })}
                              </select>
                            </label>
                          </div>
                        ) : (
                          <div style={{ padding: '6px 0', fontSize: '0.85em', color: '#2B6CB0', fontStyle: 'italic' }}>
                            🔒 Enfrentamiento determinado automáticamente por el modelo del sistema (Fase Final).
                          </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '8px' }}>
                          <select value={p.sede_id} onChange={e => {
                            const arr = [...partidosIniciales]; arr[index].sede_id = e.target.value; setPartidosIniciales(arr);
                          }} required>
                            <option value="">-- Sede --</option>
                            {recursosTorneo.sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                          </select>

                          {recursosTorneo.arbitros.length > 1 ? (
                            <select value={p.arbitro_id} onChange={e => {
                              const arr = [...partidosIniciales]; arr[index].arbitro_id = e.target.value; setPartidosIniciales(arr);
                            }}>
                              <option value="">-- Árbitro --</option>
                              {recursosTorneo.arbitros.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}
                            </select>
                          ) : (
                            <span style={{ fontSize: '0.85em', alignSelf: 'center', color: '#4A5568' }}>
                              Árbitro: {recursosTorneo.arbitros[0] ? `${recursosTorneo.arbitros[0].nombre} ${recursosTorneo.arbitros[0].apellido}` : 'Sin árbitro'}
                            </span>
                          )}

                          {recursosTorneo.anotadores.length > 1 ? (
                            <select value={p.anotador_id} onChange={e => {
                              const arr = [...partidosIniciales]; arr[index].anotador_id = e.target.value; setPartidosIniciales(arr);
                            }}>
                              <option value="">-- Anotador --</option>
                              {recursosTorneo.anotadores.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}
                            </select>
                          ) : (
                            <span style={{ fontSize: '0.85em', alignSelf: 'center', color: '#4A5568' }}>
                              Anotador: {recursosTorneo.anotadores[0] ? `${recursosTorneo.anotadores[0].nombre} ${recursosTorneo.anotadores[0].apellido}` : 'Sin anotador'}
                            </span>
                          )}
                        </div>

                        <div style={{ marginTop: '8px' }}>
                          <input 
                            type="datetime-local" 
                            min={`${formTorneo.fecha_inicio}T00:00`} 
                            max={`${formTorneo.fecha_fin}T23:59`}
                            value={p.fecha_hora} 
                            onChange={e => {
                              const arr = [...partidosIniciales]; 
                              arr[index].fecha_hora = e.target.value; 
                              setPartidosIniciales(arr);
                            }} 
                            required 
                            style={{ width: '100%' }} 
                          />
                          <small style={{ color: '#718096', fontSize: '0.75em' }}>
                            📅 Válido desde el {formTorneo.fecha_inicio} hasta el {formTorneo.fecha_fin}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                    <button type="button" onClick={() => setPasoTorneo(2)}>⬅️ Volver</button>
                    <button type="button" onClick={guardarTorneoCompleto} style={{ background: '#38A169', color: 'white', padding: '10px 20px' }}>💾 Guardar Torneo Configurado</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VISTA NUEVA: AGENDAR PARTIDO SUELTO */}
          {subPestanaTorneo === 'partido-suelto' && (
            <div style={{ maxWidth: '600px' }}>
              <h3>⚡ Agendar Partido Suelto (Prueba Operativa)</h3>
              <p style={{ fontSize: '0.85em', color: '#666' }}>
                Programa un encuentro rápido independiente. El sistema lo agrupará automáticamente en el registro general de partidos sueltos.
              </p>

              <form onSubmit={guardarPartidoSuelto} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '15px' }}>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label style={{ fontSize: '0.9em' }}>Equipo Local:
                    <select 
                      value={formPartidoSuelto.equipo_local_id} 
                      onChange={e => setFormPartidoSuelto({...formPartidoSuelto, equipo_local_id: e.target.value})} 
                      style={{ width: '100%', marginTop: '4px', padding: '8px' }} 
                      required
                    >
                      <option value="">-- Local --</option>
                      {recursosTorneo.equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
                    </select>
                  </label>

                  <label style={{ fontSize: '0.9em' }}>Equipo Visitante:
                    <select 
                      value={formPartidoSuelto.equipo_visita_id} 
                      onChange={e => setFormPartidoSuelto({...formPartidoSuelto, equipo_visita_id: e.target.value})} 
                      style={{ width: '100%', marginTop: '4px', padding: '8px' }} 
                      required
                    >
                      <option value="">-- Visitante --</option>
                      {recursosTorneo.equipos.map(eq => <option key={eq.id} value={eq.id}>{eq.nombre}</option>)}
                    </select>
                  </label>
                </div>

                <label style={{ fontSize: '0.9em' }}>Sede del Encuentro:
                  <select 
                    value={formPartidoSuelto.sede_id} 
                    onChange={e => setFormPartidoSuelto({...formPartidoSuelto, sede_id: e.target.value})} 
                    style={{ width: '100%', marginTop: '4px', padding: '8px' }} 
                    required
                  >
                    <option value="">-- Seleccionar Sede --</option>
                    {recursosTorneo.sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <label style={{ fontSize: '0.9em' }}>Árbitro Asignado:
                    <select 
                      value={formPartidoSuelto.arbitro_id} 
                      onChange={e => setFormPartidoSuelto({...formPartidoSuelto, arbitro_id: e.target.value})} 
                      style={{ width: '100%', marginTop: '4px', padding: '8px' }}
                    >
                      <option value="">-- Seleccionar Árbitro --</option>
                      {recursosTorneo.arbitros.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}
                    </select>
                  </label>

                  <label style={{ fontSize: '0.9em' }}>Anotador Asignado:
                    <select 
                      value={formPartidoSuelto.anotador_id} 
                      onChange={e => setFormPartidoSuelto({...formPartidoSuelto, anotador_id: e.target.value})} 
                      style={{ width: '100%', marginTop: '4px', padding: '8px' }}
                    >
                      <option value="">-- Seleccionar Anotador --</option>
                      {recursosTorneo.anotadores.map(a => <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>)}
                    </select>
                  </label>
                </div>

                <label style={{ fontSize: '0.9em' }}>Fecha y Hora del Partido:
                  <input 
                    type="datetime-local" 
                    min={ahoraIsoLocal} 
                    value={formPartidoSuelto.fecha_hora} 
                    onChange={e => setFormPartidoSuelto({...formPartidoSuelto, fecha_hora: e.target.value})} 
                    style={{ width: '100%', marginTop: '4px', padding: '8px' }} 
                    required 
                  />
                </label>

                <button 
                  type="submit" 
                  style={{ background: '#3182CE', color: 'white', padding: '12px', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}
                >
                  🚀 Agendar Partido Suelto
                </button>
              </form>
            </div>
          )}

          {/* TABLAS GENERALES AGRUPADAS POR CATEGORÍA */}
              {posicionesGrupoA.length === 0 && posicionesGrupoB.length === 0 && (
                <div>
                  {/* Extraer categorías únicas de las posiciones recibidas */}
                  {[...new Set(posicionesGeneral.map(p => `${p.categoria} - ${p.tipo_genero}`))].map(catName => {
                    const equiposDeCat = posicionesGeneral.filter(p => `${p.categoria} - ${p.tipo_genero}` === catName);
                    if(equiposDeCat.length === 0) return null;
                    return (
                      <div key={catName} style={{ marginBottom: '30px' }}>
                        <h4 style={{ background: '#4A5568', color: 'white', padding: '8px', borderRadius: '4px 4px 0 0', margin: 0 }}>🏆 Posiciones: {catName}</h4>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                          <thead>
                            <tr style={{ background: '#eee' }}>
                              <th style={{ padding: '8px' }}>Equipo</th>
                              <th style={{ padding: '8px' }}>Puntos</th>
                              <th style={{ padding: '8px' }}>Diferencia de Tantos</th>
                            </tr>
                          </thead>
                          <tbody>
                            {equiposDeCat.map((pos, idx) => (
                              <tr key={idx}>
                                <td style={{ border: '1px solid #ddd', padding: '8px' }}><strong>{pos.equipo_nombre}</strong></td>
                                <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>{pos.total_puntos}</td>
                                <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>{pos.diff_tantos}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                  {posicionesGeneral.length === 0 && <p style={{ color: '#666' }}>Selecciona un torneo para consultar sus posiciones.</p>}
                </div>
              )}

          {/* VISTA 4: ACUMULADO ANUAL */}
          {subPestanaTorneo === 'acumulado' && (
            <div>
              <h3>🏅 Tabla de Acumulación Anual (Filtro 60% Asistencia)</h3>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <input type="text" placeholder="Temporada (Ej. 2026)" value={temporadaFiltro} onChange={e => setTemporadaFiltro(e.target.value)} />
                <button onClick={consultarAcumuladoLiga}>Consultar Acumulado</button>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <thead>
                  <tr style={{ background: '#eee' }}>
                    <th style={{ padding: '8px' }}>Equipo</th>
                    <th style={{ padding: '8px' }}>Total Puntos</th>
                    <th style={{ padding: '8px' }}>Torneos Jugados</th>
                    <th style={{ padding: '8px' }}>Asistencia Total</th>
                  </tr>
                </thead>
                <tbody>
                  {acumuladoLiga.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '15px', color: '#666' }}>No hay registros de acumulado para esta temporada.</td></tr>
                  ) : (
                    acumuladoLiga.map((ac, idx) => (
                      <tr key={idx}>
                        <td style={{ border: '1px solid #ddd', padding: '8px' }}><strong>{ac.nombre}</strong></td>
                        <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>{ac.total_puntos}</td>
                        <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>{ac.torneos_jugados}</td>
                        <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>{ac.torneos_jugados} / {ac.total_torneos_temporada} (&ge; 60%)</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* VISTA 5: HISTORIAL PASADOS */}
          {subPestanaTorneo === 'historial' && (
            <div>
              <h3>📜 Historial de Torneos Pasados y Suspendidos</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <thead>
                  <tr style={{ background: '#eee' }}>
                    <th style={{ padding: '8px' }}>Nombre</th>
                    <th style={{ padding: '8px' }}>Inicio</th>
                    <th style={{ padding: '8px' }}>Fin</th>
                    <th style={{ padding: '8px' }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {torneosList.filter(t => t.fecha_fin < hoyStr || t.reglas?.estado === 'Suspendido').length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '15px', color: '#666' }}>No hay torneos en el historial.</td></tr>
                  ) : (
                    torneosList.filter(t => t.fecha_fin < hoyStr || t.reglas?.estado === 'Suspendido').map(t => (
                      <tr key={t.id}>
                        <td style={{ border: '1px solid #ddd', padding: '8px' }}><strong>{t.nombre}</strong></td>
                        <td style={{ border: '1px solid #ddd', padding: '8px' }}>{t.fecha_inicio}</td>
                        <td style={{ border: '1px solid #ddd', padding: '8px' }}>{t.fecha_fin}</td>
                        <td style={{ border: '1px solid #ddd', padding: '8px' }}>{t.reglas?.estado === 'Suspendido' ? '🔴 Suspendido' : '🏁 Finalizado'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ESTADÍSTICAS */}
      {pestana === 'estadisticas' && estadisticas && (
        <div>
          <h3>📊 Métricas y Estadísticas de la Liga</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginBottom: '20px' }}>
            <div style={{ border: '1px solid #ccc', padding: '15px', textAlign: 'center', borderRadius: '6px' }}><h4>Partidos Jugados</h4><p style={{ fontSize: '2em', margin: 0 }}>{estadisticas.partidos_jugados}</p></div>
            <div style={{ border: '1px solid #ccc', padding: '15px', textAlign: 'center', borderRadius: '6px' }}><h4>Torneos Totales</h4><p style={{ fontSize: '2em', margin: 0 }}>{estadisticas.total_torneos}</p></div>
            <div style={{ border: '1px solid #ccc', padding: '15px', textAlign: 'center', borderRadius: '6px' }}><h4>Equipos Inscritos</h4><p style={{ fontSize: '2em', margin: 0 }}>{estadisticas.total_equipos}</p></div>
            <div style={{ border: '1px solid #ccc', padding: '15px', textAlign: 'center', borderRadius: '6px' }}><h4>Jugadores Activos</h4><p style={{ fontSize: '2em', margin: 0 }}>{estadisticas.total_jugadores}</p></div>
            <div style={{ border: '1px solid #ccc', padding: '15px', textAlign: 'center', borderRadius: '6px' }}><h4>Tarjetas Acumuladas</h4><p style={{ fontSize: '2em', margin: 0 }}>{estadisticas.total_tarjetas}</p></div>
          </div>
          <h3>⭐ Top Jugadores Destacados (Efectividad)</h3>
          <ul>
            {estadisticas.mejores_jugadores.map((j, i) => (
              <li key={i}><strong>{j.nombre} {j.apellido}</strong> ({j.equipo}) - {j.efectivas} jugadas efectivas</li>
            ))}
          </ul>
        </div>
      )}

      {/* HISTORIAL ACTUALIZADO Y DIVIDIDO */}
      {pestana === 'historial' && (
        <div>
          <h3>🚨 Partidos Suspendidos (Requieren Acción)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em', marginBottom: '30px' }}>
            <thead>
              <tr style={{ background: '#FED7D7', color: '#C53030' }}>
                <th style={{ padding: '8px' }}>Fecha Original</th>
                <th style={{ padding: '8px' }}>Torneo</th>
                <th style={{ padding: '8px' }}>Encuentro</th>
                <th style={{ padding: '8px' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {partidos.filter(p => p.estado === 'Suspendido').length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '15px', color: '#666' }}>No hay partidos suspendidos en este momento.</td></tr>
              ) : partidos.filter(p => p.estado === 'Suspendido').map(p => (
                <tr key={p.id}>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{new Date(p.fecha_hora).toLocaleString('es-VE')}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{p.torneo_nombre}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{p.local_nombre || 'Por definir'} vs {p.visita_nombre || 'Por definir'}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>
                    <button onClick={() => setModalReagendar({ visible: true, partido: p, nuevaFecha: p.fecha_hora.slice(0, 16) })} style={{ background: '#3182CE', color: '#FFF', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>📅 Reagendar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>📜 Historial de Partidos Finalizados</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                <th style={{ padding: '8px' }}>Fecha</th>
                <th style={{ padding: '8px' }}>Torneo</th>
                <th style={{ padding: '8px' }}>Encuentro</th>
                <th style={{ padding: '8px' }}>Marcador</th>
                <th style={{ padding: '8px' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {partidos.filter(p => p.estado === 'Finalizado').map(p => (
                <tr key={p.id}>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{new Date(p.fecha_hora).toLocaleString('es-VE')}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{p.torneo_nombre}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{p.local_nombre} vs {p.visita_nombre}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>{p.marcador_local !== null ? `${p.marcador_local} - ${p.marcador_visita}` : 'Pendiente'}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px', display: 'flex', gap: '5px' }}>
                    <button onClick={() => resetearPasswordOperativo(u.id, u.cedula, u.nombre)} style={{ background: '#3182CE', color: 'white', border: 'none', padding: '4px' }}>Reset</button>
                    <button onClick={() => removerCredencial(u.id, u.nombre)} style={{ background: '#E53E3E', color: 'white', border: 'none', padding: '4px' }}>Remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}