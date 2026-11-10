import { useEffect, useRef, useState } from 'react';
import { formatearFechaHora } from './fechas'; // LOTE FECHAS: fecha del partido en dd/mm/aaaa, 12 horas

// PANTALLA DE INICIO PUBLICA (CONMINGO), revision de Keiko: el fondo conserva
// sus gradientes (con un toque mas de terracota) y simula el lance mientras
// se scrollea, porque en bolas criollas gana el equipo que deja mas bolas
// cerca del mingo: las bolas ilustradas de marca ruedan hacia el mingo
// dorado durante todo el recorrido, hasta llegar al footer. El copy va
// para quien ya
// conoce el deporte, las tarjetas llevan iconos, hay footer completo y el
// sistema se presenta como gestion deportiva de bolas criollas. Solo se
// listan partidos en vivo o agendados a futuro.

// Bola criolla ilustrada: asset de marca de Keiko (ilustracion embebida en el
// SVG). Reemplaza a la bola vectorial con gradientes, que no pegaba con el
// estilo de la marca. Las bolas reales son de madera dura y se distinguen por
// las marcas pintadas, igual que estas ilustraciones.
const BolaCriolla = ({ tamano = 'h-12 w-12' }) => (
  <img src="/bola1.svg" alt="Bola criolla ilustrada" className={tamano} />
);

// EL ARRIME: la jugada del fondo, simulada con el scroll y repartida en
// todo el recorrido de la pagina, hasta llegar al footer. El mingo dorado
// va fijo en pantalla y cada bola ilustrada parte de un extremo y rueda
// hasta su distancia final del mingo: gana el equipo con mas bolas cerca
// del mingo. Las posiciones estan en px relativos al centro del mingo; el
// umbral es la fraccion del scroll total que espera cada bola antes de
// rodar y la ventana es la fraccion del scroll que tarda en llegar.
const ARRIME_VENTANA = 0.5;
const BOLAS_ARRIME = [
  { src: '/bola1.svg', tamano: 'w-20 h-20', umbral: 0, desde: { x: -640, y: 120, giro: -170 }, hasta: { x: -34, y: 8, giro: -12 } },
  { src: '/bola4.svg', tamano: 'w-16 h-16', umbral: 0.12, desde: { x: 230, y: -320, giro: 160 }, hasta: { x: 40, y: -6, giro: 18 } },
  { src: '/bola2.svg', tamano: 'w-16 h-16', umbral: 0.24, desde: { x: 330, y: 230, giro: 140 }, hasta: { x: 10, y: 46, giro: 32 } },
  { src: '/bola0.svg', tamano: 'w-20 h-20', umbral: 0.36, desde: { x: -460, y: 350, giro: -150 }, hasta: { x: -16, y: -46, giro: -28 } }
];

const VENTAJAS = [
  {
    titulo: 'Acta digital del anotador',
    texto: 'La planilla se llena en el telefono del anotador, mano por mano. Al finalizar, el acta sale en PDF con las firmas de una vez.',
    icono: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )
  },
  {
    titulo: 'Marcador publico en vivo',
    texto: 'Un codigo QR en la cancha y el publico sigue los tantos desde su telefono, sin instalar nada.',
    icono: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M4 4h6v6H4V4zm2 2v2h2V6H6zM14 4h6v6h-6V4zm2 2v2h2V6h-2zM4 14h6v6H4v-6zm2 2v2h2v-2H6zM14 14h2v2h-2v-2zm4 0h2v2h-2v-2zm-2 2h2v2h-2v-2zm2 2h2v2h-2v-2zm-4 0h2v2h-2v-2z" />
      </svg>
    )
  },
  {
    titulo: 'Estadisticas y premiacion',
    texto: 'Average, arrimadores y bochadores se calculan solos. La premiacion del torneo sale con diplomas en PDF, sin cuentas en cuadernos.',
    icono: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )
  },
  {
    titulo: 'Reglamento y disciplina',
    texto: 'Sanciones, protestas y votacion al MVP con las reglas del torneo aplicadas por el sistema, no de memoria.',
    icono: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    )
  }
];

export default function InicioPublico({ partidos = [], onIniciarSesion }) {
  const [desplazamiento, setDesplazamiento] = useState(0);
  const [recorridoScroll, setRecorridoScroll] = useState(1); // px que abarca scrollear toda la pagina
  const reducirMovimiento = useRef(false);

  // Lectura temprana de prefers-reduced-motion (la misma del efecto de
  // scroll): con el movimiento reducido las bolas del fondo quedan
  // arrimadas al mingo desde el inicio, sin simulacion.
  if (!reducirMovimiento.current && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    reducirMovimiento.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // El arte de fondo se desplaza a distinta velocidad que el contenido
  // mientras se scrollea (parallax suave, desactivado si el usuario
  // prefiere reducir el movimiento).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof window.matchMedia === 'function') {
      reducirMovimiento.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    if (reducirMovimiento.current) return;
    let raf = 0;
    const alScrollear = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setDesplazamiento(window.scrollY || 0);
        setRecorridoScroll(Math.max(1, document.documentElement.scrollHeight - window.innerHeight));
      });
    };
    window.addEventListener('scroll', alScrollear, { passive: true });
    alScrollear();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', alScrollear);
    };
  }, []);

  // Solo partidos en vivo o agendados a futuro (los pasados y
  // suspendidos quedan fuera del inicio publico).
  const ahora = new Date();
  const enVivo = partidos.filter((p) => p.estado === 'En Curso');
  const agendados = partidos
    .filter((p) => p.estado === 'Agendado' && new Date(p.fecha_hora) >= ahora)
    .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora));

  const abrirMarcador = (p) => window.open(`/?vista=puntajes&partido_id=${p.uuid_publico || p.id}`, '_blank');
  const abrirPizarra = () => window.open('/?vista=puntajes', '_blank');
  const abrirSimulador = () => window.open('/?vista=simulador', '_blank');
  const parallax = (factor) => `translateY(${(desplazamiento * factor).toFixed(1)}px)`;

  // Avance de una bola del arrime hacia el mingo, repartido en todo el
  // recorrido de la pagina (hasta el footer); frena
  // suave al llegar y con movimiento reducido va directo a su lugar.
  const avanceBola = (bola, campo) => {
    if (reducirMovimiento.current) return bola.hasta[campo];
    const avance = Math.min(1, Math.max(0, desplazamiento / recorridoScroll));
    const bruto = Math.min(1, Math.max(0, (avance - bola.umbral) / ARRIME_VENTANA));
    const suave = 1 - (1 - bruto) * (1 - bruto);
    return bola.desde[campo] + (bola.hasta[campo] - bola.desde[campo]) * suave;
  };

  const TarjetaPartido = ({ p }) => (
    <article className="group bg-white border border-brand-gold/30 rounded-2xl p-5 flex flex-col justify-between shadow-sm hover:shadow-md hover:border-brand-rust transition-all">
      <div>
        <div className="flex justify-between items-center mb-4">
          <span className="text-xs font-bold text-brand-blue uppercase tracking-wide">{p.torneo_nombre || 'Encuentro'}</span>
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${p.estado === 'En Curso' ? 'bg-green-100 text-green-700 animate-pulse' : 'bg-brand-cream text-brand-brown border border-brand-gold/30'}`}>
            {p.estado === 'En Curso' ? 'En vivo' : 'Agendado'}
          </span>
        </div>

        <div className="text-center p-4 bg-brand-cream/30 rounded-lg border border-brand-cream mb-4 group-hover:bg-brand-cream/50 transition-colors">
          <div className="text-lg font-bold text-brand-brown">{p.local_nombre || 'Local'}</div>
          <div className="text-xs font-bold text-brand-rust my-2">VS</div>
          <div className="text-lg font-bold text-brand-brown">{p.visita_nombre || 'Visita'}</div>
        </div>

        <div className="space-y-1.5 text-sm text-brand-brown/70 mb-5">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-brand-blue shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span>{p.sede_nombre || 'Cancha principal'}</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-brand-blue shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span>{formatearFechaHora(p.fecha_hora)}</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => abrirMarcador(p)}
        className="w-full rounded-lg bg-brand-blue text-white py-2.5 font-bold shadow-sm hover:bg-brand-rust transition-colors"
      >
        {p.estado === 'En Curso' ? 'Ver marcador en vivo' : 'Ver en la pizarra publica'}
      </button>
    </article>
  );

  return (
    <div className="relative animate-slide-up">

      {/* ARTE DE FONDO: gradientes (con mas terracota), lineas y los assets
          ilustrados de marca; decoran y se desplazan con el scroll */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-48 -right-40 w-[34rem] h-[34rem] rounded-full" style={{ transform: parallax(0.08), background: 'radial-gradient(circle at 40% 40%, rgba(231,186,103,0.4), rgba(231,186,103,0.12) 45%, rgba(231,186,103,0) 70%)' }}></div>
        <div className="absolute -bottom-56 -left-40 w-[36rem] h-[36rem] rounded-full" style={{ transform: parallax(-0.06), background: 'radial-gradient(circle at 50% 50%, rgba(242,235,224,0.9), rgba(242,235,224,0.25) 50%, rgba(242,235,224,0) 72%)' }}></div>
        <div className="absolute -top-24 left-[16%] w-[30rem] h-[30rem] rounded-full" style={{ transform: parallax(0.12), background: 'radial-gradient(circle at 55% 45%, rgba(185,85,47,0.30), rgba(185,85,47,0.10) 45%, rgba(185,85,47,0) 70%)' }}></div>
        {/* Spots de gradiente acompanando el footer, espejo de los de arriba */}
        <div className="absolute -bottom-48 -right-40 w-[34rem] h-[34rem] rounded-full" style={{ transform: parallax(-0.06), background: 'radial-gradient(circle at 40% 40%, rgba(231,186,103,0.35), rgba(231,186,103,0.10) 45%, rgba(231,186,103,0) 70%)' }}></div>
        <div className="absolute -bottom-24 left-[16%] w-[30rem] h-[30rem] rounded-full" style={{ transform: parallax(-0.10), background: 'radial-gradient(circle at 55% 45%, rgba(185,85,47,0.28), rgba(185,85,47,0.10) 45%, rgba(185,85,47,0) 70%)' }}></div>

        <div className="absolute top-24 -right-24" style={{ transform: parallax(0.18) }}>
          <svg className="w-80 h-80 arte-orbita" viewBox="0 0 200 200" fill="none">
            <circle cx="100" cy="100" r="96" stroke="#9E3F23" strokeOpacity="0.14" strokeWidth="1" strokeDasharray="2 10" />
            <circle cx="100" cy="100" r="64" stroke="#572C19" strokeOpacity="0.1" strokeWidth="1" strokeDasharray="14 10" />
          </svg>
        </div>

        <div className="absolute -bottom-10 -left-16" style={{ transform: parallax(-0.12) }}>
          <svg className="w-64 h-64 arte-orbita-lenta" viewBox="0 0 160 160" fill="none">
            <circle cx="80" cy="80" r="76" stroke="#8AB0BC" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="4 8" />
            <circle cx="80" cy="80" r="50" stroke="#572C19" strokeOpacity="0.12" strokeWidth="1" />
          </svg>
        </div>

        {/* EL ARRIME: simulacion del lance ligada al scroll y repartida en
            todo el recorrido hasta el footer. El mingo dorado va fijo en
            pantalla y las bolas ilustradas ruedan hacia el, una por una,
            mientras se baja: en bolas criollas gana el equipo que deja mas
            bolas cerca del mingo. */}
        <div className="absolute right-[24%] w-10 h-10" style={{ top: '45vh', transform: parallax(1) }}>
          <img src="/mingo.svg" alt="" className="w-10 h-10 arte-brillo" />
          {BOLAS_ARRIME.map((bola) => (
            <img
              key={bola.src}
              src={bola.src}
              alt=""
              className={`absolute left-1/2 top-1/2 ${bola.tamano} opacity-80`}
              style={{ transform: `translate(calc(-50% + ${avanceBola(bola, 'x').toFixed(1)}px), calc(-50% + ${avanceBola(bola, 'y').toFixed(1)}px)) rotate(${avanceBola(bola, 'giro').toFixed(1)}deg)` }}
            />
          ))}
        </div>

        <div className="absolute left-[-4rem] top-[38%] w-72 h-px" style={{ transform: `rotate(-28deg) translateY(${(desplazamiento * 0.15).toFixed(1)}px)`, background: 'linear-gradient(90deg, transparent, rgba(185,85,47,0.32), transparent)' }}></div>
        <div className="absolute right-[-3rem] top-[76%] w-80 h-px" style={{ transform: `rotate(-28deg) translateY(${(desplazamiento * -0.1).toFixed(1)}px)`, background: 'linear-gradient(90deg, transparent, rgba(138,176,188,0.35), transparent)' }}></div>

        <div className="absolute -bottom-24 right-[28%]" style={{ transform: parallax(-0.08) }}>
          <svg className="w-96 h-48" viewBox="0 0 200 100" fill="none">
            <path d="M4 96 A 96 96 0 0 1 196 96" stroke="#572C19" strokeOpacity="0.1" strokeWidth="1.5" />
          </svg>
        </div>
      </div>

      <div className="relative">

      {/* HERO: la propuesta para quienes ya conocen la cancha */}
      <section className="text-center pt-14 pb-20 max-w-3xl mx-auto">
        <img src="/logo.png" alt="CONMINGO" className="w-full max-w-64 sm:max-w-80 md:max-w-96 h-auto mx-auto mb-8" />
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand-rust mb-4">Sistema de gestion deportiva de bolas criollas</p>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-brand-brown leading-tight mb-6">
          La cancha es suya.
          <br />El papeleo, nuestro.
        </h1>
        <p className="text-lg text-brand-brown/80 leading-relaxed mb-10">
          CONMINGO lleva las planillas, las actas, el marcador publico y las estadisticas de cada encuentro.
          Usted solo se ocupa de arrimar.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <button
            type="button"
            onClick={onIniciarSesion}
            className="rounded-lg bg-brand-rust text-white px-8 py-3 font-bold shadow-md hover:bg-brand-brown transition-colors"
          >
            Entrar al sistema
          </button>
          <a
            href="#partidos"
            className="rounded-lg bg-white border border-brand-gold/40 text-brand-brown px-8 py-3 font-bold text-center hover:bg-brand-cream transition-colors"
          >
            Ver partidos
          </a>
        </div>
      </section>

      {/* PARTIDOS: solo en vivo y agendados a futuro */}
      <section id="partidos" className="mb-16 scroll-mt-8 max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-brand-brown mb-2">Partidos</h2>
          <p className="text-brand-brown/60">En vivo y agendados de los torneos en CONMINGO</p>
        </div>

        {enVivo.length === 0 && agendados.length === 0 ? (
          <div className="text-center p-12 bg-white rounded-2xl border border-brand-gold/30 shadow-sm">
            <svg className="w-14 h-14 mx-auto text-brand-gold/60 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <p className="text-lg text-brand-brown/60 font-medium">No hay partidos en vivo ni agendados por ahora.</p>
            <p className="text-sm text-brand-brown/50 mt-2">Cuando la liga agende un encuentro aparecera aqui.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {enVivo.map((p) => <TarjetaPartido key={p.id} p={p} />)}
            {agendados.map((p) => <TarjetaPartido key={p.id} p={p} />)}
          </div>
        )}
      </section>

      {/* EL ARGUMENTO PARA DIGITALIZARSE: tarjetas con iconos de linea */}
      <section className="mb-16 max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-brand-brown mb-2">La cancha, sin cuadernos</h2>
          <p className="text-brand-brown/60">Lo que hoy se resuelve a mano, en CONMINGO queda registrado al momento</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {VENTAJAS.map((tarjeta) => (
            <div key={tarjeta.titulo} className="bg-white border border-brand-gold/30 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-11 h-11 rounded-lg bg-brand-cream flex items-center justify-center mb-4 text-brand-rust">
                {tarjeta.icono}
              </div>
              <h3 className="font-bold text-brand-brown mb-2">{tarjeta.titulo}</h3>
              <p className="text-sm text-brand-brown/70 leading-relaxed">{tarjeta.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER DE MARCA */}
      <footer className="relative overflow-hidden rounded-2xl bg-brand-brown text-brand-cream max-w-7xl mx-auto">
        <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(231,186,103,0.18), transparent 70%)' }} aria-hidden="true"></div>
        <div className="absolute -left-10 -bottom-16 w-56 h-56 rounded-full border border-brand-gold/15 pointer-events-none" aria-hidden="true"></div>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-10 p-8 sm:p-12">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <BolaCriolla tamano="h-11 w-11" />
              <p className="text-2xl font-extrabold tracking-tight text-brand-cream">CONMINGO</p>
            </div>
            <p className="text-sm text-brand-cream/70 leading-relaxed">Sistema de gestion deportiva de bolas criollas: actas, marcadores, estadisticas y disciplina en un solo lugar.</p>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-brand-gold mb-4">El sistema</h3>
            <ul className="space-y-2.5 text-sm">
              <li><button type="button" onClick={onIniciarSesion} className="hover:text-brand-gold transition-colors">Entrar al sistema</button></li>
              <li><button type="button" onClick={abrirPizarra} className="hover:text-brand-gold transition-colors">Pizarra publica</button></li>
              <li><button type="button" onClick={abrirSimulador} className="hover:text-brand-gold transition-colors">Simulador de partidos</button></li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-brand-gold mb-4">De la cancha</h3>
            <ul className="space-y-2.5 text-sm text-brand-cream/70">
              <li>Acta digital del anotador</li>
              <li>Marcador publico por codigo QR</li>
              <li>Estadisticas y premiacion del torneo</li>
              <li>Sanciones, protestas y votacion al MVP</li>
            </ul>
          </div>
        </div>

        <div className="relative border-t border-brand-cream/10 px-8 sm:px-12 py-5 flex flex-col sm:flex-row justify-between gap-2 text-xs text-brand-cream/60">
          <p>CONMINGO. Todos los derechos reservados.</p>
          <p>Sistema de gestion deportiva de bolas criollas.</p>
        </div>
      </footer>

      </div>
    </div>
  );
}
