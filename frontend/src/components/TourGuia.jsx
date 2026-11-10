import { useEffect, useState } from 'react';
import NavIcon from './NavIcon';
import { tecladoModal } from './Accesibilidad';

// LOTE 8H: guia profunda por rol: un paso por seccion, con el vocabulario real
// de cada panel. Clave de primera visita nueva (tourVisto8h2_): los usuarios
// existentes veran la guia actualizada una vez; el boton Ver Guia del
// encabezado sigue disponible para repetirla en cualquier momento.
// LOTE 8H parte 2 (pedido de Keiko): la guia es un recorrido: cada paso entra
// a su seccion del panel mientras la explica y al cerrar deja al usuario de
// vuelta en el inicio. Por eso el modal es una tarjeta flotante que no tapa
// la seccion mostrada; el panel aporta onIrASeccion y su seccion de inicio.
const CLAVE_PREFIJO = 'tourVisto8h2_';

export const TOUR_PASOS = {
  delegado: [
    { icono: 'usuarios', titulo: 'Mi Equipo', texto: 'La nómina de tu equipo con dorsal, cédula, foto y estado, junto al encuentro de hoy y el próximo encuentro. Desde aquí descargas la planilla de tu equipo.', pestana: 'equipo' },
    { icono: 'calendario', titulo: 'Calendario y Puntajes', texto: 'Fechas, sedes y horarios de la temporada. Abre cada encuentro para ver su planilla de puntajes ya jugada.', pestana: 'calendario' },
    { icono: 'documento', titulo: 'Analítica y Scouting', texto: 'Pts/Juego, Prom. Puntos/Bolo, Tasa de Error, Retención de Punto, Clutch %, Cierres, Diferencial y Perfil Sugerido de cada jugador. Exporta el scouting cuando lo necesites.', pestana: 'estadisticas' },
    { icono: 'pagos', titulo: 'Pagos del Equipo', texto: 'Solo lectura: inscrito, monto, método y referencia de cada pago que la liga registró para tu equipo.', pestana: 'pagos' },
    { icono: 'votacion', titulo: 'Votación MVP', texto: 'Participa en la votación de la jornada y consulta los ganadores de cada torneo.', pestana: 'votacion' },
    { icono: 'sancion', titulo: 'Protestas', texto: 'Presenta protestas según el reglamento de la liga y sigue su estado hasta el fallo.', pestana: 'protestas' },
    { icono: 'documentos', titulo: 'Documentos de la Liga', texto: 'Reglamentos y comunicaciones publicados por la liga, listos para descargar.', pestana: 'documentos' },
    { icono: 'trofeo', titulo: 'Premiación de la Liga', texto: 'Rankings y reconocimientos de la temporada, publicados por el admin de liga.', pestana: 'premiacion' },
  ],
  arbitro: [
    { icono: 'inicio', titulo: 'Inicio', texto: 'Tu panel abre aquí: tarjetas con tu próximo compromiso y accesos directos a Hoy, Próximos y el Historial.', pestana: 'inicio' },
    { icono: 'calendario', titulo: 'Partidos de Hoy', texto: 'Tus compromisos del día con estado, hora y sede. Abre el partido para trabajar su acta.', pestana: 'hoy' },
    { icono: 'reloj', titulo: 'Próximos Partidos', texto: 'La programación que te espera, con la fecha, hora y sede de cada compromiso.', pestana: 'proximos' },
    { icono: 'documento', titulo: 'Historial Reciente', texto: 'Tus actas pasadas, con la fecha y sede de cada una.', pestana: 'historial' },
    { icono: 'calendario', titulo: 'Calendario de Partidos', texto: 'Todos los partidos de la liga en el calendario mensual, con sus sedes y horarios.', pestana: 'calendario' },
    { icono: 'sancion', titulo: 'Modo Cancha', texto: 'Amonestar o expulsar en dos toques seleccionando al infractor, y registrar incidencias del partido con su descripción. Entras al modo cancha al abrir un partido desde Hoy.', pestana: 'hoy' },
    { icono: 'reloj', titulo: 'Tiempo de Lanzamiento', texto: 'El cronómetro lo controla el anotador; tú ves el tiempo en vivo y el aviso cuando se pasa de los 50 segundos.', pestana: 'hoy' },
    { icono: 'acta', titulo: 'Sorteo y Suspensión', texto: 'Realiza el sorteo de inicio antes del juego. Suspender Partido queda solo para fuerza mayor (lluvia, falta de luz).', pestana: 'hoy' },
    { icono: 'acta', titulo: 'Firmas del Acta', texto: 'Cierra el acta con tu firma digital y las de los delegados; el anotador firma desde su propio panel.', pestana: 'hoy' },
    { icono: 'reloj', titulo: 'Sin Señal', texto: 'Amonestaciones, expulsiones e incidencias se guardan en la cola offline y se envían solas al reconectar.', pestana: 'hoy' },
    { icono: 'votacion', titulo: 'Cierre de Jornada', texto: 'Votación MVP de la jornada para elegir al más valioso.', pestana: 'votacion' },
    { icono: 'protesta', titulo: 'Protestas', texto: 'Las protestas presentadas por los delegados en tus partidos, con su estado hasta el fallo.', pestana: 'protestas' },
  ],
  anotador: [
    { icono: 'inicio', titulo: 'Inicio', texto: 'Tu panel abre aquí: tarjetas con tu próximo compromiso y accesos directos a Hoy, Próximos y el Historial.', pestana: 'inicio' },
    { icono: 'calendario', titulo: 'Partidos de Hoy', texto: 'Tus partidos asignados del día con estado, hora y sede, listos para abrir la planilla.', pestana: 'hoy' },
    { icono: 'reloj', titulo: 'Próximos Partidos', texto: 'La programación que te espera, con la fecha, hora y sede de cada compromiso.', pestana: 'proximos' },
    { icono: 'documento', titulo: 'Historial Reciente', texto: 'Tus actas pasadas, con la fecha y sede de cada una.', pestana: 'historial' },
    { icono: 'calendario', titulo: 'Calendario de Partidos', texto: 'Todos los partidos de la liga en el calendario mensual, con sus sedes y horarios.', pestana: 'calendario' },
    { icono: 'acta', titulo: 'Planilla de Lanzamientos', texto: 'Dos toques por jugada: A, B o R en mayúscula suman el lanzamiento bueno; en minúscula queda como fallo; N es el Nulo General. Borra Celda para corregir sin perder la mano. Se trabaja al abrir un partido desde Hoy.', pestana: 'hoy' },
    { icono: 'reloj', titulo: 'Cronómetro Flotante', texto: 'La isla de la esquina se expande al tocarla: Tiempo de Lanzamiento, Iniciar/Pausar, Reset y Total del partido.', pestana: 'hoy' },
    { icono: 'documento', titulo: 'Sincronización en Vivo', texto: 'Cada jugada viaja al panel del árbitro y al marcador público. Sin señal, la cola offline guarda todo y el acta queda respaldada en tu dispositivo.', pestana: 'hoy' },
    { icono: 'credencial', titulo: 'Firmas del Acta', texto: 'Firman el anotador y los delegados; el árbitro firma desde su panel y tú ves el estado de cada firma.', pestana: 'hoy' },
    { icono: 'votacion', titulo: 'Cierre de Jornada', texto: 'Votación MVP de la jornada para elegir al más valioso.', pestana: 'votacion' },
    { icono: 'protesta', titulo: 'Protestas', texto: 'Las protestas de la jornada para confirmar según el reglamento de la liga.', pestana: 'protestas' },
  ],
  adminLiga: [
    { icono: 'torneo', titulo: 'Inicio', texto: 'Tarjetas de resumen con los partidos de hoy, las sanciones activas, los pagos registrados y los equipos inscritos; cada tarjeta te lleva directo a su sección.', pestana: 'inicio' },
    { icono: 'calendario', titulo: 'Torneos Activos', texto: 'El corazón de la operación: crea el fixture, asigna sedes, árbitros y anotadores, y modifica cualquier partido agendado.', pestana: 'torneos', sub: 'lista' },
    { icono: 'documentos', titulo: 'Compartir Partido', texto: 'Cada partido Agendado tiene su botón Compartir: envía el enlace del marcador público por WhatsApp, Telegram, X o Facebook, muestra el QR o copia el link.', pestana: 'torneos', sub: 'lista' },
    { icono: 'torneo', titulo: 'Nuevo Evento', texto: 'Nuevo Torneo con su plantilla de reglas, Torneo Flash de un día, o Partido Suelto con sus dos equipos.', pestana: 'torneos', sub: 'crear' },
    { icono: 'estadisticas', titulo: 'Posiciones', texto: 'Tabla de posiciones y grupos por categoría y género, más el Acumulado Anual por temporada.', pestana: 'torneos', sub: 'posiciones' },
    { icono: 'equipos', titulo: 'Equipos y Nóminas', texto: 'Registra equipos por categoría y género; el listado se agrupa por edad y género con chips para filtrar. Arma nóminas, asigna delegado y capitán, sube fotos en lote y genera los carnets.', pestana: 'equipos', sub: 'nomina' },
    { icono: 'pagos', titulo: 'Pagos de Inscripción', texto: 'Registra inscrito, monto, método y referencia de cada pago de la temporada.', pestana: 'equipos', sub: 'pagos' },
    { icono: 'sancion', titulo: 'Disciplina', texto: 'Sanciones manuales o acumuladas por tarjetas, y las protestas de la jornada por confirmar.', pestana: 'disciplina', sub: 'sanciones' },
    { icono: 'estadisticas', titulo: 'Resultados', texto: 'Estadísticas globales, historial de partidos finalizados y premiación de la temporada.', pestana: 'resultados', sub: 'estadisticas' },
    { icono: 'credencial', titulo: 'Configuración de la Liga', texto: 'Sedes deportivas, plantillas de reglas, documentos de la liga y credenciales con verificación de correo.', pestana: 'configuracion', sub: 'sedes' },
    { icono: 'bitacora', titulo: 'Bitácora de Actividad', texto: 'Auditoría de cada acción de la liga con fecha, usuario y dirección IP, exportable para revisión.', pestana: 'bitacora' },
  ],
  superadmin: [
    { icono: 'ligas', titulo: 'Inicio y Respaldos', texto: 'El estado global del sistema y el respaldo de la base de datos en formato SQL o JSON, descargable cuando quieras.', pestana: 'inicio' },
    { icono: 'estadisticas', titulo: 'Métricas Globales', texto: 'El pulso del sistema: ligas activas, usuarios y actividad acumulada.', pestana: 'metricas' },
    { icono: 'calendario', titulo: 'Calendario Global', texto: 'La programación de partidos de todas las ligas en una sola vista.', pestana: 'calendario' },
    { icono: 'ligas', titulo: 'Ligas', texto: 'Directorio de organizaciones: crea, edita y da de baja con la opción de restaurar si algo se borra por error.', pestana: 'ligas' },
    { icono: 'usuarios', titulo: 'Usuarios', texto: 'Directorio con roles de admin de liga, árbitro, anotador y delegado; verificación de correo y cambio de correo con doble confirmación.', pestana: 'usuarios' },
    { icono: 'documentos', titulo: 'Documentos Globales', texto: 'Reglamentos y comunicaciones globales para todas las ligas, listos para descargar.', pestana: 'documentos' },
    { icono: 'bitacora', titulo: 'Bitácora de Auditoría', texto: 'La bitácora de auditoría de todo el sistema, con fecha, usuario y dirección IP.', pestana: 'bitacora' },
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

export default function TourGuia({ rol, activo, onCerrar, onIrASeccion, seccionInicio }) {
  const [paso, setPaso] = useState(0);

  useEffect(() => {
    if (activo) setPaso(0);
  }, [activo]);

  // LOTE 8H parte 2: mientras se explica un paso, el panel entra a su seccion.
  useEffect(() => {
    if (!activo || !onIrASeccion) return;
    const actual = (TOUR_PASOS[rol] || [])[paso];
    if (actual && actual.pestana) onIrASeccion(actual.pestana, actual.sub);
  }, [activo, paso, rol, onIrASeccion]);

  if (!activo) return null;

  const pasos = TOUR_PASOS[rol] || [];
  if (pasos.length === 0) return null;

  const actual = pasos[paso];
  const esUltimo = paso >= pasos.length - 1;

  const cerrar = () => {
    marcarTourVisto(rol);
    if (onIrASeccion && seccionInicio) onIrASeccion(seccionInicio);
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
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1900] w-[calc(100%-2rem)] max-w-md"
      role="dialog"
      aria-label="Guia del panel"
      onKeyDown={(evento) => tecladoModal(evento, cerrar)}
    >
      <div className="bg-brand-cream border border-brand-gold/40 rounded-lg p-5 shadow-2xl animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-brown text-brand-gold flex items-center justify-center shrink-0">
            <NavIcon nombre={actual.icono} className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[0.65rem] font-bold text-brand-brown/60 uppercase tracking-wider">
              Paso {paso + 1} de {pasos.length}
            </p>
            <h3 className="text-lg font-bold text-brand-brown truncate">
              {actual.titulo}
            </h3>
          </div>
        </div>
        <p className="text-sm text-brand-brown/80 mt-3">
          {actual.texto}
        </p>
        <div className="flex items-center justify-center gap-1.5 mt-4" aria-hidden="true">
          {pasos.map((_, indice) => (
            <span
              key={indice}
              className={indice === paso ? 'h-1.5 w-6 rounded-full bg-brand-rust transition-all' : 'h-1.5 w-1.5 rounded-full bg-brand-gold/40 transition-all'}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 mt-4">
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
