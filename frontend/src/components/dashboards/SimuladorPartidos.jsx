import { useState, useEffect, useMemo, useRef } from 'react';
import PlanillaUniversal from './PlanillaUniversal';
import VisualizadorCancha from '../VisualizadorCancha';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// SIMULADOR DE PARTIDOS (pedido de Keiko): genera un acta completa de guia con
// datos aleatorios pero verosimiles, presentada en la misma interfaz de la
// plantilla oficial de anotacion. Objetivo: facilitar las pruebas y la
// validacion del sistema sin depender de un partido real. El sistema llena
// esta planilla de guia; el anotador llena la planilla real, y esos son los
// datos que el sistema procesa. Esta vista es de solo lectura (espectador).

const NOMINA_GENERICA = (prefijo) =>
  Array.from({ length: 8 }, (_, i) => ({ id: prefijo + (i + 1), nombre: 'Jugador ' + (i + 1), apellido: '', numero_dorsal: i + 1 }));

// Distribucion de referencia de tiros: ~45% arrime, ~35% boche y ~20% rastrero
// (solo si la plantilla de reglas registra boche rastrero). Mayuscula = valido,
// minuscula = nulo, ~8% de lanzamientos terminan en N (nulo general).
const elegirLanzamiento = (conRastrero) => {
  const dado = Math.random();
  if (conRastrero && dado < 0.2) return Math.random() < 0.7 ? 'R' : 'r';
  if (dado < (conRastrero ? 0.55 : 0.65)) return Math.random() < 0.7 ? 'A' : 'a';
  return Math.random() < 0.7 ? 'B' : 'b';
};

const generarPartido = ({ jugadoresLocal, jugadoresVisita, reglas }) => {
  const metaPuntos = parseInt(reglas && reglas.meta_puntos, 10) || 20;
  const conRastrero = reglas && reglas.registrar_boche_rastrero === true;
  const todos = [...jugadoresLocal, ...jugadoresVisita];
  const puntosLocal = Array(20).fill('');
  const puntosVisita = Array(20).fill('');
  const efectividadJugadores = {};
  const resumenPorJugador = {};
  todos.forEach(j => {
    efectividadJugadores[j.id] = {};
    resumenPorJugador[j.id] = { A: 0, a: 0, B: 0, b: 0, R: 0, r: 0, N: 0 };
  });
  let totalLocal = 0;
  let totalVisita = 0;
  for (let mIdx = 0; mIdx < 20; mIdx++) {
    // Tipo de lanzamiento y validez: una letra por jugador por mano.
    for (const j of todos) {
      const valor = Math.random() < 0.08 ? 'N' : elegirLanzamiento(conRastrero);
      efectividadJugadores[j.id][mIdx] = { valor, estado: valor === 'N' || valor === valor.toLowerCase() ? 'rechazado' : 'validado' };
      resumenPorJugador[j.id][valor] += 1;
    }
    // Tantos de la mano: ~12% de manos nulas; el resto entre 1 y 6 tantos,
    // ponderados a un ganador aleatorio de la mano.
    if (Math.random() < 0.12) continue;
    const ganaLocal = Math.random() < 0.5;
    const restante = metaPuntos - (ganaLocal ? totalLocal : totalVisita);
    const tantos = Math.min(1 + Math.floor(Math.random() * 6), restante);
    if (tantos <= 0) continue;
    if (ganaLocal) { puntosLocal[mIdx] = String(tantos); totalLocal += tantos; }
    else { puntosVisita[mIdx] = String(tantos); totalVisita += tantos; }
    if (totalLocal >= metaPuntos || totalVisita >= metaPuntos) break;
  }
  // Cantidad de cada tiro por persona y tipo. Las columnas de la planilla se
  // derivan de los lanzamientos: AL arrime valido, AB arrime nulo, BL boche y
  // rastrero validos, BB boche y rastrero nulos. N queda fuera de las 4 columnas.
  const manualStats = {};
  for (const j of todos) {
    const r = resumenPorJugador[j.id];
    manualStats[j.id] = { AL: r.A, AB: r.a, BL: r.B + r.R, BB: r.b + r.r };
  }
  return { puntosLocal, puntosVisita, efectividadJugadores, manualStats, resumenPorJugador, metaPuntos, conRastrero, totalLocal, totalVisita };
};

export default function SimuladorPartidos() {
  const [cargando, setCargando] = useState(true);
  const [jugadoresLocal, setJugadoresLocal] = useState(() => NOMINA_GENERICA('L'));
  const [jugadoresVisita, setJugadoresVisita] = useState(() => NOMINA_GENERICA('V'));
  const [datosPartido, setDatosPartido] = useState({
    localNombre: 'Equipo Local',
    visitaNombre: 'Equipo Visita',
    fecha: new Date().toLocaleDateString('es-VE')
  });
  const [reglas, setReglas] = useState({});
  const [semilla, setSemilla] = useState(0);
  const [manoSel, setManoSel] = useState(0);
  const [conNominasReales, setConNominasReales] = useState(false); // habilita "Usar en la planilla real"
  const [envioPlanilla, setEnvioPlanilla] = useState(null);
  const idPartidoUrlRef = useRef(null);

  useEffect(() => {
    // Si la URL trae partido_id (uuid_publico o id interno) se usan sus
    // nominas reales; los datos generados siguen siendo de guia.
    const id = new URLSearchParams(window.location.search).get('partido_id');
    if (!id) { setCargando(false); return; }
    idPartidoUrlRef.current = id;
    fetch(`${API_URL}/publico/partidos/${id}`)
      .then(res => res.json())
      .then(data => {
        if (!data || data.error) throw new Error('partido');
        setDatosPartido(prev => ({
          ...prev,
          localNombre: data.local_nombre || prev.localNombre,
          visitaNombre: data.visita_nombre || prev.visitaNombre,
          arbitro: data.arbitro_nombre,
          anotador: data.anotador_nombre,
          fecha: data.fecha_hora ? new Date(data.fecha_hora).toLocaleDateString('es-VE') : prev.fecha
        }));
        setReglas(data.torneo_reglas || {});
        return fetch(`${API_URL}/publico/partidos/${id}/nomina`)
          .then(res => res.json())
          .then(nomina => {
            const lista = Array.isArray(nomina) ? nomina : [];
            setJugadoresLocal(lista.filter(j => j.equipo_id === data.equipo_local_id));
            setJugadoresVisita(lista.filter(j => j.equipo_id === data.equipo_visita_id));
            setConNominasReales(true);
          });
      })
      .catch(() => {
        // Sin partido disponible se mantiene la nomina generica de 8 por equipo.
      })
      .finally(() => setCargando(false));
  }, []);

  const regenerar = () => setSemilla(s => s + 1);

  // UX ajustes (pedido de Keiko): deja los datos generados listos para aplicar
  // a la planilla REAL del partido. El simulador corre en su propia pestana y
  // no toca el estado del panel del Anotador: publica la carga en localStorage
  // y el panel del Anotador la recoge por el evento storage (siempre con
  // confirmacion y solo para el mismo partido). Requiere nominas reales, que
  // solo existen cuando se abre con partido_id.
  const usarEnPlanillaReal = () => {
    if (!conNominasReales || !idPartidoUrlRef.current) return;
    try {
      localStorage.setItem('conmingo_simulador_export', JSON.stringify({
        ts: Date.now(),
        partidoId: idPartidoUrlRef.current,
        efectividadJugadores: datosActuales.efectividadJugadores,
        manualStats: datosActuales.manualStats,
        puntosLocal: datosActuales.puntosLocal,
        puntosVisita: datosActuales.puntosVisita
      }));
      setEnvioPlanilla(Date.now());
    } catch {
      setEnvioPlanilla(null);
    }
  };
  // Los datos se generan solo al montar, al cargar nominas reales o al pedir
  // otro partido (memoizados), para que la planilla no cambie sola.
  const datosActuales = useMemo(
    () => (cargando || jugadoresLocal.length === 0)
      ? { puntosLocal: Array(20).fill(''), puntosVisita: Array(20).fill(''), efectividadJugadores: {}, manualStats: {}, resumenPorJugador: {}, metaPuntos: 20, conRastrero: false, totalLocal: 0, totalVisita: 0 }
      : generarPartido({ jugadoresLocal, jugadoresVisita, reglas }),
    [cargando, jugadoresLocal, jugadoresVisita, reglas, semilla]
  );

  const filasResumen = [
    ...jugadoresLocal.map(j => ({ ...j, lado: 'Local', equipo: datosPartido.localNombre })),
    ...jugadoresVisita.map(j => ({ ...j, lado: 'Visita', equipo: datosPartido.visitaNombre }))
  ];

  // Manos con datos registrados para el tablero de cancha.
  const manosDisponibles = useMemo(() => {
    const lista = [];
    for (let m = 0; m < 20; m++) {
      const hayJugadas = Object.values(datosActuales.efectividadJugadores).some(manos => manos && manos[m]);
      if (hayJugadas || datosActuales.puntosLocal[m] || datosActuales.puntosVisita[m]) lista.push(m);
    }
    return lista;
  }, [datosActuales]);

  const manoActual = manosDisponibles.includes(manoSel) ? manoSel : (manosDisponibles.length > 0 ? manosDisponibles[0] : -1);

  // Entrada del tablero: lanzamientos y tantos de la mano seleccionada, tal
  // como quedaron registrados en la planilla (el visualizador no genera nada).
  const entradaCancha = useMemo(() => {
    if (manoActual < 0) return null;
    const jugadas = filasResumen.flatMap(j => {
      const celda = (datosActuales.efectividadJugadores[j.id] || {})[manoActual];
      if (!celda) return [];
      return [{ equipo: j.lado, indice: j.numero_dorsal || 0, etiqueta: '#' + (j.numero_dorsal || '-') + ' ' + (j.apellido ? j.apellido + ' ' : '') + j.nombre, valor: celda.valor }];
    });
    return {
      mano: manoActual + 1,
      jugadas,
      tantosLocal: datosActuales.puntosLocal[manoActual] || '0',
      tantosVisita: datosActuales.puntosVisita[manoActual] || '0'
    };
  }, [manoActual, datosActuales, jugadoresLocal, jugadoresVisita]);

  return (
    <div className="min-h-screen bg-brand-cream text-brand-brown font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">

        <div className="bg-white rounded-xl border border-brand-gold/30 shadow-sm p-5 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-black text-brand-brown uppercase tracking-wider">Simulador de Partidos</h1>
            <p className="text-xs text-brand-brown/60 mt-1">
              Esta es la planilla de guia: el sistema llena estos datos de referencia. Sirve para probar y validar el sistema sin un partido real, y puedes aplicar los datos a la planilla real con el boton de la derecha.
            </p>
            {envioPlanilla ? (
              <p className="text-xs font-bold text-green-700 mt-1">
                Datos enviados. Vuelve a la pestana del panel del Anotador de este partido y confirma el aviso para aplicarlos al acta.
              </p>
            ) : !conNominasReales && !cargando ? (
              <p className="text-xs text-brand-brown/60 mt-1">
                El boton "Usar en la planilla real" se habilita cuando el simulador se abre con un partido real (boton Simulador del panel del Anotador).
              </p>
            ) : null}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button onClick={regenerar} className="px-6 py-3 bg-brand-blue text-white rounded-lg font-bold shadow-sm hover:bg-brand-brown transition-colors">
              Generar otro partido
            </button>
            <button
              onClick={usarEnPlanillaReal}
              disabled={!conNominasReales || cargando}
              className="px-6 py-3 bg-brand-rust text-white rounded-lg font-bold shadow-sm hover:bg-brand-brown transition-colors disabled:bg-gray-400 disabled:opacity-70 disabled:cursor-not-allowed"
              title={conNominasReales ? 'Deja los datos listos para aplicarlos en la planilla del Anotador' : 'Disponible solo cuando el simulador se abre con un partido real'}
            >
              Usar en la planilla real
            </button>
          </div>
        </div>

        {cargando ? (
          <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm p-12 text-center text-brand-brown/60 animate-pulse">
            Cargando datos del encuentro...
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm p-4 sm:p-6">
              <PlanillaUniversal
                rol="espectador"
                estadoPartido="Finalizado"
                partidoId={null}
                datosPartido={datosPartido}
                jugadoresLocal={jugadoresLocal}
                jugadoresVisita={jugadoresVisita}
                efectividadJugadores={datosActuales.efectividadJugadores}
                manualStats={datosActuales.manualStats}
                puntosPorManoLocal={datosActuales.puntosLocal}
                puntosPorManoVisita={datosActuales.puntosVisita}
              />
            </div>

            <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm p-4 sm:p-6">
              <h2 className="text-lg font-black text-brand-brown uppercase tracking-wider mb-4">Resumen por jugador y tipo de tiro</h2>
              <p className="text-xs text-brand-brown/60 mb-4">
                Cantidad de cada tiro por persona y tipo: mayuscula valida, minuscula nula, N nulo general. AL/AB/BL/BB son las columnas de la planilla (AL y AB arrime; BL y BB boche y rastrero; N queda fuera).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-brand-cream/40 text-left text-xs uppercase tracking-wider text-brand-brown/70">
                      <th className="p-2">Jugador</th>
                      <th className="p-2">Equipo</th>
                      {['A', 'a', 'B', 'b', 'R', 'r', 'N', 'AL', 'AB', 'BL', 'BB'].map(t => (
                        <th key={t} className="p-2 text-center">{t}</th>
                      ))}
                      <th className="p-2 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasResumen.map(j => {
                      const r = datosActuales.resumenPorJugador[j.id] || { A: 0, a: 0, B: 0, b: 0, R: 0, r: 0, N: 0 };
                      const s = datosActuales.manualStats[j.id] || { AL: 0, AB: 0, BL: 0, BB: 0 };
                      const total = r.A + r.a + r.B + r.b + r.R + r.r + r.N;
                      return (
                        <tr key={j.id} className="border-b border-brand-gold/20">
                          <td className="p-2 font-bold">{j.apellido ? j.apellido + ' ' : ''}{j.nombre}</td>
                          <td className="p-2 text-brand-brown/70">{j.equipo}</td>
                          {['A', 'a', 'B', 'b', 'R', 'r', 'N'].map(t => (
                            <td key={t} className={`p-2 text-center font-bold ${t === 'N' || t === t.toLowerCase() ? 'text-red-600' : 'text-green-700'}`}>{r[t]}</td>
                          ))}
                          {['AL', 'AB', 'BL', 'BB'].map(t => (
                            <td key={t} className="p-2 text-center font-bold">{s[t]}</td>
                          ))}
                          <td className="p-2 text-center font-black">{total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-brand-brown/60 mt-4">
                Marcador simulado: {datosPartido.localNombre} {datosActuales.totalLocal} - {datosActuales.totalVisita} {datosPartido.visitaNombre}. Meta de puntos: {datosActuales.metaPuntos}.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm p-4 sm:p-6">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className="text-lg font-black text-brand-brown uppercase tracking-wider">Cancha por mano (datos del acta)</h2>
                <select
                  value={manoActual}
                  onChange={e => setManoSel(Number(e.target.value))}
                  className="p-2.5 rounded-lg border border-brand-gold/40 bg-brand-cream/20 text-sm font-bold text-brand-brown outline-none cursor-pointer"
                >
                  {manosDisponibles.map(m => (
                    <option key={m} value={m}>Mano {m + 1}</option>
                  ))}
                </select>
              </div>
              {manosDisponibles.length === 0 ? (
                <p className="text-sm text-brand-brown/60">Genera un partido para ver el tablero de una mano.</p>
              ) : (
                <VisualizadorCancha
                  plantillaReglas={reglas}
                  nombreLocal={datosPartido.localNombre}
                  nombreVisita={datosPartido.visitaNombre}
                  entrada={entradaCancha}
                />
              )}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
