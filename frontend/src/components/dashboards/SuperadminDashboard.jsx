import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import SistemaMensajeria from './SistemaMensajeria';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function SuperadminDashboard({ usuario, cerrarSesion }) {
  const [pestana, setPestana] = useState(localStorage.getItem('superadminPestana') || 'metricas');
  const [menuAbierto, setMenuAbierto] = useState(false);
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
  const [ligaEditando, setLigaEditando] = useState(null);
  const [userEditando, setUserEditando] = useState(null);
  const [itemEliminar, setItemEliminar] = useState(null); 
  const [claveConfirmacion, setClaveConfirmacion] = useState('');

  const [equiposLiga, setEquiposLiga] = useState([]);
  
  const [formLiga, setFormLiga] = useState({ nombre: '', responsable_nombre: '', responsable_apellido: '', responsable_cedula: '', responsable_telefono: '', responsable_email: '' });
  const [formUser, setFormUser] = useState({ nombre: '', apellido: '', cedula: '', email: '', rol: 'administrador de liga', organizacion_id: '', equipo_id: '' });

  const [busquedaUsuario, setBusquedaUsuario] = useState('');
  const [busquedaBitacora, setBusquedaBitacora] = useState('');
  const [filtroRol, setFiltroRol] = useState('');
  const [filtroUsuarioId, setFiltroUsuarioId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [token, setToken] = useState(null);

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

  const cargarDatosPestana = async () => {
    setMensaje(null);
    try {
      if (pestana === 'metricas') {
        const resLigas = await fetchConToken('/ligas');
        if (resLigas.ok) setLigas(await resLigas.json());
        const res = await fetchConToken('/metricas');
        if (res.ok) setMetricas(await res.json());
      } else if (pestana === 'ligas') {
        const res = await fetchConToken('/ligas');
        if (res.ok) setLigas(await res.json());
      } else if (pestana === 'usuarios') {
        const resLigas = await fetchConToken('/ligas');
        if (resLigas.ok) setLigas(await resLigas.json());
        const resUsers = await fetchConToken('/usuarios');
        if (resUsers.ok) setUsuariosList(await resUsers.json());
      } else if (pestana === 'bitacora') {
        const resUsers = await fetchConToken('/usuarios');
        if (resUsers.ok) setUsuariosList(await resUsers.json());
        const res = await fetchConToken(`/bitacora?rol=${filtroRol}&usuario_id=${filtroUsuarioId}&busqueda=${encodeURIComponent(busquedaBitacora)}`);
        if (res.ok) setBitacora(await res.json());
      }
    } catch (err) { setMensaje({ texto: 'Error conectando con el servidor.', tipo: 'error' }); }
  };

  useEffect(() => { cargarDatosPestana(); }, [pestana, filtroRol, filtroUsuarioId, busquedaBitacora]);

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

  const exportarRespaldoBD = async (formato) => {
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
      doc.setFontSize(16);
      doc.text(`Reporte de ${titulo} - Sistema CONMINGO`, 14, 20);
      doc.setFontSize(10);
      doc.text(`Fecha de generación: ${new Date().toLocaleString()}`, 14, 28);
      const filasPDF = datos.map(item => pdfColumnas.map(col => item[col.key] || 'N/A'));
      const cabecerasPDF = pdfColumnas.map(col => col.label);
      autoTable(doc, {
        startY: 35, head: [cabecerasPDF], body: filasPDF, theme: 'grid',
        headStyles: { fillColor: [43, 108, 176] }, styles: { fontSize: 8 }
      });
      doc.save(`${nombreArchivo}.pdf`);
    }
  };

  const exportarReporteActual = (formato) => {
    if (pestana === 'ligas') {
      const configPDF = [{ label: 'Nombre Liga', key: 'nombre' }, { label: 'Administrador', key: 'responsable_nombre' }, { label: 'Teléfono', key: 'responsable_telefono' }, { label: 'Correo', key: 'responsable_email' }];
      generarReporte(ligas, 'Ligas_Organizaciones', formato, configPDF);
    } else if (pestana === 'usuarios') {
      const configPDF = [{ label: 'Nombre', key: 'nombre' }, { label: 'Apellido', key: 'apellido' }, { label: 'Cédula', key: 'cedula' }, { label: 'Rol', key: 'rol' }, { label: 'Correo', key: 'email' }];
      generarReporte(usuariosList, 'Usuarios_Sistema', formato, configPDF);
    } else if (pestana === 'bitacora') {
      const datosBitacora = bitacora.map(b => ({ Fecha: new Date(b.fecha).toLocaleString(), Usuario: b.usuario_email, Rol: b.usuario_rol, Accion: b.accion, Tabla: b.tabla }));
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

  const guardarLiga = async (e) => {
    e.preventDefault();
    if (isSubmitting) return; 
    setIsSubmitting(true);

    const payloadLimpio = {
      ...formLiga,
      nombre: formLiga.nombre.trim().replace(/\s+/g, ' '),
      responsable_nombre: formLiga.responsable_nombre.trim().replace(/\s+/g, ' '),
      responsable_apellido: formLiga.responsable_apellido.trim().replace(/\s+/g, ' '),
      responsable_email: formLiga.responsable_email.trim().toLowerCase()
    };

    const res = await fetchConToken('/ligas', { method: 'POST', body: JSON.stringify(payloadLimpio) });
    const data = await res.json();
    
    setIsSubmitting(false); 
    if (res.ok) {
      setMensaje({ texto: data.mensaje, tipo: 'exito' }); 
      setFormLiga({ nombre: '', responsable_nombre: '', responsable_apellido: '', responsable_cedula: '', responsable_telefono: '', responsable_email: '' });
      cargarDatosPestana();
    } else setMensaje({ texto: `Error: ${data.error}`, tipo: 'error' });
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

    const payloadLimpio = {
      ...formUser,
      nombre: formUser.nombre.trim().replace(/\s+/g, ' '),
      apellido: formUser.apellido.trim().replace(/\s+/g, ' '),
      email: formUser.email.trim().toLowerCase()
    };

    const res = await fetchConToken('/usuarios', { method: 'POST', body: JSON.stringify(payloadLimpio) });
    const data = await res.json();
    
    setIsSubmitting(false); 
    if (res.ok) {
      setMensaje({ texto: data.mensaje, tipo: 'exito' });
      setFormUser({ nombre: '', apellido: '', cedula: '', email: '', rol: 'administrador de liga', organizacion_id: '', equipo_id: '' });
      cargarDatosPestana();
    } else setMensaje({ texto: `Error: ${data.error}`, tipo: 'error' });
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
    if (!window.confirm(`¿Restablecer clave temporal a: ${primerNombre}${cincoDigitos}!?`)) return;
    const res = await fetchConToken(`/usuarios/${user.id}/reset-password`, { method: 'POST' });
    if (res.ok) { setMensaje({ texto: (await res.json()).mensaje, tipo: 'exito' }); cargarDatosPestana(); } 
    else setMensaje({ texto: `Error: ${(await res.json()).error}`, tipo: 'error' });
  };

  const iniciarEliminacionUsuario = async (u) => {
    setMensaje(null);
    try {
      const res = await fetchConToken(`/usuarios/${u.id}/verificar-eliminacion`);
      const data = await res.json();
      if (!res.ok) {
        setMensaje({ texto: data.error, tipo: 'error' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      setItemEliminar({ tipo: 'usuario', id: u.id, nombre: `${u.nombre || ''} (${u.email})` });
    } catch (error) { setMensaje({ texto: 'Error de red al intentar verificar.', tipo: 'error' }); }
  };

  const ejecutarEliminacion = async (e) => {
    e.preventDefault();
    if (!itemEliminar || !claveConfirmacion) return;
    const res = await fetchConToken(itemEliminar.tipo === 'liga' ? `/ligas/${itemEliminar.id}` : `/usuarios/${itemEliminar.id}`, { method: 'DELETE', body: JSON.stringify({ password: claveConfirmacion }) });
    const data = await res.json();
    if (res.ok) {
      setMensaje({ texto: data.mensaje, tipo: 'exito' }); setItemEliminar(null); setClaveConfirmacion('');
      if (ligaDetalle?.liga?.id === itemEliminar.id) setLigaDetalle(null);
      cargarDatosPestana();
    } else {
      setMensaje({ texto: data.error, tipo: 'error' }); 
    }
  };

  const ejecutarCerrarSesion = async () => {
    try { await fetchConToken('/log-evento', { method: 'POST', body: JSON.stringify({ accion: 'CERRAR_SESION', tabla: 'auth' }) }); } catch (e) {}
    cerrarSesion();
  };

  const isBuscando = busquedaUsuario.trim().length > 0;
  const usuariosMatchBusqueda = usuariosList.filter(u => `${u.nombre || ''} ${u.apellido || ''} ${u.email} ${u.cedula}`.toLowerCase().includes(busquedaUsuario.trim().toLowerCase()));

  const formatearFecha = (fechaIso) => {
    if (!fechaIso) return 'N/A';
    const fecha = new Date(fechaIso);
    return fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });
  };

  const renderTablaUsuarios = (arregloUsuarios) => (
    <div className="overflow-x-auto hide-scrollbar border border-brand-gold/30 rounded-lg">
      <table className="w-full text-left text-sm text-brand-brown whitespace-nowrap">
        <thead className="bg-brand-cream/50 text-brand-brown uppercase tracking-wider text-xs font-bold border-b border-brand-gold/30">
          <tr>
            <th className="p-4">Usuario</th>
            <th className="p-4">Cédula</th>
            <th className="p-4">Email</th>
            <th className="p-4">Rol</th>
            <th className="p-4">Liga</th>
            <th className="p-4 text-center">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-gold/20 bg-white">
          {arregloUsuarios.length === 0 ? (
            <tr><td colSpan={6} className="text-center p-8 text-brand-brown/50">No se encontraron usuarios.</td></tr>
          ) : (
            arregloUsuarios.map((u) => (
              <tr key={u.id} className="hover:bg-brand-cream/10 transition-colors">
                <td className="p-4 font-bold">{u.nombre} {u.apellido}</td>
                <td className="p-4">{u.cedula || 'N/R'}</td>
                <td className="p-4">{u.email}</td>
                <td className="p-4"><span className="px-2 py-1 bg-brand-cream/50 border border-brand-gold/20 rounded-md text-xs font-semibold">{u.rol}</span></td>
                <td className="p-4">{u.organizacion_nombre || 'General'}</td>
                <td className="p-4 flex gap-2 justify-center">
                  <button onClick={() => setUserEditando(u)} className="p-1.5 text-brand-blue hover:bg-brand-blue/10 rounded transition-colors" title="Editar">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                  </button>
                  <button onClick={() => resetearPasswordAccion(u)} className="p-1.5 text-brand-gold hover:bg-brand-gold/10 rounded transition-colors" title="Resetear Clave">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                  </button>
                  <button onClick={() => iniciarEliminacionUsuario(u)} className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors" title="Eliminar">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderListadoUsuarios = () => {
    if (isBuscando) return renderTablaUsuarios(usuariosMatchBusqueda);
    if (vistaUsuarios === 'ligas') {
      const ligasConGente = [{ id: 'null', nombre: 'Usuarios Generales / Sin Liga' }, ...ligas];
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {ligasConGente.map(l => (
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
            {rolesEnLiga.length === 0 ? <p className="text-brand-brown/50 text-sm p-4 col-span-full text-center border border-brand-gold/20 rounded-lg">No hay usuarios en esta liga.</p> : rolesEnLiga.map(r => (
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

  const NavIcon = ({ id }) => {
    switch (id) {
      case 'metricas': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
      case 'ligas': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>;
      case 'usuarios': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
      case 'bitacora': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
      default: return null;
    }
  };

  return (
    <div className="flex h-screen w-full bg-brand-cream font-sans overflow-hidden">
      <SistemaMensajeria usuario={usuario} token={token} />

      {/* MODAL ELIMINAR */}
      {itemEliminar && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-2000 p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl animate-slide-up border border-red-200">
            <h3 className="text-xl font-bold text-red-600 mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              Confirmar Eliminación
            </h3>
            <p className="text-sm text-brand-brown mb-4 leading-relaxed">
              Estás a punto de eliminar {itemEliminar.tipo === 'liga' ? 'la liga (y en cascada todos sus usuarios, equipos y partidos)' : 'al usuario'}: <strong className="text-red-600">{itemEliminar.nombre}</strong>.
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
                <button type="submit" className="flex-1 bg-red-600 text-white py-2.5 rounded-lg font-bold hover:bg-red-700 transition-colors shadow-sm">Eliminar Definitivamente</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SIDEBAR LATERAL */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-brand-brown text-brand-cream shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${menuAbierto ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static md:shrink-0`}>
        <div className="p-6 border-b border-brand-gold/20 shrink-0 bg-brand-brown/50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-brand-cream/10 border border-brand-gold/50 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            </div>
            <div className="overflow-hidden">
              <h1 className="text-base font-bold text-brand-cream truncate">Superadmin</h1>
              <p className="text-xs text-brand-gold font-semibold uppercase tracking-wider mt-0.5">Control Global</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 hide-scrollbar flex flex-col gap-6">
          <div>
            <div className="px-6 mb-2 text-xs font-bold text-brand-blue uppercase tracking-wider">Módulos del Sistema</div>
            <nav className="space-y-1">
              {['metricas', 'ligas', 'usuarios', 'bitacora'].map(item => {
                const isActive = pestana === item;
                return (
                  <button 
                    key={item} 
                    onClick={() => { setPestana(item); setLigaDetalle(null); setMenuAbierto(false); }} 
                    className={`w-full px-6 py-3 text-sm font-medium transition-colors flex items-center gap-3 capitalize ${isActive ? 'bg-brand-rust/20 text-brand-gold border-r-4 border-brand-gold' : 'text-brand-cream/70 hover:bg-brand-cream/5 hover:text-brand-cream'}`}
                  >
                    <NavIcon id={item} />
                    <span>{item}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-brand-gold/20 shrink-0">
          <button onClick={ejecutarCerrarSesion} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-cream/10 hover:bg-red-500 text-brand-cream rounded transition-colors text-sm font-semibold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {menuAbierto && <div className="fixed inset-0 bg-brand-brown/50 z-30 md:hidden" onClick={() => setMenuAbierto(false)}></div>}

      {/* CONTENEDOR PRINCIPAL */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-brand-cream relative overflow-y-auto">
        
        {/* HEADER SUPERIOR */}
        <header className="h-auto sm:h-20 py-4 sm:py-0 bg-white border-b border-brand-gold/20 flex flex-col sm:flex-row items-start sm:items-center justify-between px-6 shadow-sm shrink-0 gap-4">
          <div className="flex items-center gap-4 w-full sm:w-auto">
            <button onClick={() => setMenuAbierto(true)} className="md:hidden p-2 text-brand-brown hover:bg-brand-cream rounded-md">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <h2 className="text-xl font-bold text-brand-brown capitalize flex items-center gap-2">
              <NavIcon id={pestana} /> {pestana}
            </h2>
          </div>
          
          <div className="flex items-center gap-2 bg-brand-cream/30 p-1.5 rounded-lg border border-brand-gold/40 w-full sm:w-auto overflow-x-auto">
            <span className="text-xs font-bold text-brand-brown/70 ml-2 mr-1 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
              Respaldo BD:
            </span>
            <button onClick={() => exportarRespaldoBD('sql')} className="px-3 py-1.5 bg-brand-brown text-brand-cream rounded hover:bg-brand-brown/80 transition-colors text-xs font-bold">SQL</button>
            <button onClick={() => exportarRespaldoBD('json')} className="px-3 py-1.5 bg-brand-blue text-white rounded hover:bg-blue-700 transition-colors text-xs font-bold">JSON</button>
          </div>
        </header>

        {/* CONTENIDO PRINCIPAL */}
        <div className="p-4 md:p-6 flex-1 max-w-7xl mx-auto w-full">
          
          {mensaje && (
            <div className={`p-4 mb-6 rounded-lg font-medium text-sm flex items-center gap-2 animate-fade-in ${mensaje.tipo === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : mensaje.tipo === 'info' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
              {mensaje.tipo === 'error' && <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
              {mensaje.texto}
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
                    <button onClick={() => generarReporte(metricas.partidos_activos, 'Partidos_En_Vivo', 'excel', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} className="text-[0.7rem] bg-brand-cream border border-brand-gold/30 px-2 py-1 rounded font-bold hover:bg-brand-gold hover:text-white transition-colors">EXCEL</button>
                    <button onClick={() => generarReporte(metricas.partidos_activos, 'Partidos_En_Vivo', 'pdf', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} className="text-[0.7rem] bg-brand-cream border border-brand-gold/30 px-2 py-1 rounded font-bold hover:bg-brand-rust hover:text-white transition-colors">PDF</button>
                  </div>
                </div>
                <div className="overflow-x-auto hide-scrollbar">
                  {metricas.partidos_activos.length === 0 ? (
                    <p className="p-6 text-center text-sm text-brand-brown/50 italic">No hay partidos en vivo.</p>
                  ) : (
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-red-50/50 text-red-700/70 uppercase text-[0.7rem] font-bold">
                        <tr><th className="p-3 text-center">ID</th><th className="p-3">Liga</th><th className="p-3 text-center">Fecha y Hora</th></tr>
                      </thead>
                      <tbody className="divide-y divide-red-100 text-brand-brown font-medium">
                        {metricas.partidos_activos.map(p => (
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
                      <button onClick={() => generarReporte(partidosAgendadosFiltrados(), 'Partidos_Agendados', 'excel', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} className="px-2 py-1 bg-green-600 text-white rounded text-[0.7rem] font-bold hover:bg-green-700">EXCEL</button>
                      <button onClick={() => generarReporte(partidosAgendadosFiltrados(), 'Partidos_Agendados', 'pdf', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} className="px-2 py-1 bg-brand-rust text-white rounded text-[0.7rem] font-bold hover:bg-red-700">PDF</button>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto hide-scrollbar">
                  {partidosAgendadosFiltrados().length === 0 ? (
                    <p className="p-6 text-center text-sm text-brand-brown/50 italic">No hay partidos agendados bajo estos filtros.</p>
                  ) : (
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-brand-cream/10 text-brand-brown/70 uppercase text-[0.7rem] font-bold">
                        <tr><th className="p-3 text-center">ID</th><th className="p-3">Liga</th><th className="p-3 text-center">Fecha y Hora</th></tr>
                      </thead>
                      <tbody className="divide-y divide-brand-gold/20 text-brand-brown font-medium">
                        {partidosAgendadosFiltrados().map(p => (
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
                      <h3 className="font-bold text-brand-brown">Directorio de Ligas</h3>
                      <div className="flex gap-2">
                        <button onClick={() => exportarReporteActual('excel')} className="text-[0.7rem] bg-white border border-brand-gold/40 px-2 py-1 rounded font-bold hover:bg-green-500 hover:text-white transition-colors">EXCEL</button>
                        <button onClick={() => exportarReporteActual('csv')} className="text-[0.7rem] bg-white border border-brand-gold/40 px-2 py-1 rounded font-bold hover:bg-yellow-500 hover:text-white transition-colors">CSV</button>
                        <button onClick={() => exportarReporteActual('pdf')} className="text-[0.7rem] bg-white border border-brand-gold/40 px-2 py-1 rounded font-bold hover:bg-brand-rust hover:text-white transition-colors">PDF</button>
                      </div>
                    </div>
                    <div className="overflow-x-auto hide-scrollbar">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-brand-cream/10 text-brand-brown/70 uppercase text-xs font-bold">
                          <tr><th className="p-4">Nombre</th><th className="p-4">Administrador</th><th className="p-4">Estado</th><th className="p-4 text-center">Acciones</th></tr>
                        </thead>
                        <tbody className="divide-y divide-brand-gold/20 text-brand-brown">
                          {ligas.map((l) => (
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
                                <button onClick={() => setLigaEditando(l)} className="px-3 py-1.5 bg-brand-blue text-white rounded hover:bg-blue-700 transition-colors text-xs font-bold">Editar</button>
                                <button onClick={() => setItemEliminar({ tipo: 'liga', id: l.id, nombre: l.nombre })} className="px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-xs font-bold">Eliminar</button>
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
                  <h3 className="font-bold text-brand-brown">Directorio de Usuarios</h3>
                  <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                    <div className="relative w-full sm:w-64">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="w-4 h-4 text-brand-brown/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      </div>
                      <input type="text" placeholder="Buscar por nombre, cédula..." value={busquedaUsuario} onChange={(e) => setBusquedaUsuario(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-brand-gold/40 rounded-lg text-sm bg-white outline-none focus:ring-1 focus:ring-brand-rust" />
                    </div>
                    <div className="flex gap-2 bg-white border border-brand-gold/40 p-1 rounded-lg">
                      <button onClick={() => exportarReporteActual('excel')} className="text-[0.7rem] px-3 py-1 rounded font-bold bg-green-50 text-green-700 hover:bg-green-600 hover:text-white transition-colors">EXCEL</button>
                      <button onClick={() => exportarReporteActual('csv')} className="text-[0.7rem] px-3 py-1 rounded font-bold bg-yellow-50 text-yellow-700 hover:bg-yellow-500 hover:text-white transition-colors">CSV</button>
                      <button onClick={() => exportarReporteActual('pdf')} className="text-[0.7rem] px-3 py-1 rounded font-bold bg-red-50 text-red-700 hover:bg-brand-rust hover:text-white transition-colors">PDF</button>
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
                  <button onClick={() => exportarReporteActual('excel')} className="text-xs bg-brand-cream border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded font-bold hover:bg-green-600 hover:text-white transition-colors">Exportar Excel</button>
                  <button onClick={() => exportarReporteActual('pdf')} className="text-xs bg-brand-cream border border-brand-gold/40 text-brand-brown px-3 py-1.5 rounded font-bold hover:bg-brand-rust hover:text-white transition-colors">Exportar PDF</button>
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
              </div>

              <div className="overflow-x-auto hide-scrollbar max-h-[60vh]">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-brand-cream/10 text-brand-brown/70 uppercase text-xs font-bold sticky top-0">
                    <tr><th className="p-4 border-b border-brand-gold/30">Fecha</th><th className="p-4 border-b border-brand-gold/30">Usuario</th><th className="p-4 border-b border-brand-gold/30">Rol</th><th className="p-4 border-b border-brand-gold/30">Acción</th><th className="p-4 border-b border-brand-gold/30">Tabla</th></tr>
                  </thead>
                  <tbody className="divide-y divide-brand-gold/10 text-brand-brown font-medium">
                    {bitacora.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-brand-brown/50">No hay registros de auditoría para estos filtros.</td></tr>
                    ) : (
                      bitacora.map(b => (
                        <tr key={b.id} className="hover:bg-brand-cream/5 transition-colors">
                          <td className="p-4 text-xs text-brand-brown/70">{new Date(b.fecha).toLocaleString('es-VE')}</td>
                          <td className="p-4">{b.usuario_email}</td>
                          <td className="p-4"><span className="bg-brand-cream/50 px-2 py-0.5 rounded text-[0.7rem] font-bold border border-brand-gold/20">{b.usuario_rol}</span></td>
                          <td className="p-4 font-bold text-brand-blue">{b.accion}</td>
                          <td className="p-4 text-brand-brown/70">{b.tabla}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}