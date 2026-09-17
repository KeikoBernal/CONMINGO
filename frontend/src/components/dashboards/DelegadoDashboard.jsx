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
  
  const [mensaje, setMensaje] = useState('');
  
  // Seguridad y Sesión
  const [debeCambiarPass, setDebeCambiarPass] = useState(false);
  const [nuevaClave, setNuevaClave] = useState('');
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
      if (res.status === 401) setMensaje('⚠️ Tu sesión ha expirado.');
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
    const res = await fetch(`${API_URL}/delegado/cambiar-password-propio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ nueva_password: nuevaClave })
    });
    if (res.ok) {
      alert('Contraseña actualizada correctamente.');
      setDebeCambiarPass(false);
    } else {
      const data = await res.json();
      alert(data.error || 'Error al cambiar contraseña');
    }
  };

  // ==========================================
  // EXPORTACIÓN DE SCOUTING A PDF
  // ==========================================
  const generarReportePDF = () => {
    if (!miEquipo) return alert('Datos del equipo no disponibles.');
    
    const doc = new jsPDF('landscape');
    
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`REPORTE DE SCOUTING Y RENDIMIENTO`, 14, 15);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Equipo: ${miEquipo.nombre} | Categoría: ${miEquipo.categoria} - ${miEquipo.tipo_genero}`, 14, 22);
    doc.text(`Fecha de Emisión: ${new Date().toLocaleDateString('es-VE')}`, 14, 28);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(`Métricas de Rendimiento Grupal`, 14, 40);

    const grupal = estadisticas.grupal || {};
    autoTable(doc, {
      startY: 45,
      head: [['Prom. Pts/Bolo', 'Diferencial Pts', 'Retención Punto', 'Tiempo Prom/Bolo', 'Desviación Estándar']],
      body: [[
        grupal.promedio_puntos_bolo || '0.0',
        grupal.diferencial_puntos > 0 ? `+${grupal.diferencial_puntos}` : (grupal.diferencial_puntos || '0'),
        `${grupal.porcentaje_retencion || 0}%`,
        `${grupal.tiempo_promedio_bolo || 0} min`,
        grupal.desviacion_estandar || '0.0'
      ]],
      theme: 'grid',
      headStyles: { fillColor: [43, 108, 176] },
      styles: { halign: 'center', fontSize: 10 }
    });

    let finalY = doc.lastAutoTable.finalY + 15;
    doc.text(`Scouting de Jugadores (Métricas Individuales)`, 14, finalY);

    const headInd = [['N°', 'Jugador', 'Efectividad Arrime', 'Efectividad Boche', 'Tasa de Error', 'Pts/Juego', 'Clutch %', 'Perfil Táctico']];
    const bodyInd = estadisticas.individual.map(j => [
      j.dorsal,
      `${j.apellido} ${j.nombre}`.toUpperCase(),
      `${j.efectividad_arrime || 0}%`,
      `${j.efectividad_boche || 0}%`,
      `${j.tasa_error || 0}%`,
      j.pts_promedio || '0.0',
      `${j.clutch || 0}%`,
      j.perfil_tactico || 'Equilibrado'
    ]);

    autoTable(doc, {
      startY: finalY + 5,
      head: headInd,
      body: bodyInd,
      theme: 'striped',
      headStyles: { fillColor: [45, 55, 72] },
      styles: { fontSize: 9, halign: 'center' },
      columnStyles: { 1: { halign: 'left' } }
    });

    doc.save(`Scouting_${miEquipo.nombre.replace(/\s+/g, '_')}.pdf`);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '15px' }}>
      
      <SistemaMensajeria usuario={usuario} token={token} />

      {debeCambiarPass && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000 }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', maxWidth: '400px', width: '90%' }}>
            <h3>🔒 Cambio Obligatorio de Contraseña</h3>
            <p style={{ fontSize: '0.9em', color: '#4A5568' }}>Por razones de seguridad, debes actualizar tu contraseña temporal antes de gestionar tu equipo.</p>
            <form onSubmit={cambiarClaveObligatoria} style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '15px' }}>
              <input type="password" placeholder="Nueva Contraseña (mín 6 caracteres)" value={nuevaClave} onChange={e => setNuevaClave(e.target.value)} required minLength={6} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #CBD5E0' }} />
              <button type="submit" style={{ background: '#3182CE', color: 'white', padding: '10px', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>Actualizar Contraseña</button>
            </form>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', background: '#2D3748', color: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        <div>
          <h1 style={{ margin: 0 }}>🛡️ Panel de Delegado</h1>
          <p style={{ margin: '5px 0 0 0', color: '#A0AEC0' }}>{miEquipo ? `${miEquipo.nombre} | ${miEquipo.categoria} - ${miEquipo.tipo_genero}` : 'Cargando equipo...'}</p>
        </div>
        <button onClick={cerrarSesion} style={{ padding: '10px 20px', background: '#E53E3E', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Cerrar Sesión</button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '25px', borderBottom: '2px solid #E2E8F0', paddingBottom: '10px' }}>
        <button onClick={() => setPestana('equipo')} style={{ padding: '10px 20px', border: 'none', background: pestana === 'equipo' ? '#3182CE' : 'transparent', color: pestana === 'equipo' ? 'white' : '#4A5568', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>👥 Mi Equipo</button>
        <button onClick={() => setPestana('calendario')} style={{ padding: '10px 20px', border: 'none', background: pestana === 'calendario' ? '#3182CE' : 'transparent', color: pestana === 'calendario' ? 'white' : '#4A5568', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>📅 Calendario y Puntajes</button>
        <button onClick={() => setPestana('estadisticas')} style={{ padding: '10px 20px', border: 'none', background: pestana === 'estadisticas' ? '#38A169' : 'transparent', color: pestana === 'estadisticas' ? 'white' : '#4A5568', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>📈 Analítica y Scouting</button>
      </div>

      {mensaje && <div style={{ padding: '15px', background: '#FED7D7', color: '#C53030', borderRadius: '6px', marginBottom: '20px' }}>{mensaje}</div>}

      {/* VISTA 1: MI EQUIPO */}
      {pestana === 'equipo' && (
        <div style={{ background: '#FFF', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          <h3>Nómina Oficial del Equipo</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '15px' }}>
            <thead>
              <tr style={{ background: '#EDF2F7', textAlign: 'left' }}>
                <th style={{ padding: '12px' }}>Dorsal</th>
                <th style={{ padding: '12px' }}>Jugador</th>
                <th style={{ padding: '12px' }}>Cédula</th>
                <th style={{ padding: '12px' }}>Rol</th>
                <th style={{ padding: '12px' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {jugadores.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: '#718096' }}>No hay jugadores registrados en tu equipo.</td></tr>
              ) : (
                jugadores.map(j => (
                  <tr key={j.id} style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <td style={{ padding: '12px' }}><strong>#{j.numero_dorsal}</strong></td>
                    <td style={{ padding: '12px' }}>{j.nombre} {j.apellido} {j.es_capitan && '⭐ (Capitán)'}</td>
                    <td style={{ padding: '12px' }}>{j.cedula}</td>
                    <td style={{ padding: '12px', color: '#4A5568' }}>{j.posicion || 'Atleta'}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ padding: '4px 8px', background: j.estado === 'Activo' ? '#C6F6D5' : '#FED7D7', color: j.estado === 'Activo' ? '#276749' : '#9B2C2C', borderRadius: '12px', fontSize: '0.85em', fontWeight: 'bold' }}>
                        {j.estado}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* VISTA 2: CALENDARIO Y PLANILLAS DE PUNTAJES */}
      {pestana === 'calendario' && (
        <div>
          {partidoPlanillaId && datosPlanillaPartido ? (
            <div>
              <button onClick={cerrarPlanilla} style={{ marginBottom: '15px', padding: '8px 15px', background: '#E2E8F0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                ⬅️ Volver al Calendario
              </button>
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
            <div style={{ background: '#FFF', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
              <h3>Encuentros y Planillas de Puntajes</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px', marginTop: '15px' }}>
                {partidos.length === 0 ? (
                  <p style={{ color: '#718096' }}>Tu equipo no tiene partidos programados.</p>
                ) : (
                  partidos.map(p => (
                    <div key={p.id} style={{ border: '1px solid #CBD5E0', borderRadius: '8px', padding: '15px', borderLeft: p.estado === 'Finalizado' ? '4px solid #38A169' : '4px solid #3182CE' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontSize: '0.8em', fontWeight: 'bold', color: '#718096', textTransform: 'uppercase' }}>{p.fase}</span>
                        <span style={{ fontSize: '0.8em', background: '#EDF2F7', padding: '2px 6px', borderRadius: '4px' }}>{p.estado}</span>
                      </div>
                      <h4 style={{ margin: '0 0 5px 0' }}>{p.local_nombre} <span style={{ color: '#A0AEC0' }}>vs</span> {p.visita_nombre}</h4>
                      <p style={{ margin: 0, fontSize: '0.9em', color: '#4A5568' }}>📅 {new Date(p.fecha_hora).toLocaleString('es-VE')}</p>
                      <p style={{ margin: '5px 0 10px 0', fontSize: '0.9em', color: '#4A5568' }}>🏟️ {p.sede_nombre}</p>
                      <button 
                        onClick={() => cargarPlanillaPartido(p.id)} 
                        style={{ width: '100%', padding: '8px', background: '#3182CE', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85em' }}
                      >
                        📄 Ver Planilla y Puntajes
                      </button>
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
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, color: '#2D3748' }}>📊 Centro de Scouting Avanzado</h2>
            <button onClick={generarReportePDF} style={{ background: '#38A169', color: 'white', padding: '10px 20px', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🖨️ Descargar Reporte PDF
            </button>
          </div>

          <h3 style={{ borderBottom: '2px solid #E2E8F0', paddingBottom: '10px' }}>Rendimiento Grupal</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px', marginBottom: '35px' }}>
            <div style={{ background: '#FFF', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85em', color: '#718096', marginBottom: '5px' }}>Promedio Puntos/Bolo</div>
              <div style={{ fontSize: '2em', fontWeight: '900', color: '#2B6CB0' }}>{estadisticas.grupal?.promedio_puntos_bolo || '0.0'}</div>
            </div>
            <div style={{ background: '#FFF', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85em', color: '#718096', marginBottom: '5px' }}>Diferencial de Puntos</div>
              <div style={{ fontSize: '2em', fontWeight: '900', color: (estadisticas.grupal?.diferencial_puntos > 0) ? '#38A169' : '#E53E3E' }}>
                {estadisticas.grupal?.diferencial_puntos > 0 ? '+' : ''}{estadisticas.grupal?.diferencial_puntos || 0}
              </div>
            </div>
            <div style={{ background: '#FFF', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85em', color: '#718096', marginBottom: '5px' }}>Retención del Punto (%)</div>
              <div style={{ fontSize: '2em', fontWeight: '900', color: '#D69E2E' }}>{estadisticas.grupal?.porcentaje_retencion || 0}%</div>
            </div>
            <div style={{ background: '#FFF', padding: '20px', borderRadius: '8px', border: '1px solid #E2E8F0', textAlign: 'center' }}>
              <div style={{ fontSize: '0.85em', color: '#718096', marginBottom: '5px' }}>Consistencia (Desv. Estándar)</div>
              <div style={{ fontSize: '2em', fontWeight: '900', color: '#4A5568' }}>±{estadisticas.grupal?.desviacion_estandar || '0.0'}</div>
            </div>
          </div>

          <h3 style={{ borderBottom: '2px solid #E2E8F0', paddingBottom: '10px' }}>Scouting de Jugadores (Perfiles Tácticos)</h3>
          <div style={{ background: '#FFF', borderRadius: '8px', border: '1px solid #E2E8F0', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
              <thead>
                <tr style={{ background: '#2D3748', color: '#FFF', textAlign: 'center' }}>
                  <th style={{ padding: '12px' }}>Jugador</th>
                  <th style={{ padding: '12px' }}>% Arrime<br/><small style={{fontWeight: 'normal', color: '#A0AEC0'}}>[AB, AL, K]</small></th>
                  <th style={{ padding: '12px' }}>% Boche<br/><small style={{fontWeight: 'normal', color: '#A0AEC0'}}>[BB, BL, B]</small></th>
                  <th style={{ padding: '12px', background: '#4A5568' }}>Tasa Error<br/><small style={{fontWeight: 'normal', color: '#CBD5E0'}}>[O, X, N]</small></th>
                  <th style={{ padding: '12px' }}>Pts/Juego</th>
                  <th style={{ padding: '12px', background: '#975A16' }}>Clutch %<br/><small style={{fontWeight: 'normal', color: '#FBD38D'}}>Cierres</small></th>
                  <th style={{ padding: '12px' }}>Perfil Sugerido</th>
                </tr>
              </thead>
              <tbody>
                {estadisticas.individual.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '20px', color: '#718096' }}>No hay suficientes datos de partidos para calcular el scouting.</td></tr>
                ) : (
                  estadisticas.individual.map((j, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
                      <td style={{ padding: '12px', textAlign: 'left' }}><strong>#{j.dorsal} {j.apellido}</strong></td>
                      <td style={{ padding: '12px', color: '#2B6CB0', fontWeight: 'bold' }}>{j.efectividad_arrime || 0}%</td>
                      <td style={{ padding: '12px', color: '#38A169', fontWeight: 'bold' }}>{j.efectividad_boche || 0}%</td>
                      <td style={{ padding: '12px', color: '#E53E3E' }}>{j.tasa_error || 0}%</td>
                      <td style={{ padding: '12px' }}>{j.pts_promedio || '0.0'}</td>
                      <td style={{ padding: '12px', fontWeight: 'bold' }}>{j.clutch || 0}%</td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ background: '#EDF2F7', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85em', color: '#4A5568' }}>
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
      )}

    </div>
  );
}