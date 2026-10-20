import { useState } from 'react';

// LOTE S: Simulador Visual Dinámico de Bolas Criollas.
// Componente de ASISTENCIA pasivo para pruebas manuales y validación del ciclo
// de vida del torneo: no consulta la API, no escribe en la base de datos, no
// altera estados externos y no envía eventos en tiempo real. Su única función
// es dibujar una entrada simulada y sugerir el tanteo según la gráfica.

const MARGEN_TABLERO = 5; // Porcentaje de margen para que las piezas no se corten.

// Lectura estricta de la plantilla de reglas del torneo (sin hardcodeo):
// la cantidad de bolas por equipo se toma de la propiedad esferas_por_equipo.
const leerEsferasPorEquipo = (plantillaReglas) => {
  const valor = parseInt(plantillaReglas && plantillaReglas.esferas_por_equipo, 10);
  return Number.isInteger(valor) && valor > 0 ? valor : 8;
};

// Posición aleatoria en porcentaje, respetando el margen del tablero.
const posicionAleatoria = () => MARGEN_TABLERO + Math.random() * (100 - 2 * MARGEN_TABLERO);

// Motor de arrime: distancia euclidiana al mingo por el teorema de Pitágoras.
// El tablero es cuadrado y las coordenadas son porcentuales, por lo que la
// geometría del tablero coincide con la distancia real sobre la arena.
const distanciaAlMingo = (bola, mingo) => Math.sqrt(Math.pow(bola.x - mingo.x, 2) + Math.pow(bola.y - mingo.y, 2));

export default function VisualizadorCancha({ plantillaReglas = {}, nombreLocal = 'Local', nombreVisita = 'Visita' }) {
  const [mingo, setMingo] = useState(null);
  const [bolasLocal, setBolasLocal] = useState([]);
  const [bolasVisita, setBolasVisita] = useState([]);
  const [veredicto, setVeredicto] = useState(null);

  const esferasPorEquipo = leerEsferasPorEquipo(plantillaReglas);

  // Genera posiciones aleatorias para el mingo y las bolas de ambos equipos,
  // agrupa las distancias, las ordena y determina el ganador de la entrada.
  const lanzarBolas = () => {
    const nuevoMingo = { x: posicionAleatoria(), y: posicionAleatoria() };
    const nuevasLocal = Array.from({ length: esferasPorEquipo }, () => ({ x: posicionAleatoria(), y: posicionAleatoria() }));
    const nuevasVisita = Array.from({ length: esferasPorEquipo }, () => ({ x: posicionAleatoria(), y: posicionAleatoria() }));

    const distancias = []
      .concat(nuevasLocal.map((bola, i) => ({ equipo: 'Local', indice: i + 1, distancia: distanciaAlMingo(bola, nuevoMingo) })))
      .concat(nuevasVisita.map((bola, i) => ({ equipo: 'Visita', indice: i + 1, distancia: distanciaAlMingo(bola, nuevoMingo) })))
      .sort((a, b) => a.distancia - b.distancia);

    const equipoGanador = distancias[0].equipo;
    const equipoRival = equipoGanador === 'Local' ? 'Visita' : 'Local';
    const primeraDelRival = distancias.findIndex(d => d.equipo === equipoRival);
    const bolasContadas = primeraDelRival === -1 ? distancias.length : primeraDelRival;

    // Caso de raya: la bola más cercana de cada equipo quedó a la misma distancia.
    const esRayada = distancias.length > 1 && distancias[0].equipo !== distancias[1].equipo && Math.abs(distancias[0].distancia - distancias[1].distancia) < 0.0001;

    setMingo(nuevoMingo);
    setBolasLocal(nuevasLocal);
    setBolasVisita(nuevasVisita);
    setVeredicto({ distancias, ganador: equipoGanador, puntos: esRayada ? 0 : bolasContadas, raya: esRayada });
  };

  const hayLanzamiento = mingo && bolasLocal.length > 0 && bolasVisita.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-brand-brown/60 font-medium max-w-md">
          Herramienta de asistencia para pruebas manuales. No registra jugadas, no modifica el partido ni envía datos.
        </p>
        <button
          onClick={lanzarBolas}
          className="px-5 py-3 bg-brand-rust text-white rounded-lg font-bold tracking-wider hover:bg-brand-brown transition-colors shadow-sm"
        >
          LANZAR BOLAS
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {/* TABLERO DE ARENA: coordenadas X, Y relativas en porcentaje */}
        <div className="relative w-full aspect-square bg-brand-cream border-2 border-brand-gold/40 rounded-xl overflow-hidden shadow-inner">
          {hayLanzamiento ? (
            <div>
              <div
                className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-white border-2 border-brand-brown shadow z-10"
                style={{ left: mingo.x + '%', top: mingo.y + '%' }}
                title="Mingo (objetivo)"
              />
              {bolasLocal.map((bola, i) => (
                <div
                  key={'local-' + i}
                  className="absolute w-3.5 h-3.5 -ml-1.5 -mt-1.5 rounded-full bg-brand-blue border border-brand-brown/40 shadow z-20"
                  style={{ left: bola.x + '%', top: bola.y + '%' }}
                  title={'Bola ' + (i + 1) + ' de ' + nombreLocal}
                />
              ))}
              {bolasVisita.map((bola, i) => (
                <div
                  key={'visita-' + i}
                  className="absolute w-3.5 h-3.5 -ml-1.5 -mt-1.5 rounded-full bg-brand-rust border border-brand-brown/40 shadow z-20"
                  style={{ left: bola.x + '%', top: bola.y + '%' }}
                  title={'Bola ' + (i + 1) + ' de ' + nombreVisita}
                />
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <p className="text-brand-brown/40 text-sm font-semibold text-center">
                Pulsa LANZAR BOLAS para simular una entrada con {esferasPorEquipo} bolas por equipo.
              </p>
            </div>
          )}
        </div>

        {/* LEYENDA, SUGERENCIA Y TABLA DE DISTANCIAS */}
        <div className="space-y-3">
          <div className="bg-brand-cream/60 border border-brand-gold/30 rounded-lg p-3 text-sm font-semibold text-brand-brown space-y-2">
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-white border border-brand-brown inline-block"></span> Mingo</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-brand-blue inline-block"></span> {nombreLocal}</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-brand-rust inline-block"></span> {nombreVisita}</div>
            <p className="text-xs text-brand-brown/60 font-normal pt-1">Reglas del torneo: {esferasPorEquipo} bolas por equipo (propiedad esferas_por_equipo de la plantilla de reglas).</p>
          </div>

          {veredicto && (
            <div className="bg-white border border-brand-gold/30 rounded-lg p-3 shadow-sm">
              {veredicto.raya ? (
                <p className="text-sm font-bold text-brand-brown">Caso de raya: la bola más cercana de cada equipo quedó a la misma distancia. Entrada nula, no se sugiere tanteo.</p>
              ) : (
                <p className="text-sm font-bold text-brand-brown">
                  Sugerencia: Según la gráfica, anotar {veredicto.puntos} punto{veredicto.puntos === 1 ? '' : 's'} a {veredicto.ganador === 'Local' ? nombreLocal : nombreVisita}.
                </p>
              )}
              <div className="mt-3 max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-brand-brown/60 border-b border-brand-gold/20">
                      <th className="py-1 pr-2">#</th>
                      <th className="py-1 pr-2">Bola</th>
                      <th className="py-1">Distancia al mingo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {veredicto.distancias.map((d, i) => (
                      <tr key={'dist-' + i} className={veredicto.raya || i >= veredicto.puntos ? 'border-b border-brand-gold/10 text-brand-brown/60' : 'border-b border-brand-gold/10 font-bold text-brand-blue'}>
                        <td className="py-1 pr-2">{i + 1}</td>
                        <td className="py-1 pr-2">{d.equipo === 'Local' ? nombreLocal : nombreVisita} #{d.indice}</td>
                        <td className="py-1">{d.distancia.toFixed(2)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
