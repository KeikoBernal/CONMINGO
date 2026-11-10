import { useEffect, useState } from 'react';
import NavIcon from './NavIcon';
import { tecladoModal } from './Accesibilidad';

// LOTE 8H: guia profunda por rol: un paso por seccion, con el vocabulario real
// de cada panel. Clave de primera visita nueva (tourVisto8h_): los usuarios
// existentes veran la guia actualizada una vez; el boton Ver Guia del
// encabezado sigue disponible para repetirla en cualquier momento.
const CLAVE_PREFIJO = 'tourVisto8h_';

export const TOUR_PASOS = {
  delegado: [
    { icono: 'usuarios', titulo: 'Mi Equipo', texto: 'La nómina de tu equipo con dorsal, cédula, foto y estado, junto al encuentro de hoy y el próximo encuentro. Desde aquí descargas la planilla de tu equipo.' },
    { icono: 'calendario', titulo: 'Calendario y Puntajes', texto: 'Fechas, sedes y horarios de la temporada. Abre cada encuentro para ver su planilla de puntajes ya jugada.' },
    { icono: 'documento', titulo: 'Analítica y Scouting', texto: 'Pts/Juego, Prom. Puntos/Bolo, Tasa de Error, Retención de Punto, Clutch %, Cierres, Diferencial y Perfil Sugerido de cada jugador. Exporta el scouting cuando lo necesites.' },
    { icono: 'pagos', titulo: 'Pagos del Equipo', texto: 'Solo lectura: inscrito, monto, método y referencia de cada pago que la liga registró para tu equipo.' },
    { icono: 'votacion', titulo: 'Votación MVP', texto: 'Participa en la votación de la jornada y consulta los ganadores de cada torneo.' },
    { icono: 'sancion', titulo: 'Protestas', texto: 'Presenta protestas según el reglamento de la liga y sigue su estado hasta el fallo.' },
    { icono: 'documentos', titulo: 'Documentos de la Liga', texto: 'Reglamentos y comunicaciones publicados por la liga, listos para descargar.' },
    { icono: 'trofeo', titulo: 'Premiación de la Liga', texto: 'Rankings y reconocimientos de la temporada, publicados por el admin de liga.' },
  ],
  arbitro: [
    { icono: 'calendario', titulo: 'Partidos de Hoy', texto: 'Tus compromisos del día con estado, hora y sede. Abre el partido para trabajar su acta.' },
    { icono: 'documento', titulo: 'Próximos e Historial', texto: 'La programación que te espera y tus actas pasadas, con la fecha y sede de cada una.' },
    { icono: 'sancion', titulo: 'Modo Cancha', texto: 'Amonestar o expulsar en dos toques seleccionando al infractor, y registrar incidencias del partido con su descripción.' },
    { icono: 'reloj', titulo: 'Tiempo de Lanzamiento', texto: 'El cronómetro lo controla el anotador; tú ves el tiempo en vivo y el aviso cuando se pasa de los 50 segundos.' },
    { icono: 'acta', titulo: 'Sorteo y Suspensión', texto: 'Realiza el sorteo de inicio antes del juego. Suspender Partido queda solo para fuerza mayor (lluvia, falta de luz).' },
    { icono: 'acta', titulo: 'Firmas del Acta', texto: 'Cierra el acta con tu firma digital y las de los delegados; el anotador firma desde su propio panel.' },
    { icono: 'votacion', titulo: 'Cierre de Jornada', texto: 'Votación MVP de la jornada y confirmación de las protestas presentadas por los delegados.' },
    { icono: 'reloj', titulo: 'Sin Señal', texto: 'Amonestaciones, expulsiones e incidencias se guardan en la cola offline y se envían solas al reconectar.' },
  ],
  anotador: [
    { icono: 'calendario', titulo: 'Partidos de Hoy', texto: 'Tus partidos asignados del día con estado, hora y sede, listos para abrir la planilla.' },
    { icono: 'acta', titulo: 'Planilla de Lanzamientos', texto: 'Dos toques por jugada: A, B o R en mayúscula suman el lanzamiento bueno; en minúscula queda como fallo; N es el Nulo General. Borra Celda para corregir sin perder la mano.' },
    { icono: 'reloj', titulo: 'Cronómetro Flotante', texto: 'La isla de la esquina se expande al tocarla: Tiempo de Lanzamiento, Iniciar/Pausar, Reset y Total del partido.' },
    { icono: 'documento', titulo: 'Sincronización en Vivo', texto: 'Cada jugada viaja al panel del árbitro y al marcador público. Sin señal, la cola offline guarda todo y el acta queda respaldada en tu dispositivo.' },
    { icono: 'credencial', titulo: 'Firmas del Acta', texto: 'Firman el anotador y los delegados; el árbitro firma desde su panel y tú ves el estado de cada firma.' },
    { icono: 'votacion', titulo: 'Cierre de Jornada', texto: 'Votación MVP de la jornada y protestas para confirmar según reglamento.' },
    { icono: 'lista', titulo: 'Historial y Calendario', texto: 'Tus actas pasadas y la programación de la liga en un mismo lugar.' },
  ],
  adminLiga: [
    { icono: 'torneo', titulo: 'Inicio', texto: 'Tarjetas de resumen con los partidos de hoy, las sanciones activas, los pagos registrados y los equipos inscritos; cada tarjeta te lleva directo a su sección.' },
    { icono: 'calendario', titulo: 'Torneos Activos', texto: 'El corazón de la operación: crea el fixture, asigna sedes, árbitros y anotadores, y modifica cualquier partido agendado.' },
    { icono: 'documentos', titulo: 'Compartir Partido', texto: 'Cada partido Agendado tiene su botón Compartir: envía el enlace del marcador público por WhatsApp, Telegram, X o Facebook, muestra el QR o copia el link.' },
    { icono: 'torneo', titulo: 'Nuevo Evento', texto: 'Nuevo Torneo con su plantilla de reglas, Torneo Flash de un día, o Partido Suelto con sus dos equipos.' },
    { icono: 'estadisticas', titulo: 'Posiciones', texto: 'Tabla de posiciones y grupos por categoría y género, más el Acumulado Anual por temporada.' },
    { icono: 'equipos', titulo: 'Equipos y Nóminas', texto: 'Registra equipos por categoría y género; el listado se agrupa por edad y género con chips para filtrar. Arma nóminas, asigna delegado y capitán, sube fotos en lote y genera los carnets.' },
    { icono: 'pagos', titulo: 'Pagos de Inscripción', texto: 'Registra inscrito, monto, método y referencia de cada pago de la temporada.' },
    { icono: 'sancion', titulo: 'Disciplina', texto: 'Sanciones manuales o acumuladas por tarjetas, y las protestas de la jornada por confirmar.' },
    { icono: 'estadisticas', titulo: 'Resultados y Configuración', texto: 'Estadísticas globales, historial de partidos finalizados y premiación. En Configuración: sedes, plantillas de reglas, documentos y credenciales con verificación de correo.' },
    { icono: 'bitacora', titulo: 'Bitácora de Actividad', texto: 'Auditoría de cada acción de la liga con fecha, usuario y dirección IP, exportable para revisión.' },
  ],
  superadmin: [
    { icono: 'ligas', titulo: 'Inicio y Respaldos', texto: 'El estado global del sistema y el respaldo de la base de datos en formato SQL o JSON, descargable cuando quieras.' },
    { icono: 'estadisticas', titulo: 'Métricas Globales', texto: 'El pulso del sistema: ligas activas, usuarios y actividad acumulada.' },
    { icono: 'calendario', titulo: 'Calendario Global', texto: 'La programación de partidos de todas las ligas en una sola vista.' },
    { icono: 'ligas', titulo: 'Ligas', texto: 'Directorio de organizaciones: crea, edita y da de baja con la opción de restaurar si algo se borra por error.' },
    { icono: 'usuarios', titulo: 'Usuarios', texto: 'Directorio con roles de admin de liga, árbitro, anotador y delegado; verificación de correo y cambio de correo con doble confirmación.' },
    { icono: 'bitacora', titulo: 'Documentos y Bitácora', texto: 'Archivos globales para todas las ligas y la bitácora de auditoría de todo el sistema.' },
  ],
};

export function tourPendiente(rol) {
  try {
    return !localStorage.getItem(CLAVE_PREFIJO + rol);
  } catch (error) {
    return false;
  }
}

export function marcarTourVisto(rol) {
  try {
    localStorage.setItem(CLAVE_PREFIJO + rol, 'true');
  } catch (error) {
    /* almacenamiento no disponible: no bloquear la guia */
  }
}

export default function TourGuia({ rol, activo, onCerrar }) {
  const [paso, setPaso] = useState(0);

  useEffect(() => {
    if (activo) setPaso(0);
  }, [activo]);

  if (!activo) return null;

  const pasos = TOUR_PASOS[rol] || [];
  if (pasos.length === 0) return null;

  const actual = pasos[paso];
  const esUltimo = paso >= pasos.length - 1;

  const cerrar = () => {
    marcarTourVisto(rol);
    onCerrar();
  };

  const avanzar = () => {
    if (esUltimo) {
      cerrar();
      return;
    }
    setPaso(paso + 1);
  };

  return (
    <div className="fixed inset-0 z-[1900] bg-brand-brown/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Guia del panel" onKeyDown={(evento) => tecladoModal(evento, cerrar)}>
      <div className="bg-brand-cream border border-brand-gold/40 rounded-lg max-w-sm w-full p-6 shadow-2xl animate-fade-in">
        <div className="w-14 h-14 rounded-lg bg-brand-brown text-brand-gold flex items-center justify-center mx-auto">
          <NavIcon nombre={actual.icono} className="w-7 h-7" />
        </div>
        <p className="text-center text-xs font-bold text-brand-brown/60 uppercase tracking-wider mt-4">
          Paso {paso + 1} de {pasos.length}
        </p>
        <h3 className="text-center text-xl font-bold text-brand-brown mt-1">
          {actual.titulo}
        </h3>
        <p className="text-center text-sm text-brand-brown/80 mt-2">
          {actual.texto}
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-5" aria-hidden="true">
          {pasos.map((_, indice) => (
            <span
              key={indice}
              className={indice === paso ? 'h-1.5 w-6 rounded-full bg-brand-rust transition-all' : 'h-1.5 w-1.5 rounded-full bg-brand-gold/40 transition-all'}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 mt-6">
          <button
            type="button"
            autoFocus
            onClick={cerrar}
            className="px-4 py-2.5 rounded-lg border border-brand-gold/40 text-brand-brown font-semibold text-sm hover:bg-brand-rust/5 transition-colors"
          >
            Omitir
          </button>
          <button
            type="button"
            onClick={avanzar}
            className="px-6 py-2.5 rounded-lg bg-brand-rust text-white font-bold text-sm hover:bg-brand-brown transition-colors"
          >
            {esUltimo ? 'Empezar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}
