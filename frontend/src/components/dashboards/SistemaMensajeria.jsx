import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export default function SistemaMensajeria({ usuario, token, ligaActivaId }) { // <-- RECIBIR EL PROP AQUÍ
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

  // ACTUALIZACIÓN DEL useEffect PARA ESCUCHAR CAMBIOS DE LIGA
  useEffect(() => {
    if (!usuario || !token) return;

    cargarBandeja();
    cargarContactos();

    // Solo inicializamos el socket una vez
    if (!socketRef.current) {
      socketRef.current = io(SOCKET_URL);
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

    return () => {
       // Opcional: desconectar en el desmontaje final.
    };
  }, [usuario, token, ligaActivaId]); // <-- DEPENDENCIA AÑADIDA

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes, vista]);

  // PASAR EL PARÁMETRO EN LOS FETCH
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

  const mensajesNoLeidos = bandeja.filter(b => b.remitente_id !== usuario.id && !b.hora_lectura).length;
  
  // FILTROS Y VARIABLES CALCULADAS
  // CORRECCIÓN: Ahora leemos las ligas disponibles de los contactos, no de los mensajes
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
    <div style={{ position: 'fixed', bottom: '30px', right: '30px', zIndex: 2000, fontFamily: 'sans-serif' }}>
      <div style={{ position: 'relative' }}>
        <button onClick={() => { setAbierto(!abierto); if (!abierto) { setVista('bandeja'); cargarBandeja(); } }} style={{ background: '#2B6CB0', color: 'white', border: 'none', borderRadius: '50%', width: '60px', height: '60px', fontSize: '1.8em', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.2)' }}>💬</button>
        {mensajesNoLeidos > 0 && !abierto && (<span style={{ position: 'absolute', top: '-5px', right: '-5px', background: '#E53E3E', color: 'white', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85em', fontWeight: 'bold', border: '2px solid white' }}>{mensajesNoLeidos > 9 ? '9+' : mensajesNoLeidos}</span>)}
      </div>

      {abierto && (
        <div style={{ position: 'absolute', bottom: '80px', right: '0', width: '350px', height: '520px', background: '#FFF', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          <div style={{ background: '#2D3748', color: '#FFF', padding: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            {vista !== 'bandeja' && (<button onClick={retrocederVista} style={{ background: 'transparent', border: 'none', color: '#FFF', cursor: 'pointer', fontSize: '1.2em' }}>⬅️</button>)}
            <div style={{ fontWeight: 'bold', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {vista === 'bandeja' ? 'Bandeja de Entrada' : 
               vista === 'ligas' ? 'Seleccionar Liga' :
               vista === 'roles' ? (soySuperadmin ? ligaSeleccionada : 'Nuevo Mensaje') :
               vista === 'usuarios' ? `Seleccionar ${formatearPlurales(rolSeleccionado)}` :
               `${chatActivo?.nombre} ${chatActivo?.apellido}`}
            </div>
            <span onClick={() => setAbierto(false)} style={{ cursor: 'pointer', padding: '0 5px' }}>✖</span>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#F7FAFC', minHeight: 0, position: 'relative' }}>
            
            {vista === 'bandeja' && (
              <>
                {soySuperadmin && (
                  <div style={{ padding: '8px 15px', background: '#EDF2F7', borderBottom: '1px solid #CBD5E0' }}>
                    <select value={filtroLigaBandeja} onChange={(e) => setFiltroLigaBandeja(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #CBD5E0', fontSize: '0.85em' }}>
                      <option value="Todas">Todas las Ligas</option>
                      {/* CORRECCIÓN: Iteramos sobre ligasDisponibles */}
                      {ligasDisponibles.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                )}

                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {bandejaFiltrada.length === 0 ? <p style={{ textAlign: 'center', color: '#A0AEC0', marginTop: '50%' }}>Sin conversaciones.</p> : bandejaFiltrada.map(b => {
                      const soyRemitente = b.remitente_id === usuario.id;
                      const noLeido = !soyRemitente && !b.hora_lectura;
                      return (
                        <div key={b.id} onClick={() => seleccionarContacto(b)} style={{ padding: '12px 15px', borderBottom: '1px solid #E2E8F0', cursor: 'pointer', display: 'flex', flexDirection: 'column', background: noLeido ? '#EBF8FF' : '#FFF' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong style={{ color: '#2D3748', fontSize: '0.95em' }}>{b.nombre} {b.apellido}</strong>
                            <span style={{ fontSize: '0.7em', color: noLeido ? '#2B6CB0' : '#A0AEC0', fontWeight: noLeido ? 'bold' : 'normal' }}>{new Date(b.hora_envio).toLocaleTimeString('es-VE', {hour: '2-digit', minute:'2-digit'})}</span>
                          </div>
                          {soySuperadmin && <div style={{ fontSize: '0.75em', color: '#718096', margin: '2px 0' }}>{b.organizacion_nombre} | {b.rol}</div>}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
                            <span style={{ fontSize: '0.85em', color: noLeido ? '#2B6CB0' : '#718096', fontWeight: noLeido ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{soyRemitente ? 'Tú: ' : ''}{b.ultimo_mensaje}</span>
                            {noLeido && <span style={{ width: '8px', height: '8px', background: '#3182CE', borderRadius: '50%', marginLeft: 'auto', flexShrink: 0 }}></span>}
                          </div>
                        </div>
                      );
                    })}
                </div>
                <button onClick={iniciarNuevoMensaje} style={{ position: 'absolute', bottom: '15px', right: '15px', background: '#38A169', color: 'white', border: 'none', borderRadius: '50%', width: '50px', height: '50px', fontSize: '1.8em', cursor: 'pointer', boxShadow: '0 4px 6px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
              </>
            )}

            {vista === 'ligas' && soySuperadmin && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <div style={{ padding: '10px 15px', background: '#EDF2F7', fontSize: '0.85em', color: '#4A5568', fontWeight: 'bold' }}>¿A qué liga deseas escribir?</div>
                {ligasDisponibles.map(l => (
                  <div key={l} onClick={() => { setLigaSeleccionada(l); setVista('roles'); }} style={{ padding: '15px', borderBottom: '1px solid #E2E8F0', cursor: 'pointer', background: '#FFF', display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ color: '#2D3748' }}>{l}</strong><span style={{ color: '#A0AEC0' }}>➡️</span>
                  </div>
                ))}
              </div>
            )}

            {vista === 'roles' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <div style={{ padding: '10px 15px', background: '#EDF2F7', fontSize: '0.85em', color: '#4A5568', fontWeight: 'bold' }}>Elige a quién escribir:</div>
                {rolesDisponibles.map(r => (
                  <div key={r} onClick={() => { setRolSeleccionado(r); setVista('usuarios'); }} style={{ padding: '15px', borderBottom: '1px solid #E2E8F0', cursor: 'pointer', background: '#FFF', display: 'flex', justifyContent: 'space-between' }}>
                    <strong style={{ color: '#2D3748' }}>{formatearPlurales(r)}</strong><span style={{ color: '#A0AEC0' }}>➡️</span>
                  </div>
                ))}
              </div>
            )}

            {vista === 'usuarios' && (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {!soySuperadmin && (
                  <div onClick={() => seleccionarContacto({ id: `grupo_${rolSeleccionado}`, nombre: '📢 Todos los', apellido: formatearPlurales(rolSeleccionado), rol: 'Difusión', rolTarget: rolSeleccionado, isMasivo: true })} style={{ padding: '15px', borderBottom: '2px solid #E2E8F0', cursor: 'pointer', background: '#EBF8FF', color: '#2B6CB0', fontWeight: 'bold' }}>📢 Enviar mensaje a todos</div>
                )}
                {usuariosDelRol.map(c => (
                  <div key={c.id} onClick={() => seleccionarContacto(c)} style={{ padding: '12px 15px', borderBottom: '1px solid #E2E8F0', cursor: 'pointer', background: '#FFF' }}>
                    <strong style={{ color: '#2D3748', display: 'block' }}>{c.nombre} {c.apellido}</strong>
                    <span style={{ fontSize: '0.8em', color: '#718096' }}>{c.rol}</span>
                  </div>
                ))}
              </div>
            )}

            {vista === 'chat' && chatActivo && (
              <>
                <div ref={scrollRef} style={{ flex: 1, padding: '15px', overflowY: 'auto', background: '#E2E8F0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {chatActivo.isMasivo && (<div style={{ background: '#FEFCBF', color: '#975A16', padding: '10px', borderRadius: '8px', fontSize: '0.85em', textAlign: 'center', marginBottom: '10px' }}>📢 Mensaje de difusión masiva.</div>)}
                  {mensajes.length === 0 && !chatActivo.isMasivo ? <p style={{ textAlign: 'center', color: '#718096', fontSize: '0.9em' }}>Inicia la conversación...</p> : null}
                  {mensajes.map(m => {
                    const mio = m.remitente_id === usuario.id;
                    return (
                      <div key={m.id} style={{ alignSelf: mio ? 'flex-end' : 'flex-start', background: mio ? '#C6F6D5' : '#FFF', padding: '10px 14px', borderRadius: '12px', maxWidth: '85%', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                        <div style={{ fontSize: '0.95em', color: '#1A202C' }}>{m.mensaje}</div>
                        <div style={{ fontSize: '0.7em', color: '#A0AEC0', textAlign: 'right', marginTop: '4px' }}>
                          {new Date(m.hora_envio).toLocaleTimeString('es-VE', {hour: '2-digit', minute:'2-digit'})}
                          {mio && m.hora_lectura && !chatActivo.isMasivo && <span style={{ color: '#3182CE', marginLeft: '5px' }}>✓✓</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <form onSubmit={enviarMensaje} style={{ background: '#FFF', padding: '10px', borderTop: '1px solid #CBD5E0', display: 'flex', flexDirection: 'column', gap: '5px', flexShrink: 0 }}>
                  <textarea value={nuevoMensaje} onChange={e => setNuevoMensaje(e.target.value)} placeholder={chatActivo.isMasivo ? "Anuncio oficial..." : "Escribe un mensaje..."} maxLength={200} style={{ width: '100%', resize: 'none', padding: '10px', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', fontFamily: 'inherit' }} rows={2}/>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75em', color: nuevoMensaje.length >= 200 ? '#E53E3E' : '#A0AEC0' }}>{nuevoMensaje.length}/200</span>
                    <button type="submit" disabled={!nuevoMensaje.trim()} style={{ padding: '8px 20px', background: nuevoMensaje.trim() ? '#3182CE' : '#CBD5E0', color: '#FFF', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: nuevoMensaje.trim() ? 'pointer' : 'not-allowed' }}>Enviar</button>
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