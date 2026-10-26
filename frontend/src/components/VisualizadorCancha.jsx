import { useState } from 'react';

// LOTE S: Simulador Visual Dinámico de Bolas Criollas.
// Componente de ASISTENCIA pasivo para pruebas manuales y validación del ciclo
// de vida del torneo: no consulta la API, no escribe en la base de datos, no
// altera estados externos y no envía eventos en tiempo real. Su única función
// es dibujar una entrada simulada y sugerir el tanteo según la gráfica.

const MARGEN_TABLERO = 5; // Porcentaje de margen para que las piezas no se corten.
const PROBABILIDAD_NULA = 0.2; // Proporción de lanzamientos anulados por entrada.

// Tipos de lanzamiento del sistema, con el mismo vocabulario del modal del
// Anotador: 'A'/'a' = Arrime válido/nulo, 'B'/'b' = Boche válido/nulo.
const TIPOS_LANZAMIENTO = ['Arrime', 'Boche'];

// Lectura estricta de la plantilla de reglas del torneo (sin hardcodeo):
// la cantidad de bolas por equipo se toma de la propiedad esferas_por_equipo.
const leerEsferasPorEquipo = (plantillaReglas) => {
  const valor = parseInt(plantillaReglas && plantillaReglas.esferas_por_equipo, 10);
  return Number.isInteger(valor) && valor > 0 ? valor : 8;
};

// Posición aleatoria en porcentaje, respetando el margen del tablero.
const posicionAleatoria = () => MARGEN_TABLERO + Math.random() * (100 - 2 * MARGEN_TABLERO);

// Lanzamiento simulado: posición, tipo de lanzamiento y validez.
const lanzamientoAleatorio = () => ({
  x: posicionAleatoria(),
  y: posicionAleatoria(),
  tipo: TIPOS_LANZAMIENTO[Math.floor(Math.random() * TIPOS_LANZAMIENTO.length)],
  valida: Math.random() >= PROBABILIDAD_NULA
});

// Motor de arrime: distancia euclidiana al mingo por el teorema de Pitágoras.
// El tablero es cuadrado y las coordenadas son porcentuales, por lo que la
// geometría del tablero coincide con la distancia real sobre la arena.
const distanciaAlMingo = (bola, mingo) => Math.sqrt(Math.pow(bola.x - mingo.x, 2) + Math.pow(bola.y - mingo.y, 2));

export default function VisualizadorCancha({ plantillaReglas = {}, nombreLocal = 'Local', nombreVisita = 'Visita' }) {
  const [mingo, setMingo] = useState(null);
  const [bolasLocal, setBolasLocal] = useState([]);
  const [bolasVisita, setBolasVisita] = useState([]);
  const [veredicto, setVeredicto] = useState(null);
  const [bolaSeleccionada, setBolaSeleccionada] = useState(null);

  const esferasPorEquipo = leerEsferasPorEquipo(plantillaReglas);

  // Genera posiciones aleatorias para el mingo y las bolas de ambos equipos,
  // clasifica cada lanzamiento (Arrime/Boche, Válido/Nulo), agrupa las
  // distancias de las bolas válidas y determina el ganador de la entrada.
  const lanzarBolas = () => {
    const nuevoMingo = { x: posicionAleatoria(), y: posicionAleatoria() };
    const nuevasLocal = Array.from({ length: esferasPorEquipo }, lanzamientoAleatorio);
    const nuevasVisita = Array.from({ length: esferasPorEquipo }, lanzamientoAleatorio);

    const distancias = []
      .concat(nuevasLocal.map((bola, i) => ({ equipo: 'Local', indice: i + 1, tipo: bola.tipo, valida: bola.valida, distancia: distanciaAlMingo(bola, nuevoMingo) })))
      .concat(nuevasVisita.map((bola, i) => ({ equipo: 'Visita', indice: i + 1, tipo: bola.tipo, valida: bola.valida, distancia: distanciaAlMingo(bola, nuevoMingo) })));

    // Solo las bolas válidas participan del arrime; las nulas quedan como evidencia.
    const validas = distancias.filter(d => d.valida).sort((a, b) => a.distancia - b.distancia);
    const nulas = distancias.filter(d => !d.valida).sort((a, b) => a.distancia - b.distancia);
    const filas = validas.concat(nulas);

    const sinValidas = validas.length === 0;

    const equipoGanador = sinValidas ? null : validas[0].equipo;
    const equipoRival = equipoGanador === 'Local' ? 'Visita' : 'Local';
    const primeraDelRival = sinValidas ? -1 : validas.findIndex(d => d.equipo === equipoRival);
    const bolasContadas = sinValidas ? 0 : (primeraDelRival === -1 ? validas.length : primeraDelRival);

    // Caso de raya: la bola válida más cercana de cada equipo quedó a la misma distancia.
    const esRayada = validas.length > 1 && validas[0].equipo !== validas[1].equipo && Math.abs(validas[0].distancia - validas[1].distancia) < 0.0001;

    setBolaSeleccionada(null);
    setMingo(nuevoMingo);
    setBolasLocal(nuevasLocal);
    setBolasVisita(nuevasVisita);
    setVeredicto({
      filas,
      ganador: equipoGanador,
      puntos: esRayada || sinValidas ? 0 : bolasContadas,
      raya: esRayada,
      sinValidas: sinValidas,
      tipoGanador: sinValidas ? null : validas[0].tipo
    });
  };

  const hayLanzamiento = mingo && bolasLocal.length > 0 && bolasVisita.length > 0;

  // M3: panel de referencia por lanzamiento. Todo se deriva del veredicto ya
  // calculado; nada sale del componente (mantiene el contrato pasivo del Lote S).
  const esSeleccion = (equipo, indice) => !!bolaSeleccionada && bolaSeleccionada.equipo === equipo && bolaSeleccionada.indice === indice;
  const filaSel = veredicto && bolaSeleccionada ? veredicto.filas.find(f => f.equipo === bolaSeleccionada.equipo && f.indice === bolaSeleccionada.indice) : null;
  const posicionSel = bolaSeleccionada ? (bolaSeleccionada.equipo === 'Local' ? bolasLocal[bolaSeleccionada.indice - 1] : bolasVisita[bolaSeleccionada.indice - 1]) : null;
  const ordenValidas = filaSel && filaSel.valida ? veredicto.filas.filter(f => f.valida).findIndex(f => f.equipo === filaSel.equipo && f.indice === filaSel.indice) : -1;
  const puntuaSel = !!(filaSel && filaSel.valida && !veredicto.raya && !veredicto.sinValidas && ordenValidas !== -1 && ordenValidas < veredicto.puntos);
  const codigoSel = filaSel ? (filaSel.tipo === 'Arrime' ? (filaSel.valida ? 'A' : 'a') : (filaSel.valida ? 'B' : 'b')) : '';

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
                <button
                  type="button"
                  key={'local-' + i}
                  onClick={() => setBolaSeleccionada({ equipo: 'Local', indice: i + 1 })}
                  className={'absolute w-3.5 h-3.5 -ml-1.5 -mt-1.5 rounded-full bg-brand-blue border border-brand-brown/40 shadow z-20 cursor-pointer transition-transform' + (esSeleccion('Local', i + 1) ? ' scale-150 ring-4 ring-brand-gold z-30' : '') + (bola.valida ? '' : ' opacity-40 border-dashed')}
                  style={{ left: bola.x + '%', top: bola.y + '%' }}
                  title={'Bola ' + (i + 1) + ' de ' + nombreLocal + ' - Lanzamiento: ' + bola.tipo + ' (' + (bola.valida ? 'Válido' : 'Nulo') + ')'}
                />
              ))}
              {bolasVisita.map((bola, i) => (
                <button
                  type="button"
                  key={'visita-' + i}
                  onClick={() => setBolaSeleccionada({ equipo: 'Visita', indice: i + 1 })}
                  className={'absolute w-3.5 h-3.5 -ml-1.5 -mt-1.5 rounded-full bg-brand-rust border border-brand-brown/40 shadow z-20 cursor-pointer transition-transform' + (esSeleccion('Visita', i + 1) ? ' scale-150 ring-4 ring-brand-gold z-30' : '') + (bola.valida ? '' : ' opacity-40 border-dashed')}
                  style={{ left: bola.x + '%', top: bola.y + '%' }}
                  title={'Bola ' + (i + 1) + ' de ' + nombreVisita + ' - Lanzamiento: ' + bola.tipo + ' (' + (bola.valida ? 'Válido' : 'Nulo') + ')'}
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

        {/* LEYENDA, SUGERENCIA Y TABLA DE LANZAMIENTOS */}
        <div className="space-y-3">
          <div className="bg-brand-cream/60 border border-brand-gold/30 rounded-lg p-3 text-sm font-semibold text-brand-brown space-y-2">
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-white border border-brand-brown inline-block"></span> Mingo</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-brand-blue inline-block"></span> {nombreLocal}</div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-brand-rust inline-block"></span> {nombreVisita}</div>
            <p className="text-xs text-brand-brown/60 font-normal pt-1">Reglas del torneo: {esferasPorEquipo} bolas por equipo (propiedad esferas_por_equipo de la plantilla de reglas).</p>
            <p className="text-xs text-brand-brown/60 font-normal">Lanzamientos: Arrime y Boche. Las bolas con lanzamiento nulo se dibujan atenuadas con borde punteado y no puntúan.</p>
          </div>

          {veredicto && (
            <div className="bg-white border border-brand-gold/30 rounded-lg p-3 shadow-sm">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={'px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider ' + (veredicto.raya || veredicto.sinValidas ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>
                  {veredicto.raya || veredicto.sinValidas ? 'Entrada nula' : 'Entrada válida'}
                </span>
                <span className="text-xs font-semibold text-brand-brown/60">
                  {veredicto.sinValidas ? 'Sin bolas válidas' : 'Tipo de la bola más cercana: ' + veredicto.tipoGanador}
                </span>
              </div>
              {veredicto.sinValidas ? (
                <p className="text-sm font-bold text-brand-brown">Entrada nula: todos los lanzamientos quedaron anulados. No hay bolas válidas para el arrime.</p>
              ) : veredicto.raya ? (
                <p className="text-sm font-bold text-brand-brown">Caso de raya: la bola válida más cercana de cada equipo quedó a la misma distancia. Entrada nula, no se sugiere tanteo.</p>
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
                      <th className="py-1 pr-2">Lanzamiento</th>
                      <th className="py-1 pr-2">Estado</th>
                      <th className="py-1">Distancia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {veredicto.filas.map((d, i) => (
                      <tr
                        key={'dist-' + i}
                        onClick={() => setBolaSeleccionada({ equipo: d.equipo, indice: d.indice })}
                        className={(d.valida && !veredicto.raya && !veredicto.sinValidas && i < veredicto.puntos
                          ? 'border-b border-brand-gold/10 font-bold text-brand-blue'
                          : (d.valida ? 'border-b border-brand-gold/10 text-brand-brown/60' : 'border-b border-brand-gold/10 text-brand-brown/40')) + (esSeleccion(d.equipo, d.indice) ? ' bg-brand-gold/20' : ' cursor-pointer hover:bg-brand-gold/10')}
                      >
                        <td className="py-1 pr-2">{i + 1}</td>
                        <td className="py-1 pr-2">{d.equipo === 'Local' ? nombreLocal : nombreVisita} #{d.indice}</td>
                        <td className="py-1 pr-2">{d.tipo}</td>
                        <td className="py-1 pr-2">{d.valida ? 'Válido' : 'Nulo'}</td>
                        <td className="py-1">{d.distancia.toFixed(2)} %</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* M3: PANEL DE REFERENCIA POR LANZAMIENTO (solo lectura, pasivo) */}
          {veredicto && (
            <div className="bg-brand-brown text-brand-cream border border-brand-gold/40 rounded-lg p-4 shadow-sm">
              <h4 className="text-xs font-bold uppercase tracking-widest text-brand-gold mb-2">Panel de referencia por lanzamiento</h4>
              {filaSel && posicionSel ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={'w-3 h-3 rounded-full inline-block ' + (filaSel.equipo === 'Local' ? 'bg-brand-blue' : 'bg-brand-rust')}></span>
                    <span className="font-bold">{filaSel.equipo === 'Local' ? nombreLocal : nombreVisita} - Bola #{filaSel.indice}</span>
                    <span className={'px-2 py-0.5 rounded-full text-[0.65rem] font-bold uppercase tracking-wider ' + (filaSel.valida ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300')}>
                      {filaSel.tipo} {filaSel.valida ? 'válido' : 'nulo'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-brand-cream/10 rounded p-2">
                      <p className="text-brand-gold font-bold uppercase tracking-wider text-[0.65rem] mb-1">Código en el registro manual</p>
                      <p className="text-lg font-black leading-none">{codigoSel}</p>
                      <p className="text-brand-cream/60 mt-1">Equivale a {filaSel.tipo.toLowerCase()} {filaSel.valida ? 'válido' : 'nulo'} del vocabulario del sistema (A/a, B/b).</p>
                    </div>
                    <div className="bg-brand-cream/10 rounded p-2">
                      <p className="text-brand-gold font-bold uppercase tracking-wider text-[0.65rem] mb-1">Distancia al mingo</p>
                      <p className="text-lg font-black leading-none">{filaSel.distancia.toFixed(2)} %</p>
                      <p className="text-brand-cream/60 mt-1">Coordenadas: X {posicionSel.x.toFixed(1)} / Y {posicionSel.y.toFixed(1)}</p>
                    </div>
                  </div>
                  <div className="bg-brand-cream/10 rounded p-2 text-xs">
                    <p className="text-brand-gold font-bold uppercase tracking-wider text-[0.65rem] mb-1">Orden en el arrime</p>
                    {filaSel.valida ? (
                      <p className="text-brand-cream/90 font-semibold">Puesto {ordenValidas + 1} entre las {veredicto.filas.filter(f => f.valida).length} bolas válidas.</p>
                    ) : (
                      <p className="text-brand-cream/90 font-semibold">No participa del arrime: el lanzamiento quedó anulado.</p>
                    )}
                    <p className="text-brand-cream/70 mt-1">
                      {puntuaSel
                        ? 'Puntúa: es una de las ' + veredicto.puntos + ' bola' + (veredicto.puntos === 1 ? '' : 's') + ' de ' + (veredicto.ganador === 'Local' ? nombreLocal : nombreVisita) + ' antes de la primera bola válida del rival.'
                        : filaSel.valida
                          ? 'No puntúa: quedó por detrás de la primera bola válida del rival' + (veredicto.raya ? ' (entrada declarada raya)' : '') + '.'
                          : 'No puntúa: lanzamiento nulo.'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-brand-cream/60 font-medium">
                  Toca una bola del tablero o una fila de la tabla para ver su ficha de referencia: código del registro manual, distancia al mingo, orden del arrime y si puntúa.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
