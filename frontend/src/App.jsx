import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { supabase } from './supabaseClient';

// FASE C1 UX: code splitting por rol; cada panel del sistema baja en su propio
// chunk de Vite y el bundle inicial queda solo con la pantalla publica.
const SuperadminDashboard = lazy(() => import('./components/dashboards/SuperadminDashboard'));
const AdminLigaDashboard = lazy(() => import('./components/dashboards/AdminLigaDashboard'));
const ArbitroDashboard = lazy(() => import('./components/dashboards/ArbitroDashboard'));
const DelegadoDashboard = lazy(() => import('./components/dashboards/DelegadoDashboard'));
const AnotadorDashboard = lazy(() => import('./components/dashboards/AnotadorDashboard'));
const PantallaPuntajes = lazy(() => import('./components/dashboards/PantallaPuntajes'));
const SimuladorPartidos = lazy(() => import('./components/dashboards/SimuladorPartidos')); // UX: simulador de partidos en pestaña nueva
import PantallaOffline, { useConexion } from './components/PantallaOffline';
import VerificarCorreo from './components/VerificarCorreo'; // LOTE 6G: aterriza el enlace ?verificar=
import RestablecerContrasena from './components/RestablecerContrasena'; // LOTE 6H: aterriza el enlace ?restablecer=
import InicioPublico from './components/InicioPublico'; // PANTALLA DE INICIO PUBLICA CONMINGO

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// FASE C1 UX: respaldo de marca mientras baja el chunk del panel del rol
// (mismo patron visual del 'Cargando sistema...' de la sesion).
const RespaldoCargaPanel = () => (
  <div className="min-h-screen flex items-center justify-center bg-brand-cream">
    <div className="flex flex-col items-center gap-4 animate-fade-in">
      <div className="w-12 h-12 border-4 border-brand-gold border-t-brand-rust rounded-full animate-spin"></div>
      <h3 className="text-brand-brown font-semibold tracking-wide">Abriendo tu panel...</h3>
    </div>
  </div>
);

export default function App() {
  // FIX #2: la vista pública '?vista=puntajes' se evalúa tras los hooks (ver más abajo),
  // para cumplir las Rules of Hooks de React.

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
  const [bloqueadoHasta, setBloqueadoHasta] = useState(null);
  const [correoPorVerificar, setCorreoPorVerificar] = useState(''); // LOTE 6G: correo del aviso de verificacion pendiente
  const [mostrarOlvide, setMostrarOlvide] = useState(false); // LOTE 6K: panel de recuperacion de contrasena del login
  const [enviandoOlvide, setEnviandoOlvide] = useState(false); // LOTE 6K: candado del boton de envio del enlace

  const enProcesoLoginRef = useRef(false);

  // LOTE M (PWA offline): escucha los eventos online/offline del navegador y
  // permite verificar la conexión real contra el backend (ver PantallaOffline.jsx).
  const { enLinea, verificando, verificarConexion } = useConexion(API_URL);

  useEffect(() => {
    if (vista === 'inicio') {
      fetch(`${API_URL}/partidos-activos`)
        .then((res) => res.json())
        .then((data) => setPartidos(Array.isArray(data) ? data : []))
        .catch((err) => console.error('Error cargando partidos:', err));
    }
  }, [vista]);

    // FIX #12: el rol se consulta al backend (/api/mi-perfil) con el token de la sesión;
  // el navegador ya no lee la tabla usuarios directamente (independiente del RLS de Supabase).
  const obtenerRolBD = async (tokenSesion) => {
    try {
      // FIX interbloqueo: el token entra por parametro; obtenerRolBD ya no llama a
      // supabase.auth.getSession (esa llamada dentro del callback de
      // onAuthStateChange trababa el candado de la sesion de supabase-js).
      if (!tokenSesion) return 'Usuario';
      const res = await fetch(`${API_URL}/mi-perfil`, {
        headers: { 'Authorization': `Bearer ${tokenSesion}` }
      });
      if (!res.ok) return 'Usuario';
      const datosPerfil = await res.json();
      const rolPerfil = datosPerfil?.rol || 'Usuario';
      // FASE D UX: cache local del rol; sin senal, el refresh mantiene el panel del oficial abierto.
      try { localStorage.setItem('conmingo_rol_cache', rolPerfil); } catch (errCache) { /* almacenamiento no disponible */ }
      return rolPerfil;
    } catch (err) {
      // FASE D UX: sin conexion se usa el ultimo rol conocido (si existe) para no
      // degradar al panel general a un arbitro o anotador en plena cancha.
      try { return localStorage.getItem('conmingo_rol_cache') || 'Usuario'; } catch (errCache) { return 'Usuario'; }
    }
  };

  useEffect(() => {
    const verificarSesionExistente = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user && !enProcesoLoginRef.current) {
        const rolBD = await obtenerRolBD(session.access_token);
        setRolUsuario(rolBD);
        setUsuario(session.user);
        setVista('dashboard');
      }
      setCargando(false);
    };

    verificarSesionExistente();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      // FIX interbloqueo de supabase-js (bug documentado): cualquier llamada
      // async a supabase.auth dentro de este callback traba el candado de la
      // sesion y todos los getSession/getUser posteriores cuelgan en silencio
      // (botones de correo congelados sin peticion ni log). El callback ya
      // recibe session: se usa su token y el trabajo se difiere con setTimeout,
      // el patron que recomienda la documentacion de Supabase.
      (event, session) => {
        if (enProcesoLoginRef.current) return;
        if (event === 'SIGNED_IN' && session?.user) {
          setTimeout(async () => {
            const rolBD = await obtenerRolBD(session.access_token);
            setRolUsuario(rolBD);
            setUsuario(session.user);
            setVista('dashboard');
          }, 0);
        } else if (event === 'SIGNED_OUT') {
          setUsuario(null);
          setRolUsuario('');
          setVista('inicio');
        }
      }
    );

    return () => subscription?.unsubscribe();
  }, []);

  // LOTE M (PWA offline): sin conexión, toda la app (login, dashboards y pizarra
  // pública) muestra la pantalla offline en lugar de errores de red crípticos.
  // El hook useConexion la retira sola al volver la señal (evento 'online').
  // FASE D UX: sin conexion toda la app muestra la pantalla offline, EXCEPTO los
  // oficiales de cancha (arbitro y anotador), que siguen operando el partido con
  // la cola local y el chip "Sin conexion" de sus paneles.
  const rolParaOffline = (rolUsuario || '').toLowerCase();
  const esOficialDeCancha = rolParaOffline === 'arbitro' || rolParaOffline === 'árbitro' || rolParaOffline === 'arbitro/anotador' || rolParaOffline === 'árbitro / anotador' || rolParaOffline === 'anotador';
  if (!enLinea && !esOficialDeCancha) {
    return <PantallaOffline verificando={verificando} onReintentar={verificarConexion} />;
  }

  // FIX #2: retorno temprano de la vista pública, ahora ubicado DESPUÉS de todos los hooks.
  if (new URLSearchParams(window.location.search).get('vista') === 'puntajes') {
    return (
      <Suspense fallback={<RespaldoCargaPanel />}>
        <PantallaPuntajes />
      </Suspense>
    );
  }

  // UX: la vista pública '?vista=simulador' abre el simulador de partidos en
  // su propia pestaña del navegador (mismo mecanismo que la pizarra pública).
  if (new URLSearchParams(window.location.search).get('vista') === 'simulador') {
    return (
      <Suspense fallback={<RespaldoCargaPanel />}>
        <SimuladorPartidos />
      </Suspense>
    );
  }

  // LOTE 6G: aterriza el enlace de verificacion de correo (?verificar=token).
  // Vista publica sin sesion: sirve para la verificacion inicial y para la
  // confirmacion del cambio de correo (el backend distingue el tipo de token).
  if (new URLSearchParams(window.location.search).get('verificar')) {
    return <VerificarCorreo />;
  }

  // LOTE 6H: aterriza el enlace de restablecimiento de contrasena (?restablecer=token).
  // Vista publica sin sesion: la persona establece su propia clave con la misma
  // politica de la clave provisional (letras, numeros y caracter especial).
  if (new URLSearchParams(window.location.search).get('restablecer')) {
    return <RestablecerContrasena />;
  }

  const manejarLogin = async (e) => {
    e.preventDefault();
    if (isSubmitting) return; 

    if (bloqueadoHasta && new Date() < bloqueadoHasta) {
      const faltan = Math.max(1, Math.ceil((bloqueadoHasta - new Date()) / 60000));
      return setMensaje(`Demasiados intentos fallidos. Intenta de nuevo en ${faltan} minuto(s).`);
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

      // LOGIN PROXY (hallazgo #18): el backend es el único que valida credenciales
      // contra Supabase y aplica el bloqueo persistente (5 intentos → 15 minutos).
      let respuestaLogin = {};
      try {
        const resLogin = await fetch(`${API_URL}/login-proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailLimpio, password }),
        });
        respuestaLogin = await resLogin.json().catch(() => ({}));
        respuestaLogin._status = resLogin.status;
      } catch (err) {
        enProcesoLoginRef.current = false;
        setIsSubmitting(false);
        return setMensaje('Error de conexión con el servidor. Verifica tu conexión e intenta de nuevo.');
      }

      if (respuestaLogin._status !== 200) {
        enProcesoLoginRef.current = false;
        setIsSubmitting(false);
        if (respuestaLogin._status === 429) {
          const hasta = respuestaLogin.bloqueado_hasta
            ? new Date(respuestaLogin.bloqueado_hasta)
            : new Date(Date.now() + 15 * 60 * 1000);
          setBloqueadoHasta(hasta);
          const minutos = Math.max(1, Math.ceil((hasta - new Date()) / 60000));
          setMensaje(respuestaLogin.error || `Cuenta bloqueada por seguridad. Espera ${minutos} minuto(s).`);
        } else if (respuestaLogin._status === 401) {
          const restantes = typeof respuestaLogin.intentos_restantes === 'number' ? respuestaLogin.intentos_restantes : null;
          setMensaje(restantes !== null
            ? `Credenciales incorrectas. Te queda${restantes === 1 ? '' : 'n'} ${restantes} intento${restantes === 1 ? '' : 's'}.`
            : (respuestaLogin.error || 'Credenciales incorrectas.'));
        } else if (respuestaLogin.requiere_verificacion) {
          // LOTE 6G: login bloqueado hasta verificar el correo
          setCorreoPorVerificar(emailLimpio);
          setMensaje(respuestaLogin.error || 'Tu correo aún no ha sido verificado.');
        } else {
          setMensaje(respuestaLogin.error || 'No se pudo iniciar sesión. Intenta de nuevo.');
        }
        return;
      }

      if (respuestaLogin.requiere_otp) {
        // Superadmin: solicitar el código OTP también a través del proxy
        let datosOtp = { _status: 0 };
        try {
          const resOtp = await fetch(`${API_URL}/login-proxy/otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: emailLimpio }),
          });
          datosOtp = await resOtp.json().catch(() => ({}));
          datosOtp._status = resOtp.status;
        } catch (err) {
          datosOtp = { _status: 0 };
        }

        setIsSubmitting(false);
        if (datosOtp._status !== 200) {
          enProcesoLoginRef.current = false;
          setMensaje(datosOtp.error || 'Error al enviar el código.');
        } else {
          setMensaje('Código de 6 dígitos enviado a tu correo.');
          setPaso(2);
        }
        return;
      }

      // Login exitoso: cargar en el cliente la sesión entregada por el proxy
      const sesionLogin = respuestaLogin.session;
      await supabase.auth.setSession({
        access_token: sesionLogin.access_token,
        refresh_token: sesionLogin.refresh_token,
      });
      const rolBD = await obtenerRolBD(sesionLogin.access_token);
      enProcesoLoginRef.current = false;
      setIsSubmitting(false);
      setRolUsuario(rolBD);
      setUsuario(sesionLogin.user);
      setVista('dashboard');
      return;
    }

    if (paso === 2) {
      const otpLimpio = codigoOtp.trim();
      if (!/^\d{6}$/.test(otpLimpio)) {
        setIsSubmitting(false);
        return setMensaje('El código debe contener exactamente 6 dígitos numéricos.');
      }

      // Verificación del código OTP a través del proxy del backend
      try {
        const resOtp = await fetch(`${API_URL}/login-proxy/verificar-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailLimpio, token: otpLimpio }),
        });
        const respuestaOtp = await resOtp.json().catch(() => ({}));

        setIsSubmitting(false);
        if (!resOtp.ok) {
          setMensaje(respuestaOtp.error || 'Código inválido. Intenta de nuevo.');
        } else {
          enProcesoLoginRef.current = false;
          const sesionOtp = respuestaOtp.session;
          await supabase.auth.setSession({
            access_token: sesionOtp.access_token,
            refresh_token: sesionOtp.refresh_token,
          });
          const rolBD = await obtenerRolBD(sesionOtp.access_token);
          setRolUsuario(rolBD);
          setUsuario(sesionOtp.user);
          setVista('dashboard');
        }
      } catch (err) {
        setIsSubmitting(false);
        setMensaje('Error de conexión con el servidor. Intenta de nuevo.');
      }
    }
  };

  // LOTE 6K: recuperacion de contrasena desde el login. Pide al backend el
  // enlace de restablecimiento con el correo indicado; el backend responde
  // SIEMPRE con un mensaje generico (no revela si el correo existe) y aplica
  // su propio rate limit. Aqui solo se bloquea el boton mientras dura la peticion.
  const manejarOlvide = async (e) => {
    e.preventDefault();
    if (enviandoOlvide) return;
    setMensaje('');
    setEnviandoOlvide(true);
    try {
      const resOlvide = await fetch(`${API_URL}/solicitar-restablecer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const datosOlvide = await resOlvide.json().catch(() => ({}));
      setMensaje(datosOlvide.mensaje || datosOlvide.error || 'Si el correo está registrado, enviamos un enlace para restablecer la contraseña.');
    } catch (err) {
      setMensaje('Error de conexión con el servidor. Intenta de nuevo.');
    }
    setEnviandoOlvide(false);
  };

  const cerrarSesion = async () => {
    enProcesoLoginRef.current = false;
    await supabase.auth.signOut();
    try { localStorage.removeItem('conmingo_rol_cache'); } catch (errCache) { /* almacenamiento no disponible */ } // FASE D UX
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
        <Suspense fallback={<RespaldoCargaPanel />}>
          {renderizarDashboard()}
        </Suspense>
      </div>
    );
  }

  // Landing Page y Login
  return (
    <div className="min-h-screen font-sans text-brand-brown selection:bg-brand-gold/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
        
        <nav className="flex justify-between items-center mb-10 pb-6 border-b border-brand-gold/30">
          <div className="flex items-center gap-3">
            <svg className="w-9 h-9 shrink-0" viewBox="0 0 64 64" role="img" aria-label="CONMINGO">
              <defs>
                <radialGradient id="grad-bola-nav" cx="38%" cy="32%" r="72%">
                  <stop offset="0%" stopColor="#E9CFA4" />
                  <stop offset="52%" stopColor="#C89B6E" />
                  <stop offset="100%" stopColor="#754625" />
                </radialGradient>
              </defs>
              <circle cx="30" cy="34" r="26" fill="url(#grad-bola-nav)" />
              <g fill="none" stroke="#4A2313" strokeWidth="4" strokeLinecap="round">
                <path d="M43 56.5 A26 26 0 0 1 43 11.5" transform="rotate(0 30 34)" />
                <path d="M43 56.5 A26 26 0 0 1 43 11.5" transform="rotate(45 30 34)" />
                <path d="M43 56.5 A26 26 0 0 1 43 11.5" transform="rotate(90 30 34)" />
                <path d="M43 56.5 A26 26 0 0 1 43 11.5" transform="rotate(135 30 34)" />
              </g>
              <ellipse cx="20" cy="24" rx="6" ry="3.5" fill="#FFF7DF" opacity="0.35" transform="rotate(-28 20 24)" />
              <circle cx="53" cy="10" r="6" fill="#E7BA67" stroke="#9E7A2E" strokeWidth="2" />
            </svg>
            <div className="leading-tight">
              <h2 className="text-2xl font-bold text-brand-brown tracking-tight">CONMINGO</h2>
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-brand-rust">Gestion deportiva de bolas criollas</p>
            </div>
          </div>
          
          <button 
            onClick={() => { setVista(vista === 'inicio' ? 'login' : 'inicio'); setPaso(1); setMostrarOlvide(false); setMensaje(''); }}
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
          <InicioPublico partidos={partidos} onIniciarSesion={() => { setVista('login'); setPaso(1); setMostrarOlvide(false); setMensaje(''); }} />
        )}

        {vista === 'login' && (
          <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-xl border border-brand-gold/30 animate-slide-up mt-10">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-cream rounded-full mb-4">
                <svg className="w-8 h-8 text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7z" /></svg>
              </div>
              <h3 className="text-2xl font-bold text-brand-brown">
                {mostrarOlvide ? 'Recuperar Contraseña' : (paso === 1 ? 'Acceso al Sistema' : 'Verificación de Seguridad')}
              </h3>
              <p className="text-sm text-brand-brown/60 mt-2">
                {mostrarOlvide ? 'Enviaremos a tu correo un enlace para restablecerla' : (paso === 1 ? 'Ingresa tus credenciales oficiales' : `Ingresa el código enviado a ${email}`)}
              </p>
            </div>

            {mostrarOlvide ? (
              <form onSubmit={manejarOlvide} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-brand-brown">Correo Electrónico</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-3 bg-brand-cream/20 border border-gray-300 rounded-lg focus:outline-none focus:border-brand-rust focus:ring-2 focus:ring-brand-rust/20 transition-all" />
                </div>
                <p className="text-xs text-brand-brown/60">Si el correo está registrado, recibirás un enlace para establecer una contraseña nueva. El enlace es válido por 24 horas y de un solo uso.</p>
                <button type="submit" disabled={enviandoOlvide} className={`w-full text-white py-3.5 rounded-lg font-bold tracking-wide transition-colors shadow-md hover:shadow-lg mt-4 ${enviandoOlvide ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-rust hover:bg-brand-brown'}`}>
                  {enviandoOlvide ? 'Enviando...' : 'Enviar enlace de restablecimiento'}
                </button>
                <button type="button" onClick={() => { setMostrarOlvide(false); setMensaje(''); }} className="w-full py-3 rounded-lg font-bold bg-gray-100 text-brand-brown hover:bg-gray-200 transition-colors">
                  Volver al acceso
                </button>
              </form>
            ) : (
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

                  <div className="text-center">
                    <button type="button" onClick={() => { setMostrarOlvide(true); setMensaje(''); }} className="text-sm font-semibold text-brand-blue hover:text-brand-rust transition-colors">
                      ¿Olvidó su contraseña?
                    </button>
                  </div>
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
            )}

            {mensaje && (
              <div className={`mt-6 p-4 rounded-lg text-sm text-center font-medium ${mensaje.toLowerCase().includes('error') || mensaje.toLowerCase().includes('incorrectas') || mensaje.toLowerCase().includes('aún no ha sido verificado') || mensaje.toLowerCase().includes('demasiadas') ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                {mensaje}
              </div>
            )}

            {correoPorVerificar && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={async () => {
                  setIsSubmitting(true);
                  try {
                    const resReenvio = await fetch(`${API_URL}/reenviar-verificacion`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: correoPorVerificar }),
                    });
                    const datosReenvio = await resReenvio.json().catch(() => ({}));
                    setMensaje(datosReenvio.mensaje || datosReenvio.error || 'Si el correo está registrado y pendiente de verificación, se envió un nuevo enlace.');
                  } catch (err) {
                    setMensaje('Error de conexión con el servidor. Intenta de nuevo.');
                  }
                  setIsSubmitting(false);
                }}
                className="mt-4 w-full bg-brand-brown text-white py-3 rounded-lg font-bold hover:bg-brand-rust transition-colors shadow-md"
              >
                Reenviar correo de verificación
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}