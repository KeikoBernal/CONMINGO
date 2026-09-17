import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

import SuperadminDashboard from './components/dashboards/SuperadminDashboard';
import AdminLigaDashboard from './components/dashboards/AdminLigaDashboard';
import ArbitroDashboard from './components/dashboards/ArbitroDashboard';
import DelegadoDashboard from './components/dashboards/DelegadoDashboard';
import AnotadorDashboard from './components/dashboards/AnotadorDashboard';
import PantallaPuntajes from './components/dashboards/PantallaPuntajes';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('vista') === 'puntajes') {
    return <PantallaPuntajes />;
  }

  const [vista, setVista] = useState('inicio');
  const [paso, setPaso] = useState(1);
  const [partidos, setPartidos] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [codigoOtp, setCodigoOtp] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [usuario, setUsuario] = useState(null);
  const [rolUsuario, setRolUsuario] = useState('');
  const [cargando, setCargando] = useState(true);

  const enProcesoLoginRef = useRef(false);

  useEffect(() => {
    if (vista === 'inicio') {
      fetch(`${API_URL}/partidos-activos`)
        .then((res) => res.json())
        .then((data) => setPartidos(Array.isArray(data) ? data : []))
        .catch((err) => console.error('Error cargando partidos:', err));
    }
  }, [vista]);

  const obtenerRolBD = async (userId) => {
    try {
      const { data: datosBD, error } = await supabase
        .from('usuarios')
        .select('rol')
        .eq('id', userId)
        .single();
      if (error) return 'Usuario';
      return datosBD?.rol || 'Usuario';
    } catch (err) {
      return 'Usuario';
    }
  };

  useEffect(() => {
    const verificarSesionExistente = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && !enProcesoLoginRef.current) {
        const rolBD = await obtenerRolBD(session.user.id);
        setRolUsuario(rolBD);
        setUsuario(session.user);
        setVista('dashboard');
      }
      setCargando(false);
    };

    verificarSesionExistente();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (enProcesoLoginRef.current) return;
        if (event === 'SIGNED_IN' && session?.user) {
          const rolBD = await obtenerRolBD(session.user.id);
          setRolUsuario(rolBD);
          setUsuario(session.user);
          setVista('dashboard');
        } else if (event === 'SIGNED_OUT') {
          setUsuario(null);
          setRolUsuario('');
          setVista('inicio');
        }
      }
    );

    return () => subscription?.unsubscribe();
  }, []);

  const manejarLogin = async (e) => {
    e.preventDefault();
    setMensaje('');
    const emailLimpio = email.trim().toLowerCase();

    if (paso === 1) {
      setMensaje('Validando credenciales...');
      enProcesoLoginRef.current = true;

      const { data, error: errorPassword } = await supabase.auth.signInWithPassword({
        email: emailLimpio,
        password,
      });

      if (errorPassword) {
        enProcesoLoginRef.current = false;
        setMensaje(`Credenciales incorrectas: ${errorPassword.message}`);
        return;
      }

      const rolBD = await obtenerRolBD(data.user.id);
      setRolUsuario(rolBD);

      if (rolBD.toLowerCase() === 'superadmin') {
        await supabase.auth.signOut();
        const { error: errorOtp } = await supabase.auth.signInWithOtp({
          email: emailLimpio,
          options: { shouldCreateUser: false },
        });
        if (errorOtp) {
          enProcesoLoginRef.current = false;
          setMensaje(`Error al enviar código: ${errorOtp.message}`);
        } else {
          setMensaje('Código de 6 dígitos enviado a tu correo.');
          setPaso(2);
        }
      } else {
        enProcesoLoginRef.current = false;
        setUsuario(data.user);
        setVista('dashboard');
      }
      return;
    }

    if (paso === 2) {
      const { data, error } = await supabase.auth.verifyOtp({
        email: emailLimpio,
        token: codigoOtp.trim(),
        type: 'email',
      });
      if (error) {
        setMensaje(`Código inválido: ${error.message}`);
      } else {
        enProcesoLoginRef.current = false;
        const rolBD = await obtenerRolBD(data.user.id);
        setRolUsuario(rolBD);
        setUsuario(data.user);
        setVista('dashboard');
      }
    }
  };

  const cerrarSesion = async () => {
    enProcesoLoginRef.current = false;
    await supabase.auth.signOut();
    setUsuario(null);
    setRolUsuario('');
    setPaso(1);
    setCodigoOtp('');
    setPassword('');
    setVista('inicio');
    setMensaje('');
  };

  const renderizarDashboard = () => {
    const rol = rolUsuario?.toLowerCase();
    switch (rol) {
      case 'superadmin': return <SuperadminDashboard usuario={usuario} cerrarSesion={cerrarSesion} />;
      case 'administrador de liga': return <AdminLigaDashboard usuario={usuario} cerrarSesion={cerrarSesion} />;
      case 'arbitro':
      case 'árbitro':
      case 'arbitro/anotador':
      case 'árbitro / anotador': return <ArbitroDashboard usuario={usuario} cerrarSesion={cerrarSesion} />;
      case 'anotador': return <AnotadorDashboard usuario={usuario} cerrarSesion={cerrarSesion} />;
      case 'delegado de equipo': return <DelegadoDashboard usuario={usuario} cerrarSesion={cerrarSesion} />;
      default: return (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <h3>Panel General</h3>
          <button onClick={cerrarSesion}>Cerrar Sesión</button>
        </div>
      );
    }
  };

  if (cargando) {
    return <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}><h3>Cargando sistema...</h3></div>;
  }

  // Agrupar partidos por Torneo
  const partidosPorTorneo = partidos.reduce((acc, partido) => {
    const torneo = partido.torneo_nombre || 'Encuentros Generales';
    if (!acc[torneo]) {
      acc[torneo] = {
        organizacion: partido.organizacion_nombre || 'Liga Oficial',
        partidos: []
      };
    }
    acc[torneo].partidos.push(partido);
    return acc;
  }, {});

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', borderBottom: '1px solid #CBD5E0', paddingBottom: '15px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#2D3748' }}>🥎 Portal de Bolas Criollas</h2>
        </div>
        {vista !== 'dashboard' && (
          <button 
            onClick={() => { setVista(vista === 'inicio' ? 'login' : 'inicio'); setPaso(1); setMensaje(''); }}
            style={{ padding: '8px 18px', background: '#3182CE', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {vista === 'inicio' ? '🔑 Iniciar Sesión' : '🏠 Volver al Inicio'}
          </button>
        )}
      </nav>

      {/* Landing Page Pública Mejorada */}
      {vista === 'inicio' && (
        <div>
          {/* Sección de Bienvenida explicativa para principiantes */}
          <div style={{ background: '#EBF8FF', border: '1px solid #BEE3F8', borderRadius: '8px', padding: '20px', marginBottom: '30px', color: '#2B6CB0' }}>
            <h3 style={{ margin: '0 0 8px 0' }}>👋 ¡Bienvenidos al Campeonato de Bolas Criollas!</h3>
            <p style={{ margin: 0, fontSize: '0.95em', lineHeight: '1.5' }}>
              Las <strong>Bolas Criollas</strong> son un deporte tradicional de precisión y estrategia. Dos equipos compiten lanzando sus esferas metálicas intentando dejarlas lo más cerca posible de una pequeña bola guía llamada <em>mingo</em>. Explora los torneos activos a continuación y sigue los marcadores y planillas en tiempo real.
            </p>
          </div>

          <div style={{ textAlign: 'center', marginBottom: '25px' }}>
            <h2 style={{ color: '#2D3748', margin: '0 0 5px 0' }}>🏆 Torneos y Partidos en Curso</h2>
            <p style={{ color: '#718096', margin: 0 }}>Selecciona un encuentro para ver la pizarra de puntajes en directo</p>
          </div>

          {Object.keys(partidosPorTorneo).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', background: '#F7FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
              <p style={{ color: '#718096', fontSize: '1.1em' }}>No hay partidos activos o programados en este momento.</p>
            </div>
          ) : (
            Object.entries(partidosPorTorneo).map(([nombreTorneo, grupo]) => (
              <div key={nombreTorneo} style={{ marginBottom: '35px', background: '#FFF', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                {/* Cabecera del Torneo */}
                <div style={{ background: '#2D3748', color: '#FFF', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '1.1em' }}>🏅 {nombreTorneo}</h3>
                  <span style={{ fontSize: '0.8em', background: '#4A5568', padding: '3px 10px', borderRadius: '12px', color: '#E2E8F0' }}>
                    {grupo.organizacion}
                  </span>
                </div>

                {/* Lista de Partidos del Torneo */}
                <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                  {grupo.partidos.map((p) => (
                    <div key={p.id} style={{ border: '1px solid #CBD5E0', borderRadius: '8px', padding: '15px', background: '#FAFCFF', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <span style={{ fontSize: '0.7em', fontWeight: 'bold', color: '#718096', textTransform: 'uppercase' }}>{p.fase || 'Fase Regular'}</span>
                          <span style={{ fontSize: '0.75em', fontWeight: 'bold', color: p.estado === 'En Curso' ? '#38A169' : '#3182CE', background: p.estado === 'En Curso' ? '#C6F6D5' : '#EBF8FF', padding: '2px 8px', borderRadius: '10px' }}>
                            {p.estado}
                          </span>
                        </div>

                        {/* Enfrentamiento */}
                        <div style={{ textAlign: 'center', margin: '12px 0', padding: '10px', background: '#FFF', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                          <div style={{ fontSize: '1em', fontWeight: 'bold', color: '#1A202C' }}>{p.local_nombre || 'Local'}</div>
                          <div style={{ fontSize: '0.8em', color: '#A0AEC0', margin: '3px 0' }}>VS</div>
                          <div style={{ fontSize: '1em', fontWeight: 'bold', color: '#1A202C' }}>{p.visita_nombre || 'Visita'}</div>
                        </div>

                        <div style={{ fontSize: '0.85em', color: '#4A5568', marginBottom: '15px' }}>
                          <div>🏟️ <strong>Sede:</strong> {p.sede_nombre || 'Cancha Principal'}</div>
                          <div>📅 <strong>Fecha:</strong> {new Date(p.fecha_hora).toLocaleString('es-VE')}</div>
                        </div>
                      </div>

                      <button 
                        onClick={() => window.open(`/?vista=puntajes&partido_id=${p.id}`, '_blank')}
                        style={{ width: '100%', background: '#3182CE', color: 'white', padding: '9px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      >
                        📺 Ver Puntajes en Vivo
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Formulario de Login */}
      {vista === 'login' && (
        <div style={{ maxWidth: '380px', margin: '40px auto', background: '#FFF', padding: '30px', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
          <h3 style={{ textAlign: 'center', marginTop: 0, color: '#2D3748' }}>
            {paso === 1 ? 'Acceso al Sistema' : 'Verificación de Seguridad'}
          </h3>

          <form onSubmit={manejarLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
            {paso === 1 && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '0.85em', fontWeight: 'bold', color: '#4A5568' }}>Correo Electrónico</label>
                  <input
                    type="email"
                    placeholder="correo@ejemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{ padding: '10px', borderRadius: '6px', border: '1px solid #CBD5E0' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '0.85em', fontWeight: 'bold', color: '#4A5568' }}>Contraseña</label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type={mostrarPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      style={{ width: '100%', padding: '10px', paddingRight: '40px', borderRadius: '6px', border: '1px solid #CBD5E0', boxSizing: 'border-box' }}
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarPassword(!mostrarPassword)}
                      style={{ position: 'absolute', right: '10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.1em' }}
                    >
                      {mostrarPassword ? '👁️‍🗨️' : '👁️'}
                    </button>
                  </div>
                </div>

                <button type="submit" style={{ background: '#3182CE', color: 'white', padding: '12px', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}>
                  Entrar
                </button>
              </>
            )}

            {paso === 2 && (
              <>
                <p style={{ fontSize: '0.9em', color: '#4A5568', margin: 0, textAlign: 'center' }}>
                  Ingresa el código de 6 dígitos enviado a <strong>{email}</strong>
                </p>
                <input
                  type="text"
                  placeholder="123456"
                  value={codigoOtp}
                  onChange={(e) => setCodigoOtp(e.target.value)}
                  maxLength={6}
                  required
                  style={{ padding: '12px', borderRadius: '6px', border: '1px solid #CBD5E0', textAlign: 'center', fontSize: '1.2em', letterSpacing: '4px' }}
                />
                <button type="submit" style={{ background: '#38A169', color: 'white', padding: '12px', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
                  Validar e Iniciar Sesión
                </button>
                <button 
                  type="button" 
                  onClick={() => { enProcesoLoginRef.current = false; setPaso(1); setMensaje(''); }} 
                  style={{ background: '#E2E8F0', color: '#4A5568', padding: '10px', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  Volver
                </button>
              </>
            )}
          </form>

          {mensaje && (
            <div style={{ marginTop: '15px', padding: '10px', borderRadius: '6px', background: mensaje.toLowerCase().includes('error') ? '#FED7D7' : '#C6F6D5', color: mensaje.toLowerCase().includes('error') ? '#9B2C2C' : '#276749', fontSize: '0.9em', textAlign: 'center' }}>
              {mensaje}
            </div>
          )}
        </div>
      )}

      {vista === 'dashboard' && renderizarDashboard()}
    </div>
  );
}