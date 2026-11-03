import { useEffect, useState } from 'react';

// ============================================================
// FASE D UX: modo offline de los oficiales (arbitro y anotador).
// Cola de envios en localStorage: sin senal, las escrituras del
// partido se guardan en este dispositivo y se reenvian EN ORDEN
// al volver la conexion. Los endpoints de partidos son
// idempotentes o transiciones de estado, y las incidencias llevan
// client_id para que el reenvio no duplique el registro.
// ============================================================

const PREFIJO = 'conmingo_offline_';

const leer = (clave) => {
  try { return JSON.parse(localStorage.getItem(PREFIJO + clave) || '[]'); } catch (err) { return []; }
};

const escribir = (clave, valor) => {
  try { localStorage.setItem(PREFIJO + clave, JSON.stringify(valor)); } catch (err) { /* cuota llena: la cola no persiste, la app sigue */ }
};

export const leerCola = (rol) => leer('cola_' + rol);

export const encolar = (rol, { metodo, ruta, cuerpo, etiqueta }) => {
  const cola = leerCola(rol);
  const item = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'envio-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    creado_en: Date.now(),
    metodo,
    ruta,
    cuerpo: cuerpo || null,
    etiqueta: etiqueta || 'Envio del partido',
    estado: 'pendiente',
    error: null,
    intentos: 0
  };
  cola.push(item);
  escribir('cola_' + rol, cola);
  return item;
};

export const quitarDeCola = (rol, id) => escribir('cola_' + rol, leerCola(rol).filter((i) => i.id !== id));

export const actualizarItem = (rol, id, campos) => escribir('cola_' + rol, leerCola(rol).map((i) => (i.id === id ? { ...i, ...campos } : i)));

export const contarCola = (rol) => {
  const cola = leerCola(rol);
  return { pendientes: cola.filter((i) => i.estado !== 'error').length, fallidos: cola.filter((i) => i.estado === 'error').length };
};

// Reenvia la cola EN ORDEN. Un fallo de red detiene el replay (la cola queda
// intacta para el proximo intento); un rechazo del servidor marca el item con
// su mensaje y detiene el replay para no alterar el orden de la secuela.
// Las transiciones ya aplicadas (partido ya iniciado o ya finalizado) se
// toleran como exito porque el estado deseado ya existe en el servidor.
const yaAplicado = (ruta, status, error) => {
  if (status !== 400 || !error) return false;
  if (ruta.endsWith('/iniciar') && error.includes("Solo se pueden iniciar partidos en estado 'Agendado'")) return true;
  if (ruta.endsWith('/finalizar') && error.includes("El partido debe estar 'En Curso'")) return true;
  return false;
};

export const procesarCola = async (rol, fetchConToken) => {
  const resumen = { enviados: 0, fallidos: 0 };
  while (true) {
    const item = leerCola(rol).find((i) => i.estado !== 'error');
    if (!item) break;
    let res = null;
    try {
      res = await fetchConToken(item.ruta, { method: item.metodo, body: item.cuerpo });
    } catch (err) {
      break; // sigo sin senal: la cola queda intacta
    }
    if (res.ok) {
      quitarDeCola(rol, item.id);
      resumen.enviados += 1;
      continue;
    }
    let cuerpo = {};
    try { cuerpo = await res.json(); } catch (err) { /* respuesta sin JSON */ }
    if (yaAplicado(item.ruta, res.status, cuerpo.error)) {
      quitarDeCola(rol, item.id);
      resumen.enviados += 1;
      continue;
    }
    actualizarItem(rol, item.id, { estado: 'error', error: cuerpo.error || ('HTTP ' + res.status), intentos: (item.intentos || 0) + 1 });
    resumen.fallidos += 1;
    break;
  }
  return resumen;
};

// Pone los items marcados como error de vuelta en la cola para reintentarlos.
export const reintentarFallidos = (rol) => escribir('cola_' + rol, leerCola(rol).map((i) => (i.estado === 'error' ? { ...i, estado: 'pendiente', error: null } : i)));

// Conexion a nivel de navegador (eventos online/offline). La verificacion
// real contra el backend la hace useConexion en PantallaOffline; aqui basta
// la senal del dispositivo para saber si se puede enviar o se encola.
export const useEnLinea = () => {
  const [enLinea, setEnLinea] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const alConectar = () => setEnLinea(true);
    const alDesconectar = () => setEnLinea(false);
    window.addEventListener('online', alConectar);
    window.addEventListener('offline', alDesconectar);
    return () => {
      window.removeEventListener('online', alConectar);
      window.removeEventListener('offline', alDesconectar);
    };
  }, []);
  return enLinea;
};
