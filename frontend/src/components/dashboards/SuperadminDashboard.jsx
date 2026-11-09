import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import SistemaMensajeria from './SistemaMensajeria';
import ConfirmDialog from '../ConfirmDialog'; // FASE 1 UX: dialogo de confirmacion de marca
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TableTools, EMPTY_FILTER, rowMatchesFilter, EncabezadoTabla, usePaginacion, PaginacionTabla, BotonAccionTabla } from './HerramientasTabla';
import CalendarioPartidos from '../CalendarioPartidos';
import Sidebar from '../Sidebar'; // UX: barra lateral compartida (colapso, grupos, notificaciones)
import TourGuia, { tourPendiente, marcarTourVisto } from '../TourGuia';
import HeaderPanel from '../HeaderPanel'; // FASE 2 UX: encabezado compartido de los paneles
import NavIcon from '../NavIcon'; // FASE 2 UX: catalogo unico de iconos de navegacion
import { SkeletonTabla, SkeletonTarjetas } from '../SkeletonCarga'; // FASE 2 UX: esqueletos de carga de marca
import EmptyState from '../EmptyState'; // FASE 3C: estado vacio de marca en todas las vistas
import TarjetaResumen from '../TarjetaResumen'; // FASE B1 UX: tarjetas de resumen de la pestana Inicio
import { tecladoModal } from '../Accesibilidad';
import { formatearFecha, formatearFechaHora } from '../fechas'; // LOTE FECHAS: sello y bitacora en dd/mm/aaaa, 12 horas
import { MARCA_PDF, encabezadoMarca } from '../pdfMarca'; // LOTE PDF MARCA: encabezado de marca en los reportes PDF

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function SuperadminDashboard({ usuario, cerrarSesion }) {
  const [pestana, setPestana] = useState('inicio'); // FASE B1 UX: el panel abre siempre en la pestana Inicio
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [tourActivo, setTourActivo] = useState(() => tourPendiente('superadmin'));
  const cerrarTour = () => {
    marcarTourVisto('superadmin');
    setTourActivo(false);
  };

  // FASE 1 UX: confirmacion con dialogo de marca en vez del confirm nativo
  const [confirmacion, setConfirmacion] = useState(null);
  const pedirConfirmacion = (titulo, mensaje, tipo) =>
    new Promise((resolver) => setConfirmacion({ titulo, mensaje, tipo, resolver }));
  const [mensaje, setMensaje] = useState(null);

  const [metricas, setMetricas] = useState(null);
  const [ligas, setLigas] = useState([]);
  const [usuariosList, setUsuariosList] = useState([]);
  const [bitacora, setBitacora] = useState([]);

  const [filtroPeriodo, setFiltroPeriodo] = useState('todos');
  const [filtroLigaPartidos, setFiltroLigaPartidos] = useState('todas');

  const [vistaUsuarios, setVistaUsuarios] = useState('ligas'); 
  const [usuLigaSel, setUsuLigaSel] = useState(null);
  const [usuRolSel, setUsuRolSel] = useState(null);

  const [ligaDetalle, setLigaDetalle] = useState(null); 
  const [ligasEliminadas, setLigasEliminadas] = useState([]); // LOTE 8B: ligas con baja logica (restaurables)
  const [restaurandoLiga, setRestaurandoLiga] = useState(null); // LOTE 8B: id de la liga en restauracion 
  const [ligaEditando, setLigaEditando] = useState(null);
  const [userEditando, setUserEditando] = useState(null);
  const [itemEliminar, setItemEliminar] = useState(null); 
  const [claveConfirmacion, setClaveConfirmacion] = useState('');
  // LOTE 6G: cambio de correo y reenvio de verificacion desde el directorio
  const [modalCorreo, setModalCorreo] = useState(null);
  const [nuevoCorreoUsuario, setNuevoCorreoUsuario] = useState('');
  const [enviosEnCurso, setEnviosEnCurso] = useState([]); // LOTE 6J: ids con un envio de correo en curso (bloqueo por persona)
  const [segundosCorreo, setSegundosCorreo] = useState(0); // LOTE 6J: cronometro visible del envio de correo

  // LOTE 6J (revision a pedido de Keiko): el bloqueo es POR PERSONA, no global.
  // No se repite un envio hacia la misma persona mientras este en curso, pero
  // el superadmin puede seguir trabajando con otras personas.
  const envioEnCurso = (id) => enviosEnCurso.includes(id);
  const bloquearEnvio = (id) => setEnviosEnCurso((prev) => prev.includes(id) ? prev : [...prev, id]);
  const liberarEnvio = (id) => setEnviosEnCurso((prev) => prev.filter((x) => x !== id));

  useEffect(() => {
    if (enviosEnCurso.length === 0) { setSegundosCorreo(0); return; }
    const intervalo = setInterval(() => setSegundosCorreo((s) => s + 1), 1000);
    return () => clearInterval(intervalo);
  }, [enviosEnCurso.length]);

  const [equiposLiga, setEquiposLiga] = useState([]);
  
  const [formLiga, setFormLiga] = useState({ nombre: '', responsable_nombre: '', responsable_apellido: '', responsable_cedula: '', responsable_telefono: '', responsable_email: '' });
  const [formUser, setFormUser] = useState({ nombre: '', apellido: '', cedula: '', email: '', rol: 'administrador de liga', organizacion_id: '', equipo_id: '' });

  const [busquedaUsuario, setBusquedaUsuario] = useState('');
  const [busquedaBitacora, setBusquedaBitacora] = useState('');
  const [filtroRol, setFiltroRol] = useState('');
  const [filtroUsuarioId, setFiltroUsuarioId] = useState('');
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('');
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [token, setToken] = useState(null);

  const [partidosGlobales, setPartidosGlobales] = useState([]);

  // LOTE 3B+: repositorio global de documentos (compartidos con todas las ligas)
  const [documentosGlobales, setDocumentosGlobales] = useState([]);
  const [formDocGlobal, setFormDocGlobal] = useState({ titulo: '', tipo: 'Reglamento' });
  const [archivoDocGlobal, setArchivoDocGlobal] = useState(null);
  const [subiendoDocGlobal, setSubiendoDocGlobal] = useState(false);
  const [filtrosTablas, setFiltrosTablas] = useState({});

  // LOTE R: filtrado, busqueda y descargas compartidos para las tablas del Superadmin.
  const getFilter = key => filtrosTablas[key] || EMPTY_FILTER;
  const setTableFilter = key => next => setFiltrosTablas(previous => ({ ...previous, [key]: next }));
  const filtrarTabla = (key, rows, categoryFields = [], dateFields = []) => rows.filter(row => rowMatchesFilter(row, getFilter(key), categoryFields, dateFields));

  useEffect(() => {
    localStorage.setItem('superadminPestana', pestana);
  }, [pestana]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token);
    });
  }, []);

  const fetchConToken = async (endpoint, options = {}) => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        return { ok: false, status: 401, json: async () => ({ error: 'Sesión no válida' }) };
      }
      
      const response = await fetch(`${API_URL}/superadmin${endpoint}`, {
        ...options,
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${session.access_token}`, 
          ...options.headers 
        },
      });
      
      if (response.status === 401) setMensaje({ texto: 'Tu sesión ha expirado.', tipo: 'error' });
      return response;
    } catch (err) {
      return { ok: false, status: 500, json: async () => ({ error: 'Error de conexión.' }) };
    }
  };

  // LOTE R: los partidos globales se obtienen del router operativo (mis-partidos ya
  // devuelve todos los partidos de todas las ligas para el rol Superadmin).
  const fetchOperativo = async (endpoint, options = {}) => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        return { ok: false, status: 401, json: async () => ({ error: 'Sesión no válida' }) };
      }

      const response = await fetch(API_URL + '/operativo' + endpoint, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
          ...options.headers
        },
      });

      if (response.status === 401) setMensaje({ texto: 'Tu sesión ha expirado.', tipo: 'error' });
      return response;
    } catch (err) {
      return { ok: false, status: 500, json: async () => ({ error: 'Error de conexión.' }) };
    }
  };

  const cargarDatosPestana = async () => {
    setMensaje(null);
    setCargandoPestana(true);
    try {
      if (pestana === 'inicio') {
        // FASE B1 UX: datos del resumen global de la pestana Inicio.
        const resLigasInicio = await fetchConToken('/ligas');
        if (resLigasInicio.ok) setLigas(await resLigasInicio.json());
        const resMetricasInicio = await fetchConToken('/metricas');
        if (resMetricasInicio.ok) setMetricas(await resMetricasInicio.json());
      } else if (pestana === 'metricas') {
        const resLigas = await fetchConToken('/ligas');
        if (resLigas.ok) setLigas(await resLigas.json());
        const res = await fetchConToken('/metricas');
        if (res.ok) setMetricas(await res.json());
      } else if (pestana === 'ligas') {
        const res = await fetchConToken('/ligas');
        if (res.ok) setLigas(await res.json());
        // LOTE 8B: directorio de ligas eliminadas (baja logica) para restaurarlas.
        const resEliminadas = await fetchConToken('/ligas/eliminadas');
        if (resEliminadas.ok) setLigasEliminadas(await resEliminadas.json());
      } else if (pestana === 'usuarios') {
        const resLigas = await fetchConToken('/ligas');
        if (resLigas.ok) setLigas(await resLigas.json());
        const resUsers = await fetchConToken('/usuarios');
        if (resUsers.ok) setUsuariosList(await resUsers.json());
      } else if (pestana === 'calendario') {
        const resPartidos = await fetchOperativo('/mis-partidos');
        if (resPartidos.ok) setPartidosGlobales(await resPartidos.json());
      } else if (pestana === 'documentos') {
        const res = await fetchConToken('/documentos');
        if (res.ok) setDocumentosGlobales((await res.json()).documentos || []);
      } else if (pestana === 'bitacora') {
        const resUsers = await fetchConToken('/usuarios');
        if (resUsers.ok) setUsuariosList(await resUsers.json());
        const res = await fetchConToken(`/bitacora?rol=${filtroRol}&usuario_id=${filtroUsuarioId}&fecha_desde=${filtroFechaDesde}&fecha_hasta=${filtroFechaHasta}&busqueda=${encodeURIComponent(busquedaBitacora)}`);
        if (res.ok) setBitacora(await res.json());
      }
    } catch (err) { setMensaje({ texto: 'Error conectando con el servidor.', tipo: 'error' }); } finally { setCargandoPestana(false); }
  };

  useEffect(() => { cargarDatosPestana(); }, [pestana, filtroRol, filtroUsuarioId, filtroFechaDesde, filtroFechaHasta, busquedaBitacora]);

  useEffect(() => {
    if (formUser.rol.toLowerCase() === 'delegado de equipo' && formUser.organizacion_id && token) {
      fetchConToken(`/equipos?liga_id=${formUser.organizacion_id}`)
        .then(res => res.json())
        .then(data => setEquiposLiga(data || []));
    } else {
      setEquiposLiga([]);
      setFormUser(prev => ({ ...prev, equipo_id: '' }));
    }
  }, [formUser.organizacion_id, formUser.rol, token]);

  const exportarRespaldoBD = async (formato) => { if (generandoRespaldo) return; setGenerandoRespaldo(true); try { await exportarRespaldoBDBase(formato); } finally { setGenerandoRespaldo(false); } };
const exportarRespaldoBDBase = async (formato) => {
    setMensaje({ texto: 'Generando volcado de base de datos...', tipo: 'info' });
    try {
      const res = await fetchConToken('/respaldo-completo');
      if (!res.ok) throw new Error('Error de conexión');
      const data = await res.json();
      const timestamp = new Date().toISOString().split('T')[0];
      const nombreArchivo = `Backup_CONMINGO_${timestamp}`;

      if (formato === 'json') {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${nombreArchivo}.json`; a.click();
      } 
      else if (formato === 'sql') {
        let sqlContent = `-- VOLCADO DE BASE DE DATOS CONMINGO\n-- Fecha: ${timestamp}\n\n`;
        Object.keys(data).forEach(tabla => {
          const filas = data[tabla];
          if (filas.length > 0) {
            sqlContent += `-- Tabla: ${tabla}\n`;
            const columnas = Object.keys(filas[0]).join(', ');
            filas.forEach(fila => {
              const valores = Object.values(fila).map(val => {
                if (val === null || val === undefined) return 'NULL';
                if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                return val;
              }).join(', ');
              sqlContent += `INSERT INTO public.${tabla} (${columnas}) VALUES (${valores});\n`;
            });
            sqlContent += '\n';
          }
        });
        const blob = new Blob([sqlContent], { type: 'text/sql' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${nombreArchivo}.sql`; a.click();
      }
      setMensaje({ texto: `Respaldo ${formato.toUpperCase()} generado correctamente.`, tipo: 'exito' });
    } catch (error) {
      setMensaje({ texto: 'Error al generar el respaldo de la base de datos.', tipo: 'error' });
    }
  };

  const generarReporte = (datos, titulo, formato, pdfColumnas) => {
    if (!datos || datos.length === 0) {
      setMensaje({ texto: 'No hay datos para exportar en esta vista.', tipo: 'error' });
      return;
    }
    const timestamp = new Date().toISOString().split('T')[0];
    const nombreArchivo = `Reporte_${titulo}_${timestamp}`;

    if (formato === 'excel') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(datos);
      XLSX.utils.book_append_sheet(wb, ws, "Reporte");
      XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
    } 
    else if (formato === 'csv') {
      const ws = XLSX.utils.json_to_sheet(datos);
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${nombreArchivo}.csv`; a.click();
    } 
    else if (formato === 'pdf') {
      const doc = new jsPDF('landscape');
      encabezadoMarca(doc, { titulo: 'REPORTE OFICIAL', subtitulo: `Reporte de ${titulo}` });
      doc.setFontSize(10);
      doc.text(`Fecha de generación: ${formatearFechaHora(new Date())}`, 14, 30);
      const filasPDF = datos.map(item => pdfColumnas.map(col => item[col.key] || 'N/A'));
      const cabecerasPDF = pdfColumnas.map(col => col.label);
      autoTable(doc, {
        startY: 36, head: [cabecerasPDF], body: filasPDF, theme: 'grid',
        headStyles: { fillColor: MARCA_PDF.brown, textColor: MARCA_PDF.cream }, styles: { fontSize: 8 }
      });
      doc.save(`${nombreArchivo}.pdf`);
    }
  };

  const exportarReporteActual = (formato) => {
    if (pestana === 'ligas') {
      const configPDF = [{ label: 'Nombre Liga', key: 'nombre' }, { label: 'Administrador', key: 'responsable_nombre' }, { label: 'Teléfono', key: 'responsable_telefono' }, { label: 'Correo', key: 'responsable_email' }];
      generarReporte(ligas, 'Ligas_Organizaciones', formato, configPDF);
      } else if (pestana === 'usuarios') {
      const configPDF = [
        { label: 'Nombre', key: 'nombre' }, 
        { label: 'Apellido', key: 'apellido' }, 
        { label: 'Cédula', key: 'cedula' }, 
        { label: 'Rol', key: 'rol' }, 
        { label: 'Correo', key: 'email' },
        { label: 'Estado', key: 'estado' }
      ];
      generarReporte(usuariosList, 'Usuarios_Sistema', formato, configPDF);
    } else if (pestana === 'bitacora') {
      const datosBitacora = bitacora.map(b => ({ Fecha: formatearFechaHora(b.fecha), Usuario: b.usuario_email, Rol: b.usuario_rol, Accion: b.accion, Tabla: b.tabla }));
      const configPDF = [{ label: 'Fecha', key: 'Fecha' }, { label: 'Usuario', key: 'Usuario' }, { label: 'Rol', key: 'Rol' }, { label: 'Acción', key: 'Accion' }, { label: 'Tabla', key: 'Tabla' }];
      generarReporte(datosBitacora, 'Auditoria_Bitacora', formato, configPDF);
    } else if (pestana === 'metricas') {
      setMensaje({ texto: 'En Métricas, usa la exportación individual de la tabla que desees.', tipo: 'info' });
    }
  };

  const partidosAgendadosFiltrados = () => {
    if (!metricas?.partidos_agendados) return [];
    let base = metricas.partidos_agendados;
    if (filtroLigaPartidos !== 'todas') base = base.filter(p => String(p.organizacion_id) === String(filtroLigaPartidos));
    if (filtroPeriodo === 'todos') return base;
    const ahora = new Date();
    return base.filter((p) => {
      const fechaP = new Date(p.fecha_hora); 
      if (filtroPeriodo === 'hoy') return fechaP.toDateString() === ahora.toDateString();
      if (filtroPeriodo === 'semana') {
        const unaSemana = new Date(); unaSemana.setDate(ahora.getDate() + 7);
        return fechaP >= ahora && fechaP <= unaSemana;
      }
      if (filtroPeriodo === 'mes') return fechaP.getMonth() === ahora.getMonth() && fechaP.getFullYear() === ahora.getFullYear();
      return true;
    });
  };

  // LOTE R: filas derivadas para el filtrado, la busqueda y las descargas de las tablas.
  const filasPartidosVivo = filtrarTabla('partidosVivo', metricas?.partidos_activos || [], ['liga_nombre'], ['fecha_hora']);
  const filasAgendados = filtrarTabla('partidosAgendados', partidosAgendadosFiltrados(), []);
  const filasLigasBase = ligas.map(l => ({ ...l, estado_liga: l.estado_activa ? 'Activa' : 'Inactiva' }));
  const filasLigas = filtrarTabla('ligas', filasLigasBase, ['estado_liga']);

  // FASE 2 UX: paginacion compartida del directorio de ligas y pagina del directorio de usuarios
  const pagLigas = usePaginacion(filasLigas);
  const [paginaUsuarios, setPaginaUsuarios] = useState(1);
  // FASE 2 UX: esqueleto de carga mientras llega la respuesta de la pestana activa
  const [cargandoPestana, setCargandoPestana] = useState(true);

  // FASE 3C
  const [guardandoModal, setGuardandoModal] = useState(false);
  const [generandoRespaldo, setGenerandoRespaldo] = useState(false);
  const sedesGlobales = Object.fromEntries(partidosGlobales.filter(p => p.sede_nombre).map(p => [p.id, p.sede_nombre]));

  const guardarLiga = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    // LOTE 6J (revision): envia la bienvenida (hasta ~2 min) pero solo bloquea
    // su propio formulario: el resto del panel queda libre.
    setIsSubmitting(true);
    setMensaje({ texto: 'Registrando la organización y enviando el correo de bienvenida... Puede tardar hasta 2 minutos. Espera el aviso de éxito antes de repetir la acción.', tipo: 'info' });

    const payloadLimpio = {
      ...formLiga,
      nombre: formLiga.nombre.trim().replace(/\s+/g, ' '),
      responsable_nombre: formLiga.responsable_nombre.trim().replace(/\s+/g, ' '),
      responsable_apellido: formLiga.responsable_apellido.trim().replace(/\s+/g, ' '),
      responsable_email: formLiga.responsable_email.trim().toLowerCase()
    };

    try {
      const res = await fetchConToken('/ligas', { method: 'POST', body: JSON.stringify(payloadLimpio) });
      // LOTE 6G FIX: respuesta no JSON (proxy durante redeploy) no debe matar el handler
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setMensaje({ texto: data.mensaje, tipo: 'exito' });
        setFormLiga({ nombre: '', responsable_nombre: '', responsable_apellido: '', responsable_cedula: '', responsable_telefono: '', responsable_email: '' });
        cargarDatosPestana();
      } else setMensaje({ texto: `Error: ${data.error || 'el servidor no respondio correctamente (redeploy en Render?)'}`, tipo: 'error' });
    } catch (err) {
      setMensaje({ texto: 'Error de conexión al registrar la organización.', tipo: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const actualizarLiga = async (e) => {
    e.preventDefault();
    if (isSubmitting) return; 
    setIsSubmitting(true);

    const payloadLimpio = {
      ...ligaEditando,
      nombre: ligaEditando.nombre.trim().replace(/\s+/g, ' '),
      responsable_nombre: ligaEditando.responsable_nombre.trim().replace(/\s+/g, ' '),
      responsable_email: ligaEditando.responsable_email.trim().toLowerCase()
    };

    const res = await fetchConToken(`/ligas/${ligaEditando.id}`, { method: 'PUT', body: JSON.stringify(payloadLimpio) });
    
    setIsSubmitting(false); // Liberar botón
    if (res.ok) { setMensaje({ texto: 'Liga actualizada.', tipo: 'exito' }); setLigaEditando(null); cargarDatosPestana(); }
  };

  const verInformacionLiga = async (id) => {
    const res = await fetchConToken(`/ligas/${id}/detalle`);
    if (res.ok) setLigaDetalle(await res.json()); else setMensaje({ texto: 'Error al obtener info.', tipo: 'error' });
  };

  const guardarUsuario = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    // LOTE 6J (revision): envia la bienvenida (hasta ~2 min) pero solo bloquea
    // su propio formulario: el resto del panel queda libre.
    setIsSubmitting(true);
    setMensaje({ texto: 'Creando el usuario y enviando el correo de bienvenida... Puede tardar hasta 2 minutos. Espera el aviso de éxito antes de repetir la acción.', tipo: 'info' });

    const payloadLimpio = {
      ...formUser,
      nombre: formUser.nombre.trim().replace(/\s+/g, ' '),
      apellido: formUser.apellido.trim().replace(/\s+/g, ' '),
      email: formUser.email.trim().toLowerCase()
    };

    try {
      const res = await fetchConToken('/usuarios', { method: 'POST', body: JSON.stringify(payloadLimpio) });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setMensaje({ texto: data.mensaje, tipo: 'exito' });
        setFormUser({ nombre: '', apellido: '', cedula: '', email: '', rol: 'administrador de liga', organizacion_id: '', equipo_id: '' });
        cargarDatosPestana();
      } else setMensaje({ texto: `Error: ${data.error || 'el servidor no respondio correctamente (redeploy en Render?)'}`, tipo: 'error' });
    } catch (err) {
      setMensaje({ texto: 'Error de conexión al registrar el usuario.', tipo: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const actualizarUsuario = async (e) => {
    e.preventDefault();
    if (isSubmitting) return; 
    setIsSubmitting(true);

    const payloadLimpio = {
      ...userEditando,
      nombre: userEditando.nombre.trim().replace(/\s+/g, ' '),
      apellido: userEditando.apellido.trim().replace(/\s+/g, ' ')
    };

    const res = await fetchConToken(`/usuarios/${userEditando.id}`, { method: 'PUT', body: JSON.stringify(payloadLimpio) });
    
    setIsSubmitting(false); // Liberar botón
    if (res.ok) { setMensaje({ texto: 'Datos actualizados.', tipo: 'exito' }); setUserEditando(null); cargarDatosPestana(); }
  };

  const resetearPasswordAccion = async (user) => {
    const primerNombre = user.nombre ? user.nombre.trim().split(' ')[0] : 'User';
    const cincoDigitos = user.cedula ? user.cedula.trim().substring(0, 5) : '00000';
    if (!(await pedirConfirmacion('Restablecer clave', `¿Restablecer clave temporal a: ${primerNombre}${cincoDigitos}!?`))) return;
    // LOTE 6J (revision): bloqueo por persona, no global. Otras personas siguen operativas.
    if (envioEnCurso(user.id)) return;
    bloquearEnvio(user.id);
    setMensaje({ texto: 'Enviando el correo de restablecimiento... Puede tardar hasta 2 minutos. Espera el aviso de éxito antes de repetir la acción.', tipo: 'info' });
    try {
      const res = await fetchConToken(`/usuarios/${user.id}/reset-password`, { method: 'POST' });
      if (res.ok) { setMensaje({ texto: (await res.json().catch(() => ({}))).mensaje || 'Clave restablecida.', tipo: 'exito' }); cargarDatosPestana(); }
      else setMensaje({ texto: `Error: ${(await res.json().catch(() => ({}))).error || 'el servidor no respondio correctamente'}`, tipo: 'error' });
    } finally {
      liberarEnvio(user.id);
    }
  };

  // LOTE 6G: cambiar el correo de un usuario desde el panel de credenciales
  const cambiarCorreoAccion = (u) => {
    setModalCorreo(u);
    setNuevoCorreoUsuario('');
  };

  const enviarCambioCorreo = async (e) => {
    e.preventDefault();
    if (!modalCorreo) return;
    const usuarioId = modalCorreo.id;
    const correoLimpio = nuevoCorreoUsuario.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoLimpio)) {
      setMensaje({ texto: 'El nuevo correo tiene un formato inválido.', tipo: 'error' });
      return;
    }
    // LOTE 6J (revision): bloqueo por persona, no global. Otras personas siguen operativas.
    if (envioEnCurso(usuarioId)) return;
    bloquearEnvio(usuarioId);
    setMensaje({ texto: 'Enviando la confirmación al nuevo correo... Puede tardar hasta 2 minutos. Espera el aviso de éxito antes de repetir la acción.', tipo: 'info' });
    try {
      const res = await fetchConToken(`/usuarios/${usuarioId}/cambiar-correo`, { method: 'POST', body: JSON.stringify({ nuevo_email: correoLimpio }) });
      const data = await res.json().catch(() => ({}));
      setModalCorreo(null);
      if (res.ok) {
        setMensaje({ texto: data.mensaje, tipo: 'exito' });
        cargarDatosPestana();
      } else {
        setMensaje({ texto: data.error || 'No se pudo solicitar el cambio de correo.', tipo: 'error' });
      }
    } finally {
      liberarEnvio(usuarioId);
    }
  };

  // LOTE 6G: reenviar enlace de verificacion (o confirmacion de cambio pendiente)
  const reenviarVerificacionAccion = async (u) => {
    // LOTE 6J (revision): bloqueo por persona, no global. Otras personas siguen operativas.
    if (envioEnCurso(u.id)) return;
    bloquearEnvio(u.id);
    setMensaje({ texto: 'Enviando el correo de verificación... Puede tardar hasta 2 minutos. Espera el aviso de éxito antes de repetir la acción.', tipo: 'info' });
    try {
      const res = await fetchConToken(`/usuarios/${u.id}/reenviar-verificacion`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMensaje({ texto: data.mensaje, tipo: 'exito' }); cargarDatosPestana(); }
      else setMensaje({ texto: data.error || 'No se pudo reenviar la verificación.', tipo: 'error' });
    } finally {
      liberarEnvio(u.id);
    }
  };

  const iniciarEliminacionUsuario = async (u) => {
    setMensaje(null);
    try {
      const res = await fetchConToken(`/usuarios/${u.id}/verificar-eliminacion`);
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ texto: data.error || 'El servidor no respondio correctamente.', tipo: 'error' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      setItemEliminar({ tipo: 'usuario', id: u.id, nombre: `${u.nombre || ''} (${u.email})` });
    } catch (error) { setMensaje({ texto: 'Error de red al intentar verificar.', tipo: 'error' }); }
  };

  const reactivarUsuario = async (u) => {
    if (!(await pedirConfirmacion('Reactivar acceso', `¿Reactivar el acceso de ${u.nombre} ${u.apellido} (${u.email})?`))) return;
    const res = await fetchConToken(`/usuarios/${u.id}/reactivar`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMensaje({ texto: data.mensaje || 'Usuario reactivado con éxito.', tipo: 'exito' });
      cargarDatosPestana();
    } else {
      setMensaje({ texto: data.error || 'No se pudo reactivar el usuario.', tipo: 'error' });
    }
  };

  // LOTE 8D: rechazar la solicitud de activacion de un usuario desactivado.
  // El AdminLiga que pidio la reactivacion recibe el aviso en su bandeja.
  const rechazarSolicitud = async (u) => {
    if (!(await pedirConfirmacion('Rechazar solicitud', `¿Rechazar reactivar el acceso de ${u.nombre} ${u.apellido} (${u.email})? El usuario seguirá desactivado.`, 'peligro'))) return;
    const res = await fetchConToken(`/usuarios/${u.id}/rechazar-activacion`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMensaje({ texto: data.mensaje || 'Solicitud rechazada.', tipo: 'exito' });
      cargarDatosPestana();
    } else {
      setMensaje({ texto: data.error || 'No se pudo rechazar la solicitud.', tipo: 'error' });
    }
  };

  // LOTE 8B: restaurar una liga eliminada (inverso del soft delete).
  const restaurarLiga = async (liga) => {
    if (restaurandoLiga) return;
    const confirmado = await pedirConfirmacion('Restaurar Liga', `¿Restaurar "${liga.nombre}"? Volverá al directorio con estado Activa y sus usuarios recuperarán el acceso.`, 'exito');
    if (!confirmado) return;
    setRestaurandoLiga(liga.id);
    try {
      const res = await fetchConToken(`/ligas/${liga.id}/restaurar`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMensaje({ texto: data.mensaje || 'Liga restaurada con éxito.', tipo: 'exito' });
        cargarDatosPestana();
      } else {
        setMensaje({ texto: data.error || 'No se pudo restaurar la liga.', tipo: 'error' });
      }
    } finally {
      setRestaurandoLiga(null);
    }
  };

  const ejecutarEliminacion = async (e) => { if (guardandoModal) return; setGuardandoModal(true); try { await ejecutarEliminacionBase(e); } finally { setGuardandoModal(false); } };
const ejecutarEliminacionBase = async (e) => {
    e.preventDefault();
    if (!itemEliminar || !claveConfirmacion) return;
    const res = await fetchConToken(itemEliminar.tipo === 'liga' ? `/ligas/${itemEliminar.id}` : `/usuarios/${itemEliminar.id}`, { method: 'DELETE', body: JSON.stringify({ password: claveConfirmacion }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMensaje({ texto: data.mensaje, tipo: 'exito' }); setItemEliminar(null); setClaveConfirmacion('');
      if (ligaDetalle?.liga?.id === itemEliminar.id) setLigaDetalle(null);
      cargarDatosPestana();
    } else {
      setMensaje({ texto: data.error || 'El servidor no respondio correctamente.', tipo: 'error' }); 
    }
  };

  const ejecutarCerrarSesion = async () => {
    try { await fetchConToken('/log-evento', { method: 'POST', body: JSON.stringify({ accion: 'CERRAR_SESION', tabla: 'auth' }) }); } catch (e) {}
    cerrarSesion();
  };

  const isBuscando = busquedaUsuario.trim().length > 0;
  const usuariosMatchBusqueda = usuariosList.filter(u => `${u.nombre || ''} ${u.apellido || ''} ${u.email} ${u.cedula}`.toLowerCase().includes(busquedaUsuario.trim().toLowerCase()));

  const formatearFecha = (fechaIso) => fechaIso ? formatearFechaHora(fechaIso) : 'N/A'; // LOTE FECHAS: delega en el kit compartido (dd/mm/aaaa, 12 horas)

  const renderTablaUsuarios = (arregloUsuarios) => {
    const filasUsuariosVista = filtrarTabla('usuarios', arregloUsuarios, ['rol', 'estado']);
    // FASE 2 UX: recorte de la pagina vigente (calculo puro, el estado vive arriba)
    const porPaginaUsuarios = 12;
    const totalPaginasUsuarios = Math.max(1, Math.ceil(filasUsuariosVista.length / porPaginaUsuarios));
    const paginaSeguraUsuarios = Math.min(paginaUsuarios, totalPaginasUsuarios);
    const inicioUsuarios = (paginaSeguraUsuarios - 1) * porPaginaUsuarios;
    const filasUsuariosPagina = filasUsuariosVista.slice(inicioUsuarios, inicioUsuarios + porPaginaUsuarios);
    return (
      <div className="space-y-3">
        <TableTools rows={arregloUsuarios} filteredRows={filasUsuariosVista} filter={getFilter('usuarios')} setFilter={setTableFilter('usuarios')} columns={[{ key: 'nombre', label: 'Nombre' }, { key: 'apellido', label: 'Apellido' }, { key: 'cedula', label: 'Cédula' }, { key: 'email', label: 'Email' }, { key: 'rol', label: 'Rol' }, { key: 'organizacion_nombre', label: 'Liga' }, { key: 'estado', label: 'Estado' }]} categoryFields={['rol', 'estado']} filename="superadmin_directorio_usuarios" modulo="Superadmin" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
        <div className="overflow-x-auto hide-scrollbar border border-brand-gold/30 rounded-lg">
      <table className="w-full text-left text-sm text-brand-brown whitespace-nowrap">
        <thead className="bg-brand-cream/50 text-brand-brown uppercase tracking-wider text-xs font-bold border-b border-brand-gold/30">
          <tr>
            <th scope="col" className="p-4">Usuario</th>
            <th scope="col" className="p-4">Cédula</th>
            <th scope="col" className="p-4">Email</th>
            <th scope="col" className="p-4">Rol</th>
            <th scope="col" className="p-4">Liga</th>
            <th scope="col" className="p-4">Estado</th>
            <th scope="col" className="p-4 text-center">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-gold/20 bg-white">
          {cargandoPestana && filasUsuariosVista.length === 0 ? (
            <tr><td colSpan={7} className="p-5"><SkeletonTabla filas={6} columnas={7} /></td></tr>
          ) : filasUsuariosVista.length === 0 ? (
            <tr><td colSpan={7} className="p-0 border-0"><EmptyState icono="usuarios" titulo="Sin usuarios para mostrar" descripcion={isBuscando ? 'Ningún usuario coincide con la búsqueda.' : 'Crea el primer usuario desde el formulario de esta vista.'} /></td></tr>
          ) : (
            filasUsuariosPagina.map((u) => (
              <tr key={u.id} className={`transition-colors ${u.estado === 'Inactivo' ? 'opacity-60 bg-gray-50' : 'hover:bg-brand-cream/10'}`}>
                <td className="p-4 font-bold">{u.nombre} {u.apellido}</td>
                <td className="p-4">{u.cedula || 'N/R'}</td>
                <td className="p-4">
                  <div>{u.email}</div>
                  {u.correo_verificado === false && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[0.65rem] font-bold">Sin verificar</span>
                  )}
                  {u.email_pendiente && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[0.65rem] font-bold">Cambio pendiente a {u.email_pendiente}</span>
                  )}
                </td>
                <td className="p-4">
                  <span className="px-2 py-1 bg-brand-cream/50 border border-brand-gold/20 rounded-md text-xs font-semibold">
                    {u.rol}
                  </span>
                </td>
                <td className="p-4">{u.organizacion_nombre || 'General'}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded-full text-[0.7rem] font-bold uppercase tracking-wider ${u.estado === 'Inactivo' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {u.estado || 'Activo'}
                  </span>
                </td>
                <td className="p-4 flex gap-2 justify-center">
                  <button onClick={() => setUserEditando(u)} className="p-1.5 text-brand-blue hover:bg-brand-blue/10 rounded-lg transition-colors" title="Editar" aria-label="Editar">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button onClick={() => resetearPasswordAccion(u)} disabled={envioEnCurso(u.id)} className="p-1.5 text-brand-gold hover:bg-brand-gold/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Resetear Clave" aria-label="Resetear Clave">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                  </button>
                  <button onClick={() => cambiarCorreoAccion(u)} disabled={envioEnCurso(u.id)} className="p-1.5 text-brand-blue hover:bg-brand-blue/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Cambiar Correo" aria-label="Cambiar Correo">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  </button>
                  {(u.correo_verificado === false || u.email_pendiente) && (
                    <button onClick={() => reenviarVerificacionAccion(u)} disabled={envioEnCurso(u.id)} className="p-1.5 text-brand-brown hover:bg-brand-brown/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Reenviar Verificación" aria-label="Reenviar Verificación">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                  )}
                  {u.estado !== 'Inactivo' && (
                    <button onClick={() => iniciarEliminacionUsuario(u)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Desactivar Acceso" aria-label="Desactivar Acceso">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                  {u.estado === 'Inactivo' && (
                    <>
                    <button onClick={() => reactivarUsuario(u)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Reactivar Acceso" aria-label="Reactivar Acceso">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                    <button onClick={() => rechazarSolicitud(u)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Rechazar Solicitud" aria-label="Rechazar Solicitud">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </button>
                    </>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
        </div>
        <PaginacionTabla pagina={paginaSeguraUsuarios} setPagina={setPaginaUsuarios} totalPaginas={totalPaginasUsuarios} desde={filasUsuariosVista.length === 0 ? 0 : inicioUsuarios + 1} hasta={Math.min(inicioUsuarios + porPaginaUsuarios, filasUsuariosVista.length)} total={filasUsuariosVista.length} />
      </div>
    );
  };

  const renderListadoUsuarios = () => {
    if (isBuscando) return renderTablaUsuarios(usuariosMatchBusqueda);
    if (vistaUsuarios === 'ligas') {
      const ligasConGente = [{ id: 'null', nombre: 'Usuarios Generales / Sin Liga' }, ...ligas];
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {cargandoPestana && ligas.length === 0 ? (
            <div className="col-span-full"><SkeletonTarjetas cantidad={6} clasesGrid="grid-cols-1 sm:grid-cols-2 md:grid-cols-3" /></div>
          ) : ligasConGente.map(l => (
            <div key={l.id} onClick={() => { setUsuLigaSel(l.id === 'null' ? null : l.id); setVistaUsuarios('roles'); }} className="bg-white border border-brand-gold/30 p-6 rounded-xl cursor-pointer text-center hover:shadow-md hover:border-brand-gold transition-all">
              <h4 className="text-brand-blue font-bold mb-2">{l.nombre}</h4>
              <p className="text-xs text-brand-brown/60 flex justify-center items-center gap-1">Clic para ver roles <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg></p>
            </div>
          ))}
        </div>
      );
    }
    if (vistaUsuarios === 'roles') {
      const usuariosDeLaLiga = usuariosList.filter(u => u.organizacion_id === usuLigaSel);
      const rolesEnLiga = [...new Set(usuariosDeLaLiga.map(u => u.rol))];
      return (
        <div className="animate-fade-in">
          <button onClick={() => setVistaUsuarios('ligas')} className="mb-4 text-brand-gold font-bold flex items-center gap-2 text-sm hover:text-brand-brown transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg> Volver a Ligas
          </button>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {cargandoPestana && usuariosList.length === 0 ? (<div className="col-span-full"><SkeletonTarjetas cantidad={4} clasesGrid="grid-cols-1 sm:grid-cols-2 md:grid-cols-4" /></div>) : rolesEnLiga.length === 0 ? (<div className="col-span-full"><EmptyState icono="usuarios" titulo="No hay usuarios en esta liga" descripcion="Crea usuarios de esta organización desde el formulario de arriba." /></div>) : rolesEnLiga.map(r => (
              <div key={r} onClick={() => { setUsuRolSel(r); setVistaUsuarios('tabla'); }} className="bg-brand-cream/30 border border-brand-gold/30 p-6 rounded-xl cursor-pointer text-center hover:bg-brand-cream/60 transition-colors">
                <h4 className="text-brand-brown font-bold capitalize mb-1">{r}s</h4>
                <span className="bg-brand-gold/20 text-brand-gold text-xs font-bold px-2 py-0.5 rounded-full">{usuariosDeLaLiga.filter(u => u.rol === r).length} personas</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (vistaUsuarios === 'tabla') {
      const usuariosFinales = usuariosList.filter(u => u.organizacion_id === usuLigaSel && u.rol === usuRolSel);
      return (
        <div className="animate-fade-in">
          <button onClick={() => setVistaUsuarios('roles')} className="mb-4 text-brand-gold font-bold flex items-center gap-2 text-sm hover:text-brand-brown transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg> Volver a Roles
          </button>
          {renderTablaUsuarios(usuariosFinales)}
        </div>
      );
    }
  };

  // LOTE 3B+: helpers del repositorio global de documentos
  const formatearTamanoDocGlobal = (bytes) => {
    const valor = parseInt(bytes, 10);
    if (!valor || valor <= 0) return 'N/D';
    if (valor < 1024) return valor + ' B';
    if (valor < 1024 * 1024) return (valor / 1024).toFixed(1) + ' KB';
    return (valor / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const recargarDocumentosGlobales = async () => {
    const res = await fetchConToken('/documentos');
    if (res.ok) setDocumentosGlobales((await res.json()).documentos || []);
  };

  const subirDocumentoGlobal = async (e) => {
    e.preventDefault();
    if (subiendoDocGlobal) return;
    const titulo = formDocGlobal.titulo.trim();
    if (!titulo) return setMensaje({ texto: 'El título del documento es obligatorio.', tipo: 'error' });
    if (!archivoDocGlobal) return setMensaje({ texto: 'Selecciona el archivo a subir.', tipo: 'error' });
    if (archivoDocGlobal.size > 10 * 1024 * 1024) return setMensaje({ texto: 'El archivo supera los 10MB permitidos.', tipo: 'error' });
    setSubiendoDocGlobal(true);
    let ruta = null;
    try {
      const extension = ((archivoDocGlobal.name.match(/\.([a-zA-Z0-9]{1,8})$/) || [null, 'bin'])[1]).toLowerCase();
      ruta = '__global/' + crypto.randomUUID() + '.' + extension;
      const { error: errorSubida } = await supabase.storage.from('documentos').upload(ruta, archivoDocGlobal, { contentType: archivoDocGlobal.type || 'application/octet-stream', upsert: false });
      if (errorSubida) throw new Error(errorSubida.message || 'Error subiendo el archivo.');
      const res = await fetchConToken('/documentos', {
        method: 'POST',
        body: JSON.stringify({ titulo, tipo: formDocGlobal.tipo, archivo_path: ruta, tamano_bytes: archivoDocGlobal.size, mime_type: archivoDocGlobal.type || 'application/octet-stream' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await supabase.storage.from('documentos').remove([ruta]).catch(() => {});
        throw new Error(data.error || 'Error registrando el documento global.');
      }
      setMensaje({ texto: 'Documento compartido con todas las ligas.', tipo: 'exito' });
      setFormDocGlobal({ titulo: '', tipo: 'Reglamento' });
      setArchivoDocGlobal(null);
      await recargarDocumentosGlobales();
    } catch (err) {
      setMensaje({ texto: err.message || 'Error subiendo el documento global.', tipo: 'error' });
    } finally {
      setSubiendoDocGlobal(false);
    }
  };

  const eliminarDocumentoGlobal = async (id) => {
    if (!(await pedirConfirmacion('Eliminar documento global', '¿Eliminar este documento global? Dejará de estar disponible para todas las ligas.', 'peligro'))) return;
    const res = await fetchConToken('/documentos/' + id, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMensaje({ texto: 'Documento global eliminado.', tipo: 'exito' });
      await recargarDocumentosGlobales();
    } else {
      setMensaje({ texto: data.error || 'Error eliminando el documento global.', tipo: 'error' });
    }
  };

  const TITULOS_PESTANA = {
    inicio: 'Inicio',
    metricas: 'Métricas Globales',
    calendario: 'Calendario de Partidos',
    ligas: 'Ligas',
    usuarios: 'Usuarios',
    documentos: 'Documentos',
    bitacora: 'Bitácora de Actividad',
  };

  // FASE 2 UX: los iconos viven en el catalogo compartido; cada pestana mapea a un nombre
  const ICONOS_PESTANA = { inicio: 'inicio', metricas: 'estadisticas', ligas: 'ligas', usuarios: 'usuarios', bitacora: 'acta', calendario: 'calendario', documentos: 'documentos' };
  // FASE B1 UX: resumen global de la pestana Inicio.
  const totalLigasInicio = metricas?.total_ligas ?? 0;
  const ligasActivasInicio = metricas?.ligas_activas ?? 0;
  const usuariosInicio = metricas?.total_usuarios ?? 0;
  const partidosVivoInicio = metricas?.partidos_activos || [];
  const equiposInicio = metricas?.total_equipos ?? 0;
  const jugadoresInicio = metricas?.total_jugadores ?? 0;

  return (
    <div className="flex h-screen w-full bg-brand-cream font-sans overflow-hidden">
      <SistemaMensajeria usuario={usuario} token={token} />
      <TourGuia rol="superadmin" activo={tourActivo} onCerrar={cerrarTour} />
      <ConfirmDialog confirmacion={confirmacion} onCerrar={() => setConfirmacion(null)} />

      {/* MODAL CAMBIO DE CORREO (LOTE 6G) */}
      {modalCorreo && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-2000 p-4" role="dialog" aria-modal="true" aria-label="Cambiar Correo Electrónico" onKeyDown={(evento) => tecladoModal(evento, () => setModalCorreo(null))}>
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl animate-slide-up border border-brand-gold/30">
            <h3 className="text-xl font-bold text-brand-brown mb-2">Cambiar Correo Electrónico</h3>
            <p className="text-sm text-brand-brown/70 mb-1">Usuario: <strong>{modalCorreo.nombre} {modalCorreo.apellido}</strong></p>
            <p className="text-sm text-brand-brown/70 mb-4">Correo actual: <strong>{modalCorreo.email}</strong></p>
            <p className="text-xs text-brand-brown/60 mb-4 leading-relaxed">
              Se enviará un aviso al correo actual y una confirmación al nuevo correo. El cambio se aplicará solo cuando el nuevo correo lo confirme desde el enlace recibido.
            </p>
            <form onSubmit={enviarCambioCorreo} className="flex flex-col gap-4">
              <input
                type="email"
                placeholder="Nuevo correo electrónico"
                value={nuevoCorreoUsuario}
                onChange={(e) => setNuevoCorreoUsuario(e.target.value)}
                required
                autoFocus
                className="w-full p-3 border border-brand-gold/40 rounded-lg focus:ring-2 focus:ring-brand-rust focus:border-brand-rust outline-none text-brand-brown bg-brand-cream/20"
              />
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => setModalCorreo(null)} className="flex-1 bg-gray-200 text-brand-brown py-2.5 rounded-lg font-bold hover:bg-gray-300 transition-colors">Cancelar</button>
                <button type="submit" disabled={envioEnCurso(modalCorreo.id)} className="flex-1 bg-brand-blue text-white py-2.5 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{envioEnCurso(modalCorreo.id) ? 'Enviando... ' + segundosCorreo + ' s' : 'Enviar Confirmación'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ELIMINAR */}
      {itemEliminar && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-2000 p-4" role="dialog" aria-modal="true" aria-label="Confirmar Eliminación">
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl animate-slide-up border border-red-200">
            <h3 className="text-xl font-bold text-red-600 mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              Confirmar Eliminación
            </h3>
            <p className="text-sm text-brand-brown mb-4 leading-relaxed">
              {itemEliminar.tipo === 'liga'
                ? <>Estás a punto de eliminar la liga: <strong className="text-red-600">{itemEliminar.nombre}</strong>. Queda marcada como eliminada (nada se borra en cascada): sus usuarios pierden acceso y sus datos históricos se preservan. Puedes restaurarla luego desde la sección de Ligas Eliminadas.</>
                : <>Estás a punto de desactivar al usuario: <strong className="text-red-600">{itemEliminar.nombre}</strong>. Sus credenciales pierden validez y podrás reactivarlo después.</>
              }
            </p>
            <form onSubmit={ejecutarEliminacion} className="flex flex-col gap-4">
              <input 
                type="password" 
                placeholder="Contraseña de Superadmin" 
                value={claveConfirmacion} 
                onChange={(e) => setClaveConfirmacion(e.target.value)} 
                required 
                autoFocus 
                className="w-full p-3 border border-brand-gold/40 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none text-brand-brown bg-brand-cream/20"
              />
              <div className="flex gap-3 mt-2">
                <button type="button" onClick={() => { setItemEliminar(null); setClaveConfirmacion(''); }} className="flex-1 bg-gray-200 text-brand-brown py-2.5 rounded-lg font-bold hover:bg-gray-300 transition-colors">Cancelar</button>
                <button type="submit" disabled={guardandoModal} className="flex-1 bg-red-600 text-white py-2.5 rounded-lg font-bold hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{guardandoModal ? 'Eliminando...' : (itemEliminar.tipo === 'liga' ? 'Eliminar Liga' : 'Eliminar Usuario')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SIDEBAR LATERAL */}
      {/* UX: barra lateral compartida (se colapsa en escritorio, menu deslizante en movil) */}
      <Sidebar
        titulo="Superadmin"
        subtitulo="Control Global"
        onCerrarSesion={ejecutarCerrarSesion}
        extras={<div className="flex gap-2">
          <button onClick={() => exportarRespaldoBD('sql')} disabled={generandoRespaldo} className="flex-1 px-3 py-2 bg-brand-cream/10 text-brand-cream border border-brand-gold/30 rounded-lg hover:bg-brand-rust text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{generandoRespaldo ? 'Generando...' : 'Respaldo SQL'}</button>
          <button onClick={() => exportarRespaldoBD('json')} disabled={generandoRespaldo} className="flex-1 px-3 py-2 bg-brand-cream/10 text-brand-cream border border-brand-gold/30 rounded-lg hover:bg-brand-rust text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{generandoRespaldo ? 'Generando...' : 'Respaldo JSON'}</button>
        </div>}

        grupos={[
          { etiqueta: 'Panel', items: [
            { id: 'inicio', label: 'Inicio' },
          ]},
          { etiqueta: 'Operación', items: [
            { id: 'metricas', label: 'Métricas Globales' },
            { id: 'calendario', label: 'Calendario de Partidos' },
          ]},
          { etiqueta: 'Estructura', items: [
            { id: 'ligas', label: 'Ligas' },
            { id: 'usuarios', label: 'Usuarios' },
          ]},
          { etiqueta: 'Recursos y Auditoría', items: [
            { id: 'documentos', label: 'Documentos' },
            { id: 'bitacora', label: 'Bitácora de Actividad' },
          ]},
        ]}
        pestana={pestana}
        onPestana={(id) => { setPestana(id); setLigaDetalle(null); setMenuAbierto(false); }}
        renderIcono={(id) => <NavIcon nombre={ICONOS_PESTANA[id]} />}
        menuAbierto={menuAbierto}
        onCerrarMenu={() => setMenuAbierto(false)}
        claveColapso="superadminSidebarColapsada"
        onVerGuia={() => setTourActivo(true)}
      />

      {/* CONTENEDOR PRINCIPAL */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-brand-cream relative overflow-y-auto">
        
        {/* HEADER SUPERIOR */}
        <HeaderPanel
          apilado
          claseTitulo="text-xl font-bold text-brand-brown capitalize flex items-center gap-2"
          titulo={<><NavIcon nombre={ICONOS_PESTANA[pestana]} /> {TITULOS_PESTANA[pestana] || pestana}</>}
          onAbrirMenu={() => setMenuAbierto(true)}
        />

        {/* CONTENIDO PRINCIPAL */}
        <div className="p-4 md:p-6 flex-1 max-w-7xl mx-auto w-full">
          
          {mensaje && (
            <div className={`p-4 mb-6 rounded-lg font-medium text-sm flex items-center gap-2 animate-fade-in ${mensaje.tipo === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : mensaje.tipo === 'info' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
              {mensaje.tipo === 'error' && <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
              {mensaje.texto}
            </div>
          )}

          {/* FASE B1 UX: PESTANA INICIO */}
          {pestana === 'inicio' && (
            <div className="space-y-6 animate-fade-in">
              <h3 className="text-lg font-bold text-brand-rust border-b-2 border-brand-rust/30 pb-2 flex items-center gap-2">
                <NavIcon nombre="inicio" className="w-5 h-5" />
                Resumen Global del Sistema
              </h3>
              {cargandoPestana && !metricas ? (
                <SkeletonTarjetas cantidad={2} clasesGrid="grid grid-cols-1 md:grid-cols-2 gap-4" />
              ) : partidosVivoInicio.length > 0 ? (
                <div className="bg-white rounded-lg border-l-4 border-green-500 border-y border-r border-y-brand-gold/20 border-r-brand-gold/20 p-5 shadow-sm space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wide text-green-700 mb-2">En juego ahora ({partidosVivoInicio.length})</div>
                  {partidosVivoInicio.map(p => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-bold text-brand-brown">{p.liga_nombre || 'General / Suelto'} <span className="text-brand-brown/50 font-medium">- {formatearFecha(p.fecha_hora)}</span></div>
                      <button onClick={() => setPestana('metricas')} className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-brown transition-colors shadow-sm">Ver Métricas Globales</button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState titulo="Sin partidos en juego" descripcion="Ninguna liga tiene un partido en vivo en este momento." icono="reloj" />
              )}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <TarjetaResumen icono="ligas" titulo="Ligas" valor={totalLigasInicio} texto={'Activas: ' + ligasActivasInicio} onClick={() => setPestana('ligas')} textoAccion="Ir a Ligas" />
                <TarjetaResumen icono="usuarios" titulo="Usuarios" valor={usuariosInicio} texto="Cuentas registradas en el sistema." onClick={() => setPestana('usuarios')} textoAccion="Ir a Usuarios" />
                <TarjetaResumen icono="estadisticas" titulo="Partidos en vivo" valor={partidosVivoInicio.length} texto="Encuentros transcurriendo ahora." onClick={() => setPestana('metricas')} textoAccion="Ver Métricas" />
                <TarjetaResumen icono="equipos" titulo="Equipos y jugadores" valor={equiposInicio} texto={jugadoresInicio + ' jugadores inscritos.'} onClick={() => setPestana('metricas')} textoAccion="Ver Métricas" />
              </div>
              <div className="bg-white border border-brand-gold/30 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-brand-brown text-sm">Respaldo de la base de datos</h4>
                  <p className="text-xs text-brand-brown/70">Descarga un volcado completo (SQL o JSON) del estado actual del sistema.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => exportarRespaldoBD('sql')} disabled={generandoRespaldo} className="bg-brand-brown text-brand-cream px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-brown/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{generandoRespaldo ? 'Generando...' : 'Descargar SQL'}</button>
                  <button onClick={() => exportarRespaldoBD('json')} disabled={generandoRespaldo} className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-brown transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{generandoRespaldo ? 'Generando...' : 'Descargar JSON'}</button>
                </div>
              </div>
            </div>
          )}

          {pestana === 'metricas' && metricas && (
            <div className="animate-fade-in space-y-6">
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border border-brand-gold/30 p-5 rounded-xl text-center shadow-sm">
                  <h4 className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Ligas</h4>
                  <p className="text-4xl font-black text-brand-blue">{metricas.total_ligas}</p>
                  <p className="text-xs font-semibold text-green-600 mt-1 bg-green-50 rounded-full inline-block px-2 py-0.5">{metricas.ligas_activas} Activas</p>
                </div>
                <div className="bg-white border border-brand-gold/30 p-5 rounded-xl text-center shadow-sm">
                  <h4 className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Usuarios</h4>
                  <p className="text-4xl font-black text-brand-blue">{metricas.total_usuarios}</p>
                </div>
                <div className="bg-white border border-brand-gold/30 p-5 rounded-xl text-center shadow-sm">
                  <h4 className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Equipos</h4>
                  <p className="text-4xl font-black text-brand-gold">{metricas.total_equipos}</p>
                </div>
                <div className="bg-white border border-brand-gold/30 p-5 rounded-xl text-center shadow-sm">
                  <h4 className="text-xs font-bold text-brand-brown/60 uppercase tracking-wider mb-2">Jugadores</h4>
                  <p className="text-4xl font-black text-brand-gold">{metricas.total_jugadores}</p>
                </div>
              </div>

              <div className="bg-white border border-red-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-red-50 px-5 py-4 border-b border-red-200 flex justify-between items-center">
                  <h3 className="text-red-600 font-bold flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span> Partidos en Vivo
                  </h3>
                  <div className="flex gap-2">
                    <button onClick={() => generarReporte(metricas.partidos_activos, 'Partidos_En_Vivo', 'excel', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} className="text-[0.7rem] bg-brand-cream border border-brand-gold/30 px-2 py-1 rounded-lg font-bold hover:bg-brand-rust hover:text-white transition-colors">EXCEL</button>
                    <button onClick={() => generarReporte(metricas.partidos_activos, 'Partidos_En_Vivo', 'pdf', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} className="text-[0.7rem] bg-brand-cream border border-brand-gold/30 px-2 py-1 rounded-lg font-bold hover:bg-brand-rust hover:text-white transition-colors">PDF</button>
                  </div>
                </div>
                <TableTools rows={metricas.partidos_activos} filteredRows={filasPartidosVivo} filter={getFilter('partidosVivo')} setFilter={setTableFilter('partidosVivo')} columns={[{ key: 'id', label: 'ID' }, { key: 'liga_nombre', label: 'Liga' }, { key: 'fecha_hora', label: 'Fecha y Hora' }]} categoryFields={['liga_nombre']} dateFields={['fecha_hora']} filename="superadmin_partidos_en_vivo" modulo="Superadmin" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                <div className="overflow-x-auto hide-scrollbar">
                  {cargandoPestana && filasPartidosVivo.length === 0 ? (
                    <div className="p-6"><SkeletonTabla filas={3} columnas={3} /></div>
                  ) : filasPartidosVivo.length === 0 ? (
                    <div className="p-6"><EmptyState icono="reloj" titulo="No hay partidos en vivo" descripcion="Cuando una liga comience un partido aparecerá aquí." /></div>
                  ) : (
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-red-50/50 text-red-700/70 uppercase text-[0.7rem] font-bold">
                        <tr><th scope="col" className="p-3 text-center">ID</th><th scope="col" className="p-3">Liga</th><th scope="col" className="p-3 text-center">Fecha y Hora</th></tr>
                      </thead>
                      <tbody className="divide-y divide-red-100 text-brand-brown font-medium">
                        {filasPartidosVivo.map(p => (
                          <tr key={p.id} className="hover:bg-red-50/30">
                            <td className="p-3 text-center text-red-600 font-bold">#{p.id}</td>
                            <td className="p-3">{p.liga_nombre || 'General / Suelto'}</td>
                            <td className="p-3 text-center">{formatearFecha(p.fecha_hora)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="bg-white border border-brand-gold/30 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-brand-cream/30 px-5 py-4 border-b border-brand-gold/30 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
                  <h3 className="text-brand-brown font-bold flex items-center gap-2">
                    <svg className="w-5 h-5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Partidos Agendados
                  </h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <select value={filtroLigaPartidos} onChange={(e) => setFiltroLigaPartidos(e.target.value)} className="text-sm p-1.5 border border-brand-gold/40 rounded bg-white text-brand-brown focus:ring-1 focus:ring-brand-rust outline-none">
                      <option value="todas">Todas las Ligas</option>
                      {ligas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                    </select>
                    <select value={filtroPeriodo} onChange={(e) => setFiltroPeriodo(e.target.value)} className="text-sm p-1.5 border border-brand-gold/40 rounded bg-white text-brand-brown focus:ring-1 focus:ring-brand-rust outline-none">
                      <option value="todos">Cualquier Fecha</option><option value="hoy">Para Hoy</option><option value="semana">Esta Semana</option><option value="mes">Este Mes</option>
                    </select>
                    <div className="flex gap-1 ml-auto">
                      <button onClick={() => generarReporte(partidosAgendadosFiltrados(), 'Partidos_Agendados', 'excel', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} className="px-2 py-1 bg-brand-rust text-white rounded-lg text-[0.7rem] font-bold hover:bg-brand-brown">EXCEL</button>
                      <button onClick={() => generarReporte(partidosAgendadosFiltrados(), 'Partidos_Agendados', 'pdf', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} className="px-2 py-1 bg-brand-rust text-white rounded-lg text-[0.7rem] font-bold hover:bg-brand-brown">PDF</button>
                    </div>
                  </div>
                </div>
                <TableTools rows={partidosAgendadosFiltrados()} filteredRows={filasAgendados} filter={getFilter('partidosAgendados')} setFilter={setTableFilter('partidosAgendados')} columns={[{ key: 'id', label: 'ID' }, { key: 'liga_nombre', label: 'Liga' }, { key: 'fecha_hora', label: 'Fecha y Hora' }]} filename="superadmin_partidos_agendados" modulo="Superadmin" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                <div className="overflow-x-auto hide-scrollbar">
                  {cargandoPestana && filasAgendados.length === 0 ? (
                    <div className="p-6"><SkeletonTabla filas={3} columnas={3} /></div>
                  ) : filasAgendados.length === 0 ? (
                    <div className="p-6"><EmptyState icono="calendario" titulo="No hay partidos agendados" descripcion="Ningún partido coincide con los filtros aplicados." /></div>
                  ) : (
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-brand-cream/10 text-brand-brown/70 uppercase text-[0.7rem] font-bold">
                        <tr><th scope="col" className="p-3 text-center">ID</th><th scope="col" className="p-3">Liga</th><th scope="col" className="p-3 text-center">Fecha y Hora</th></tr>
                      </thead>
                      <tbody className="divide-y divide-brand-gold/20 text-brand-brown font-medium">
                        {filasAgendados.map(p => (
                          <tr key={p.id} className="hover:bg-brand-cream/20 transition-colors">
                            <td className="p-3 text-center font-bold">#{p.id}</td>
                            <td className="p-3">{p.liga_nombre || 'General / Suelto'}</td>
                            <td className="p-3 text-center">{formatearFecha(p.fecha_hora)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PESTAÑA: CALENDARIO GLOBAL DE PARTIDOS */}
          {pestana === 'calendario' && (
            <div className="animate-fade-in space-y-6">
              <div className="bg-white border border-brand-gold/30 rounded-xl shadow-sm">
                <div className="bg-brand-cream/30 px-5 py-4 border-b border-brand-gold/30 flex justify-between items-center">
                  <h3 className="font-bold text-brand-brown flex items-center gap-2">
                    <svg className="w-5 h-5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Calendario Global de Partidos
                  </h3>
                  <span className="text-xs font-bold text-brand-brown/60">{partidosGlobales.length} partidos en el sistema</span>
                </div>
                <div className="p-4">
                  {cargandoPestana && partidosGlobales.length === 0 ? (
                    <SkeletonTarjetas cantidad={4} clasesGrid="grid-cols-1 md:grid-cols-2 xl:grid-cols-3" />
                  ) : partidosGlobales.length === 0 ? (
                    <EmptyState icono="calendario" titulo="Aún no hay partidos registrados" descripcion="Cuando las ligas agenden partidos aparecerán en este calendario." />
                  ) : (
                    <CalendarioPartidos partidos={partidosGlobales} sedesPorPartido={sedesGlobales} />
                  )}
                </div>
              </div>
            </div>
          )}

          {pestana === 'ligas' && (
            <div className="animate-fade-in space-y-6">
              {ligaDetalle ? (
                <div className="bg-white border border-brand-gold/30 p-6 rounded-xl shadow-sm">
                  <button onClick={() => setLigaDetalle(null)} className="mb-6 text-brand-gold font-bold flex items-center gap-2 text-sm hover:text-brand-brown transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg> Volver al Listado
                  </button>
                  <h2 className="text-2xl font-black text-brand-brown mb-2">{ligaDetalle.liga.nombre}</h2>
                  <p className="text-brand-brown/70 mb-6 font-medium">Administrador: <strong className="text-brand-blue">{ligaDetalle.liga.responsable_nombre}</strong> ({ligaDetalle.liga.responsable_email})</p>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="border border-brand-gold/20 rounded-lg p-4 bg-brand-cream/10">
                      <h4 className="font-bold text-brand-brown mb-3 border-b border-brand-gold/20 pb-2">Usuarios Registrados ({ligaDetalle.usuarios.length})</h4>
                      <ul className="space-y-2 text-sm text-brand-brown">
                        {ligaDetalle.usuarios.map(u => <li key={u.id} className="flex justify-between items-center"><span>{u.nombre}</span> <span className="text-xs bg-white px-2 py-1 rounded border border-brand-gold/20">{u.rol}</span></li>)}
                      </ul>
                    </div>
                    <div className="border border-brand-gold/20 rounded-lg p-4 bg-brand-cream/10">
                      <h4 className="font-bold text-brand-brown mb-3 border-b border-brand-gold/20 pb-2">Equipos Activos ({ligaDetalle.equipos.length})</h4>
                      <ul className="space-y-2 text-sm text-brand-brown list-disc pl-4 marker:text-brand-gold">
                        {ligaDetalle.equipos.map(eq => <li key={eq.id}>{eq.nombre}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bg-white border border-brand-gold/30 p-6 rounded-xl shadow-sm">
                    <h3 className="text-lg font-bold text-brand-brown mb-5 flex items-center gap-2">
                      {ligaEditando ? <svg className="w-5 h-5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> : <svg className="w-5 h-5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>}
                      {ligaEditando ? 'Editar Organización' : 'Registrar Nueva Organización'}
                    </h3>
                    <form onSubmit={ligaEditando ? actualizarLiga : guardarLiga} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <input type="text" placeholder="Nombre de la Liga" value={ligaEditando ? ligaEditando.nombre : formLiga.nombre} onChange={(e) => ligaEditando ? setLigaEditando({...ligaEditando, nombre: e.target.value}) : setFormLiga({...formLiga, nombre: e.target.value})} required className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-brand-cream/10 text-sm" />
                      <input type="text" placeholder="Teléfono" value={ligaEditando ? ligaEditando.responsable_telefono : formLiga.responsable_telefono} onChange={(e) => ligaEditando ? setLigaEditando({...ligaEditando, responsable_telefono: e.target.value}) : setFormLiga({...formLiga, responsable_telefono: e.target.value})} className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-brand-cream/10 text-sm" />
                      <input type="text" placeholder="Nombres del Administrador" value={ligaEditando ? ligaEditando.responsable_nombre : formLiga.responsable_nombre} onChange={(e) => ligaEditando ? setLigaEditando({...ligaEditando, responsable_nombre: e.target.value}) : setFormLiga({...formLiga, responsable_nombre: e.target.value})} required className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-brand-cream/10 text-sm" />
                      {!ligaEditando && <input type="text" placeholder="Apellidos del Administrador" value={formLiga.responsable_apellido} onChange={(e) => setFormLiga({...formLiga, responsable_apellido: e.target.value})} required className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-brand-cream/10 text-sm" />}
                      {!ligaEditando && <input type="text" placeholder="Cédula (Min 5, Max 8 dígitos)" pattern="\d{5,8}" value={formLiga.responsable_cedula} onChange={(e) => setFormLiga({...formLiga, responsable_cedula: e.target.value})} required title="Debe contener entre 5 y 8 números exactos" className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-brand-cream/10 text-sm" />}
                      <input type="email" placeholder="Correo Electrónico" value={ligaEditando ? ligaEditando.responsable_email : formLiga.responsable_email} onChange={(e) => ligaEditando ? setLigaEditando({...ligaEditando, responsable_email: e.target.value}) : setFormLiga({...formLiga, responsable_email: e.target.value})} required className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-brand-cream/10 text-sm" />
                      
                      <div className="md:col-span-2 flex gap-3 mt-2">
                        <button 
                          type="submit" 
                          disabled={isSubmitting}
                          className={`flex-1 text-white py-3 rounded-lg font-bold transition-colors shadow-sm ${isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-blue hover:bg-blue-700'}`}
                        >
                          {ligaEditando ? (isSubmitting ? 'Guardando Cambios...' : 'Guardar Cambios') : (isSubmitting ? 'Registrando...' : 'Registrar Organización')}
                        </button>
                        {ligaEditando && <button type="button" onClick={() => setLigaEditando(null)} className="flex-1 bg-gray-200 text-brand-brown py-3 rounded-lg font-bold hover:bg-gray-300 transition-colors">Cancelar</button>}
                      </div>
                    </form>
                  </div>

                  <div className="bg-white border border-brand-gold/30 rounded-xl overflow-hidden shadow-sm">
                    <div className="bg-brand-cream/30 px-5 py-4 border-b border-brand-gold/30 flex justify-between items-center">
                      <EncabezadoTabla titulo="Directorio de Ligas" total={filasLigas.length} />
                      <div className="flex gap-2">
                        <button onClick={() => exportarReporteActual('excel')} className="text-[0.7rem] bg-white border border-brand-gold/40 px-2 py-1 rounded-lg font-bold text-brand-brown hover:bg-brand-rust hover:text-white transition-colors">EXCEL</button>
                        <button onClick={() => exportarReporteActual('csv')} className="text-[0.7rem] bg-white border border-brand-gold/40 px-2 py-1 rounded-lg font-bold text-brand-brown hover:bg-brand-rust hover:text-white transition-colors">CSV</button>
                        <button onClick={() => exportarReporteActual('pdf')} className="text-[0.7rem] bg-white border border-brand-gold/40 px-2 py-1 rounded-lg font-bold text-brand-brown hover:bg-brand-rust hover:text-white transition-colors">PDF</button>
                      </div>
                    </div>
                    <TableTools rows={filasLigasBase} filteredRows={filasLigas} filter={getFilter('ligas')} setFilter={setTableFilter('ligas')} columns={[{ key: 'nombre', label: 'Nombre' }, { key: 'responsable_nombre', label: 'Administrador' }, { key: 'estado_liga', label: 'Estado' }]} categoryFields={['estado_liga']} filename="superadmin_directorio_ligas" modulo="Superadmin" reportContext={{ usuario: usuario?.nombre || usuario?.email || '' }} />
                    <div className="overflow-x-auto hide-scrollbar">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-brand-cream/10 text-brand-brown/70 uppercase text-xs font-bold">
                          <tr><th scope="col" className="p-4">Nombre</th><th scope="col" className="p-4">Administrador</th><th scope="col" className="p-4">Estado</th><th scope="col" className="p-4 text-center">Acciones</th></tr>
                        </thead>
                        <tbody className="divide-y divide-brand-gold/20 text-brand-brown">
                          {cargandoPestana && filasLigas.length === 0 ? (
                            <tr><td colSpan={4} className="p-5"><SkeletonTabla filas={5} columnas={4} /></td></tr>
                          ) : filasLigas.length === 0 ? (
                            <tr><td colSpan={4} className="p-0 border-0"><EmptyState icono="ligas" titulo="Aún no hay organizaciones" descripcion="Registra la primera liga desde el formulario de arriba." /></td></tr>
                          ) : pagLigas.filasPagina.map((l) => (
                            <tr key={l.id} className="hover:bg-brand-cream/10 transition-colors">
                              <td className="p-4 font-bold">{l.nombre}</td>
                              <td className="p-4">{l.responsable_nombre}</td>
                              <td className="p-4">
                                <span className={`px-2 py-1 rounded-full text-[0.7rem] font-bold uppercase tracking-wider ${l.estado_activa ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {l.estado_activa ? 'Activa' : 'Inactiva'}
                                </span>
                              </td>
                              <td className="p-4 flex gap-2 justify-center">
                                <button onClick={() => verInformacionLiga(l.id)} className="px-3 py-1.5 bg-brand-cream border border-brand-gold/40 text-brand-brown rounded hover:bg-brand-gold hover:text-white transition-colors text-xs font-bold">Ver Info</button>
                                <button onClick={() => setLigaEditando(l)} className="px-3 py-1.5 bg-brand-blue text-white rounded-lg hover:bg-brand-brown transition-colors text-xs font-bold">Editar</button>
                                <button onClick={() => setItemEliminar({ tipo: 'liga', id: l.id, nombre: l.nombre })} className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-xs font-bold">Eliminar</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <PaginacionTabla {...pagLigas} />
                  </div>

                  {/* LOTE 8B: ligas eliminadas (baja logica) con opcion de restaurar */}
                  <div className="bg-white border border-brand-gold/30 rounded-xl overflow-hidden shadow-sm">
                    <div className="bg-brand-cream/30 px-5 py-4 border-b border-brand-gold/30">
                      <h3 className="text-sm font-bold text-brand-brown uppercase tracking-wider">Ligas Eliminadas</h3>
                      <p className="text-xs text-brand-brown/70 mt-1">Las ligas eliminadas conservan sus datos históricos. Restaura una liga para devolverla al directorio con estado Activa y recuperar el acceso de sus usuarios.</p>
                    </div>
                    <div className="overflow-x-auto hide-scrollbar">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-brand-cream/10 text-brand-brown/70 uppercase text-xs font-bold">
                          <tr><th scope="col" className="p-4">Nombre</th><th scope="col" className="p-4">Administrador</th><th scope="col" className="p-4">Eliminada</th><th scope="col" className="p-4 text-center">Acciones</th></tr>
                        </thead>
                        <tbody className="divide-y divide-brand-gold/20 text-brand-brown">
                          {ligasEliminadas.length === 0 ? (
                            <tr><td colSpan={4} className="p-0 border-0"><EmptyState icono="ligas" titulo="No hay ligas eliminadas" descripcion="Cuando elimines una liga aparecerá aquí con la opción de restaurarla." /></td></tr>
                          ) : ligasEliminadas.map((l) => (
                            <tr key={l.id} className="hover:bg-brand-cream/10 transition-colors">
                              <td className="p-4 font-bold">{l.nombre}</td>
                              <td className="p-4">{l.responsable_nombre}</td>
                              <td className="p-4 text-xs text-brand-brown/70">{formatearFecha(l.eliminado_en)}</td>
                              <td className="p-4 flex gap-2 justify-center">
                                <button onClick={() => restaurarLiga(l)} disabled={restaurandoLiga === l.id} className="px-3 py-1.5 bg-brand-blue text-white rounded-lg hover:bg-brand-brown transition-colors text-xs font-bold disabled:bg-gray-400 disabled:cursor-not-allowed">{restaurandoLiga === l.id ? 'Restaurando...' : 'Restaurar'}</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {pestana === 'usuarios' && (
            <div className="animate-fade-in space-y-6">
              <div className="bg-white border border-brand-gold/30 p-6 rounded-xl shadow-sm">
                <h3 className="text-lg font-bold text-brand-brown mb-5 flex items-center gap-2">
                  {userEditando ? <svg className="w-5 h-5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> : <svg className="w-5 h-5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>}
                  {userEditando ? 'Editar Usuario' : 'Crear Usuario Manualmente'}
                </h3>
                
                {userEditando ? (
                  <form onSubmit={actualizarUsuario} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input type="text" placeholder="Nombre" value={userEditando.nombre || ''} onChange={(e) => setUserEditando({...userEditando, nombre: e.target.value})} required className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-brand-cream/10 text-sm" />
                    <input type="text" placeholder="Apellido" value={userEditando.apellido || ''} onChange={(e) => setUserEditando({...userEditando, apellido: e.target.value})} required className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-brand-cream/10 text-sm" />
                    <input type="text" placeholder="Cédula (Min 5, Max 8)" pattern="\d{5,8}" value={userEditando.cedula || ''} onChange={(e) => setUserEditando({...userEditando, cedula: e.target.value})} required className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-brand-cream/10 text-sm" />
                    <select value={userEditando.rol} onChange={(e) => setUserEditando({...userEditando, rol: e.target.value})} className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-white text-sm">
                      <option value="administrador de liga">Administrador de Liga</option><option value="arbitro">Árbitro</option><option value="anotador">Anotador</option><option value="delegado de equipo">Delegado de equipo</option><option value="Superadmin">Superadmin</option>
                    </select>
                    <select value={userEditando.organizacion_id || ''} onChange={(e) => setUserEditando({...userEditando, organizacion_id: e.target.value})} className="p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-white text-sm">
                      <option value="">-- Sin Liga Asignada --</option>{ligas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                    </select>
                    <div className="md:col-span-2 flex gap-3 mt-2">
                      <button 
                        type="submit" 
                        disabled={isSubmitting}
                        className={`flex-1 text-white py-3 rounded-lg font-bold transition-colors shadow-sm ${isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-blue hover:bg-blue-700'}`}
                      >
                        {isSubmitting ? 'Actualizando Datos...' : 'Actualizar Datos'}
                      </button>
                      <button type="button" onClick={() => setUserEditando(null)} className="flex-1 bg-gray-200 text-brand-brown py-3 rounded-lg font-bold hover:bg-gray-300 transition-colors">Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={guardarUsuario} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {formUser.rol.toLowerCase() === 'delegado de equipo' && formUser.organizacion_id && (
                      <div className="md:col-span-2 bg-brand-cream/30 p-4 rounded-lg border border-brand-gold/40 animate-fade-in">
                        <label className="block text-xs font-bold text-brand-brown uppercase tracking-wider mb-2">Asignación Inmediata de Equipo (Opcional):</label>
                        <select value={formUser.equipo_id} onChange={(e) => setFormUser({...formUser, equipo_id: e.target.value})} className="w-full p-3 rounded-lg border border-brand-gold/40 focus:ring-1 focus:ring-brand-rust outline-none bg-white text-sm">
                          <option value="">-- No asignar aún --</option>
                          {equiposLiga.map(e => <option key={e.id} value={e.id}>{e.nombre} ({e.categoria})</option>)}
                        </select>
                      </div>
                    )}
                    <button 
                      type="submit" 
                      disabled={isSubmitting}
                      className={`md:col-span-2 mt-2 text-white py-3 rounded-lg font-bold transition-colors shadow-sm ${isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-blue hover:bg-blue-700'}`}
                    >
                      {isSubmitting ? 'Registrando Usuario...' : 'Registrar Nuevo Usuario'}
                    </button>
                  </form>
                )}
              </div>

              <div className="bg-white border border-brand-gold/30 rounded-xl shadow-sm overflow-hidden">
                <div className="bg-brand-cream/30 px-5 py-4 border-b border-brand-gold/30 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
                  <EncabezadoTabla titulo="Directorio de Usuarios" />
                  <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                    <div className="relative w-full sm:w-64">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="w-4 h-4 text-brand-brown/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      </div>
                      <input type="text" placeholder="Buscar por nombre, cédula..." value={busquedaUsuario} onChange={(e) => setBusquedaUsuario(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-brand-gold/40 rounded-lg text-sm bg-white outline-none focus:ring-1 focus:ring-brand-rust" />
                    </div>
                    <div className="flex gap-2 bg-white border border-brand-gold/40 p-1 rounded-lg">
                      <button onClick={() => exportarReporteActual('excel')} className="text-[0.7rem] px-3 py-1 rounded-lg font-bold bg-brand-cream border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white transition-colors">EXCEL</button>
                      <button onClick={() => exportarReporteActual('csv')} className="text-[0.7rem] px-3 py-1 rounded-lg font-bold bg-brand-cream border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white transition-colors">CSV</button>
                      <button onClick={() => exportarReporteActual('pdf')} className="text-[0.7rem] px-3 py-1 rounded-lg font-bold bg-brand-cream border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white transition-colors">PDF</button>
                    </div>
                  </div>
                </div>
                <div className="p-5">
                  {renderListadoUsuarios()}
                </div>
              </div>
            </div>
          )}

          {pestana === 'bitacora' && (
            <div className="animate-fade-in bg-white border border-brand-gold/30 rounded-xl overflow-hidden shadow-sm">
              <div className="bg-brand-cream/30 px-5 py-4 border-b border-brand-gold/30 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <h3 className="font-bold text-brand-brown flex items-center gap-2">
                  <svg className="w-5 h-5 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                  Bitácora de Auditoría
                </h3>
                <div className="flex gap-2">
                  <button onClick={() => exportarReporteActual('excel')} className="text-xs bg-brand-cream border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded-lg font-bold hover:bg-brand-rust hover:text-white transition-colors">Exportar Excel</button>
                  <button onClick={() => exportarReporteActual('pdf')} className="text-xs bg-brand-cream border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded-lg font-bold hover:bg-brand-rust hover:text-white transition-colors">Exportar PDF</button>
                </div>
              </div>
              
              <div className="p-5 border-b border-brand-gold/20 flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-brand-brown/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </div>
                  <input type="text" placeholder="Buscar acción, usuario, tabla..." value={busquedaBitacora} onChange={(e) => setBusquedaBitacora(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-brand-gold/40 rounded-lg text-sm bg-white outline-none focus:ring-1 focus:ring-brand-rust" />
                </div>
                <select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)} className="w-full md:w-64 p-2 border border-brand-gold/40 rounded-lg bg-white text-sm outline-none focus:ring-1 focus:ring-brand-rust text-brand-brown">
                  <option value="">Todos los Roles</option><option value="Superadmin">Superadmin</option><option value="administrador de liga">Admin de Liga</option><option value="arbitro">Árbitro</option>
                </select>
                <input type="date" value={filtroFechaDesde} onChange={(e) => setFiltroFechaDesde(e.target.value)} className="w-full md:w-44 p-2 border border-brand-gold/40 rounded-lg bg-white text-sm outline-none focus:ring-1 focus:ring-brand-rust text-brand-brown" title="Desde" />
                <input type="date" value={filtroFechaHasta} onChange={(e) => setFiltroFechaHasta(e.target.value)} className="w-full md:w-44 p-2 border border-brand-gold/40 rounded-lg bg-white text-sm outline-none focus:ring-1 focus:ring-brand-rust text-brand-brown" title="Hasta" />
              </div>

              <div className="overflow-x-auto hide-scrollbar max-h-[60vh]">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-brand-cream/10 text-brand-brown/70 uppercase text-xs font-bold sticky top-0">
                    <tr><th scope="col" className="p-4 border-b border-brand-gold/30">Fecha</th><th scope="col" className="p-4 border-b border-brand-gold/30">Usuario</th><th scope="col" className="p-4 border-b border-brand-gold/30">Rol</th><th scope="col" className="p-4 border-b border-brand-gold/30">Acción</th><th scope="col" className="p-4 border-b border-brand-gold/30">Tabla</th><th scope="col" className="p-4 border-b border-brand-gold/30">Liga</th></tr>
                  </thead>
                  <tbody className="divide-y divide-brand-gold/10 text-brand-brown font-medium">
                    {cargandoPestana && bitacora.length === 0 ? (
                      <tr><td colSpan={6} className="p-0 border-0"><SkeletonTabla filas={6} columnas={6} compacto /></td></tr>
                    ) : bitacora.length === 0 ? (
                      <tr><td colSpan={6} className="p-0 border-0"><EmptyState icono="acta" titulo="Sin registros de auditoría" descripcion={busquedaBitacora || filtroRol || filtroFechaDesde || filtroFechaHasta ? 'Ningún evento coincide con los filtros aplicados.' : 'La actividad del sistema aparecerá registrada aquí.'} /></td></tr>
                    ) : (
                      bitacora.map(b => (
                        <tr key={b.id} className="hover:bg-brand-cream/5 transition-colors">
                          <td className="p-4 text-xs text-brand-brown/70">{formatearFechaHora(b.fecha)}</td>
                          <td className="p-4">{b.usuario_email}</td>
                          <td className="p-4"><span className="bg-brand-cream/50 px-2 py-0.5 rounded text-[0.7rem] font-bold border border-brand-gold/20">{b.usuario_rol}</span></td>
                          <td className="p-4 font-bold text-brand-blue">{b.accion_descripcion || b.accion}</td>
                          <td className="p-4 text-brand-brown/70">{b.tabla}</td>
                          <td className="p-4 text-brand-brown/70">{b.organizacion_nombre || '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {pestana === 'documentos' && (
            <div className="animate-fade-in space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                <h3 className="text-lg font-bold text-brand-brown mb-2 flex items-center gap-2">
                  <NavIcon nombre="documentos" />
                  Documentos Compartidos con Todas las Ligas
                </h3>
                <p className="text-sm text-brand-brown/70 mb-6">
                  Reglamentos, convocatorias y comunicados de carácter general. Cada documento subido aquí
                  queda visible y descargable para todas las ligas del sistema.
                </p>
                <form onSubmit={subirDocumentoGlobal} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-brand-brown mb-1">Título del documento</label>
                    <input
                      type="text"
                      value={formDocGlobal.titulo}
                      onChange={(e) => setFormDocGlobal({ ...formDocGlobal, titulo: e.target.value })}
                      required
                      maxLength={200}
                      className="w-full px-4 py-2.5 bg-brand-cream/20 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-rust focus:ring-2 focus:ring-brand-rust/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-brand-brown mb-1">Tipo de documento</label>
                    <select
                      value={formDocGlobal.tipo}
                      onChange={(e) => setFormDocGlobal({ ...formDocGlobal, tipo: e.target.value })}
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:outline-none focus:border-brand-rust focus:ring-2 focus:ring-brand-rust/20 transition-all"
                    >
                      <option value="Reglamento">Reglamento</option>
                      <option value="Convocatoria">Convocatoria</option>
                      <option value="Acta">Acta</option>
                      <option value="Inscripcion">Inscripción</option>
                      <option value="Comunicado">Comunicado</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 bg-brand-blue/10 text-brand-blue hover:bg-brand-blue hover:text-white px-4 py-2.5 rounded-lg font-semibold text-sm cursor-pointer transition-colors shadow-sm w-fit">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                      {archivoDocGlobal ? 'Cambiar archivo' : 'Seleccionar archivo'}
                      <input type="file" className="hidden" onChange={(e) => setArchivoDocGlobal(e.target.files?.[0] || null)} accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp" />
                    </label>
                    {archivoDocGlobal && <p className="mt-2 text-xs font-semibold text-brand-brown/70">{archivoDocGlobal.name} ({formatearTamanoDocGlobal(archivoDocGlobal.size)})</p>}
                  </div>
                  <div className="md:col-span-2">
                    <button type="submit" disabled={subiendoDocGlobal} className="bg-brand-rust text-white px-6 py-3 rounded-lg font-bold hover:bg-brand-brown transition-colors shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed">
                      {subiendoDocGlobal ? 'Subiendo...' : 'Compartir con Todas las Ligas'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                <h3 className="text-lg font-bold text-brand-brown mb-4">Repositorio Global</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-brand-cream/10 text-brand-brown/70 uppercase text-xs font-bold">
                      <tr>
                        <th scope="col" className="p-4 border-b border-brand-gold/30">Documento</th>
                        <th scope="col" className="p-4 border-b border-brand-gold/30">Tipo</th>
                        <th scope="col" className="p-4 border-b border-brand-gold/30">Subido por</th>
                        <th scope="col" className="p-4 border-b border-brand-gold/30">Tamaño</th>
                        <th scope="col" className="p-4 border-b border-brand-gold/30">Fecha</th>
                        <th scope="col" className="p-4 border-b border-brand-gold/30 text-center w-28">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-gold/10 text-brand-brown font-medium">
                      {cargandoPestana && documentosGlobales.length === 0 ? (
                        <tr><td colSpan={6} className="p-0 border-0"><SkeletonTabla filas={4} columnas={6} compacto /></td></tr>
                      ) : documentosGlobales.length === 0 ? (
                        <tr><td colSpan={6} className="p-0 border-0"><EmptyState icono="documentos" titulo="Aún no hay documentos globales" descripcion="Comparte el primer reglamento o comunicado para todas las ligas." /></td></tr>
                      ) : (
                        documentosGlobales.map(d => (
                          <tr key={d.id} className="group hover:bg-brand-cream/5 transition-colors">
                            <td className="p-4 font-bold">{d.titulo}</td>
                            <td className="p-4"><span className="bg-brand-cream text-brand-brown px-2 py-1 rounded-full text-xs font-bold border border-brand-gold/30">{d.tipo}</span></td>
                            <td className="p-4 text-brand-brown/80">{d.subido_por_nombre || 'N/D'}</td>
                            <td className="p-4 text-brand-brown/80">{formatearTamanoDocGlobal(d.tamano_bytes)}</td>
                            <td className="p-4 text-xs text-brand-brown/70">{d.creado_en ? d.creado_en.slice(0, 10).split('-').reverse().join('/') : ''}</td>
                            <td className="p-4 flex gap-2 justify-center">
                              <BotonAccionTabla titulo="Descargar" onClick={() => d.url_firmada && window.open(d.url_firmada, '_blank', 'noopener')} deshabilitado={!d.url_firmada}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg></BotonAccionTabla>
                              <BotonAccionTabla titulo="Eliminar" tono="peligro" onClick={() => eliminarDocumentoGlobal(d.id)}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></BotonAccionTabla>
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

        </div>
      </main>
    </div>
  );
}