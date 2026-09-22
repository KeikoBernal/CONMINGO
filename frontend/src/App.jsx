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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [intentosFallidos, setIntentosFallidos] = useState(0);
  const [bloqueadoHasta, setBloqueadoHasta] = useState(null);

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
    if (isSubmitting) return; 

    if (bloqueadoHasta && new Date() < bloqueadoHasta) {
      const faltan = Math.ceil((bloqueadoHasta - new Date()) / 1000);
      return setMensaje(`Demasiados intentos fallidos. Intenta de nuevo en ${faltan} segundos.`);
    }

    setMensaje('');
    setIsSubmitting(true); 
    const emailLimpio = email.trim().toLowerCase();

    if (paso === 1) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailLimpio)) {
        setIsSubmitting(false);
        return setMensaje('Por favor, ingresa un formato de correo electrónico válido.');
      }

      setMensaje('Validando credenciales...');
      enProcesoLoginRef.current = true;

      const { data, error: errorPassword } = await supabase.auth.signInWithPassword({
        email: emailLimpio,
        password,
      });

      if (errorPassword) {
        enProcesoLoginRef.current = false;
        setIsSubmitting(false);
        const nuevosIntentos = intentosFallidos + 1;
        setIntentosFallidos(nuevosIntentos);
        
        if (nuevosIntentos >= 3) {
          setBloqueadoHasta(new Date(Date.now() + 60000)); // Bloquear por 60 segundos
          setMensaje('Múltiples intentos fallidos. Por seguridad, espera 60 segundos.');
        } else {
          setMensaje(`Credenciales incorrectas. Intento ${nuevosIntentos} de 3.`);
        }
        return;
      }

      setIntentosFallidos(0); 

      const rolBD = await obtenerRolBD(data.user.id);
      setRolUsuario(rolBD);

      if (rolBD.toLowerCase() === 'superadmin') {
        await supabase.auth.signOut();
        const { error: errorOtp } = await supabase.auth.signInWithOtp({
          email: emailLimpio,
          options: { shouldCreateUser: false },
        });
        
        setIsSubmitting(false); 
        if (errorOtp) {
          enProcesoLoginRef.current = false;
          setMensaje(`Error al enviar código: ${errorOtp.message}`);
        } else {
          setMensaje('Código de 6 dígitos enviado a tu correo.');
          setPaso(2);
        }
      } else {
        enProcesoLoginRef.current = false;
        setIsSubmitting(false);
        setUsuario(data.user);
        setVista('dashboard');
      }
      return;
    }

    if (paso === 2) {
      const otpLimpio = codigoOtp.trim();
      if (!/^\d{6}$/.test(otpLimpio)) {
        setIsSubmitting(false);
        return setMensaje('El código debe contener exactamente 6 dígitos numéricos.');
      }

      const { data, error } = await supabase.auth.verifyOtp({
        email: emailLimpio,
        token: otpLimpio,
        type: 'email',
      });
      
      setIsSubmitting(false);
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
        <div className="text-center p-8 w-full h-screen flex flex-col items-center justify-center bg-brand-cream">
          <h3 className="text-2xl font-bold mb-4 text-brand-brown">Panel General</h3>
          <button onClick={cerrarSesion} className="bg-brand-rust text-white px-6 py-2 rounded-lg hover:bg-brand-brown transition-colors">
            Cerrar Sesión
          </button>
        </div>
      );
    }
  };

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-cream">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="w-12 h-12 border-4 border-brand-gold border-t-brand-rust rounded-full animate-spin"></div>
          <h3 className="text-brand-brown font-semibold tracking-wide">Cargando sistema...</h3>
        </div>
      </div>
    );
  }

  // Si la vista es dashboard, devolvemos el contenedor en pantalla completa sin NavBar externo
  if (vista === 'dashboard') {
    return (
      <div className="h-screen w-full font-sans text-brand-brown selection:bg-brand-gold/40 overflow-hidden bg-brand-cream">
        {renderizarDashboard()}
      </div>
    );
  }

  // Agrupar partidos por Torneo para la Landing Page
  const partidosPorTorneo = partidos.reduce((acc, partido) => {
    const torneo = partido.torneo_nombre || 'Encuentros Generales';
    if (!acc[torneo]) {
      acc[torneo] = { organizacion: partido.organizacion_nombre || 'Liga Oficial', partidos: [] };
    }
    acc[torneo].partidos.push(partido);
    return acc;
  }, {});

  // Landing Page y Login
  return (
    <div className="min-h-screen font-sans text-brand-brown selection:bg-brand-gold/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
        
        <nav className="flex justify-between items-center mb-10 pb-6 border-b border-brand-gold/30">
          <div className="flex items-center gap-3">
            <svg className="w-8 h-8 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth="2" />
              <circle cx="12" cy="12" r="4" strokeWidth="2" fill="currentColor" opacity="0.2"/>
            </svg>
            <h2 className="text-2xl font-bold text-brand-brown tracking-tight">Portal de Bolas Criollas</h2>
          </div>
          
          <button 
            onClick={() => { setVista(vista === 'inicio' ? 'login' : 'inicio'); setPaso(1); setMensaje(''); }}
            className="flex items-center gap-2 px-6 py-2.5 bg-brand-brown text-brand-cream rounded-lg hover:bg-brand-rust transition-all duration-300 shadow-md hover:shadow-lg font-semibold transform hover:-translate-y-0.5"
          >
            {vista === 'inicio' ? (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
                <span>Iniciar Sesión</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                <span>Volver al Inicio</span>
              </>
            )}
          </button>
        </nav>

        {vista === 'inicio' && (
          <div className="animate-slide-up">
            <div className="bg-brand-blue/10 border-l-4 border-brand-blue rounded-r-xl p-6 mb-12 shadow-sm transform transition-transform hover:translate-x-1 duration-300">
              <h3 className="text-xl font-bold text-brand-brown mb-3 flex items-center gap-2">
                <svg className="w-6 h-6 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Bienvenidos al Campeonato
              </h3>
              <p className="text-brand-brown/80 leading-relaxed max-w-4xl">
                Las <strong className="text-brand-rust">Bolas Criollas</strong> son un deporte tradicional de precisión y estrategia. 
                Dos equipos compiten lanzando sus esferas metálicas intentando dejarlas lo más cerca posible de una pequeña bola guía llamada mingo. 
                Explora los torneos activos a continuación y sigue los marcadores en tiempo real.
              </p>
            </div>

            <div className="text-center mb-10">
              <h2 className="text-3xl font-extrabold text-brand-brown mb-3">Torneos y Partidos en Curso</h2>
              <p className="text-brand-brown/60">Selecciona un encuentro para ver la pizarra de puntajes en directo</p>
            </div>

            {Object.keys(partidosPorTorneo).length === 0 ? (
              <div className="text-center p-12 bg-white rounded-2xl border border-brand-gold/30 shadow-sm">
                <svg className="w-16 h-16 mx-auto text-brand-gold/50 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <p className="text-lg text-brand-brown/60 font-medium">No hay partidos activos o programados en este momento.</p>
              </div>
            ) : (
              Object.entries(partidosPorTorneo).map(([nombreTorneo, grupo]) => (
                <div key={nombreTorneo} className="mb-12 bg-white rounded-2xl overflow-hidden shadow-lg border border-brand-gold/20 hover:shadow-xl transition-shadow duration-300">
                  <div className="bg-brand-brown text-brand-cream px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                      <svg className="w-5 h-5 text-brand-gold" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 2a1 1 0 01.832.445l2 3.111 3.553.517a1 1 0 01.554 1.706l-2.57 2.506.607 3.539a1 1 0 01-1.451 1.054L10 13.18l-3.177 1.67a1 1 0 01-1.451-1.054l.607-3.539-2.57-2.506a1 1 0 01.554-1.706l3.553-.517 2-3.111A1 1 0 0110 2z" clipRule="evenodd" /></svg>
                      {nombreTorneo}
                    </h3>
                    <span className="text-xs font-semibold bg-brand-gold text-brand-brown px-3 py-1 rounded-full uppercase tracking-wider">
                      {grupo.organizacion}
                    </span>
                  </div>

                  <div className="p-6 bg-brand-cream/10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {grupo.partidos.map((p) => (
                      <div key={p.id} className="group bg-white border border-brand-gold/30 rounded-xl p-5 flex flex-col justify-between hover:border-brand-rust transition-colors duration-300 shadow-sm hover:shadow-md">
                        <div>
                          <div className="flex justify-between items-center mb-4">
                            <span className="text-xs font-bold text-brand-blue uppercase tracking-wide">
                              {p.fase || 'Fase Regular'}
                            </span>
                            <span className={`text-xs font-bold px-3 py-1 rounded-full ${p.estado === 'En Curso' ? 'bg-green-100 text-green-700 animate-pulse' : 'bg-brand-cream text-brand-brown border border-brand-gold/30'}`}>
                              {p.estado}
                            </span>
                          </div>

                          <div className="text-center p-4 bg-brand-cream/30 rounded-lg border border-brand-cream mb-5 group-hover:bg-brand-cream/50 transition-colors">
                            <div className="text-lg font-bold text-brand-brown">{p.local_nombre || 'Local'}</div>
                            <div className="text-xs font-bold text-brand-rust my-2">VS</div>
                            <div className="text-lg font-bold text-brand-brown">{p.visita_nombre || 'Visita'}</div>
                          </div>

                          <div className="space-y-2 text-sm text-brand-brown/70 mb-6">
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                              <span>{p.sede_nombre || 'Cancha Principal'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-brand-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                              <span>{new Date(p.fecha_hora).toLocaleString('es-VE')}</span>
                            </div>
                          </div>
                        </div>

                        <button 
                          onClick={() => window.open(`/?vista=puntajes&partido_id=${p.id}`, '_blank')}
                          className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white py-2.5 rounded-lg font-semibold hover:bg-brand-rust transition-colors duration-300 shadow-sm"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                          Ver Puntajes en Vivo
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {vista === 'login' && (
          <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-xl border border-brand-gold/30 animate-slide-up mt-10">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-cream rounded-full mb-4">
                <svg className="w-8 h-8 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7z" /></svg>
              </div>
              <h3 className="text-2xl font-bold text-brand-brown">
                {paso === 1 ? 'Acceso al Sistema' : 'Verificación de Seguridad'}
              </h3>
              <p className="text-sm text-brand-brown/60 mt-2">
                {paso === 1 ? 'Ingresa tus credenciales oficiales' : `Ingresa el código enviado a ${email}`}
              </p>
            </div>

            <form onSubmit={manejarLogin} className="space-y-6">
              {paso === 1 && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-brand-brown">Correo Electrónico</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-3 bg-brand-cream/20 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-rust focus:ring-2 focus:ring-brand-rust/20 transition-all" />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-brand-brown">Contraseña</label>
                    <div className="relative">
                      <input type={mostrarPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full px-4 py-3 bg-brand-cream/20 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-rust focus:ring-2 focus:ring-brand-rust/20 transition-all pr-12" />
                      <button type="button" onClick={() => setMostrarPassword(!mostrarPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand-rust transition-colors p-1">
                        {mostrarPassword ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <button type="submit" disabled={isSubmitting} className={`w-full text-white py-3.5 rounded-lg font-bold tracking-wide transition-colors shadow-md hover:shadow-lg mt-4 ${isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-rust hover:bg-brand-brown'}`}>
                    {isSubmitting ? 'Validando...' : 'Entrar al Sistema'}
                  </button>
                </>
              )}

              {paso === 2 && (
                <div className="space-y-6">
                  <input type="text" placeholder="123456" value={codigoOtp} onChange={(e) => setCodigoOtp(e.target.value)} maxLength={6} required className="w-full px-4 py-4 bg-brand-cream/20 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-rust focus:ring-2 focus:ring-brand-rust/20 transition-all text-center text-2xl tracking-[0.5em] font-mono" />
                  <div className="flex flex-col gap-3">
                    {/* MODIFICACIÓN: Atributos dinámicos en base al estado isSubmitting */}
                    <button type="submit" disabled={isSubmitting} className={`w-full text-white py-3 rounded-lg font-bold transition-colors shadow-md ${isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-blue hover:bg-brand-brown'}`}>
                      {isSubmitting ? 'Verificando...' : 'Validar e Iniciar Sesión'}
                    </button>
                    <button type="button" disabled={isSubmitting} onClick={() => { enProcesoLoginRef.current = false; setPaso(1); setMensaje(''); }} className={`w-full py-3 rounded-lg font-bold transition-colors ${isSubmitting ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-100 text-brand-brown hover:bg-gray-200'}`}>Volver</button>
                  </div>
                </div>
              )}
            </form>

            {mensaje && (
              <div className={`mt-6 p-4 rounded-lg text-sm text-center font-medium ${mensaje.toLowerCase().includes('error') || mensaje.toLowerCase().includes('incorrectas') ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                {mensaje}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}