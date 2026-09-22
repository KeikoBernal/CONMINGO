import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import SistemaMensajeria from './SistemaMensajeria';
import PlanillaUniversal from './PlanillaUniversal';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function DelegadoDashboard({ usuario, cerrarSesion }) {
  // Mantener la pestaña activa mediante localStorage
  const [pestana, setPestana] = useState(() => {
    return localStorage.getItem('delegado_pestana') || 'equipo';
  });
  
  const [menuAbierto, setMenuAbierto] = useState(false);
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

  const [token, setToken] = useState(null);

  // Datos del Delegado
  const [miEquipo, setMiEquipo] = useState(null);
  const [jugadores, setJugadores] = useState([]);
  const [partidos, setPartidos] = useState([]);
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
    try {
      if (pestana === 'equipo' || pestana === 'estadisticas') {
        const resEq = await fetchConToken('/mi-equipo');
        if (resEq.ok) {
          const data = await resEq.json();
          setMiEquipo(data.equipo);
          setJugadores(data.jugadores || []);
          if (data.estadisticas) setEstadisticas(data.estadisticas);
        }
      } 
      else if (pestana === 'calendario') {
        const resPart = await fetchConToken('/mis-partidos');
        if (resPart.ok) setPartidos(await resPart.json());
      }
    } catch (e) {
      setMensaje('Error conectando con el servidor.');
    }
  };

  const cargarPlanillaPartido = async (partidoId) => {
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

  const cambiarClaveObligatoria = async (e) => {
    e.preventDefault();
    
    if (isSubmittingPass) return;
    const claveSaneada = nuevaClave.trim();
    
    if (claveSaneada.length < 6) {
      return alert('La contraseña no puede contener puros espacios en blanco y debe tener al menos 6 caracteres válidos.');
    }
    
    setIsSubmittingPass(true);

    const res = await fetch(`${API_URL}/delegado/cambiar-password-propio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ nueva_password: claveSaneada })
    });
    
    setIsSubmittingPass(false); // Liberar bloqueo
    
    if (res.ok) {
      alert('Contraseña actualizada correctamente.');
      setDebeCambiarPass(false);
    } else {
      const data = await res.json();
      alert(data.error || 'Error al cambiar contraseña');
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
    if (!miEquipo || !estadisticas) return alert('Datos no disponibles.');
    if (!estadisticas.individual || estadisticas.individual.length === 0) return alert('No hay datos de jugadores registrados para generar el reporte de scouting.');
    
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

  const exportarPlanilla = async (partidoId, formato) => {
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
        let csv = `Encuentro,${partidoData.local_nombre} vs ${partidoData.visita_nombre}\nFecha,${new Date(partidoData.fecha_hora).toLocaleString('es-VE')}\n\nCedula,Nombre,Apellido,Dorsal,Equipo\n`;
        nominaData.forEach(j => {
          csv += `${j.cedula},"${j.nombre}","${j.apellido}",${j.numero_dorsal},"${j.equipo_nombre}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        descargarBlob(blob, `${nombreArchivo}.csv`);
      } else if (formato === 'excel') {
        let html = `<table border="1"><tr><th>Encuentro</th><th>${partidoData.local_nombre} vs ${partidoData.visita_nombre}</th></tr>`;
        html += `<tr><th>Fecha</th><th>${new Date(partidoData.fecha_hora).toLocaleString('es-VE')}</th></tr></table><br/>`;
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
      setMensaje('❌ Error al exportar la planilla.');
    }
  };

  // Íconos SVG para la barra lateral
  const NavIcon = ({ pestanaId }) => {
    switch (pestanaId) {
      case 'equipo': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
      case 'calendario': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
      case 'estadisticas': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
      default: return null;
    }
  };

  return (
    <div className="flex h-screen w-full bg-brand-cream font-sans overflow-hidden">
      
      <SistemaMensajeria usuario={usuario} token={token} />

      {/* MODAL DE CAMBIO DE CONTRASEÑA */}
      {debeCambiarPass && (
        <div className="fixed inset-0 bg-black/90 flex justify-center items-center z-50 p-4">
          <div className="bg-white p-8 rounded-xl w-full max-w-sm shadow-2xl">
            <h3 className="text-xl font-bold text-brand-brown mb-4 flex items-center gap-2">
              <svg className="w-6 h-6 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7z" /></svg>
              Actualización Obligatoria
            </h3>
            <p className="text-sm text-brand-brown/70 mb-4">Por razones de seguridad, debes actualizar tu contraseña temporal antes de gestionar tu equipo.</p>
            <form onSubmit={cambiarClaveObligatoria} className="space-y-4">
              <input type="password" placeholder="Nueva Contraseña (mín 6 chars)" className="w-full p-3 border border-brand-gold/30 rounded focus:ring-brand-rust focus:border-brand-rust" value={nuevaClave} onChange={e => setNuevaClave(e.target.value)} required minLength={6} />
              
              {/* MODIFICACIÓN: Botón con estado deshabilitado */}
              <button type="submit" disabled={isSubmittingPass} className={`w-full py-3 rounded text-white font-bold transition-colors ${isSubmittingPass ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-rust hover:bg-brand-brown'}`}>
                {isSubmittingPass ? 'Actualizando...' : 'Actualizar Contraseña'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SIDEBAR TIPO ADMIN */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-brand-brown text-brand-cream shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${menuAbierto ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:static md:shrink-0`}>
        
        {/* Identificación del Equipo */}
        <div className="p-6 border-b border-brand-gold/20 shrink-0 bg-brand-brown/50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-brand-cream/10 border border-brand-gold/50 flex items-center justify-center shrink-0 overflow-hidden">
              {miEquipo?.logo_url ? (
                <img src={miEquipo.logo_url} alt="Logo Equipo" className="w-full h-full object-cover" />
              ) : (
                <svg className="w-6 h-6 text-brand-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                </svg>
              )}
            </div>
            <div className="overflow-hidden">
              <h1 className="text-lg font-bold text-brand-cream truncate" title={miEquipo?.nombre || 'Cargando...'}>
                {miEquipo ? miEquipo.nombre : 'Cargando...'}
              </h1>
              <p className="text-xs text-brand-gold font-semibold uppercase tracking-wider mt-0.5">
                Panel Delegado
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 hide-scrollbar flex flex-col gap-6">
          <div>
            <div className="px-6 mb-2 text-xs font-bold text-brand-blue uppercase tracking-wider">Gestión Deportiva</div>
            <nav className="space-y-1">
              {[
                { id: 'equipo', label: 'Mi Equipo' },
                { id: 'calendario', label: 'Calendario y Puntajes' },
                { id: 'estadisticas', label: 'Analítica y Scouting' }
              ].map(item => {
                const isAnimating = animandoBoton === item.id;
                const isActive = pestana === item.id && !isAnimating;
                
                return (
                  <button 
                    key={item.id} 
                    onClick={() => cambiarPestanaConAnimacion(item.id)} 
                    className={`w-full px-6 py-3 text-sm font-medium transition-colors ${isActive ? 'bg-brand-rust/20 text-brand-gold border-r-4 border-brand-gold' : 'text-brand-cream/70 hover:bg-brand-cream/5 hover:text-brand-cream'}`}
                  >
                    <div className="flex items-center gap-3 w-full">
                      <div className={`w-6 h-6 flex items-center justify-center shrink-0 ${isAnimating ? 'anim-icono-bola' : ''}`}>
                        <NavIcon pestanaId={item.id} />
                      </div>
                      <span className={`transition-all ${isAnimating ? 'anim-texto-fade' : ''}`}>
                        {item.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="p-4 border-t border-brand-gold/20 shrink-0">
          <button onClick={cerrarSesion} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-cream/10 hover:bg-brand-rust text-brand-cream rounded transition-colors text-sm font-semibold">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* OVERLAY MOBILE */}
      {menuAbierto && (
        <div className="fixed inset-0 bg-brand-brown/50 z-30 md:hidden" onClick={() => setMenuAbierto(false)}></div>
      )}

      {/* ÁREA DE CONTENIDO PRINCIPAL */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-brand-cream relative">
        
        {/* HEADER SUPERIOR */}
        <header className="h-16 sm:h-20 bg-white border-b border-brand-gold/20 flex items-center justify-between px-6 shadow-sm shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setMenuAbierto(true)} className="md:hidden p-2 text-brand-brown hover:bg-brand-cream rounded-md">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <h2 className="text-2xl font-bold text-brand-brown hidden sm:block">
              {pestana === 'equipo' ? 'Mi Equipo' : pestana === 'calendario' ? 'Calendario y Puntajes' : 'Analítica y Scouting'}
            </h2>
          </div>
          <div className="hidden sm:block">
            {miEquipo && <span className="text-sm font-semibold text-brand-brown/70">{miEquipo.categoria} - {miEquipo.tipo_genero}</span>}
          </div>
        </header>

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
              <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-gold/20">
                <h3 className="text-lg font-bold text-brand-brown mb-4 flex items-center gap-2">
                  <NavIcon pestanaId="equipo" />
                  Nómina Oficial del Equipo
                </h3>
                <div className="overflow-x-auto">
                  <table className="tabla-admin">
                    <thead>
                      <tr>
                        <th className="text-center">Dorsal</th>
                        <th className="text-center">Foto</th>
                        <th>Jugador</th>
                        <th>Cédula</th>
                        <th>Rol</th>
                        <th className="text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jugadores.length === 0 ? (
                        <tr><td colSpan={6} className="text-center p-6 text-brand-brown/50">No hay jugadores registrados en tu equipo.</td></tr>
                      ) : (
                        jugadores.map(j => (
                          <tr key={j.id} className={j.estado === 'Inactivo' ? 'bg-gray-50 opacity-60' : ''}>
                            <td className="text-center font-bold text-lg text-brand-brown">#{j.numero_dorsal}</td>
                            <td className="text-center">
                              {j.foto_url ? (
                                <img src={j.foto_url} alt={`Foto`} className="w-10 h-10 rounded-full object-cover border border-brand-gold mx-auto" />
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
                      <button onClick={() => exportarPlanilla(datosPlanillaPartido.id, 'pdf')} className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-sm font-bold transition-colors shadow-sm">PDF</button>
                      <button onClick={() => exportarPlanilla(datosPlanillaPartido.id, 'excel')} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm font-bold transition-colors shadow-sm">Excel</button>
                      <button onClick={() => exportarPlanilla(datosPlanillaPartido.id, 'csv')} className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1.5 rounded text-sm font-bold transition-colors shadow-sm">CSV</button>
                      <button onClick={() => exportarPlanilla(datosPlanillaPartido.id, 'json')} className="bg-gray-700 hover:bg-gray-800 text-white px-3 py-1.5 rounded text-sm font-bold transition-colors shadow-sm">JSON</button>
                    </div>
                  </div>
                  <PlanillaUniversal
                    rol="espectador"
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
                      fecha: datosPlanillaPartido.fecha_hora ? new Date(datosPlanillaPartido.fecha_hora).toLocaleDateString('es-VE') : ''
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
                    <NavIcon pestanaId="calendario" />
                    Encuentros y Planillas de Puntajes
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {partidos.length === 0 ? (
                      <div className="col-span-full text-center py-8 text-brand-brown/50">Tu equipo no tiene partidos programados.</div>
                    ) : (
                      partidos.map(p => (
                        <div key={p.id} className={`flex flex-col justify-between p-5 rounded-xl border ${p.estado === 'Finalizado' ? 'border-brand-rust bg-brand-rust/5 shadow-sm ring-1 ring-brand-rust' : 'border-brand-gold/30 bg-white hover:border-brand-blue hover:shadow-sm'} transition-all`}>
                          <div>
                            <div className="flex justify-between items-center mb-3">
                              <span className="text-xs font-bold text-brand-blue uppercase tracking-wider">{p.fase}</span>
                              <span className="text-xs font-semibold bg-brand-cream text-brand-brown px-2 py-1 rounded border border-brand-gold/20">{p.estado}</span>
                            </div>
                            <h4 className="font-bold text-brand-brown text-lg mb-1">{p.local_nombre} <span className="text-brand-rust font-normal mx-1">vs</span> {p.visita_nombre}</h4>
                            <p className="text-sm text-brand-brown/70 mb-1 flex items-center gap-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> {new Date(p.fecha_hora).toLocaleString('es-VE')}</p>
                            <p className="text-sm text-brand-brown/70 mb-4 flex items-center gap-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg> {p.sede_nombre}</p>
                          </div>
                          
                          <div className="mt-auto space-y-2">
                            <button onClick={() => cargarPlanillaPartido(p.id)} className="w-full py-2 bg-brand-blue text-white rounded font-bold hover:bg-brand-brown transition-colors text-sm flex items-center justify-center gap-2">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              Ver Planilla Detallada
                            </button>
                            <div className="flex gap-2">
                              <button onClick={() => exportarPlanilla(p.id, 'pdf')} className="flex-1 bg-red-100 hover:bg-red-600 text-red-700 hover:text-white py-1.5 rounded text-xs font-bold transition-colors">PDF</button>
                              <button onClick={() => exportarPlanilla(p.id, 'excel')} className="flex-1 bg-green-100 hover:bg-green-600 text-green-700 hover:text-white py-1.5 rounded text-xs font-bold transition-colors">Excel</button>
                              <button onClick={() => exportarPlanilla(p.id, 'csv')} className="flex-1 bg-yellow-100 hover:bg-yellow-600 text-yellow-700 hover:text-white py-1.5 rounded text-xs font-bold transition-colors">CSV</button>
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
                  <NavIcon pestanaId="estadisticas" />
                  Centro de Scouting Avanzado
                </h3>
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm font-bold text-brand-brown self-center mr-2">Exportar Scouting:</span>
                  <button onClick={() => exportarScouting('excel')} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm font-bold transition-colors shadow-sm">Excel</button>
                  <button onClick={() => exportarScouting('csv')} className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1.5 rounded text-sm font-bold transition-colors shadow-sm">CSV</button>
                  <button onClick={() => exportarScouting('json')} className="bg-gray-700 hover:bg-gray-800 text-white px-3 py-1.5 rounded text-sm font-bold transition-colors shadow-sm">JSON</button>
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
                <div className="overflow-x-auto">
                  <table className="tabla-admin">
                    <thead>
                      <tr>
                        <th>Jugador</th>
                        <th className="text-center">% Arrime<br/><span className="text-xs font-normal text-brand-cream/70">[AB, AL, K]</span></th>
                        <th className="text-center">% Boche<br/><span className="text-xs font-normal text-brand-cream/70">[BB, BL, B]</span></th>
                        <th className="text-center bg-brand-brown/80 text-white">Tasa Error<br/><span className="text-xs font-normal text-white/70">[O, X, N]</span></th>
                        <th className="text-center">Pts/Juego</th>
                        <th className="text-center bg-brand-rust text-white">Clutch %<br/><span className="text-xs font-normal text-white/70">Cierres</span></th>
                        <th className="text-center">Perfil Sugerido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {estadisticas.individual.length === 0 ? (
                        <tr><td colSpan={7} className="text-center p-6 text-brand-brown/50">No hay suficientes datos de partidos para calcular el scouting.</td></tr>
                      ) : (
                        estadisticas.individual.map((j, idx) => (
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
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}