import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import SistemaMensajeria from './SistemaMensajeria';
import PlanillaUniversal from './PlanillaUniversal';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TableTools, EMPTY_FILTER, rowMatchesFilter, EncabezadoTabla, usePaginacion, PaginacionTabla, BotonAccionTabla } from './HerramientasTabla';
import CalendarioPartidos from '../CalendarioPartidos';
import VotacionMvp from '../VotacionMvp';
import Premiacion from '../Premiacion';
import ProtestasDelegado from '../ProtestasDelegado';
import Sidebar from '../Sidebar'; // UX: barra lateral compartida (colapso, grupos, notificaciones)
import TourGuia, { tourPendiente, marcarTourVisto } from '../TourGuia';
import HeaderPanel from '../HeaderPanel'; // FASE 2 UX: encabezado compartido de los paneles
import NavIcon from '../NavIcon'; // FASE 2 UX: catalogo unico de iconos de navegacion
import { useToasts, ToastContainer } from '../Toast'; // FASE 1 UX: notificaciones toast de marca
import { SkeletonTabla, SkeletonTarjetas } from '../SkeletonCarga'; // FASE 2 UX: esqueletos de carga de marca
import EmptyState from '../EmptyState'; // FASE 3C: estado vacio de marca en todas las vistas
import TarjetasMovil from '../TarjetasMovil'; // FASE A2 UX: tarjetas apiladas en pantallas chicas
import { formatearFecha, formatearFechaHora, formatearHoraDeFecha, fechaHoy } from '../fechas'; // LOTE FECHAS: fechas en dd/mm/aaaa y horas 12h de Venezuela

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function DelegadoDashboard({ usuario, cerrarSesion }) {
  // Mantener la pestaña activa mediante localStorage
  const [pestana, setPestana] = useState(() => {
    return localStorage.getItem('delegado_pestana') || 'equipo';
  });
  
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [tourActivo, setTourActivo] = useState(() => tourPendiente('delegado'));
  const cerrarTour = () => {
    marcarTourVisto('delegado');
    setTourActivo(false);
  };

  // FASE 1 UX: notificaciones toast en vez de alert nativo
  const { toasts, mostrarToast, cerrarToast } = useToasts();
  const [mensaje, setMensaje] = useState('');
  
  // Estado para la animación de la bola criolla en el menú lateral
  const [animandoBoton, setAnimandoBoton] = useState(null);

  const cambiarPestanaConAnimacion = (nuevaPestana) => {
    if (nuevaPestana === pestana || animandoBoton) return;
    setAnimandoBoton(nuevaPestana);
    setTimeout(() => {
      setPestana(nuevaPestana);
      setMenuAbierto(false);
      setAnimandoBoton(null);
    }, 700);
  };
  
// Seguridad y Sesión
  const [debeCambiarPass, setDebeCambiarPass] = useState(false);
  const [nuevaClave, setNuevaClave] = useState('');
  const [isSubmittingPass, setIsSubmittingPass] = useState(false);

  // FASE 3C
  const [cargando, setCargando] = useState(false);
  const [cargandoPlanilla, setCargandoPlanilla] = useState(false);
  const [exportandoPlanilla, setExportandoPlanilla] = useState(false);

  const [token, setToken] = useState(null);
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

  // Filtrado, busqueda y descargas de las tablas del modulo
  const [filtrosTablas, setFiltrosTablas] = useState({});

  // Datos del Delegado
  const [miEquipo, setMiEquipo] = useState(null);
  const [jugadores, setJugadores] = useState([]);
  const [partidos, setPartidos] = useState([]);
  const [documentosLiga, setDocumentosLiga] = useState([]);
  const [pagosEquipo, setPagosEquipo] = useState([]);
  const [estadisticas, setEstadisticas] = useState({
    individual: [],
    grupal: null
  });

  // Estados para Planilla del Partido Seleccionado
  const [partidoPlanillaId, setPartidoPlanillaId] = useState(() => {
    return localStorage.getItem('delegado_partido_planilla_id') || null;
  });
  const [datosPlanillaPartido, setDatosPlanillaPartido] = useState(null);
  const [jugadoresLocalPlanilla, setJugadoresLocalPlanilla] = useState([]);
  const [jugadoresVisitaPlanilla, setJugadoresVisitaPlanilla] = useState([]);
  const [efectividadPlanilla, setEfectividadPlanilla] = useState({});
  const [manualStatsPlanilla, setManualStatsPlanilla] = useState({});
  const [puntosLocalPlanilla, setPuntosLocalPlanilla] = useState(Array(20).fill(''));
  const [puntosVisitaPlanilla, setPuntosVisitaPlanilla] = useState(Array(20).fill(''));

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token);
      if (session?.user?.user_metadata?.debe_cambiar_password) {
        setDebeCambiarPass(true);
      }
    });
  }, []);

  // Guardar pestaña en localStorage y cargar datos
  useEffect(() => {
    localStorage.setItem('delegado_pestana', pestana);
    if (pestana !== 'calendario') {
      cerrarPlanilla();
    }
    if (token) cargarDatos();
  }, [pestana, token]);

  // Si hay un partido guardado en planilla al recargar
  useEffect(() => {
    if (token && partidoPlanillaId && pestana === 'calendario') {
      cargarPlanillaPartido(partidoPlanillaId);
    }
  }, [token, partidoPlanillaId]);

  const fetchConToken = async (endpoint, options = {}) => {
    try {
      const res = await fetch(`${API_URL}/delegado${endpoint}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...options.headers }
      });
      if (res.status === 401) setMensaje('Tu sesión ha expirado.');
      return res;
    } catch (err) {
      return { ok: false, json: async () => ({ error: 'Error de red.' }) };
    }
  };

  const cargarDatos = async () => {
    setMensaje('');
    setCargando(true);
    try {
      if (pestana === 'equipo' || pestana === 'estadisticas') {
        const resEq = await fetchConToken('/mi-equipo');
        if (resEq.ok) {
          const data = await resEq.json();
          setMiEquipo(data.equipo);
          setJugadores(data.jugadores || []);
          if (data.estadisticas) setEstadisticas(data.estadisticas);
        }
        if (pestana === 'equipo') {
          const resPart = await fetchConToken('/mis-partidos');
          if (resPart.ok) setPartidos(await resPart.json());
        }
      } 
      else if (pestana === 'calendario') {
        const resPart = await fetchConToken('/mis-partidos');
        if (resPart.ok) setPartidos(await resPart.json());
      } else if (pestana === 'documentos') {
        const resDoc = await fetchConToken('/documentos');
        if (resDoc.ok) {
          const dataDoc = await resDoc.json();
          setDocumentosLiga(dataDoc.documentos || []);
        }
      } else if (pestana === 'pagos') {
        const resPagos = await fetchConToken('/pagos');
        if (resPagos.ok) {
          const dataPagos = await resPagos.json();
          setPagosEquipo(dataPagos.pagos || []);
        }
      }
    } catch (e) {
      setMensaje('Error conectando con el servidor.');
    } finally { setCargando(false); }
  };

  const cargarPlanillaPartido = async (partidoId) => { if (cargandoPlanilla) return; setCargandoPlanilla(true); try { await cargarPlanillaPartidoBase(partidoId); } finally { setCargandoPlanilla(false); } };
const cargarPlanillaPartidoBase = async (partidoId) => {
    setMensaje('');
    const res = await fetchConToken(`/partidos/${partidoId}/planilla`);
    if (res.ok) {
      const data = await res.json();
      setDatosPlanillaPartido(data.partido);
      setJugadoresLocalPlanilla(data.nomina.filter(j => j.equipo_id === data.partido.equipo_local_id));
      setJugadoresVisitaPlanilla(data.nomina.filter(j => j.equipo_id === data.partido.equipo_visita_id));
      setEfectividadPlanilla(data.efectividadJugadores || {});
      setManualStatsPlanilla(data.manualStats || {});
      setPuntosLocalPlanilla(data.puntosPorManoLocal || Array(20).fill(''));
      setPuntosVisitaPlanilla(data.puntosPorManoVisita || Array(20).fill(''));
      setPartidoPlanillaId(partidoId);
      localStorage.setItem('delegado_partido_planilla_id', partidoId);
    } else {
      const errData = await res.json();
      setMensaje(errData.error || 'Error al cargar la planilla del partido.');
      cerrarPlanilla();
    }
  };

  const cerrarPlanilla = () => {
    setPartidoPlanillaId(null);
    localStorage.removeItem('delegado_partido_planilla_id');
    setDatosPlanillaPartido(null);
  };

  // FASE 3C UX: abre la planilla del encuentro destacado en el bloque Hoy
  const abrirPartidoHoy = async (partidoId) => {
    await cargarPlanillaPartido(partidoId);
    setPestana('calendario');
  };

  const cambiarClaveObligatoria = async (e) => {
    e.preventDefault();
    
    if (isSubmittingPass) return;
    const claveSaneada = nuevaClave.trim();
    
    if (claveSaneada.length < 6) {
      return mostrarToast('La contraseña no puede contener puros espacios en blanco y debe tener al menos 6 caracteres válidos.', 'error');
    }
    
    setIsSubmittingPass(true);

    const res = await fetch(`${API_URL}/delegado/cambiar-password-propio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ nueva_password: claveSaneada })
    });
    
    setIsSubmittingPass(false); // Liberar bloqueo
    
    if (res.ok) {
      mostrarToast('Contraseña actualizada correctamente.', 'exito');
      setDebeCambiarPass(false);
    } else {
      const data = await res.json();
      mostrarToast(data.error || 'Error al cambiar contraseña', 'error');
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

  const exportarScouting = (formato) => {
    if (!miEquipo || !estadisticas) return mostrarToast('Datos no disponibles.', 'error');
    if (!estadisticas.individual || estadisticas.individual.length === 0) return mostrarToast('No hay datos de jugadores registrados para generar el reporte de scouting.', 'error');
    
    const nombreArchivo = `Scouting_${miEquipo.nombre.replace(/\s+/g, '_')}`;
    const grupal = estadisticas.grupal || {};

    if (formato === 'json') {
      const blob = new Blob([JSON.stringify({ equipo: miEquipo, estadisticas }, null, 2)], { type: 'application/json' });
      descargarBlob(blob, `${nombreArchivo}.json`);
    } else if (formato === 'csv') {
      let csv = `Métricas de Rendimiento Grupal\nMetrica,Valor\n`;
      csv += `Prom. Pts/Bolo,${grupal.promedio_puntos_bolo || '0.0'}\n`;
      csv += `Diferencial Pts,${grupal.diferencial_puntos || 0}\n`;
      csv += `Retencion Punto (%),${grupal.porcentaje_retencion || 0}\n`;
      csv += `Tiempo Prom/Bolo (min),${grupal.tiempo_promedio_bolo || 0}\n`;
      csv += `Desviacion Estandar,${grupal.desviacion_estandar || '0.0'}\n\n`;

      csv += `Scouting de Jugadores\nDorsal,Jugador,Efectividad Arrime,Efectividad Boche,Tasa de Error,Pts/Juego,Clutch %,Perfil Tactico\n`;
      estadisticas.individual.forEach(j => {
        csv += `${j.dorsal},"${j.apellido} ${j.nombre}","${j.efectividad_arrime || 0}%","${j.efectividad_boche || 0}%","${j.tasa_error || 0}%",${j.pts_promedio || '0.0'},"${j.clutch || 0}%","${j.perfil_tactico || 'Equilibrado'}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      descargarBlob(blob, `${nombreArchivo}.csv`);
    } else if (formato === 'excel') {
      let html = `<h3>Métricas de Rendimiento Grupal</h3><table border="1"><tr><th>Métrica</th><th>Valor</th></tr>`;
      html += `<tr><td>Prom. Pts/Bolo</td><td>${grupal.promedio_puntos_bolo || '0.0'}</td></tr>`;
      html += `<tr><td>Diferencial Pts</td><td>${grupal.diferencial_puntos || 0}</td></tr>`;
      html += `<tr><td>Retención Punto (%)</td><td>${grupal.porcentaje_retencion || 0}%</td></tr>`;
      html += `<tr><td>Tiempo Prom/Bolo</td><td>${grupal.tiempo_promedio_bolo || 0} min</td></tr>`;
      html += `<tr><td>Desviación Estándar</td><td>±${grupal.desviacion_estandar || '0.0'}</td></tr></table><br/>`;

      html += `<h3>Scouting de Jugadores</h3><table border="1"><tr><th>Dorsal</th><th>Jugador</th><th>Efectividad Arrime</th><th>Efectividad Boche</th><th>Tasa Error</th><th>Pts/Juego</th><th>Clutch %</th><th>Perfil Táctico</th></tr>`;
      estadisticas.individual.forEach(j => {
        html += `<tr><td>${j.dorsal}</td><td>${j.apellido} ${j.nombre}</td><td>${j.efectividad_arrime || 0}%</td><td>${j.efectividad_boche || 0}%</td><td>${j.tasa_error || 0}%</td><td>${j.pts_promedio || '0.0'}</td><td>${j.clutch || 0}%</td><td>${j.perfil_tactico || 'Equilibrado'}</td></tr>`;
      });
      html += `</table>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
      descargarBlob(blob, `${nombreArchivo}.xls`);
    }
  };

  const exportarPlanilla = async (partidoId, formato) => { if (exportandoPlanilla) return; setExportandoPlanilla(true); try { await exportarPlanillaBase(partidoId, formato); } finally { setExportandoPlanilla(false); } };
const exportarPlanillaBase = async (partidoId, formato) => {
    try {
      setMensaje(`Generando archivo ${formato.toUpperCase()} de la planilla...`);
      
      if (formato === 'pdf') {
        window.open(`/?vista=puntajes&partido_id=${partidoId}`, '_blank');
        setMensaje('');
        return;
      }

      const res = await fetchConToken(`/partidos/${partidoId}/planilla`);
      if (!res.ok) throw new Error('Error al obtener datos');
      
      const data = await res.json();
      const partidoData = data.partido;
      const nominaData = data.nomina;

      const nombreArchivo = `Planilla_${partidoData.local_nombre}_vs_${partidoData.visita_nombre}`.replace(/\s+/g, '_');

      if (formato === 'json') {
        const blob = new Blob([JSON.stringify({ partido: partidoData, nomina: nominaData }, null, 2)], { type: 'application/json' });
        descargarBlob(blob, `${nombreArchivo}.json`);
      } else if (formato === 'csv') {
        let csv = `Encuentro,${partidoData.local_nombre} vs ${partidoData.visita_nombre}\nFecha,${formatearFechaHora(partidoData.fecha_hora)}\n\nCedula,Nombre,Apellido,Dorsal,Equipo\n`;
        nominaData.forEach(j => {
          csv += `${j.cedula},"${j.nombre}","${j.apellido}",${j.numero_dorsal},"${j.equipo_nombre}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        descargarBlob(blob, `${nombreArchivo}.csv`);
      } else if (formato === 'excel') {
        let html = `<table border="1"><tr><th>Encuentro</th><th>${partidoData.local_nombre} vs ${partidoData.visita_nombre}</th></tr>`;
        html += `<tr><th>Fecha</th><th>${formatearFechaHora(partidoData.fecha_hora)}</th></tr></table><br/>`;
        html += `<table border="1"><tr><th>Cédula</th><th>Nombre</th><th>Apellido</th><th>Dorsal</th><th>Equipo</th></tr>`;
        nominaData.forEach(j => {
          html += `<tr><td>${j.cedula}</td><td>${j.nombre}</td><td>${j.apellido}</td><td>${j.numero_dorsal}</td><td>${j.equipo_nombre}</td></tr>`;
        });
        html += `</table>`;
        const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
        descargarBlob(blob, `${nombreArchivo}.xls`);
      }
      setMensaje('');
    } catch (e) {
      setMensaje('Error al exportar la planilla.');
    }
  };

  // Filtrado, busqueda y descargas de las tablas del modulo
  const getFilter = key => filtrosTablas[key] || EMPTY_FILTER;
  const setTableFilter = key => next => setFiltrosTablas(previous => ({ ...previous, [key]: next }));
  const filtrarTabla = (key, rows, categoryFields = [], dateFields = []) => rows.filter(row => rowMatchesFilter(row, getFilter(key), categoryFields, dateFields));
  const filasNomina = filtrarTabla('nomina', jugadores, ['estado', 'posicion']);
  const filasPartidos = filtrarTabla('calendario', partidos, ['estado', 'fase'], ['fecha_hora']);
  const filasScouting = filtrarTabla('scouting', estadisticas.individual || [], ['perfil_tactico']);
  const filasPagosEquipo = filtrarTabla('pagos', pagosEquipo, ['metodo', 'moneda'], []);
  const sedesDelegado = Object.fromEntries(filasPartidos.filter(p => p.sede_nombre).map(p => [p.id, p.sede_nombre]));

  // FASE 3C UX: bloque Hoy del panel. Destaca el encuentro en juego o el proximo
  // partido del equipo; en movil es lo primero que el delegado necesita ver.
  const hoyFechaDelegado = fechaHoy();
  const partidosDeHoy = partidos.filter(p => formatearFecha(p.fecha_hora) === hoyFechaDelegado && p.estado !== 'Finalizado' && p.estado !== 'Suspendido');
  const partidoEnVivo = partidosDeHoy.find(p => p.estado === 'En Curso') || null;
  const partidoDeHoy = partidoEnVivo || partidosDeHoy[0] || null;
  const proximoPartido = !partidoDeHoy ? partidos.filter(p => p.estado !== 'Finalizado' && p.estado !== 'Suspendido' && new Date(p.fecha_hora) > new Date()).sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))[0] || null : null;

  // FASE 2 UX: paginacion compartida de nomina, scouting y pagos del equipo
  const pagNomina = usePaginacion(filasNomina);
  const pagScouting = usePaginacion(filasScouting);
  const pagPagosEquipo = usePaginacion(filasPagosEquipo);

  // LOTE 3B: formato legible del tamaño de los documentos de la liga
  const formatearTamanoDoc = (bytes) => {
    const valor = parseInt(bytes, 10);
    if (!valor || valor <= 0) return 'N/D';
    if (valor < 1024) return valor + ' B';
    if (valor < 1024 * 1024) return (valor / 1024).toFixed(1) + ' KB';
    return (valor / (1024 * 1024)).toFixed(2) + ' MB';
  };

  // Íconos SVG para la barra lateral
  // FASE 2 UX: los iconos viven en el catalogo compartido; cada pestana mapea a un nombre
  const ICONOS_PESTANA = { equipo: 'usuarios', calendario: 'calendario', estadisticas: 'estadisticas', documentos: 'documentos', pagos: 'pagos', votacion: 'votacion', protestas: 'protesta', premiacion: 'trofeo' };

  return (
    <div className="flex h-screen w-full bg-brand-cream font-sans overflow-hidden">
      
      <SistemaMensajeria usuario={usuario} token={token} />
      <ToastContainer toasts={toasts} onCerrar={cerrarToast} />
            <TourGuia rol="delegado" activo={tourActivo} onCerrar={cerrarTour} seccionInicio="equipo" onIrASeccion={(id) => { setPestana(id); setMenuAbierto(false); }} />

      {/* MODAL DE CAMBIO DE CONTRASEÑA */}
      {debeCambiarPass && (
        <div className="fixed inset-0 bg-black/90 flex justify-center items-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Actualización Obligatoria">
          <div className="bg-white p-8 rounded-xl w-full max-w-sm shadow-2xl">
            <h3 className="text-xl font-bold text-brand-brown mb-4 flex items-center gap-2">
              <svg className="w-6 h-6 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7z" /></svg>
              Actualización Obligatoria
            </h3>
            <p className="text-sm text-brand-brown/70 mb-4">Por razones de seguridad, debes actualizar tu contraseña temporal antes de gestionar tu equipo.</p>
            <form onSubmit={cambiarClaveObligatoria} className="space-y-4">
              <input type="password" autoFocus placeholder="Nueva Contraseña (mín 6 chars)" className="w-full p-3 border border-brand-gold/30 rounded focus:ring-brand-rust focus:border-brand-rust" value={nuevaClave} onChange={e => setNuevaClave(e.target.value)} required minLength={6} />
              
              {/* MODIFICACIÓN: Botón con estado deshabilitado */}
              <button type="submit" disabled={isSubmittingPass} className={`w-full py-3 rounded text-white font-bold transition-colors ${isSubmittingPass ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-rust hover:bg-brand-brown'}`}>
                {isSubmittingPass ? 'Actualizando...' : 'Actualizar Contraseña'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* UX: barra lateral compartida (se colapsa en escritorio, menu deslizante en movil) */}
      <Sidebar
        logoUrl={miEquipo?.logo_url || null}
        titulo={miEquipo ? miEquipo.nombre : 'Cargando...'}
        subtitulo="Panel Delegado"
        onCerrarSesion={cerrarSesion}

        grupos={[
          { etiqueta: 'Mi Equipo', items: [
            { id: 'equipo', label: 'Mi Equipo' },
            { id: 'estadisticas', label: 'Analítica y Scouting' },
            { id: 'pagos', label: 'Pagos del Equipo' },
          ]},
          { etiqueta: 'Competencia', items: [
            { id: 'calendario', label: 'Calendario y Puntajes' },
            { id: 'votacion', label: 'Votación MVP' },
            { id: 'protestas', label: 'Protestas' },
          ]},
          { etiqueta: 'Liga', items: [
            { id: 'documentos', label: 'Documentos de la Liga' },
            { id: 'premiacion', label: 'Premiación de la Liga' },
          ]},
        ]}
        pestana={pestana}
        onPestana={cambiarPestanaConAnimacion}
        animandoBoton={animandoBoton}
        renderIcono={(id) => <NavIcon nombre={ICONOS_PESTANA[id]} />}
        menuAbierto={menuAbierto}
        onCerrarMenu={() => setMenuAbierto(false)}
        claveColapso="delegadoSidebarColapsada"
        onVerGuia={() => setTourActivo(true)}
      />

      {/* ÁREA DE CONTENIDO PRINCIPAL */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-brand-cream relative">
        
        {/* HEADER SUPERIOR */}
        <HeaderPanel
          titulo={pestana === 'equipo' ? 'Mi Equipo' : pestana === 'calendario' ? 'Calendario y Puntajes' : pestana === 'documentos' ? 'Documentos de la Liga' : pestana === 'pagos' ? 'Pagos del Equipo' : pestana === 'votacion' ? 'Votación MVP' : pestana === 'protestas' ? 'Protestas' : pestana === 'premiacion' ? 'Premiación de la Liga' : 'Analítica y Scouting'}
          onAbrirMenu={() => setMenuAbierto(true)}
          acciones={miEquipo ? <span className="hidden sm:block text-sm font-semibold text-brand-brown/70">{miEquipo.categoria} - {miEquipo.tipo_genero}</span> : null}
        />

        {/* CONTENEDOR DESLIZABLE (SCROLL) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">

          {mensaje && (
            <div className="mb-6 bg-green-50 border-l-4 border-green-500 p-4 rounded shadow-sm flex items-center gap-3 animate-fade-in">
              <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
              <p className="text-sm font-medium text-green-800">{mensaje}</p>
            </div>
          )}

          {/* VISTA 1: MI EQUIPO */}
          {pestana === 'equipo' && (
            <div className="space-y-6 animate-fade-in">
              {/* FASE 3C UX: bloque Hoy - el encuentro del dia siempre visible al abrir el panel */}
              {cargando && partidos.length === 0 ? (
                <SkeletonTarjetas cantidad={1} clasesGrid="grid-cols-1" />
              ) : partidoDeHoy ? (
                <div className={`p-5 rounded-xl shadow-sm border ${partidoEnVivo ? 'bg-brand-brown text-white border-brand-gold/40' : 'bg-white border-brand-gold/20'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-full ${partidoEnVivo ? 'bg-brand-gold text-brand-brown' : 'bg-brand-blue/10 text-brand-blue'}`}>
                      {partidoEnVivo ? 'En juego ahora' : 'Tu equipo juega hoy'}
                    </span>
                    <span className={`text-xs font-semibold ${partidoEnVivo ? 'text-brand-cream/70' : 'text-brand-brown/60'}`}>
                      {partidoDeHoy.fase} - {partidoDeHoy.estado}
                    </span>
                  </div>
                  <h4 className="text-xl font-black mb-2">{partidoDeHoy.local_nombre} <span className="text-brand-rust font-normal mx-1 text-sm">vs</span> {partidoDeHoy.visita_nombre}</h4>
                  <div className={`flex flex-wrap items-center gap-4 text-sm font-medium ${partidoEnVivo ? 'text-brand-cream/80' : 'text-brand-brown/70'}`}>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {formatearHoraDeFecha(partidoDeHoy.fecha_hora)}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      {partidoDeHoy.sede_nombre}
                    </span>
                  </div>
                  <button onClick={() => abrirPartidoHoy(partidoDeHoy.id)} className="mt-4 w-full sm:w-auto px-4 py-2.5 bg-brand-gold text-brand-brown rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm">
                    {partidoEnVivo ? 'Ver Marcador en Vivo' : 'Abrir Planilla del Encuentro'}
                  </button>
                </div>
              ) : proximoPartido ? (
                <div className="bg-white p-5 rounded-xl shadow-sm border border-brand-gold/20">
                  <span className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-brand-gold/20 text-brand-brown">Próximo encuentro</span>
                  <h4 className="text-lg font-black text-brand-brown mt-3 mb-2">{proximoPartido.local_nombre} <span className="text-brand-rust font-normal mx-1 text-sm">vs</span> {proximoPartido.visita_nombre}</h4>
                  <p className="text-sm text-brand-brown/70 font-medium flex items-center gap-1">
                    <svg className="w-4 h-4 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    {formatearFechaHora(proximoPartido.fecha_hora)}
                  </p>
                  <p className="text-sm text-brand-brown/70 font-medium flex items-center gap-1 mt-1">
                    <svg className="w-4 h-4 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    {proximoPartido.sede_nombre}
                  </p>
                </div>
              ) : (
                <EmptyState icono="calendario" titulo="Sin encuentros agendados" descripcion="Cuando la liga agende el próximo partido de tu equipo lo verás aquí." />
              )}

              <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                <h3 className="text-lg font-bold text-brand-brown mb-4 flex items-center gap-2">
                  <NavIcon nombre="usuarios" />
                  Nómina Oficial del Equipo
                </h3>
                <TableTools rows={jugadores} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={filasNomina} filter={getFilter('nomina')} setFilter={setTableFilter('nomina')} columns={[{ key: 'numero_dorsal', label: 'Dorsal' }, { key: 'nombre', label: 'Nombre' }, { key: 'apellido', label: 'Apellido' }, { key: 'cedula', label: 'Cédula' }, { key: 'posicion', label: 'Rol' }, { key: 'estado', label: 'Estado' }]} categoryFields={['estado', 'posicion']} filename="nomina_filtrada_delegado" modulo="Delegado de equipo" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                <div className="md:hidden">
                  {cargando && filasNomina.length === 0 ? (
                    <SkeletonTarjetas cantidad={6} />
                  ) : filasNomina.length === 0 ? (
                    <EmptyState icono="usuarios" titulo="Sin jugadores para mostrar" descripcion={jugadores.length === 0 ? 'Aún no hay jugadores inscritos en el equipo.' : 'Ningún jugador coincide con los filtros aplicados.'} />
                  ) : (
                    <TarjetasMovil
                      filas={pagNomina.filasPagina}
                      clave="id"
                      campos={[
                        { etiqueta: 'Dorsal', valor: (j) => '#' + (j.numero_dorsal || 'Sin dorsal') },
                        { etiqueta: 'Jugador', valor: (j) => j.nombre + ' ' + j.apellido + (j.es_capitan ? ' (Capitán)' : '') },
                        { etiqueta: 'Estado', valor: (j) => j.estado }
                      ]}
                      detalle={[
                        { etiqueta: 'Cédula', valor: (j) => j.cedula },
                        { etiqueta: 'Rol', valor: (j) => j.posicion || 'Atleta' }
                      ]}
                    />
                  )}
                </div>
                <div className="hidden md:block overflow-x-auto">
                  <table className="tabla-admin">
                    <thead>
                      <tr>
                        <th scope="col" className="text-center">Dorsal</th>
                        <th scope="col" className="text-center">Foto</th>
                        <th scope="col">Jugador</th>
                        <th scope="col">Cédula</th>
                        <th scope="col">Rol</th>
                        <th scope="col" className="text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargando && filasNomina.length === 0 ? (
                        <tr><td colSpan={6} className="p-0 border-0"><SkeletonTabla filas={6} columnas={6} /></td></tr>
                      ) : filasNomina.length === 0 ? (
                        <tr><td colSpan={6} className="p-0 border-0"><EmptyState icono="usuarios" titulo="Sin jugadores para mostrar" descripcion={jugadores.length === 0 ? 'Aún no hay jugadores inscritos en el equipo.' : 'Ningún jugador coincide con los filtros aplicados.'} /></td></tr>
                      ) : (
                        pagNomina.filasPagina.map(j => (
                          <tr key={j.id} className={j.estado === 'Inactivo' ? 'bg-gray-50 opacity-60' : ''}>
                            <td className="text-center font-bold text-lg text-brand-brown">#{j.numero_dorsal}</td>
                            <td className="text-center">
                              {j.foto_url ? (
                                <img src={j.foto_url} alt={`Foto de ${j.nombre} ${j.apellido}`} className="w-10 h-10 rounded-full object-cover border border-brand-gold mx-auto" />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-brand-cream/50 flex items-center justify-center mx-auto text-brand-brown"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg></div>
                              )}
                            </td>
                            <td className="font-semibold text-brand-brown">
                              {j.nombre} {j.apellido}
                              {j.es_capitan && <svg className="w-4 h-4 text-brand-gold inline ml-2" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>}
                            </td>
                            <td className="text-brand-brown/80">{j.cedula}</td>
                            <td className="text-brand-brown/80">{j.posicion || 'Atleta'}</td>
                            <td className="text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-bold ${j.estado === 'Activo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700 border border-red-300'}`}>
                                {j.estado}
                              </span>
                              
                              {j.estado === 'Inactivo' && (
                                <div className="text-[10px] text-red-600 mt-1 font-bold uppercase tracking-tight bg-red-50 py-0.5 rounded">
                                  Inhabilitado
                                </div>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginacionTabla {...pagNomina} />
              </div>
            </div>
          )}

          {/* VISTA 2: CALENDARIO Y PLANILLAS DE PUNTAJES */}
          {pestana === 'calendario' && (
            <div className="animate-fade-in">
              {partidoPlanillaId && datosPlanillaPartido ? (
                <div className="space-y-4">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-brand-gold/20">
                    <button onClick={cerrarPlanilla} className="flex items-center gap-2 bg-brand-cream text-brand-brown px-4 py-2 rounded-lg font-bold hover:bg-brand-gold/20 transition-colors">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                      Volver al Calendario
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-brand-brown mr-2">Descargar Planilla:</span>
                      <button onClick={() => exportarPlanilla(datosPlanillaPartido.id, 'pdf')} disabled={exportandoPlanilla} className="bg-white border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">PDF</button>
                      <button onClick={() => exportarPlanilla(datosPlanillaPartido.id, 'excel')} disabled={exportandoPlanilla} className="bg-white border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">Excel</button>
                      <button onClick={() => exportarPlanilla(datosPlanillaPartido.id, 'csv')} disabled={exportandoPlanilla} className="bg-white border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">CSV</button>
                      <button onClick={() => exportarPlanilla(datosPlanillaPartido.id, 'json')} disabled={exportandoPlanilla} className="bg-white border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">JSON</button>
                    </div>
                  </div>
                  <PlanillaUniversal
                    rol="espectador"
                    nombreLiga={orgLiga?.nombre || ''}
                    logoLiga={orgLiga?.logo_url || null}
                    estadoPartido={datosPlanillaPartido.estado}
                    partidoId={datosPlanillaPartido.id}
                    datosPartido={{
                      arbitro: datosPlanillaPartido.arbitro_nombre,
                      anotador: datosPlanillaPartido.anotador_nombre,
                      capitanLocal: datosPlanillaPartido.capitan_local_nombre,
                      capitanVisita: datosPlanillaPartido.capitan_visita_nombre,
                      localNombre: datosPlanillaPartido.local_nombre,
                      visitaNombre: datosPlanillaPartido.visita_nombre,
                      horaInicio: datosPlanillaPartido.hora_inicio,
                      horaFinal: datosPlanillaPartido.hora_final,
                      fecha: datosPlanillaPartido.fecha_hora ? formatearFecha(datosPlanillaPartido.fecha_hora) : ''
                    }}
                    jugadoresLocal={jugadoresLocalPlanilla}
                    jugadoresVisita={jugadoresVisitaPlanilla}
                    efectividadJugadores={efectividadPlanilla}
                    manualStats={manualStatsPlanilla}
                    puntosPorManoLocal={puntosLocalPlanilla}
                    puntosPorManoVisita={puntosVisitaPlanilla}
                  />
                </div>
              ) : (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                  <h3 className="text-lg font-bold text-brand-brown mb-4 flex items-center gap-2">
                    <NavIcon nombre="calendario" />
                    Encuentros y Planillas de Puntajes
                  </h3>
                  <TableTools rows={partidos} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={filasPartidos} filter={getFilter('calendario')} setFilter={setTableFilter('calendario')} columns={[{ key: 'fecha_hora', label: 'Fecha' }, { key: 'fase', label: 'Fase' }, { key: 'local_nombre', label: 'Local' }, { key: 'visita_nombre', label: 'Visitante' }, { key: 'sede_nombre', label: 'Sede' }, { key: 'estado', label: 'Estado' }]} categoryFields={['estado', 'fase']} dateFields={['fecha_hora']} filename="calendario_filtrado_delegado" modulo="Delegado de equipo" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                  <div className="mb-4">
                    <CalendarioPartidos partidos={filasPartidos} sedesPorPartido={sedesDelegado} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {cargando && filasPartidos.length === 0 ? (
                      <div className="col-span-full"><SkeletonTarjetas cantidad={6} clasesGrid="grid-cols-1 md:grid-cols-2 lg:grid-cols-3" /></div>
                    ) : filasPartidos.length === 0 ? (
                      <div className="col-span-full"><EmptyState icono="calendario" titulo="Sin partidos para mostrar" descripcion={partidos.length === 0 ? 'Aún no hay encuentros agendados para tu equipo.' : 'Ningún partido coincide con los filtros aplicados.'} /></div>
                    ) : (
                      filasPartidos.map(p => (
                        <div key={p.id} className={`flex flex-col justify-between p-5 rounded-xl border ${p.estado === 'Finalizado' ? 'border-brand-rust bg-brand-rust/5 shadow-sm ring-1 ring-brand-rust' : 'border-brand-gold/30 bg-white hover:border-brand-blue hover:shadow-sm'} transition-all`}>
                          <div>
                            <div className="flex justify-between items-center mb-3">
                              <span className="text-xs font-bold text-brand-blue uppercase tracking-wider">{p.fase}</span>
                              <span className="text-xs font-semibold bg-brand-cream text-brand-brown px-2 py-1 rounded border border-brand-gold/20">{p.estado}</span>
                            </div>
                            <h4 className="font-bold text-brand-brown text-lg mb-1">{p.local_nombre} <span className="text-brand-rust font-normal mx-1">vs</span> {p.visita_nombre}</h4>
                            <p className="text-sm text-brand-brown/70 mb-1 flex items-center gap-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> {formatearFechaHora(p.fecha_hora)}</p>
                            <p className="text-sm text-brand-brown/70 mb-4 flex items-center gap-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg> {p.sede_nombre}</p>
                          </div>
                          
                          <div className="mt-auto space-y-2">
                            <button onClick={() => cargarPlanillaPartido(p.id)} disabled={cargandoPlanilla} className="w-full py-2 bg-brand-blue text-white rounded-lg font-bold hover:bg-brand-brown transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              {cargandoPlanilla ? 'Abriendo...' : 'Ver Planilla Detallada'}
                            </button>
                            <div className="flex gap-2">
                              <button onClick={() => exportarPlanilla(p.id, 'pdf')} disabled={exportandoPlanilla} className="flex-1 bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">PDF</button>
                              <button onClick={() => exportarPlanilla(p.id, 'excel')} disabled={exportandoPlanilla} className="flex-1 bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Excel</button>
                              <button onClick={() => exportarPlanilla(p.id, 'csv')} disabled={exportandoPlanilla} className="flex-1 bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">CSV</button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VISTA 3: ESTADÍSTICAS Y SCOUTING */}
          {pestana === 'estadisticas' && (
            <div className="space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h3 className="text-xl font-bold text-brand-brown flex items-center gap-2">
                  <NavIcon nombre="estadisticas" />
                  Centro de Scouting Avanzado
                </h3>
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm font-bold text-brand-brown self-center mr-2">Exportar Scouting:</span>
                  <button onClick={() => exportarScouting('excel')} className="bg-white border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm">Excel</button>
                  <button onClick={() => exportarScouting('csv')} className="bg-white border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm">CSV</button>
                  <button onClick={() => exportarScouting('json')} className="bg-white border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded-lg text-sm font-bold hover:bg-brand-rust hover:text-white transition-colors shadow-sm">JSON</button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-xl border border-brand-gold/20 shadow-sm text-center">
                  <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Prom. Puntos/Bolo</div>
                  <div className="text-4xl font-extrabold text-brand-blue">{estadisticas.grupal?.promedio_puntos_bolo || '0.0'}</div>
                </div>
                <div className="bg-white p-5 rounded-xl border border-brand-gold/20 shadow-sm text-center">
                  <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Diferencial Puntos</div>
                  <div className={`text-4xl font-extrabold ${(estadisticas.grupal?.diferencial_puntos > 0) ? 'text-green-600' : 'text-red-500'}`}>
                    {estadisticas.grupal?.diferencial_puntos > 0 ? '+' : ''}{estadisticas.grupal?.diferencial_puntos || 0}
                  </div>
                </div>
                <div className="bg-white p-5 rounded-xl border border-brand-gold/20 shadow-sm text-center">
                  <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Retención Punto (%)</div>
                  <div className="text-4xl font-extrabold text-brand-gold">{estadisticas.grupal?.porcentaje_retencion || 0}%</div>
                </div>
                <div className="bg-white p-5 rounded-xl border border-brand-gold/20 shadow-sm text-center">
                  <div className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Consistencia (Desv)</div>
                  <div className="text-4xl font-extrabold text-brand-brown">±{estadisticas.grupal?.desviacion_estandar || '0.0'}</div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-brand-gold/20 shadow-sm">
                <h3 className="text-lg font-bold text-brand-brown mb-4">Scouting de Jugadores (Perfiles Tácticos)</h3>
                <TableTools rows={estadisticas.individual || []} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={filasScouting} filter={getFilter('scouting')} setFilter={setTableFilter('scouting')} columns={[{ key: 'dorsal', label: 'Dorsal' }, { key: 'apellido', label: 'Apellido' }, { key: 'nombre', label: 'Nombre' }, { key: 'efectividad_arrime', label: '% Arrime' }, { key: 'efectividad_boche', label: '% Boche' }, { key: 'tasa_error', label: 'Tasa de error' }, { key: 'pts_promedio', label: 'Pts/Juego' }, { key: 'clutch', label: 'Clutch %' }, { key: 'perfil_tactico', label: 'Perfil sugerido' }]} categoryFields={['perfil_tactico']} filename="scouting_filtrado_delegado" modulo="Delegado de equipo" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                <div className="overflow-x-auto">
                  <table className="tabla-admin">
                    <thead>
                      <tr>
                        <th scope="col">Jugador</th>
                        <th scope="col" className="text-center">% Arrime<br/><span className="text-xs font-normal text-brand-cream/70">[AB, AL, K]</span></th>
                        <th scope="col" className="text-center">% Boche<br/><span className="text-xs font-normal text-brand-cream/70">[BB, BL, B]</span></th>
                        <th scope="col" className="text-center bg-brand-brown/80 text-white">Tasa Error<br/><span className="text-xs font-normal text-white/70">[O, X, N]</span></th>
                        <th scope="col" className="text-center">Pts/Juego</th>
                        <th scope="col" className="text-center bg-brand-rust text-white">Clutch %<br/><span className="text-xs font-normal text-white/70">Cierres</span></th>
                        <th scope="col" className="text-center">Perfil Sugerido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargando && filasScouting.length === 0 ? (
                        <tr><td colSpan={7} className="p-0 border-0"><SkeletonTabla filas={6} columnas={7} /></td></tr>
                      ) : filasScouting.length === 0 ? (
                        <tr><td colSpan={7} className="p-0 border-0"><EmptyState icono="estadisticas" titulo="Sin datos de scouting" descripcion={(estadisticas.individual || []).length === 0 ? 'Juega partidos para generar métricas de tus jugadores.' : 'Ningún jugador coincide con los filtros aplicados.'} /></td></tr>
                      ) : (
                        pagScouting.filasPagina.map((j, idx) => (
                          <tr key={idx}>
                            <td className="font-bold text-brand-brown">#{j.dorsal} {j.apellido}</td>
                            <td className="text-center font-bold text-brand-blue">{j.efectividad_arrime || 0}%</td>
                            <td className="text-center font-bold text-green-600">{j.efectividad_boche || 0}%</td>
                            <td className="text-center font-bold text-red-500">{j.tasa_error || 0}%</td>
                            <td className="text-center font-bold">{j.pts_promedio || '0.0'}</td>
                            <td className="text-center font-bold text-brand-rust">{j.clutch || 0}%</td>
                            <td className="text-center">
                              <span className="px-2 py-1 bg-brand-cream text-brand-brown rounded text-xs font-bold border border-brand-gold/30">
                                {j.perfil_tactico || 'Equilibrado'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginacionTabla {...pagScouting} />
              </div>
            </div>
          )}

          {/* VISTA 4: DOCUMENTOS DE LA LIGA (SOLO LECTURA) */}
          {pestana === 'documentos' && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                <h3 className="text-lg font-bold text-brand-brown mb-2 flex items-center gap-2">
                  <NavIcon nombre="documentos" />
                  Documentos de la Liga
                </h3>
                <p className="text-sm text-brand-brown/70 mb-4">Reglamentos, convocatorias, actas y comunicados publicados por la administración de la liga.</p>
                <div className="overflow-x-auto">
                  <table className="tabla-admin">
                    <thead>
                      <tr>
                        <th scope="col">Documento</th>
                        <th scope="col">Tipo</th>
                        <th scope="col">Torneo</th>
                        <th scope="col" className="text-center">Tamaño</th>
                        <th scope="col">Fecha</th>
                        <th scope="col" className="text-center w-28">Descarga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargando && documentosLiga.length === 0 ? (
                        <tr><td colSpan={6} className="p-0 border-0"><SkeletonTabla filas={4} columnas={6} /></td></tr>
                      ) : documentosLiga.length === 0 ? (
                        <tr><td colSpan={6} className="p-0 border-0"><EmptyState icono="documentos" titulo="Sin documentos publicados" descripcion="La liga aún no ha publicado documentos para tus equipos." /></td></tr>
                      ) : (
                        documentosLiga.map(d => (
                          <tr key={d.id}>
                            <td className="font-bold">{d.titulo}{d.es_global && <span className="ml-2 bg-brand-blue/10 text-brand-blue px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase border border-brand-blue/20">Global</span>}</td>
                            <td><span className="bg-brand-cream text-brand-brown px-2 py-1 rounded-full text-xs font-bold border border-brand-gold/30">{d.tipo}</span></td>
                            <td className="text-brand-brown/80">{d.torneo_nombre || 'General'}</td>
                            <td className="text-center text-brand-brown/80">{formatearTamanoDoc(d.tamano_bytes)}</td>
                            <td className="text-brand-brown/80">{d.creado_en ? d.creado_en.slice(0, 10).split('-').reverse().join('/') : ''}</td>
                            <td className="text-center">
                              <BotonAccionTabla titulo="Descargar" onClick={() => d.url_firmada && window.open(d.url_firmada, '_blank', 'noopener')} deshabilitado={!d.url_firmada}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg></BotonAccionTabla>
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

          {/* VISTA 5: PAGOS DEL EQUIPO (SOLO LECTURA, LOTE 3C) */}
          {pestana === 'pagos' && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                <h3 className="text-lg font-bold text-brand-brown mb-2 flex items-center gap-2">
                  <NavIcon nombre="pagos" />
                  Pagos de Inscripción del Equipo
                </h3>
                <p className="text-sm text-brand-brown/70 mb-4">Pagos de inscripción a torneos registrados por la administración de la liga para tu equipo y sus jugadores.</p>
                <TableTools rows={pagosEquipo} logoUrl={orgLiga?.logo_url || null} nombreLiga={orgLiga?.nombre || ''} filteredRows={filasPagosEquipo} filter={getFilter('pagos')} setFilter={setTableFilter('pagos')} columns={[{ key: 'torneo_nombre', label: 'Torneo' }, { key: 'equipo_nombre', label: 'Equipo' }, { key: 'jugador_nombre', label: 'Jugador' }, { key: 'monto', label: 'Monto' }, { key: 'metodo', label: 'Metodo' }]} categoryFields={['metodo']} filename="pagos_filtrados_delegado" modulo="Delegado de equipo" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                <div className="overflow-x-auto">
                  <table className="tabla-admin">
                    <thead>
                      <tr>
                        <th scope="col">Torneo</th>
                        <th scope="col">Inscrito</th>
                        <th scope="col" className="text-center">Monto</th>
                        <th scope="col">Método</th>
                        <th scope="col">Referencia</th>
                        <th scope="col">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargando && pagosEquipo.length === 0 ? (
                        <tr><td colSpan={6} className="p-0 border-0"><SkeletonTabla filas={4} columnas={6} /></td></tr>
                      ) : filasPagosEquipo.length === 0 ? (
                        <tr><td colSpan={6} className="p-0 border-0"><EmptyState icono="pagos" titulo="Sin pagos registrados" descripcion="Cuando la liga registre pagos de tu equipo aparecerán aquí." /></td></tr>
                      ) : (
                        pagPagosEquipo.filasPagina.map(p => (
                          <tr key={p.id}>
                            <td className="font-bold">{p.torneo_nombre || 'N/D'}</td>
                            <td className="text-brand-brown/80">{p.jugador_nombre ? p.jugador_nombre + ' (jugador)' : (p.equipo_nombre || '') + ' (equipo)'}</td>
                            <td className="text-center font-bold text-brand-blue">{Number(p.monto).toFixed(2)} {p.moneda}</td>
                            <td><span className="bg-brand-cream text-brand-brown px-2 py-1 rounded-full text-xs font-bold border border-brand-gold/30">{p.metodo}</span></td>
                            <td className="text-brand-brown/80">{p.referencia || '—'}</td>
                            <td className="text-brand-brown/80">{p.creado_en ? p.creado_en.slice(0, 10).split('-').reverse().join('/') : ''}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <PaginacionTabla {...pagPagosEquipo} />
              </div>
            </div>
          )}


          {/* VISTA 6: VOTACION MVP (LOTE 4C N3) */}
          {pestana === 'votacion' && (
            <div className="space-y-6 animate-fade-in">
              <VotacionMvp />
            </div>
          )}

          {/* VISTA 8: PREMIACION DE LA LIGA */}
          {pestana === 'premiacion' && (
            <div className="space-y-6 animate-fade-in">
              <Premiacion />
            </div>
          )}

          {/* VISTA 7: PROTESTAS (LOTE 4D P1) */}
          {pestana === 'protestas' && (
            <div className="space-y-6 animate-fade-in">
              <ProtestasDelegado fetchConToken={fetchConToken} />
            </div>
          )}

        </div>
      </main>
    </div>
  );
}