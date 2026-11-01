// LOTE 6G: utilidad de correo saliente (SMTP propio) y tokens de verificacion.
// Agnostica del proveedor: todo se lee de variables de entorno:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, URL_FRONTEND
// Sin SMTP_HOST la utilidad entra en modo degradado: ningun correo se envia
// y los endpoints que la usan deciden como fallar (por ejemplo, mostrar la
// clave temporal al administrador, como hacia el sistema antes de este lote).
const nodemailer = require('nodemailer');
const crypto = require('crypto');
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

let transporte = null;
const obtenerTransporte = () => {
  if (transporte) return transporte;
  const puerto = parseInt(process.env.SMTP_PORT || '465', 10);
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: puerto,
    secure: puerto === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transporte;
};

const remitente = () => process.env.SMTP_FROM || process.env.SMTP_USER || 'CONMINGO';

// Envia un correo. Devuelve { enviado: true } o { enviado: false, motivo }.
const enviarCorreo = async ({ para, asunto, html, texto }) => {
  if (!SMTP_CONFIGURADO) return { enviado: false, motivo: 'smtp_no_configurado' };
  try {
    await obtenerTransporte().sendMail({
      from: remitente(),
      to: para,
      subject: asunto,
      html,
      text: texto || html.replace(/<[^>]+>/g, ' ')
    });
    return { enviado: true };
  } catch (error) {
    console.error('[correo] No se pudo enviar:', { para, asunto, error: error?.message || error });
    return { enviado: false, motivo: 'error_envio', error: error?.message || String(error) };
  }
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
const enviarBienvenidaConVerificacion = async ({ usuarioId, para, nombre, usuario, claveTemporal }) => {
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
};

// Reenvio del enlace de verificacion (solo el enlace, sin clave).
const reenviarVerificacion = async ({ usuarioId, para, nombre }) => {
  const token = await crearTokenCorreo(usuarioId, 'verificacion', 48);
  const url = URL_FRONTEND() + '/?verificar=' + token;
  const cuerpo = [
    '<p>Hola <strong>' + (nombre || para) + '</strong>:</p>',
    '<p>Tu cuenta sigue pendiente de verificacion. Usa el siguiente enlace para activarla:</p>',
    boton(url, 'Verificar mi correo'),
    '<p style="font-size: 12px; color: #7a6a55;">Si no recuerdas tu clave temporal, contacta al administrador de tu liga. El enlace es valido por 48 horas.</p>'
  ].join('\n');
  return enviarCorreo({ para, asunto: 'Verifica tu correo - CONMINGO', html: plantilla('Verificacion de correo', cuerpo) });
};

// Cambio de correo: aviso al correo antiguo + confirmacion al nuevo.
const solicitarCambioCorreo = async ({ usuarioId, nombre, paraAntiguo, paraNuevo }) => {
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

  return { enviadoAntiguo: resAntiguo.enviado, motivoAntiguo: resAntiguo.motivo, enviadoNuevo: resNuevo.enviado, motivoNuevo: resNuevo.motivo };
};

// LOTE 6H: restablecimiento de clave. El administrador pide el reset desde el
// panel y la persona recibe un enlace para establecer su propia contrasena
// (token de 'recuperacion', 24 horas). La clave nunca viaja en el correo.
const enviarRestablecerPassword = async ({ usuarioId, para, nombre }) => {
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
};

module.exports = {
  enviarCorreo,
  crearTokenCorreo,
  consumirTokenCorreo,
  enviarBienvenidaConVerificacion,
  reenviarVerificacion,
  solicitarCambioCorreo,
  enviarRestablecerPassword
};
