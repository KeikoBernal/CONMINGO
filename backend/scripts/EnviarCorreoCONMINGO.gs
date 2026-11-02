// CONMINGO - puente de envio de correos por Google Apps Script.
// Despliegue (una sola vez, con la cuenta conmingo.app@gmail.com):
//   1. Entrar en script.google.com -> Nuevo proyecto -> pegar TODO este archivo.
//   2. Editar SECRETO con una frase larga; la misma frase va en la variable
//      GMAIL_SCRIPT_SECRETO de Render.
//   3. Implementar -> Nueva implementacion -> Tipo: Aplicacion web.
//      Ejecutar como: Yo (conmingo.app@gmail.com).
//      Quien tiene acceso: Cualquier usuario.
//   4. Autorizar (si sale el aviso de app no verificada: Opciones avanzadas ->
//      Ir a CONMINGO (no seguro) -> Permitir).
//   5. Copiar la URL que termina en /exec: esa va en GMAIL_SCRIPT_URL de Render.
// El backend llama esta aplicacion por HTTPS con el secreto compartido y
// MailApp envia desde la cuenta que despliego. Cuota de Gmail de consumo:
// 100 correos/dia (1500 con Google Workspace).
var SECRETO = 'CAMBIAR-ESTA-FRASE-SECRETA';

function doPost(e) {
  var responder = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  try {
    var dato = JSON.parse(e.postData.contents);
    if (!dato || dato.secreto !== SECRETO) return responder({ ok: false, error: 'secreto invalido' });
    if (!dato.para || !dato.asunto || (!dato.html && !dato.texto)) {
      return responder({ ok: false, error: 'faltan campos (para, asunto, html o texto)' });
    }
    MailApp.sendEmail({
      to: dato.para,
      subject: dato.asunto,
      htmlBody: dato.html || null,
      body: dato.texto || String(dato.html || '').replace(/<[^>]+>/g, ' '),
      name: 'CONMINGO'
    });
    return responder({ ok: true });
  } catch (error) {
    return responder({ ok: false, error: String(error && error.message || error) });
  }
}