import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function SistemaMensajeria({ usuario, token, ligaActivaId }) {
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState('bandeja'); 
  
  const [bandeja, setBandeja] = useState([]);
  const [contactos, setContactos] = useState([]);
  
  const [ligaSeleccionada, setLigaSeleccionada] = useState(null);
  const [rolSeleccionado, setRolSeleccionado] = useState('');
  const [filtroLigaBandeja, setFiltroLigaBandeja] = useState('Todas');
  
  const [chatActivo, setChatActivo] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [nuevoMensaje, setNuevoMensaje] = useState('');
  
  const socketRef = useRef(null);
  const scrollRef = useRef(null);
  
  const chatActivoRef = useRef(null);
  const vistaRef = useRef('bandeja');
  
  const rolDelUsuario = usuario?.rol || usuario?.user_metadata?.rol || '';
  const soySuperadmin = rolDelUsuario.toLowerCase() === 'superadmin';

  useEffect(() => { chatActivoRef.current = chatActivo; }, [chatActivo]);
  useEffect(() => { vistaRef.current = vista; }, [vista]);

  useEffect(() => {
    if (!usuario || !token) return;

    cargarBandeja();
    cargarContactos();

    if (!socketRef.current) {
      socketRef.current = io(SOCKET_URL, {
        transports: ['websocket'],
        upgrade: false
      });
      
      socketRef.current.on('connect', () => {
        socketRef.current.emit('registrar_usuario_mensajeria', { id: usuario.id });
      });

      socketRef.current.on('nuevo_mensaje', (data) => {
        const currentChat = chatActivoRef.current;
        const currentVista = vistaRef.current;
        
        if (currentChat && !currentChat.isMasivo && data.remitente_id === currentChat.id && currentVista === 'chat') {
          cargarConversacion(currentChat.id); 
        } else {
          cargarBandeja(); 
        }
      });
    }
  }, [usuario, token, ligaActivaId]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes, vista]);

  const cargarBandeja = async () => {
    try {
      const queryParams = ligaActivaId ? `?liga_id=${ligaActivaId}` : '';
      const res = await fetch(`${API_URL}/mensajeria/bandeja${queryParams}`, { headers: { 'Authorization': `Bearer ${token}` }, cache: 'no-store' });
      if (res.ok) setBandeja(await res.json());
    } catch (e) {}
  };

  const cargarContactos = async () => {
    try {
      const queryParams = ligaActivaId ? `?liga_id=${ligaActivaId}` : '';
      const res = await fetch(`${API_URL}/mensajeria/contactos${queryParams}`, { headers: { 'Authorization': `Bearer ${token}` }, cache: 'no-store' });
      if (res.ok) setContactos(await res.json());
    } catch (e) {}
  };

  const cargarConversacion = async (contactoId) => {
    try {
      const res = await fetch(`${API_URL}/mensajeria/conversacion/${contactoId}`, { headers: { 'Authorization': `Bearer ${token}` }, cache: 'no-store' });
      if (res.ok) { setMensajes(await res.json()); cargarBandeja(); }
    } catch (e) {}
  };

  const seleccionarContacto = (contacto) => {
    setChatActivo(contacto);
    setVista('chat');
    if (contacto.isMasivo) setMensajes([]); else cargarConversacion(contacto.id);
  };

  const enviarMensaje = async (e) => {
    e.preventDefault();
    if (!nuevoMensaje.trim() || nuevoMensaje.length > 200) return;

    const payload = chatActivo.isMasivo 
      ? { destinatario_rol: chatActivo.rolTarget, mensaje: nuevoMensaje }
      : { destinatario_id: chatActivo.id, mensaje: nuevoMensaje };

    const res = await fetch(`${API_URL}/mensajeria/enviar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      if (data.esMasivo) {
        data.destinatarios.forEach(idUser => { socketRef.current.emit('enviar_mensaje', { destinatario_sala: `usuario_${idUser}`, remitente_id: usuario.id }); });
        setMensajes(prev => [...prev, { id: Date.now(), mensaje: nuevoMensaje, remitente_id: usuario.id, hora_envio: new Date() }]);
      } else {
        setMensajes(prev => [...prev, data.mensaje]);
        socketRef.current.emit('enviar_mensaje', { destinatario_sala: `usuario_${chatActivo.id}`, remitente_id: usuario.id });
      }
      setNuevoMensaje(''); cargarBandeja();
    }
  };

  const iniciarNuevoMensaje = () => {
    if (soySuperadmin) setVista('ligas'); else setVista('roles');
  };

  const formatearPlurales = (rol) => {
    const r = rol.toLowerCase();
    if (r === 'administrador de liga') return 'Administradores de Liga';
    if (r === 'anotador') return 'Anotadores';
    if (r === 'arbitro' || r === 'árbitro') return 'Árbitros';
    if (r === 'delegado de equipo') return 'Delegados de Equipo';
    return rol + 's';
  };

  const getInitials = (n, a) => {
    return `${(n || '').charAt(0)}${(a || '').charAt(0)}`.toUpperCase() || 'U';
  };

  const mensajesNoLeidos = bandeja.filter(b => b.remitente_id !== usuario.id && !b.hora_lectura).length;
  
  const ligasDisponibles = soySuperadmin ? [...new Set(contactos.map(c => c.organizacion_nombre).filter(Boolean))] : [];
  
  const bandejaFiltrada = soySuperadmin && filtroLigaBandeja !== 'Todas' 
    ? bandeja.filter(b => b.organizacion_nombre === filtroLigaBandeja) 
    : bandeja;

  const contactosFiltradosPorLiga = soySuperadmin && ligaSeleccionada ? contactos.filter(c => c.organizacion_nombre === ligaSeleccionada) : contactos;
  const rolesDisponibles = [...new Set(contactosFiltradosPorLiga.map(c => c.rol))];
  const usuariosDelRol = contactosFiltradosPorLiga.filter(c => c.rol === rolSeleccionado);

  const retrocederVista = () => {
    if (vista === 'chat' && chatActivo?.isMasivo) setVista('roles');
    else if (vista === 'chat') setVista('bandeja');
    else if (vista === 'usuarios') setVista('roles');
    else if (vista === 'roles') {
      if (soySuperadmin) setVista('ligas'); else setVista('bandeja');
    }
    else if (vista === 'ligas') setVista('bandeja');
  };

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-2000 font-sans">
      
      {/* BOTÓN FLOTANTE */}
      <div className="relative">
        <button 
          onClick={() => { setAbierto(!abierto); if (!abierto) { setVista('bandeja'); cargarBandeja(); } }} 
          className="bg-brand-rust text-white border-none rounded-full w-14 h-14 shadow-xl hover:bg-brand-brown hover:scale-105 transition-all flex items-center justify-center ring-4 ring-white/50"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
        </button>
        {mensajesNoLeidos > 0 && !abierto && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold border-2 border-white shadow-sm">
            {mensajesNoLeidos > 9 ? '9+' : mensajesNoLeidos}
          </span>
        )}
      </div>

      {/* VENTANA DEL CHAT (Completamente Responsiva) */}
      {abierto && (
        <div className="absolute bottom-16 sm:bottom-20 right-0 w-[calc(100vw-2rem)] sm:w-[24rem] h-137.5 max-h-[calc(100vh-8rem)] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden border border-brand-gold/40 animate-fade-in origin-bottom-right">
          
          {/* HEADER DEL MODAL */}
          <div className="bg-brand-brown text-brand-cream p-4 flex items-center gap-3 shrink-0 shadow-md relative z-10 border-b border-brand-gold/30">
            {vista !== 'bandeja' && (
              <button onClick={retrocederVista} className="text-brand-cream hover:text-brand-gold transition-colors shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
              </button>
            )}
            <div className="font-bold flex-1 truncate text-sm sm:text-base">
              {vista === 'bandeja' ? 'Bandeja de Entrada' : 
               vista === 'ligas' ? 'Seleccionar Liga' :
               vista === 'roles' ? (soySuperadmin ? ligaSeleccionada : 'Nuevo Mensaje') :
               vista === 'usuarios' ? `Para: ${formatearPlurales(rolSeleccionado)}` :
               `${chatActivo?.nombre} ${chatActivo?.apellido}`}
            </div>
            <button onClick={() => setAbierto(false)} className="text-brand-cream/70 hover:text-white transition-colors shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {/* CONTENIDO VARIABLE */}
          <div className="flex-1 flex flex-col bg-brand-cream/20 min-h-0 relative">
            
            {/* VISTA: BANDEJA */}
            {vista === 'bandeja' && (
              <>
                {soySuperadmin && (
                  <div className="p-3 bg-brand-cream border-b border-brand-gold/30 shrink-0 shadow-sm">
                    <select value={filtroLigaBandeja} onChange={(e) => setFiltroLigaBandeja(e.target.value)} className="w-full p-2.5 rounded-lg border border-brand-gold/40 text-sm text-brand-brown font-semibold focus:ring-2 focus:ring-brand-rust outline-none cursor-pointer bg-white">
                      <option value="Todas">Todas las Ligas</option>
                      {ligasDisponibles.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto hide-scrollbar">
                  {bandejaFiltrada.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-brand-brown/40 p-6 text-center">
                      <div className="w-16 h-16 bg-brand-gold/10 rounded-full flex items-center justify-center mb-3">
                        <svg className="w-8 h-8 text-brand-gold/60" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                      </div>
                      <p className="font-semibold text-sm text-brand-brown/60">Bandeja vacía</p>
                      <p className="text-xs mt-1">Tus conversaciones recientes aparecerán aquí.</p>
                    </div>
                  ) : bandejaFiltrada.map(b => {
                      const soyRemitente = b.remitente_id === usuario.id;
                      const noLeido = !soyRemitente && !b.hora_lectura;
                      
                      return (
                        <div key={b.id} onClick={() => seleccionarContacto(b)} className={`p-4 border-b border-brand-gold/20 cursor-pointer flex gap-3 transition-colors ${noLeido ? 'bg-brand-rust/5 border-l-4 border-l-brand-rust' : 'bg-white hover:bg-brand-cream/40 border-l-4 border-l-transparent'}`}>
                          
                          {/* Avatar Circle */}
                          <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-bold text-white shadow-sm text-sm ${noLeido ? 'bg-brand-rust' : 'bg-brand-blue'}`}>
                            {getInitials(b.nombre, b.apellido)}
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col justify-center">
                            <div className="flex justify-between items-center mb-0.5">
                              <strong className="text-brand-brown font-bold text-[0.9rem] truncate pr-2">{b.nombre} {b.apellido}</strong>
                              <span className={`text-[0.65rem] shrink-0 ${noLeido ? 'text-brand-rust font-bold' : 'text-brand-brown/50 font-medium'}`}>
                                {new Date(b.hora_envio).toLocaleTimeString('es-VE', {hour: '2-digit', minute:'2-digit'})}
                              </span>
                            </div>
                            
                            {soySuperadmin && <div className="text-[0.65rem] text-brand-gold font-bold uppercase tracking-wider mb-1 truncate">{b.organizacion_nombre} • {b.rol}</div>}
                            
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-xs truncate ${noLeido ? 'text-brand-brown font-semibold' : 'text-brand-brown/60'}`}>
                                {soyRemitente ? 'Tú: ' : ''}{b.ultimo_mensaje}
                              </span>
                              {noLeido && <span className="w-2.5 h-2.5 bg-brand-rust rounded-full shrink-0 shadow-sm"></span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
                
                <button onClick={iniciarNuevoMensaje} className="absolute bottom-5 right-5 bg-brand-blue hover:bg-brand-brown text-white rounded-full w-12 h-12 shadow-lg hover:scale-105 transition-all flex items-center justify-center ring-2 ring-white/50">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                </button>
              </>
            )}

            {/* VISTA: LIGAS (Solo Superadmin) */}
            {vista === 'ligas' && soySuperadmin && (
              <div className="flex-1 overflow-y-auto hide-scrollbar">
                <div className="px-4 py-3 bg-brand-cream text-xs font-bold text-brand-blue uppercase tracking-wider border-b border-brand-gold/30">Ligas Disponibles</div>
                {ligasDisponibles.map(l => (
                  <div key={l} onClick={() => { setLigaSeleccionada(l); setVista('roles'); }} className="p-4 bg-white border-b border-brand-gold/20 hover:bg-brand-cream/40 cursor-pointer flex justify-between items-center transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-brand-gold/20 flex items-center justify-center text-brand-gold group-hover:bg-brand-gold group-hover:text-white transition-colors">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                      </div>
                      <strong className="text-brand-brown text-sm">{l}</strong>
                    </div>
                    <svg className="w-4 h-4 text-brand-gold/50 group-hover:text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                  </div>
                ))}
              </div>
            )}

            {/* VISTA: ROLES */}
            {vista === 'roles' && (
              <div className="flex-1 overflow-y-auto hide-scrollbar">
                <div className="px-4 py-3 bg-brand-cream text-xs font-bold text-brand-blue uppercase tracking-wider border-b border-brand-gold/30">Grupos Operativos</div>
                {rolesDisponibles.map(r => (
                  <div key={r} onClick={() => { setRolSeleccionado(r); setVista('usuarios'); }} className="p-4 bg-white border-b border-brand-gold/20 hover:bg-brand-cream/40 cursor-pointer flex justify-between items-center transition-colors group">
                     <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center text-brand-blue group-hover:bg-brand-blue group-hover:text-white transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                      </div>
                      <strong className="text-brand-brown text-sm capitalize">{formatearPlurales(r)}</strong>
                    </div>
                    <svg className="w-4 h-4 text-brand-gold/50 group-hover:text-brand-rust" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                  </div>
                ))}
              </div>
            )}

            {/* VISTA: USUARIOS */}
            {vista === 'usuarios' && (
              <div className="flex-1 overflow-y-auto hide-scrollbar">
                {!soySuperadmin && (
                  <div onClick={() => seleccionarContacto({ id: `grupo_${rolSeleccionado}`, nombre: '📢 Todos los', apellido: formatearPlurales(rolSeleccionado), rol: 'Difusión', rolTarget: rolSeleccionado, isMasivo: true })} className="p-4 border-b-2 border-brand-rust/20 cursor-pointer bg-brand-rust/5 hover:bg-brand-rust/10 text-brand-rust transition-colors flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand-rust flex items-center justify-center text-white shadow-sm shrink-0">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
                    </div>
                    <div>
                      <strong className="block text-[0.9rem]">Mensaje de Difusión</strong>
                      <span className="text-xs opacity-80">Enviar a todos los {formatearPlurales(rolSeleccionado).toLowerCase()}</span>
                    </div>
                  </div>
                )}
                {usuariosDelRol.map(c => (
                  <div key={c.id} onClick={() => seleccionarContacto(c)} className="p-4 bg-white border-b border-brand-gold/20 hover:bg-brand-cream/40 cursor-pointer flex items-center gap-3 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-brand-blue flex items-center justify-center text-white text-sm font-bold shadow-sm shrink-0">
                      {getInitials(c.nombre, c.apellido)}
                    </div>
                    <div>
                      <strong className="text-brand-brown block text-[0.9rem]">{c.nombre} {c.apellido}</strong>
                      <span className="text-xs text-brand-gold font-bold uppercase tracking-wide">{c.rol}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* VISTA: CHAT ACTIVO */}
            {vista === 'chat' && chatActivo && (
              <>
                <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto hide-scrollbar flex flex-col gap-3">
                  
                  {chatActivo.isMasivo && (
                    <div className="bg-brand-gold/20 text-brand-brown p-3 rounded-lg text-xs text-center mb-2 font-bold border border-brand-gold/40 shadow-sm mx-4">
                      📢 Modo Difusión: Este mensaje llegará a todos los usuarios del grupo.
                    </div>
                  )}
                  
                  {mensajes.length === 0 && !chatActivo.isMasivo ? (
                    <div className="flex flex-col items-center justify-center h-full text-brand-brown/40">
                      <p className="font-medium text-sm bg-white px-4 py-2 rounded-full shadow-sm border border-brand-gold/20">Aún no hay mensajes. ¡Escribe el primero!</p>
                    </div>
                  ) : null}
                  
                  {mensajes.map(m => {
                    const mio = m.remitente_id === usuario.id;
                    return (
                      <div key={m.id} className={`max-w-[85%] p-3 shadow-sm ${mio ? 'self-end bg-brand-blue text-white rounded-2xl rounded-tr-none' : 'self-start bg-white border border-brand-gold/40 text-brand-brown rounded-2xl rounded-tl-none'}`}>
                        <div className="text-[0.9rem] leading-relaxed wrap-break-word">{m.mensaje}</div>
                        <div className={`text-[0.65rem] text-right mt-1.5 font-medium flex items-center justify-end gap-1 ${mio ? 'text-white/80' : 'text-brand-brown/50'}`}>
                          {new Date(m.hora_envio).toLocaleTimeString('es-VE', {hour: '2-digit', minute:'2-digit'})}
                          {mio && m.hora_lectura && !chatActivo.isMasivo && <span className="text-white">✓✓</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* ZONA DE INPUT */}
                <form onSubmit={enviarMensaje} className="bg-white p-3 border-t border-brand-gold/40 flex flex-col gap-2 shrink-0 z-10 shadow-[0_-4px_10px_-1px_rgba(0,0,0,0.05)]">
                  <textarea 
                    value={nuevoMensaje} 
                    onChange={e => setNuevoMensaje(e.target.value)} 
                    placeholder={chatActivo.isMasivo ? "Escribe el anuncio oficial..." : "Escribe un mensaje..."} 
                    maxLength={200} 
                    className="w-full resize-none p-3 bg-brand-cream/20 border border-brand-gold/50 rounded-lg text-sm focus:ring-2 focus:ring-brand-rust focus:border-brand-rust outline-none text-brand-brown font-medium transition-shadow" 
                    rows={2}
                  />
                  <div className="flex justify-between items-center px-1">
                    <span className={`text-[0.7rem] font-bold ${nuevoMensaje.length >= 200 ? 'text-red-500' : 'text-brand-brown/50'}`}>
                      {nuevoMensaje.length}/200
                    </span>
                    <button 
                      type="submit" 
                      disabled={!nuevoMensaje.trim()} 
                      className="px-5 py-2 rounded-lg text-sm font-bold transition-all shadow-sm bg-brand-rust text-white hover:bg-brand-brown disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-brand-rust"
                    >
                      Enviar
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}