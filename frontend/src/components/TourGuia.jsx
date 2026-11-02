import { useEffect, useState } from 'react';
import NavIcon from './NavIcon';

// B2: guia de bienvenida por rol (4 pasos) con marcador de primera visita en localStorage.
const CLAVE_PREFIJO = 'tourVisto_';

export const TOUR_PASOS = {
  delegado: [
    { icono: 'usuarios', titulo: 'Mi Equipo', texto: 'Consulta la nomina de tu equipo y el encuentro de hoy en un solo lugar.' },
    { icono: 'calendario', titulo: 'Calendario y resultados', texto: 'Sigue las fechas, sedes y resultados de la temporada.' },
    { icono: 'documentos', titulo: 'Documentos y pagos', texto: 'Descarga documentos de la liga y revisa el estado de los pagos.' },
    { icono: 'votacion', titulo: 'Cierre de jornada', texto: 'Participa en la votacion MVP y presenta protestas segun el reglamento.' },
  ],
  arbitro: [
    { icono: 'calendario', titulo: 'Partidos de hoy', texto: 'Tus compromisos del dia con estado, hora y sede en un vistazo.' },
    { icono: 'sancion', titulo: 'Modo Cancha', texto: 'Amonestaciones, expulsiones e incidencias a pie de cancha, en dos toques.' },
    { icono: 'documento', titulo: 'Historial y calendario', texto: 'Consulta tus actas pasadas y la programacion de la liga.' },
    { icono: 'votacion', titulo: 'Cierre de jornada', texto: 'Votacion MVP y protestas de cada jornada.' },
  ],
  anotador: [
    { icono: 'calendario', titulo: 'Partidos de hoy', texto: 'Tus partidos asignados del dia, listos para abrir la planilla.' },
    { icono: 'acta', titulo: 'Planilla y Modo Cancha', texto: 'Registra las jugadas con dos toques desde el modo cancha.' },
    { icono: 'reloj', titulo: 'Cronometro y conexion', texto: 'Controla el tiempo y sigue el estado en vivo junto al arbitro.' },
    { icono: 'documento', titulo: 'Finalizar acta', texto: 'Cierra el acta con las firmas de oficiales y delegados.' },
  ],
  adminLiga: [
    { icono: 'torneo', titulo: 'Operacion', texto: 'Torneos, equipos, nominas y pagos de tu liga.' },
    { icono: 'sancion', titulo: 'Disciplina y resultados', texto: 'Sanciones, protestas, estadisticas e historial de partidos.' },
    { icono: 'configuracion', titulo: 'Administracion', texto: 'Configuracion de la liga, sedes, reglas, documentos y credenciales.' },
    { icono: 'bitacora', titulo: 'Bitacora', texto: 'Registro de auditoria de todas las acciones de la liga.' },
  ],
  superadmin: [
    { icono: 'ligas', titulo: 'Directorio de ligas', texto: 'Crea y administra las organizaciones del sistema.' },
    { icono: 'usuarios', titulo: 'Usuarios y credenciales', texto: 'Gestiona accesos, claves y verificacion de correo.' },
    { icono: 'calendario', titulo: 'Calendario global', texto: 'Programacion de partidos de todas las ligas.' },
    { icono: 'documentos', titulo: 'Recursos', texto: 'Documentos globales y respaldos de la base de datos.' },
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
    <div className="fixed inset-0 z-[1900] bg-brand-brown/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Guia del panel">
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
