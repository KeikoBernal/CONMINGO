// LOTE 6G: utilidad de correo saliente (SMTP propio) y tokens de verificacion.
// Agnostica del proveedor: todo se lee de variables de entorno:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, URL_FRONTEND
// Ruta adicional (incidente Render 2/11/2026): con GMAIL_SCRIPT_URL y
// GMAIL_SCRIPT_SECRETO los envios van por Google Apps Script por HTTPS (puerto
// 443, que Render no bloquea) en vez de por SMTP.
// Sin SMTP_HOST la utilidad entra en modo degradado: ningun correo se envia
// y los endpoints que la usan deciden como fallar (por ejemplo, mostrar la
// clave temporal al administrador, como hacia el sistema antes de este lote).
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const dns = require('dns');
const db = require('../config/db');

const SMTP_CONFIGURADO = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

// LOTE 6G: aviso de arranque para diagnosticar el SMTP desde el log de Render
// (nunca imprime la contrasena, solo si esta definida).
console.log('[correo] SMTP al arrancar:', SMTP_CONFIGURADO ? 'configurado' : 'SIN CONFIGURAR (faltan SMTP_HOST, SMTP_USER o SMTP_PASS)', {
  host: process.env.SMTP_HOST || '(falta)',
  puerto: process.env.SMTP_PORT || '(falta, se usara 465)',
  usuario: process.env.SMTP_USER || '(falta)',
  contrasena: process.env.SMTP_PASS ? 'definida' : '(falta)',
  remitente: process.env.SMTP_FROM || '(falta, se usara SMTP_USER)'
});

// ============================================================================
// INCIDENTE RENDER 2/11/2026: puente de envio por Google Apps Script (HTTPS).
// ============================================================================
// El plan gratuito de Render bloquea el SMTP saliente (puertos 25, 465 y 587)
// descartando los paquetes en silencio, y los proveedores transaccionales
// gratuitos exigen verificacion telefonica que no llega a Venezuela (Brevo y
// Elastic Email la pidieron). Este puente llama por HTTPS (puerto 443, que
// Render no bloquea) a una pequena aplicacion web de Google Apps Script
// desplegada con la misma cuenta de Gmail de la liga (el archivo esta en
// backend/scripts/EnviarCorreoCONMINGO.gs): sin consola de Google Cloud, sin
// pantallas OAuth ni tokens de refresco. Requiere 2 variables en Render:
//   GMAIL_SCRIPT_URL (la URL /exec de la aplicacion web desplegada),
//   GMAIL_SCRIPT_SECRETO (la frase secreta compartida con el script)
// Cuota de Gmail de consumo: 100 correos/dia. Es un puente, no un lock-in: el
// dia que exista un proveedor SMTP viable (por ejemplo Resend con dominio
// propio verificado), basta borrar las variables GMAIL_* y la utilidad vuelve
// al camino SMTP sin cambiar codigo.
const GMAIL_SCRIPT_URL = process.env.GMAIL_SCRIPT_URL;
const GMAIL_SCRIPT_SECRETO = process.env.GMAIL_SCRIPT_SECRETO;
const GMAIL_CONFIGURADO = !!(GMAIL_SCRIPT_URL && GMAIL_SCRIPT_SECRETO);

console.log('[correo] Ruta de envio activa:', GMAIL_CONFIGURADO
  ? 'Gmail por Apps Script (HTTPS, variables GMAIL_* presentes)'
  : 'SMTP (sin variables GMAIL_*, el puente de Apps Script esta apagado)');

// Pausa entre reintentos del puente de Apps Script.
const esperarMs = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Un intento de llamada a la aplicacion web del Apps Script. Devuelve
// { exito: true } o { exito: false, error, esHtml }.
const intentarLlamadaScript = async ({ para, asunto, html, texto }) => {
  // Apps Script no recibe los POST con Content-Type application/json: el
  // endpoint /exec responde con una cadena de redirecciones que convierte
  // el POST en GET (el cuerpo se pierde, doPost nunca corre y la respuesta
  // final es una pagina HTML con estado 200). Con text/plain el POST llega
  // directo al script y e.postData.contents trae el JSON: es el patron
  // canonico documentado para integrar apps web de Apps Script.
  const res = await fetch(GMAIL_SCRIPT_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      secreto: GMAIL_SCRIPT_SECRETO,
      para,
      asunto,
      html,
      texto: texto || html.replace(/<[^>]+>/g, ' ')
    })
  });
  const cuerpo = await res.text().catch(() => '');
  let data = null;
  try {
    data = JSON.parse(cuerpo);
  } catch (error) {
    data = null;
  }
  if (res.ok && data && data.ok === true) return { exito: true };
  const esHtml = data === null && cuerpo.trim().charAt(0) === '<';
  const detalle = data && data.error
    ? data.error
    : 'respuesta inesperada del script (verificar el despliegue con acceso Cualquier usuario): ' + cuerpo.slice(0, 120).replace(/\s+/g, ' ');
  return { exito: false, error: 'HTTP ' + res.status + ': ' + detalle, esHtml };
};

// Llama a la aplicacion web del Apps Script con el mensaje ya compuesto.
// LECCION (incidente del 2/11/2026): durante arranques en frio del proxy
// de Apps Script o cambios de enrutado de borde, Google sirve
// transitoriamente una pagina HTML de desafio (window['ppConfig']) en
// lugar del JSON del script; al reintentar a los pocos segundos el mismo
// pedido responde bien (comportamiento documentado por otros
// integradores). Se reintentan hasta 3 veces con pausa de 3 segundos SOLO
// ante ese caso (respuestas HTML); los errores reales del script (secreto
// invalido, campos faltantes) o de HTTP no se reintentan.
const enviarPorGmailApi = async ({ para, asunto, html, texto }) => {
  const inicio = Date.now();
  let ultimoError = null;
  try {
    for (let intento = 1; intento <= 3; intento++) {
      const r = await intentarLlamadaScript({ para, asunto, html, texto });
      if (r.exito) {
        const ms = Date.now() - inicio;
        console.log('[correo] Enviado a ' + para + ' en ' + ms + ' ms (via Gmail/Script)' + (intento > 1 ? ' (intento ' + intento + ')' : ''));
        return { ok: true, ms };
      }
      ultimoError = r.error;
      console.error('[correo] Fallo el envio via Apps Script (intento ' + intento + ' de 3):', { para, error: r.error });
      if (intento < 3 && r.esHtml) {
        await esperarMs(3000);
        continue;
      }
      break;
    }
    return { ok: false, ms: Date.now() - inicio, error: 'Gmail Script: ' + ultimoError };
  } catch (error) {
    return { ok: false, ms: Date.now() - inicio, error: 'Gmail Script: ' + (error?.message || String(error)) };
  }
};

let transporte = null;
let ipActual = null; // IPv4 que usa el transporte vigente (null si conecta por nombre)
let ipExitosa = null; // IPv4 que ya logro conectar alguna vez (se prefiere)
let indiceIp = 0; // rotacion: la proxima reconstruccion usa otra IPv4 de la lista
let ipsSmtp = []; // todas las IPv4 del host SMTP (vacia si se conecta por nombre)
let usarHostname = false; // ultimo recurso tras fallar todas las IPv4

// ============================================================================
// LOTE 6J: control anti-reenvio (contrarresta la impaciencia)
// ============================================================================
// Los envios por Gmail desde Render pueden tardar hasta ~2 minutos. Sin este
// control, repetir el clic (o recargar la pagina y volver a intentarlo, o
// pedirlo desde otra sesion de administrador) genera varios correos iguales.
// Por cada usuario y tipo de token se marca un envio EN CURSO; mientras esta
// en curso, o durante MARGEN_REENVIO_MS despues de un envio exitoso, un pedido
// repetido NO genera otro correo: devuelve motivo 'reenvio_reciente' con un
// mensaje listo para mostrar. Si el envio falla, la marca se libera para
// permitir un reintento real. Es estado en memoria del proceso: se pierde al
// reiniciar, aceptable para una ventana de minutos.
const MARGEN_REENVIO_MS = 120000;
const enviosMarcados = new Map(); // clave usuarioId|tipo -> { desde, enCurso }

const formaBloqueoCorreo = (mensaje) => ({ enviado: false, motivo: 'reenvio_reciente', mensaje });

const mensajeReenvioReciente = (reciente) => reciente.enCurso
  ? 'Ya hay un correo en proceso de envio para esta persona; puede tardar hasta 2 minutos. No es necesario volver a enviarlo.'
  : 'Hace menos de 2 minutos se envio el mismo correo a esta persona y el enlace anterior sigue siendo valido. Revisa la bandeja (y el correo no deseado) antes de volver a enviar.';

const reenvioReciente = (usuarioId, tipo) => {
  const clave = String(usuarioId) + '|' + tipo;
  const marca = enviosMarcados.get(clave);
  if (!marca) return null;
  const transcurrido = Date.now() - marca.desde;
  if (marca.enCurso || transcurrido < MARGEN_REENVIO_MS) {
    return { enCurso: marca.enCurso, segundosRestantes: Math.max(1, Math.ceil((MARGEN_REENVIO_MS - transcurrido) / 1000)) };
  }
  return null;
};

// Envuelve un flujo de correo completo con el control anti-reenvio.
// formaBloqueo moldea la respuesta cuando hay un reenvio reciente (cada flujo
// tiene su propia forma de resultado).
const conControlReenvio = async (usuarioId, tipo, hacer, formaBloqueo) => {
  const reciente = reenvioReciente(usuarioId, tipo);
  if (reciente) return (formaBloqueo || formaBloqueoCorreo)(mensajeReenvioReciente(reciente));
  const clave = String(usuarioId) + '|' + tipo;
  enviosMarcados.set(clave, { desde: Date.now(), enCurso: true });
  try {
    const resultado = await hacer();
    if (resultado && (resultado.enviado || resultado.enviadoNuevo)) {
      enviosMarcados.set(clave, { desde: Date.now(), enCurso: false });
    } else {
      enviosMarcados.delete(clave);
    }
    return resultado;
  } catch (error) {
    enviosMarcados.delete(clave);
    throw error;
  }
};

const construirTransporte = async () => {
  const puerto = parseInt(process.env.SMTP_PORT || '465', 10);
  const host = process.env.SMTP_HOST;

  // LOTE 6I: smtp.gmail.com tiene direcciones IPv4 e IPv6 y nodemailer elige
  // una al azar en cada conexion; en Render la ruta IPv6 hacia Gmail se cae en
  // silencio. Pero ademas, de las varias IPv4 que publica Gmail, algunas NO
  // son alcanzables desde la red de Render (el TCP al puerto 465 se cae en
  // silencio): se vio en produccion un Connection timeout con una IPv4 concreta.
  // Por eso se resuelven TODAS las IPv4 y se conecta a una concreta (el nombre
  // original queda como servername para que el certificado TLS de Gmail siga
  // validando); enviarCorreo rota a la siguiente IPv4 si esa falla.
  let hostConexion = host;
  let servernameTls = null;
  ipActual = null;
  if (!usarHostname) {
    try {
      const direcciones = await dns.promises.resolve4(host);
      if (Array.isArray(direcciones) && direcciones.length > 0) {
        ipsSmtp = direcciones;
        if (ipExitosa && direcciones.includes(ipExitosa)) {
          hostConexion = ipExitosa;
        } else {
          hostConexion = direcciones[indiceIp % direcciones.length];
          indiceIp += 1;
        }
        servernameTls = host;
      }
    } catch (error) {
      // resolve4 no disponible o host sin registros A: se intenta una sola
      // IPv4 y, si tambien falla, se conecta por nombre tal cual.
      try {
        const resolucion = await dns.promises.lookup(host, { family: 4 });
        hostConexion = resolucion.address;
        servernameTls = host;
      } catch (error2) {
        console.error('[correo] No se pudo resolver ' + host + ' a IPv4, se conecta por nombre:', error2?.message || error2);
      }
    }
  }
  if (servernameTls) ipActual = hostConexion;

  const opciones = {
    host: hostConexion,
    port: puerto,
    secure: puerto === 465,
    // Pool: se reutilizan conexiones en lugar de abrir una nueva por correo.
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    // Timeouts generosos (leccion del lote 6i): la conexion SMTP a Gmail desde
    // Render puede tardar mas de un minuto en completarse. Los timeouts cortos
    // (10-15 s) convertian esa lentitud en el error Connection timeout y
    // rompian envios que con paciencia si llegaban. Se mantiene el log de
    // duracion en ms para medir cuanto tarda de verdad cada envio.
    connectionTimeout: 120000,
    greetingTimeout: 120000,
    socketTimeout: 300000,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  };
  if (servernameTls) {
    opciones.servername = servernameTls;
    // En el upgrade STARTTLS (puerto 587) nodemailer lee el servername de
    // opciones.tls: sin esto, al conectar a una IP el certificado de Gmail no
    // validaria y el envio por 587 fallaria.
    opciones.tls = { servername: servernameTls };
  }

  console.log('[correo] Transporte hacia ' + hostConexion + (servernameTls ? ' (servername: ' + servernameTls + ')' : ' (por nombre)') + '. IPv4 disponibles: ' + (usarHostname ? 'no (modo nombre)' : (ipsSmtp.join(', ') || '1')));
  transporte = nodemailer.createTransport(opciones);
  return transporte;
};

const obtenerTransporte = async () => transporte || construirTransporte();

// Errores que justifican rotar a otra IPv4 y reintentar (fallas de conexion).
const esErrorDeConexion = (mensaje) => {
  const m = String(mensaje || '').toLowerCase();
  return m.includes('connection timeout') || m.includes('greeting never received') ||
    m.includes('econnection') || m.includes('etimedout') || m.includes('econnrefused') ||
    m.includes('ehostunreach') || m.includes('enetunreach') || m.includes('econnreset') ||
    m.includes('socket hang up') || m.includes('certificate') || m.includes('tls');
};

const remitente = () => process.env.SMTP_FROM || process.env.SMTP_USER || 'CONMINGO';

// Envia un correo. Devuelve { enviado: true } o { enviado: false, motivo }.
// LOTE 6I: si la IPv4 en uso falla a nivel de conexion (timeout, rechazo, TLS),
// se reconstruye el transporte con otra IPv4 de la lista y se reintenta (hasta
// 3 IPs); la IP que funciona queda en cache para los envios siguientes. Como
// ultimo recurso se conecta por nombre (nodemailer probara todas sus direcciones).
const intentarEnviar = async ({ para, asunto, html, texto }) => {
  const inicio = Date.now();
  try {
    await (await obtenerTransporte()).sendMail({
      from: remitente(),
      to: para,
      subject: asunto,
      html,
      text: texto || html.replace(/<[^>]+>/g, ' ')
    });
    return { ok: true, ms: Date.now() - inicio };
  } catch (error) {
    return { ok: false, ms: Date.now() - inicio, error: error?.message || String(error) };
  }
};

const enviarCorreo = async ({ para, asunto, html, texto }) => {
  // Puente Gmail API (incidente Render/SMTP): si las variables GMAIL_* estan,
  // se envia por HTTPS y el SMTP bloqueado ni siquiera se toca.
  if (GMAIL_CONFIGURADO) {
    const r = await enviarPorGmailApi({ para, asunto, html, texto });
    if (r.ok) return { enviado: true };
    console.error('[correo] No se pudo enviar (Apps Script):', { para, asunto, error: r.error });
    return { enviado: false, motivo: 'error_envio', error: r.error };
  }
  if (!SMTP_CONFIGURADO) return { enviado: false, motivo: 'smtp_no_configurado' };
  await obtenerTransporte(); // resuelve las IPv4 disponibles si es la primera vez
  const intentosMax = ipsSmtp.length > 1 ? Math.min(ipsSmtp.length, 3) : 1;
  let ultimoError = null;
  for (let intento = 1; intento <= intentosMax; intento++) {
    const r = await intentarEnviar({ para, asunto, html, texto });
    if (r.ok) {
      if (ipActual) ipExitosa = ipActual;
      console.log('[correo] Enviado a ' + para + ' en ' + r.ms + ' ms' + (ipActual ? ' via ' + ipActual : '') + (intento > 1 ? ' (intento ' + intento + ')' : ''));
      return { enviado: true };
    }
    ultimoError = r.error;
    console.error('[correo] Fallo el envio (intento ' + intento + ' de ' + intentosMax + (ipActual ? ' via ' + ipActual : '') + '):', { para, asunto, error: r.error });
    if (intento >= intentosMax || !esErrorDeConexion(r.error)) break;
    transporte = null; // fuerza reconstruir el transporte con otra IPv4
  }

  // Ultima alternativa: conectar por nombre y dejar que nodemailer pruebe
  // todas sus direcciones (incluida la IPv6 lenta de Render, solo como red de
  // seguridad). El proximo pedido vuelve a intentar por IPv4.
  if (ultimoError && ipsSmtp.length > 0 && !usarHostname && esErrorDeConexion(ultimoError)) {
    usarHostname = true;
    transporte = null;
    const r = await intentarEnviar({ para, asunto, html, texto });
    if (r.ok) {
      console.log('[correo] Enviado a ' + para + ' en ' + r.ms + ' ms (por nombre)');
      return { enviado: true };
    }
    ultimoError = r.error;
    console.error('[correo] Tambien fallo el envio por nombre:', { para, asunto, error: r.error });
    usarHostname = false;
    transporte = null;
  }

  console.error('[correo] No se pudo enviar:', { para, asunto, error: ultimoError });
  return { enviado: false, motivo: 'error_envio', error: ultimoError };
};

const URL_FRONTEND = () => String(process.env.URL_FRONTEND || 'https://conmingo.vercel.app').replace(/\/+$/, '');

// Plantilla HTML con la paleta de marca. Sin emojis (regla del proyecto).
const plantilla = (titulo, cuerpo) => [
  '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #d8c9a3; border-radius: 10px; overflow: hidden;">',
  '<div style="background: #3b2314; padding: 20px 24px;">',
  '<h1 style="color: #f0c75e; margin: 0; font-size: 20px; letter-spacing: 2px;">CONMINGO</h1>',
  '<p style="color: #efe6d6; margin: 4px 0 0; font-size: 12px;">Sistema de gestion de ligas de bolas criollas</p>',
  '</div>',
  '<div style="padding: 24px; background: #fdf8ef; color: #3b2314;">',
  '<h2 style="margin: 0 0 16px; font-size: 18px;">' + titulo + '</h2>',
  cuerpo,
  '<p style="margin-top: 28px; font-size: 12px; color: #7a6a55;">Este es un mensaje automatico del sistema CONMINGO. Si no esperabas este correo, ignoralo.</p>',
  '</div></div>'
].join('\n');

const boton = (url, etiqueta) => [
  '<p style="text-align: center; margin: 24px 0;">',
  '<a href="' + url + '" style="background: #a34a29; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">' + etiqueta + '</a>',
  '</p>',
  '<p style="font-size: 12px; color: #7a6a55; text-align: center; margin: 0;">Si el boton no funciona, copia y pega este enlace en tu navegador:<br>' + url + '</p>'
].join('\n');

// ============================================================================
// TOKENS DE CORREO (se guarda el hash sha256, nunca el token en claro)
// ============================================================================
const crearTokenCorreo = async (usuarioId, tipo, horasValidez = 48) => {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  // LOTE 6I: un nuevo pedido invalida los enlaces previos del mismo usuario y
  // tipo: si se presiona el boton varias veces, solo sirve el ultimo correo.
  await db.query('UPDATE public.tokens_correo SET usado = true WHERE usuario_id = $1 AND tipo = $2 AND usado = false', [usuarioId, tipo]);
  await db.query(
    'INSERT INTO public.tokens_correo (usuario_id, tipo, token_hash, expira_en) VALUES ($1, $2, $3, now() + ($4 || \' hours\')::interval)',
    [usuarioId, tipo, tokenHash, horasValidez]
  );
  return token;
};

// Consume un token valido (no usado, no expirado, usuario activo).
// Devuelve { usuario_id, email, nombre, email_pendiente } o null.
const consumirTokenCorreo = async (token, tipo) => {
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const res = await db.query(
    'UPDATE public.tokens_correo t SET usado = true, usado_en = now() ' +
    'FROM public.usuarios u ' +
    'WHERE t.token_hash = $1 AND t.tipo = $2 AND t.usado = false AND t.expira_en > now() ' +
    'AND u.id = t.usuario_id AND u.estado <> \'Inactivo\' ' +
    'RETURNING t.usuario_id, u.email, u.nombre, u.email_pendiente',
    [tokenHash, tipo]
  );
  return res.rows[0] || null;
};

// ============================================================================
// CORREOS DEL LOTE 6G
// ============================================================================

// Bienvenida al crear credenciales: usuario, clave temporal y enlace de verificacion.
const enviarBienvenidaConVerificacion = async ({ usuarioId, para, nombre, usuario, claveTemporal }) => conControlReenvio(usuarioId, 'verificacion', async () => {
  const token = await crearTokenCorreo(usuarioId, 'verificacion', 48);
  const url = URL_FRONTEND() + '/?verificar=' + token;
  const cuerpo = [
    '<p>Hola <strong>' + (nombre || usuario) + '</strong>:</p>',
    '<p>Tu cuenta de acceso al sistema CONMINGO ya esta creada.</p>',
    '<p>Usuario: <strong>' + usuario + '</strong><br>Clave temporal: <strong>' + claveTemporal + '</strong> (deberas cambiarla al iniciar sesion).</p>',
    '<p>Para activar tu cuenta debes verificar este correo:</p>',
    boton(url, 'Verificar mi correo'),
    '<p style="font-size: 12px; color: #7a6a55;">Tu acceso permanecera bloqueado hasta que verifiques el correo. El enlace es valido por 48 horas.</p>'
  ].join('\n');
  return enviarCorreo({ para, asunto: 'Bienvenido a CONMINGO - Credenciales de acceso', html: plantilla('Credenciales de acceso', cuerpo) });
});

// Reenvio del enlace de verificacion (solo el enlace, sin clave).
const reenviarVerificacion = async ({ usuarioId, para, nombre }) => conControlReenvio(usuarioId, 'verificacion', async () => {
  const token = await crearTokenCorreo(usuarioId, 'verificacion', 48);
  const url = URL_FRONTEND() + '/?verificar=' + token;
  const cuerpo = [
    '<p>Hola <strong>' + (nombre || para) + '</strong>:</p>',
    '<p>Tu cuenta sigue pendiente de verificacion. Usa el siguiente enlace para activarla:</p>',
    boton(url, 'Verificar mi correo'),
    '<p style="font-size: 12px; color: #7a6a55;">Si no recuerdas tu clave temporal, contacta al administrador de tu liga. El enlace es valido por 48 horas.</p>'
  ].join('\n');
  return enviarCorreo({ para, asunto: 'Verifica tu correo - CONMINGO', html: plantilla('Verificacion de correo', cuerpo) });
});

// Cambio de correo: aviso al correo antiguo + confirmacion al nuevo.
const solicitarCambioCorreo = async ({ usuarioId, nombre, paraAntiguo, paraNuevo }) => conControlReenvio(usuarioId, 'cambio_correo', async () => {
  const token = await crearTokenCorreo(usuarioId, 'cambio_correo', 24);
  const url = URL_FRONTEND() + '/?verificar=' + token;

  // Aviso al correo antiguo (notificacion, no requiere accion)
  const cuerpoAviso = [
    '<p>Hola <strong>' + (nombre || paraAntiguo) + '</strong>:</p>',
    '<p>Se solicito cambiar el correo de tu cuenta de CONMINGO a <strong>' + paraNuevo + '</strong>.</p>',
    '<p>Si fuiste tu, no necesitas hacer nada: el cambio se aplica cuando el nuevo correo lo confirme.</p>',
    '<p>Si NO fuiste tu, contacta de inmediato al administrador de tu liga.</p>'
  ].join('\n');
  const resAntiguo = await enviarCorreo({ para: paraAntiguo, asunto: 'Solicitud de cambio de correo - CONMINGO', html: plantilla('Cambio de correo solicitado', cuerpoAviso) });

  // Confirmacion al correo nuevo (requiere accion)
  const cuerpoNuevo = [
    '<p>Hola <strong>' + (nombre || paraNuevo) + '</strong>:</p>',
    '<p>Se solicito usar este correo para tu cuenta de CONMINGO. Para completar el cambio confirma el correo:</p>',
    boton(url, 'Confirmar nuevo correo'),
    '<p style="font-size: 12px; color: #7a6a55;">El enlace es valido por 24 horas. Hasta confirmar, tu acceso sigue funcionando con el correo anterior.</p>'
  ].join('\n');
  const resNuevo = await enviarCorreo({ para: paraNuevo, asunto: 'Confirma tu nuevo correo - CONMINGO', html: plantilla('Confirmacion de nuevo correo', cuerpoNuevo) });

  return { enviadoAntiguo: resAntiguo.enviado, motivoAntiguo: resAntiguo.motivo, errorAntiguo: resAntiguo.error, enviadoNuevo: resNuevo.enviado, motivoNuevo: resNuevo.motivo, errorNuevo: resNuevo.error };
}, (mensaje) => ({
  enviadoAntiguo: false, motivoAntiguo: 'reenvio_reciente', errorAntiguo: null,
  enviadoNuevo: false, motivoNuevo: 'reenvio_reciente', errorNuevo: null,
  mensajeNuevo: mensaje
}));

// LOTE 6H: restablecimiento de clave. El administrador pide el reset desde el
// panel y la persona recibe un enlace para establecer su propia contrasena
// (token de 'recuperacion', 24 horas). La clave nunca viaja en el correo.
const enviarRestablecerPassword = async ({ usuarioId, para, nombre }) => conControlReenvio(usuarioId, 'recuperacion', async () => {
  const token = await crearTokenCorreo(usuarioId, 'recuperacion', 24);
  const url = URL_FRONTEND() + '/?restablecer=' + token;
  const cuerpo = [
    '<p>Hola <strong>' + (nombre || para) + '</strong>:</p>',
    '<p>Se solicitó restablecer la contraseña de tu cuenta de CONMINGO.</p>',
    '<p>Usa el siguiente enlace para establecer tu nueva contraseña:</p>',
    boton(url, 'Establecer mi contraseña'),
    '<p style="font-size: 12px; color: #7a6a55;">El enlace es válido por 24 horas. Tu contraseña actual sigue funcionando hasta que establezcas la nueva.</p>'
  ].join('\n');
  return enviarCorreo({ para, asunto: 'Restablece tu contraseña - CONMINGO', html: plantilla('Restablecimiento de contraseña', cuerpo) });
});

module.exports = {
  enviarCorreo,
  crearTokenCorreo,
  consumirTokenCorreo,
  enviarBienvenidaConVerificacion,
  reenviarVerificacion,
  solicitarCambioCorreo,
  enviarRestablecerPassword
};
