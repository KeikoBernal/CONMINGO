// ============================================================
// LOTE FECHAS: formato unico de fechas y horas en todo el
// sistema (dia/mes/anio y horas de 12 horas, peticion de
// Keiko).
// Convenciones:
// - fecha_hora viaja desde el backend como texto SIN zona
//   (YYYY-MM-DDTHH:MM:SS, hora de Venezuela escrita con
//   TO_CHAR). Se interpreta como America/Caracas fija
//   (UTC-4, sin horario de verano desde 2016) para que se
//   vea igual en cualquier dispositivo.
// - Los timestamp con zona (terminados en Z o con +hh:mm) son
//   instantes reales y se formatean en America/Caracas.
// - hora_inicio/hora_final de partidos es texto legado: puede
//   traer "03:45 p. m.", "15:45" (canonico nuevo) o el ISO UTC
//   que escribia antes el cierre por meta de puntos.
//   formatearHora entiende los tres.
// ============================================================

const ZONA = 'America/Caracas';

const sinValor = (valor) => valor === null || valor === undefined || String(valor).trim() === '';

// Convierte cualquier entrada a un instante Date o null.
const aInstante = (valor) => {
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  if (sinValor(valor)) return null;
  const s = String(valor).trim();
  // Instante real: ISO con zona (Z o +hh:mm).
  if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Fecha sola YYYY-MM-DD: medianoche de Caracas.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00-04:00');
  // Texto naive YYYY-MM-DDTHH:MM[:SS]: hora de Caracas fija.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return new Date(s + '-04:00');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const partesCaracas = (instante, opciones) => {
  const formato = new Intl.DateTimeFormat('es-VE', Object.assign({ timeZone: ZONA }, opciones));
  const partes = {};
  for (const parte of formato.formatToParts(instante)) partes[parte.type] = parte.value;
  return partes;
};

// 05/11/2026
export const formatearFecha = (valor) => {
  if (sinValor(valor)) return '';
  const instante = aInstante(valor);
  if (!instante) return String(valor);
  const p = partesCaracas(instante, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return p.day + '/' + p.month + '/' + p.year;
};

// 03:45 p.m. a partir de una hora de 24 horas.
const hora12 = (h24, minutos) => {
  const sufijo = h24 >= 12 ? 'p.m.' : 'a.m.';
  const h = h24 % 12 || 12;
  return String(h).padStart(2, '0') + ':' + minutos + ' ' + sufijo;
};

// 05/11/2026, 03:45 p.m.
export const formatearFechaHora = (valor) => {
  if (sinValor(valor)) return '';
  const instante = aInstante(valor);
  if (!instante) return String(valor);
  const p = partesCaracas(instante, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return p.day + '/' + p.month + '/' + p.year + ', ' + hora12(parseInt(p.hour, 10), p.minute);
};

// 03:45 p.m. (hora de un datetime completo)
export const formatearHoraDeFecha = (valor) => {
  if (sinValor(valor)) return '';
  const instante = aInstante(valor);
  if (!instante) return String(valor);
  const p = partesCaracas(instante, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return hora12(parseInt(p.hour, 10), p.minute);
};

// Hora de partido (texto legado o canonico) a 03:45 p.m.
export const formatearHora = (valor) => {
  if (sinValor(valor)) return '';
  const s = String(valor).trim();
  // ISO con o sin zona: instante formateado en Caracas.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const instante = aInstante(s);
    if (!instante) return s;
    const p = partesCaracas(instante, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return hora12(parseInt(p.hour, 10), p.minute);
  }
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  let h = parseInt(m[1], 10);
  const minutos = m[2];
  if (/p\.?\s*m/i.test(s)) h = h % 12 + 12;
  else if (/a\.?\s*m/i.test(s)) h = h % 12;
  else if (h > 23) return s;
  return hora12(h, minutos);
};

// Hora canonica HH:MM (24 horas) que el sistema guarda en
// hora_inicio/hora_final desde este lote en adelante.
export const horaCanonica = (fecha) => {
  const p = partesCaracas(fecha instanceof Date ? fecha : new Date(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return p.hour + ':' + p.minute;
};

// Fecha de hoy en formato dd/mm/aaaa, para comparaciones.
export const fechaHoy = () => formatearFecha(new Date());
