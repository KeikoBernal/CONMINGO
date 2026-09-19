import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import SistemaMensajeria from './SistemaMensajeria';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function SuperadminDashboard({ usuario, cerrarSesion }) {
  const [pestana, setPestana] = useState('metricas');
  const [mensaje, setMensaje] = useState('');

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

  const [token, setToken] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setToken(session?.access_token); });
  }, []);

  const fetchConToken = async (endpoint, options = {}) => {
    return await fetch(`${API_URL}/superadmin${endpoint}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...options.headers },
    });
  };

  const cargarDatosPestana = async () => {
    if (!token) return;
    setMensaje('');
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
    } catch (err) { setMensaje('Error conectando con el servidor.'); }
  };

  useEffect(() => { cargarDatosPestana(); }, [pestana, filtroRol, filtroUsuarioId, busquedaBitacora, token]);

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


  // ==========================================
  // 1. RESPALDO GLOBAL DEL SISTEMA (SQL / JSON)
  // ==========================================
  const exportarRespaldoBD = async (formato) => {
    setMensaje('Generando volcado de base de datos...');
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
        
        // Iterar sobre cada tabla recibida desde el backend
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
      setMensaje(`✅ Respaldo ${formato.toUpperCase()} generado correctamente.`);
    } catch (error) {
      setMensaje('⚠️ Error al generar el respaldo de la base de datos.');
    }
  };

  // ==========================================
  // 2. GENERADOR DINÁMICO DE REPORTES (EXCEL, CSV, PDF)
  // ==========================================
  const generarReporte = (datos, titulo, formato, pdfColumnas) => {
    if (!datos || datos.length === 0) {
      setMensaje('⚠️ No hay datos para exportar en esta vista.');
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
      const doc = new jsPDF('landscape'); // Horizontal
      doc.setFontSize(16);
      doc.text(`Reporte de ${titulo} - Sistema CONMINGO`, 14, 20);
      doc.setFontSize(10);
      doc.text(`Fecha de generación: ${new Date().toLocaleString()}`, 14, 28);

      const filasPDF = datos.map(item => pdfColumnas.map(col => item[col.key] || 'N/A'));
      const cabecerasPDF = pdfColumnas.map(col => col.label);

      autoTable(doc, {
        startY: 35,
        head: [cabecerasPDF],
        body: filasPDF,
        theme: 'grid',
        headStyles: { fillColor: [43, 108, 176] },
        styles: { fontSize: 8 }
      });
      doc.save(`${nombreArchivo}.pdf`);
    }
  };

  // Funciones específicas para enviar los datos correctos según la pestaña activa
  const exportarReporteActual = (formato) => {
    if (pestana === 'ligas') {
      const configPDF = [
        { label: 'Nombre Liga', key: 'nombre' }, { label: 'Administrador', key: 'responsable_nombre' },
        { label: 'Teléfono', key: 'responsable_telefono' }, { label: 'Correo', key: 'responsable_email' }
      ];
      generarReporte(ligas, 'Ligas_Organizaciones', formato, configPDF);
    } 
    else if (pestana === 'usuarios') {
      const configPDF = [
        { label: 'Nombre', key: 'nombre' }, { label: 'Apellido', key: 'apellido' },
        { label: 'Cédula', key: 'cedula' }, { label: 'Rol', key: 'rol' }, { label: 'Correo', key: 'email' }
      ];
      generarReporte(usuariosList, 'Usuarios_Sistema', formato, configPDF);
    }
    else if (pestana === 'bitacora') {
      const datosBitacora = bitacora.map(b => ({
        Fecha: new Date(b.fecha).toLocaleString(), Usuario: b.usuario_email, Rol: b.usuario_rol, 
        Accion: b.accion, Tabla: b.tabla
      }));
      const configPDF = [
        { label: 'Fecha', key: 'Fecha' }, { label: 'Usuario', key: 'Usuario' },
        { label: 'Rol', key: 'Rol' }, { label: 'Acción', key: 'Accion' }, { label: 'Tabla', key: 'Tabla' }
      ];
      generarReporte(datosBitacora, 'Auditoria_Bitacora', formato, configPDF);
    }
    else if (pestana === 'metricas') {
      setMensaje('⚠️ En Métricas, usa la exportación individual de la tabla que desees.');
    }
  };


  const partidosAgendadosFiltrados = () => {
    if (!metricas?.partidos_agendados) return [];
    let base = metricas.partidos_agendados;
    if (filtroLigaPartidos !== 'todas') base = base.filter(p => p.organizacion_id === filtroLigaPartidos);
    if (filtroPeriodo === 'todos') return base;
    const ahora = new Date();
    return base.filter((p) => {
      const fechaP = new Date(p.fecha_partido);
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
    const res = await fetchConToken('/ligas', { method: 'POST', body: JSON.stringify(formLiga) });
    const data = await res.json();
    if (res.ok) {
      setMensaje(data.mensaje); 
      setFormLiga({ nombre: '', responsable_nombre: '', responsable_apellido: '', responsable_cedula: '', responsable_telefono: '', responsable_email: '' });
      cargarDatosPestana();
    } else setMensaje(`Error: ${data.error}`);
  };

  const actualizarLiga = async (e) => {
    e.preventDefault();
    const res = await fetchConToken(`/ligas/${ligaEditando.id}`, { method: 'PUT', body: JSON.stringify(ligaEditando) });
    if (res.ok) { setMensaje('Liga actualizada.'); setLigaEditando(null); cargarDatosPestana(); }
  };

  const verInformacionLiga = async (id) => {
    const res = await fetchConToken(`/ligas/${id}/detalle`);
    if (res.ok) setLigaDetalle(await res.json()); else setMensaje('Error al obtener info.');
  };

  const guardarUsuario = async (e) => {
    e.preventDefault();
    const res = await fetchConToken('/usuarios', { method: 'POST', body: JSON.stringify(formUser) });
    const data = await res.json();
    if (res.ok) {
      setMensaje(data.mensaje);
      setFormUser({ nombre: '', apellido: '', cedula: '', email: '', rol: 'administrador de liga', organizacion_id: '', equipo_id: '' });
      cargarDatosPestana();
    } else setMensaje(`Error: ${data.error}`);
  };

  const actualizarUsuario = async (e) => {
    e.preventDefault();
    const res = await fetchConToken(`/usuarios/${userEditando.id}`, { method: 'PUT', body: JSON.stringify(userEditando) });
    if (res.ok) { setMensaje('Datos actualizados.'); setUserEditando(null); cargarDatosPestana(); }
  };

  const resetearPasswordAccion = async (user) => {
    const primerNombre = user.nombre ? user.nombre.trim().split(' ')[0] : 'User';
    const cincoDigitos = user.cedula ? user.cedula.trim().substring(0, 5) : '00000';
    if (!window.confirm(`¿Restablecer clave temporal a: ${primerNombre}${cincoDigitos}!?`)) return;
    const res = await fetchConToken(`/usuarios/${user.id}/reset-password`, { method: 'POST' });
    if (res.ok) { setMensaje((await res.json()).mensaje); cargarDatosPestana(); } else setMensaje(`Error: ${(await res.json()).error}`);
  };

  const iniciarEliminacionUsuario = async (u) => {
    setMensaje('');
    try {
      const res = await fetchConToken(`/usuarios/${u.id}/verificar-eliminacion`);
      const data = await res.json();
      
      if (!res.ok) {
        setMensaje(`⚠️ ${data.error}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      setItemEliminar({ tipo: 'usuario', id: u.id, nombre: `${u.nombre || ''} (${u.email})` });
    } catch (error) {
      setMensaje('⚠️ Error de red al intentar verificar el estado del usuario.');
    }
  };

  const ejecutarEliminacion = async (e) => {
    e.preventDefault();
    if (!itemEliminar || !claveConfirmacion) return;
    const res = await fetchConToken(itemEliminar.tipo === 'liga' ? `/ligas/${itemEliminar.id}` : `/usuarios/${itemEliminar.id}`, { method: 'DELETE', body: JSON.stringify({ password: claveConfirmacion }) });
    const data = await res.json();
    if (res.ok) {
      setMensaje(data.mensaje); setItemEliminar(null); setClaveConfirmacion('');
      if (ligaDetalle?.liga?.id === itemEliminar.id) setLigaDetalle(null);
      cargarDatosPestana();
    } else {
      setMensaje(`⚠️ Error: ${data.error}`); 
    }
  };

  const ejecutarCerrarSesion = async () => {
    try { await fetchConToken('/log-evento', { method: 'POST', body: JSON.stringify({ accion: 'CERRAR_SESION', tabla: 'auth' }) }); } catch (e) {}
    cerrarSesion();
  };

  const isBuscando = busquedaUsuario.trim().length > 0;
  const usuariosMatchBusqueda = usuariosList.filter(u => `${u.nombre || ''} ${u.apellido || ''} ${u.email} ${u.cedula}`.toLowerCase().includes(busquedaUsuario.trim().toLowerCase()));

  const renderListadoUsuarios = () => {
    if (isBuscando) return renderTablaUsuarios(usuariosMatchBusqueda);
    if (vistaUsuarios === 'ligas') {
      const ligasConGente = [{ id: 'null', nombre: 'Usuarios Generales / Sin Liga' }, ...ligas];
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px' }}>
          {ligasConGente.map(l => (
            <div key={l.id} onClick={() => { setUsuLigaSel(l.id === 'null' ? null : l.id); setVistaUsuarios('roles'); }} style={{ background: '#FFF', border: '1px solid #CBD5E0', padding: '20px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <h4 style={{ margin: 0, color: '#2B6CB0' }}>{l.nombre}</h4>
              <p style={{ fontSize: '0.85em', color: '#718096', margin: '10px 0 0 0' }}>Clic para ver roles ➡️</p>
            </div>
          ))}
        </div>
      );
    }
    if (vistaUsuarios === 'roles') {
      const usuariosDeLaLiga = usuariosList.filter(u => u.organizacion_id === usuLigaSel);
      const rolesEnLiga = [...new Set(usuariosDeLaLiga.map(u => u.rol))];
      return (
        <div>
          <button onClick={() => setVistaUsuarios('ligas')} style={{ marginBottom: '15px' }}>⬅️ Volver a Ligas</button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
            {rolesEnLiga.length === 0 ? <p>No hay usuarios en esta liga.</p> : rolesEnLiga.map(r => (
              <div key={r} onClick={() => { setUsuRolSel(r); setVistaUsuarios('tabla'); }} style={{ background: '#EBF8FF', border: '1px solid #90CDF4', padding: '15px', borderRadius: '8px', cursor: 'pointer', textAlign: 'center' }}>
                <h4 style={{ margin: 0, color: '#2C5282' }}>{r}s</h4>
                <p style={{ fontSize: '0.85em', color: '#4A5568', margin: '5px 0 0 0' }}>{usuariosDeLaLiga.filter(u => u.rol === r).length} personas</p>
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (vistaUsuarios === 'tabla') {
      const usuariosFinales = usuariosList.filter(u => u.organizacion_id === usuLigaSel && u.rol === usuRolSel);
      return (
        <div>
          <button onClick={() => setVistaUsuarios('roles')} style={{ marginBottom: '15px' }}>⬅️ Volver a Roles</button>
          {renderTablaUsuarios(usuariosFinales)}
        </div>
      );
    }
  };

  const formatearFecha = (fechaIso) => {
    if (!fechaIso) return 'N/A';
    const fecha = new Date(fechaIso);
    return fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const renderTablaUsuarios = (arregloUsuarios) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
      <thead>
        <tr style={{ background: '#eee' }}>
          <th style={{ border: '1px solid #ddd', padding: '8px' }}>Usuario</th>
          <th style={{ border: '1px solid #ddd', padding: '8px' }}>Cédula</th>
          <th style={{ border: '1px solid #ddd', padding: '8px' }}>Email</th>
          <th style={{ border: '1px solid #ddd', padding: '8px' }}>Rol</th>
          <th style={{ border: '1px solid #ddd', padding: '8px' }}>Liga</th>
          <th style={{ border: '1px solid #ddd', padding: '8px' }}>Acciones</th>
        </tr>
      </thead>
      <tbody>
        {arregloUsuarios.length === 0 ? (
          <tr><td colSpan={6} style={{ textAlign: 'center', padding: '15px', color: '#666' }}>No se encontraron usuarios.</td></tr>
        ) : (
          arregloUsuarios.map((u) => (
            <tr key={u.id}>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}><strong>{u.nombre} {u.apellido}</strong></td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{u.cedula || 'N/R'}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{u.email}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{u.rol}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px' }}>{u.organizacion_nombre || 'General'}</td>
              <td style={{ border: '1px solid #ddd', padding: '8px', display: 'flex', gap: '5px' }}>
                <button onClick={() => setUserEditando(u)}>Editar</button>
                <button onClick={() => resetearPasswordAccion(u)}>Reset Clave</button>
                <button onClick={() => iniciarEliminacionUsuario(u)} style={{ background: '#E53E3E', color: '#fff', border: 'none', borderRadius: '3px', padding: '3px 8px', cursor: 'pointer' }}>Eliminar</button>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  return (
  <div style={{ fontFamily: 'sans-serif', maxWidth: '1100px', margin: '0 auto', padding: '10px' }}>
    <SistemaMensajeria usuario={usuario} token={token} />
      
      {/* CABECERA: SISTEMA DE RESPALDO GLOBAL */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h2>🛡️ Panel de Superadmin</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '5px', background: '#E2E8F0', padding: '6px 12px', borderRadius: '6px', alignItems: 'center', border: '1px solid #CBD5E0' }}>
            <span style={{ fontSize: '0.85em', fontWeight: 'bold', color: '#2D3748', marginRight: '5px' }}>⚙️ Respaldo Total BD:</span>
            <button onClick={() => exportarRespaldoBD('sql')} style={{ background: '#4A5568', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em', fontWeight: 'bold' }}>SQL</button>
            <button onClick={() => exportarRespaldoBD('json')} style={{ background: '#2B6CB0', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em', fontWeight: 'bold' }}>JSON</button>
          </div>
          <button onClick={ejecutarCerrarSesion} style={{ background: '#E53E3E', color: '#FFF', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Cerrar Sesión</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
        {['metricas', 'ligas', 'usuarios', 'bitacora'].map((p) => (
          <button key={p} onClick={() => { setPestana(p); setLigaDetalle(null); }} style={{ padding: '8px 14px', cursor: 'pointer', fontWeight: pestana === p ? 'bold' : 'normal', borderBottom: pestana === p ? '3px solid #2B6CB0' : 'none', background: pestana === p ? '#EBF8FF' : 'transparent' }}>
            {p.toUpperCase()}
          </button>
        ))}
      </div>

      {mensaje && (
        <div style={{ padding: '10px', marginBottom: '15px', borderRadius: '4px', backgroundColor: mensaje.includes('Error') || mensaje.includes('⚠️') ? '#FED7D7' : '#C6F6D5', color: mensaje.includes('Error') || mensaje.includes('⚠️') ? '#9B2C2C' : '#22543D' }}>{mensaje}</div>
      )}

      {itemEliminar && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '8px', maxWidth: '400px', width: '90%', color: '#333' }}>
            <h3 style={{ marginTop: 0, color: '#C53030' }}>⚠️ Confirmar Eliminación</h3>
            <p>Estás a punto de eliminar {itemEliminar.tipo === 'liga' ? 'la liga (y en cascada todos sus usuarios, equipos y partidos)' : 'al usuario'}: <strong>{itemEliminar.nombre}</strong>.</p>
            <form onSubmit={ejecutarEliminacion} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '15px' }}>
              <input type="password" placeholder="Contraseña Superadmin" value={claveConfirmacion} onChange={(e) => setClaveConfirmacion(e.target.value)} required autoFocus style={{ padding: '8px' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" onClick={() => { setItemEliminar(null); setClaveConfirmacion(''); }}>Cancelar</button>
                <button type="submit" style={{ background: '#E53E3E', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer' }}>Eliminar Definitivamente</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MÉTRICAS */}
      {pestana === 'metricas' && metricas && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3>📊 Resumen Global</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', marginBottom: '25px' }}>
            <div style={{ border: '1px solid #E2E8F0', padding: '15px', borderRadius: '8px', textAlign: 'center', background: '#FFF' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#4A5568' }}>Ligas</h4>
              <p style={{ fontSize: '2.5em', margin: 0, color: '#2B6CB0', fontWeight: 'bold' }}>{metricas.total_ligas}</p>
              <small style={{ color: '#718096' }}>{metricas.ligas_activas} Activas</small>
            </div>
            <div style={{ border: '1px solid #E2E8F0', padding: '15px', borderRadius: '8px', textAlign: 'center', background: '#FFF' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#4A5568' }}>Usuarios</h4>
              <p style={{ fontSize: '2.5em', margin: 0, color: '#2B6CB0', fontWeight: 'bold' }}>{metricas.total_usuarios}</p>
            </div>
            <div style={{ border: '1px solid #E2E8F0', padding: '15px', borderRadius: '8px', textAlign: 'center', background: '#FFF' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#4A5568' }}>Equipos</h4>
              <p style={{ fontSize: '2.5em', margin: 0, color: '#38A169', fontWeight: 'bold' }}>{metricas.total_equipos}</p>
            </div>
            <div style={{ border: '1px solid #E2E8F0', padding: '15px', borderRadius: '8px', textAlign: 'center', background: '#FFF' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#4A5568' }}>Jugadores</h4>
              <p style={{ fontSize: '2.5em', margin: 0, color: '#38A169', fontWeight: 'bold' }}>{metricas.total_jugadores}</p>
            </div>
          </div>

          <div style={{ marginBottom: '30px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ color: '#E53E3E' }}>🔴 Partidos en Vivo</h3>
              <div style={{ display: 'flex', gap: '5px' }}>
                <span style={{ fontSize: '0.8em', color: '#666', alignSelf: 'center' }}>Exportar listado:</span>
                <button onClick={() => generarReporte(metricas.partidos_activos, 'Partidos_En_Vivo', 'excel', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} style={{ padding: '4px 8px', fontSize: '0.8em' }}>Excel</button>
                <button onClick={() => generarReporte(metricas.partidos_activos, 'Partidos_En_Vivo', 'pdf', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} style={{ padding: '4px 8px', fontSize: '0.8em' }}>PDF</button>
              </div>
            </div>
            {metricas.partidos_activos.length === 0 ? <p style={{ fontStyle: 'italic', color: '#718096' }}>No hay partidos en vivo.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <thead>
                  <tr style={{ background: '#FED7D7' }}>
                    <th style={{ padding: '8px' }}>ID</th>
                    <th style={{ padding: '8px' }}>Liga</th>
                    <th style={{ padding: '8px' }}>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {metricas.partidos_activos.map((p) => (
                    <tr key={p.id}>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>#{p.id}</td>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>{p.liga_nombre || 'General'}</td>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>{formatearFecha(p.fecha_partido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3>📅 Partidos Agendados</h3>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <select value={filtroLigaPartidos} onChange={(e) => setFiltroLigaPartidos(e.target.value)} style={{ padding: '6px', borderRadius: '4px' }}>
                  <option value="todas">Todas las Ligas</option>
                  {ligas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
                <select value={filtroPeriodo} onChange={(e) => setFiltroPeriodo(e.target.value)} style={{ padding: '6px', borderRadius: '4px' }}>
                  <option value="todos">Cualquier Fecha</option>
                  <option value="hoy">Para Hoy</option>
                  <option value="semana">Esta Semana</option>
                  <option value="mes">Este Mes</option>
                </select>
                <div style={{ display: 'flex', gap: '5px', marginLeft: '10px' }}>
                  <button onClick={() => generarReporte(partidosAgendadosFiltrados(), 'Partidos_Agendados', 'excel', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} style={{ padding: '4px 8px', fontSize: '0.8em', background: '#38A169', color: '#fff', border: 'none', borderRadius: '3px' }}>Excel</button>
                  <button onClick={() => generarReporte(partidosAgendadosFiltrados(), 'Partidos_Agendados', 'pdf', [{label: 'ID', key: 'id'}, {label: 'Liga', key: 'liga_nombre'}])} style={{ padding: '4px 8px', fontSize: '0.8em', background: '#E53E3E', color: '#fff', border: 'none', borderRadius: '3px' }}>PDF</button>
                </div>
              </div>
            </div>

            {partidosAgendadosFiltrados().length === 0 ? (
              <p style={{ fontStyle: 'italic', color: '#666' }}>No hay partidos agendados bajo estos filtros.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <thead>
                  <tr style={{ background: '#EDF2F7' }}>
                    <th style={{ padding: '8px' }}>ID</th>
                    <th style={{ padding: '8px' }}>Liga</th>
                    <th style={{ padding: '8px' }}>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {partidosAgendadosFiltrados().map((p) => (
                    <tr key={p.id}>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>#{p.id}</td>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>{p.liga_nombre || 'General'}</td>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px', textAlign: 'center' }}>{formatearFecha(p.fecha_partido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* LIGAS */}
      {pestana === 'ligas' && (
        <div>
          {ligaDetalle ? (
            <div style={{ background: '#FFF', border: '1px solid #CBD5E0', padding: '20px', borderRadius: '6px' }}>
              <button onClick={() => setLigaDetalle(null)} style={{ marginBottom: '15px' }}>← Volver</button>
              <h2>{ligaDetalle.liga.nombre}</h2>
              <p><strong>Admin:</strong> {ligaDetalle.liga.responsable_nombre} ({ligaDetalle.liga.responsable_email})</p>
              <h4>Usuarios ({ligaDetalle.usuarios.length})</h4>
              <ul>{ligaDetalle.usuarios.map(u => <li key={u.id}>{u.nombre} - <strong>{u.rol}</strong></li>)}</ul>
              <h4>Equipos ({ligaDetalle.equipos.length})</h4>
              <ul>{ligaDetalle.equipos.map(eq => <li key={eq.id}>{eq.nombre}</li>)}</ul>
            </div>
          ) : (
            <>
              <h3>{ligaEditando ? '✏️ Editar Liga' : '🏆 Registrar Nueva Liga'}</h3>
              <form onSubmit={ligaEditando ? actualizarLiga : guardarLiga} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px', padding: '15px', background: '#F7FAFC', border: '1px solid #CBD5E0', borderRadius: '6px' }}>
                <input type="text" placeholder="Nombre Liga" value={ligaEditando ? ligaEditando.nombre : formLiga.nombre} onChange={(e) => ligaEditando ? setLigaEditando({...ligaEditando, nombre: e.target.value}) : setFormLiga({...formLiga, nombre: e.target.value})} required />
                <input type="text" placeholder="Teléfono" value={ligaEditando ? ligaEditando.responsable_telefono : formLiga.responsable_telefono} onChange={(e) => ligaEditando ? setLigaEditando({...ligaEditando, responsable_telefono: e.target.value}) : setFormLiga({...formLiga, responsable_telefono: e.target.value})} />
                <input type="text" placeholder="Nombres del Admin" value={ligaEditando ? ligaEditando.responsable_nombre : formLiga.responsable_nombre} onChange={(e) => ligaEditando ? setLigaEditando({...ligaEditando, responsable_nombre: e.target.value}) : setFormLiga({...formLiga, responsable_nombre: e.target.value})} required />
                {!ligaEditando && <input type="text" placeholder="Apellidos del Admin" value={formLiga.responsable_apellido} onChange={(e) => setFormLiga({...formLiga, responsable_apellido: e.target.value})} required />}
                {!ligaEditando && <input type="text" placeholder="Cédula (Min 5, Max 8 dígitos)" pattern="\d{5,8}" value={formLiga.responsable_cedula} onChange={(e) => setFormLiga({...formLiga, responsable_cedula: e.target.value})} required title="Debe contener entre 5 y 8 números exactos" />}
                <input type="email" placeholder="Correo" value={ligaEditando ? ligaEditando.responsable_email : formLiga.responsable_email} onChange={(e) => ligaEditando ? setLigaEditando({...ligaEditando, responsable_email: e.target.value}) : setFormLiga({...formLiga, responsable_email: e.target.value})} required />
                <div style={{ gridColumn: 'span 2' }}>
                  <button type="submit">{ligaEditando ? 'Guardar Cambios' : 'Registrar Liga'}</button>
                  {ligaEditando && <button type="button" onClick={() => setLigaEditando(null)}>Cancelar</button>}
                </div>
              </form>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ margin: 0 }}>Listado de Ligas</h3>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <span style={{ fontSize: '0.85em', fontWeight: 'bold', color: '#4A5568', alignSelf: 'center', marginRight: '5px' }}>📄 Reporte:</span>
                  <button onClick={() => exportarReporteActual('excel')} style={{ background: '#38A169', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em' }}>Excel</button>
                  <button onClick={() => exportarReporteActual('csv')} style={{ background: '#D69E2E', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em' }}>CSV</button>
                  <button onClick={() => exportarReporteActual('pdf')} style={{ background: '#E53E3E', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em' }}>PDF</button>
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                <thead><tr style={{ background: '#eee' }}><th>Nombre</th><th>Admin</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>
                  {ligas.map((l) => (
                    <tr key={l.id}>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}><strong>{l.nombre}</strong></td>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>{l.responsable_nombre}</td>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px' }}>{l.estado_activa ? '🟢 Activa' : '🔴 Inactiva'}</td>
                      <td style={{ borderBottom: '1px solid #ddd', padding: '8px', display: 'flex', gap: '5px' }}>
                        <button onClick={() => verInformacionLiga(l.id)}>Ver Info</button>
                        <button onClick={() => setLigaEditando(l)}>Editar</button>
                        <button onClick={() => setItemEliminar({ tipo: 'liga', id: l.id, nombre: l.nombre })} style={{ background: '#E53E3E', color: '#fff' }}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* USUARIOS */}
      {pestana === 'usuarios' && (
        <div>
          <h3>{userEditando ? '✏️ Editar Usuario' : '👤 Crear Usuario Manual'}</h3>
          {userEditando ? (
            <form onSubmit={actualizarUsuario} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
              <input type="text" placeholder="Nombre" value={userEditando.nombre || ''} onChange={(e) => setUserEditando({...userEditando, nombre: e.target.value})} required />
              <input type="text" placeholder="Apellido" value={userEditando.apellido || ''} onChange={(e) => setUserEditando({...userEditando, apellido: e.target.value})} required />
              <input type="text" placeholder="Cédula (Min 5, Max 8)" pattern="\d{5,8}" value={userEditando.cedula || ''} onChange={(e) => setUserEditando({...userEditando, cedula: e.target.value})} required />
              <select value={userEditando.rol} onChange={(e) => setUserEditando({...userEditando, rol: e.target.value})}>
                <option value="administrador de liga">Administrador de Liga</option><option value="arbitro">Árbitro</option><option value="anotador">Anotador</option><option value="delegado de equipo">Delegado de equipo</option><option value="Superadmin">Superadmin</option>
              </select>
              <select value={userEditando.organizacion_id || ''} onChange={(e) => setUserEditando({...userEditando, organizacion_id: e.target.value})}>
                <option value="">-- Sin Liga --</option>{ligas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
              <div style={{ gridColumn: 'span 2', display: 'flex', gap: '10px' }}><button type="submit">Actualizar</button><button type="button" onClick={() => setUserEditando(null)}>Cancelar</button></div>
            </form>
          ) : (
            <form onSubmit={guardarUsuario} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
              <input type="text" placeholder="Nombre" value={formUser.nombre} onChange={(e) => setFormUser({...formUser, nombre: e.target.value})} required />
              <input type="text" placeholder="Apellido" value={formUser.apellido} onChange={(e) => setFormUser({...formUser, apellido: e.target.value})} required />
              <input type="text" placeholder="Cédula (Min 5, Max 8 dígitos)" pattern="\d{5,8}" value={formUser.cedula} onChange={(e) => setFormUser({...formUser, cedula: e.target.value})} required />
              <input type="email" placeholder="Correo" value={formUser.email} onChange={(e) => setFormUser({...formUser, email: e.target.value})} required />
              
              <select value={formUser.rol} onChange={(e) => setFormUser({...formUser, rol: e.target.value})}>
                <option value="administrador de liga">Admin Liga</option><option value="arbitro">Árbitro</option><option value="anotador">Anotador</option><option value="delegado de equipo">Delegado de Equipo</option><option value="Superadmin">Superadmin</option>
              </select>
              
              <select value={formUser.organizacion_id} onChange={(e) => setFormUser({...formUser, organizacion_id: e.target.value})}>
                <option value="">-- Asignar Liga --</option>{ligas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>

              {formUser.rol.toLowerCase() === 'delegado de equipo' && formUser.organizacion_id && (
                <div style={{ gridColumn: 'span 2', background: '#EBF8FF', padding: '10px', borderRadius: '6px', border: '1px solid #90CDF4' }}>
                  <label style={{ display: 'block', fontSize: '0.85em', color: '#2B6CB0', fontWeight: 'bold', marginBottom: '5px' }}>Asignación Inmediata de Equipo (Opcional):</label>
                  <select value={formUser.equipo_id} onChange={(e) => setFormUser({...formUser, equipo_id: e.target.value})} style={{ width: '100%', padding: '6px' }}>
                    <option value="">-- No asignar aún --</option>
                    {equiposLiga.map(e => <option key={e.id} value={e.id}>{e.nombre} ({e.categoria})</option>)}
                  </select>
                </div>
              )}

              <button type="submit" style={{ gridColumn: 'span 2' }}>Crear Usuario</button>
            </form>
          )}

          <div style={{ background: '#F7FAFC', border: '1px solid #E2E8F0', padding: '15px', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>Navegación de Usuarios</h3>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                <input type="text" placeholder="🔍 Buscar directo..." value={busquedaUsuario} onChange={(e) => setBusquedaUsuario(e.target.value)} style={{ padding: '8px 12px', width: '200px' }} />
                <div style={{ display: 'flex', gap: '5px', background: '#E2E8F0', padding: '4px', borderRadius: '4px' }}>
                  <span style={{ fontSize: '0.8em', alignSelf: 'center', margin: '0 5px' }}>Exportar:</span>
                  <button onClick={() => exportarReporteActual('excel')} style={{ background: '#38A169', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '0.8em' }}>Excel</button>
                  <button onClick={() => exportarReporteActual('csv')} style={{ background: '#D69E2E', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '0.8em' }}>CSV</button>
                  <button onClick={() => exportarReporteActual('pdf')} style={{ background: '#E53E3E', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '0.8em' }}>PDF</button>
                </div>
              </div>
            </div>
            {renderListadoUsuarios()}
          </div>
        </div>
      )}

      {/* BITÁCORA */}
      {pestana === 'bitacora' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0 }}>🔍 Bitácora de Auditoría</h3>
            <div style={{ display: 'flex', gap: '5px' }}>
              <button onClick={() => exportarReporteActual('excel')} style={{ background: '#38A169', color: 'white', border: 'none', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em' }}>Exportar Excel</button>
              <button onClick={() => exportarReporteActual('pdf')} style={{ background: '#E53E3E', color: 'white', border: 'none', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em' }}>Exportar PDF</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginBottom: '15px' }}>
            <input type="text" placeholder="Buscar..." value={busquedaBitacora} onChange={(e) => setBusquedaBitacora(e.target.value)} />
            <select value={filtroRol} onChange={(e) => setFiltroRol(e.target.value)}><option value="">Todos los Roles</option><option value="Superadmin">Superadmin</option><option value="administrador de liga">Admin de Liga</option><option value="arbitro">Árbitro</option></select>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
            <thead><tr style={{ background: '#eee' }}><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Tabla</th></tr></thead>
            <tbody>
              {bitacora.map((b) => (
                <tr key={b.id}>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '6px' }}>{new Date(b.fecha).toLocaleString('es-VE')}</td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '6px' }}>{b.usuario_email}</td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '6px' }}>{b.usuario_rol}</td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '6px' }}><strong>{b.accion}</strong></td>
                  <td style={{ borderBottom: '1px solid #ddd', padding: '6px' }}>{b.tabla}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}