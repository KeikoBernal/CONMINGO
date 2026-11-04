import { useEffect, useRef, useState } from 'react';

// PANTALLA DE INICIO PUBLICA (CONMINGO). Vista para jugadores y
// administradores de ligas que ya conocen el deporte: la propuesta es
// digitalizar la gestion de la liga (actas, marcador, estadisticas),
// no explicar las bolas criollas. Solo se listan partidos en vivo o
// agendados a futuro; los pasados y suspendidos no aparecen.

// Bola criolla vectorial: esfera de madera tan con las costuras curvas
// de las bolas reales (recreacion en SVG del arte del sistema).
const BolaCriolla = ({ tamano = 'h-12 w-12' }) => (
  <svg viewBox="0 0 64 64" className={tamano} role="img" aria-label="Bola criolla">
    <defs>
      <radialGradient id="grad-bola-criolla" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#E3C39A" />
        <stop offset="55%" stopColor="#C89B6E" />
        <stop offset="100%" stopColor="#8F5B33" />
      </radialGradient>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#grad-bola-criolla)" stroke="#572C19" strokeWidth="2" />
    <path d="M6 40 C 16 54, 48 54, 58 40" fill="none" stroke="#572C19" strokeWidth="3" strokeLinecap="round" />
    <path d="M6 24 C 16 10, 48 10, 58 24" fill="none" stroke="#572C19" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
    <ellipse cx="22" cy="18" rx="7" ry="4" fill="#F2EBE0" opacity="0.35" transform="rotate(-25 22 18)" />
  </svg>
);

// El mingo: bola pequena y metalica, dorada para combinar con la marca.
const MingoDorado = ({ tamano = 'h-9 w-9 md:h-12 md:w-12' }) => (
  <svg viewBox="0 0 32 32" className={tamano} role="img" aria-label="Mingo dorado">
    <defs>
      <radialGradient id="grad-mingo-dorado" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#F7E2A8" />
        <stop offset="60%" stopColor="#E7BA67" />
        <stop offset="100%" stopColor="#9E7A2E" />
      </radialGradient>
    </defs>
    <circle cx="16" cy="16" r="14" fill="url(#grad-mingo-dorado)" stroke="#8A6D2F" strokeWidth="1.5" />
    <circle cx="11" cy="10" r="3" fill="#FFF7DF" opacity="0.85" />
  </svg>
);

const VENTAJAS = [
  {
    titulo: 'Acta digital del anotador',
    texto: 'La planilla se llena en el telefono del anotador, mano por mano. Al finalizar, el acta sale en PDF con las firmas de una vez.'
  },
  {
    titulo: 'Marcador publico en vivo',
    texto: 'Un codigo QR en la cancha y el publico sigue los tantos desde su telefono, sin instalar nada.'
  },
  {
    titulo: 'Estadisticas y premiacion',
    texto: 'Average, arrimadores y bochadores se calculan solos. La premiacion del torneo sale con diplomas en PDF, sin cuentas en cuadernos.'
  },
  {
    titulo: 'Reglamento y disciplina',
    texto: 'Sanciones, protestas y votacion al MVP con las reglas de la liga aplicadas por el sistema, no de memoria.'
  }
];

export default function InicioPublico({ partidos = [], onIniciarSesion }) {
  const [animarJugada, setAnimarJugada] = useState(false);
  const refJugada = useRef(null);

  // La jugada se anima cuando la seccion entra en pantalla (al scrollear).
  useEffect(() => {
    const nodo = refJugada.current;
    if (!nodo) return;
    if (typeof IntersectionObserver === 'undefined') {
      setAnimarJugada(true);
      return;
    }
    const observador = new IntersectionObserver((entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting) {
          setAnimarJugada(true);
          observador.disconnect();
        }
      });
    }, { threshold: 0.3 });
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  // Solo partidos en vivo o agendados a futuro (los pasados y
  // suspendidos quedan fuera del inicio publico).
  const ahora = new Date();
  const enVivo = partidos.filter((p) => p.estado === 'En Curso');
  const agendados = partidos
    .filter((p) => p.estado === 'Agendado' && new Date(p.fecha_hora) >= ahora)
    .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora));

  const abrirMarcador = (p) => window.open(`/?vista=puntajes&partido_id=${p.uuid_publico || p.id}`, '_blank');

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
            <svg className="w-4 h-4 text-brand-blue shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            <span>{p.sede_nombre || 'Cancha principal'}</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-brand-blue shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span>{new Date(p.fecha_hora).toLocaleString('es-VE')}</span>
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
    <div className="animate-slide-up">

      {/* HERO: la propuesta para las ligas que ya conocen la cancha */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center mb-16">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-brand-rust mb-3">Sistema de gestion de ligas de bolas criollas</p>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-brand-brown leading-tight mb-4">
            La cancha es suya.
            <br />El papeleo, nuestro.
          </h1>
          <p className="text-lg text-brand-brown/80 leading-relaxed mb-8 max-w-xl">
            CONMINGO lleva las planillas, las actas, el marcador publico y las estadisticas de su liga.
            Usted solo se ocupa de arrimar.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
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
        </div>

        <div className="relative hidden lg:flex items-center justify-center h-72" aria-hidden="true">
          <div className="flotar-suave"><BolaCriolla tamano="h-36 w-36" /></div>
          <div className="flotar-suave-lento -ml-4 -mb-14"><BolaCriolla tamano="h-20 w-20" /></div>
          <div className="flotar-suave-lento ml-10 -mt-20"><MingoDorado tamano="h-12 w-12" /></div>
        </div>
      </section>

      {/* LA JUGADA: animacion 2D del lance hacia el mingo, al entrar en pantalla */}
      <section className="mb-16">
        <div className="text-center mb-6">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-brand-brown mb-2">Primero el mingo, despues la arrimada</h2>
          <p className="text-brand-brown/60">Asi de simple es llevar las cuentas con CONMINGO: el sistema anota cada mano y usted decide el lance.</p>
        </div>

        <div
          ref={refJugada}
          className={`jugada-cancha relative h-56 md:h-64 rounded-2xl bg-white border border-brand-gold/30 shadow-sm overflow-hidden ${animarJugada ? 'jugada-animar' : ''}`}
          role="img"
          aria-label="Animacion de una jugada de bolas criollas: tres bolas ruedan hacia el mingo dorado y la mas arrimada queda marcada"
        >
          {/* calle de la cancha */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[55%] bg-brand-cream/40 border-y border-brand-gold/20"></div>

          {/* zona del mingo */}
          <div className="absolute right-[2%] top-[26%] w-20 h-20 rounded-full border-2 border-dashed border-brand-gold/50"></div>

          {/* mingo dorado */}
          <div className="mingo-jugada"><MingoDorado /></div>

          {/* bolas que se lanzan */}
          <div className="bola-jugada bola-jugada-2"><div className="bola-gira bola-gira-2"><BolaCriolla tamano="h-12 w-12 md:h-16 md:w-16" /></div></div>
          <div className="bola-jugada bola-jugada-3"><div className="bola-gira bola-gira-3"><BolaCriolla tamano="h-12 w-12 md:h-16 md:w-16" /></div></div>
          <div className="bola-jugada bola-jugada-1">
            <div className="relative">
              <div className="bola-gira bola-gira-1"><BolaCriolla tamano="h-12 w-12 md:h-20 md:w-20" /></div>
              <div className="anillo-arrimada absolute -inset-2 rounded-full border-4 border-brand-gold pointer-events-none"></div>
              <div className="etiqueta-arrimada absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-[0.65rem] font-bold uppercase tracking-wider text-brand-brown bg-brand-gold px-2.5 py-0.5 rounded-full">Arrimador</div>
            </div>
          </div>
        </div>

        <p className="text-center text-sm text-brand-brown/60 mt-4">La bola arrimada queda marcada; los tantos de cada mano, en el acta del anotador.</p>
      </section>

      {/* PARTIDOS: solo en vivo y agendados a futuro */}
      <section id="partidos" className="mb-16 scroll-mt-8">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-brand-brown mb-2">Partidos</h2>
          <p className="text-brand-brown/60">En vivo y agendados de las ligas en CONMINGO</p>
        </div>

        {enVivo.length === 0 && agendados.length === 0 ? (
          <div className="text-center p-12 bg-white rounded-2xl border border-brand-gold/30 shadow-sm">
            <svg className="w-14 h-14 mx-auto text-brand-gold/60 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
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

      {/* POR QUE CONMINGO: el argumento para digitalizar la liga */}
      <section className="mb-16">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-brand-brown mb-2">Su liga, sin cuadernos</h2>
          <p className="text-brand-brown/60">Lo que hoy se resuelve a mano, en CONMINGO queda registrado al momento</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {VENTAJAS.map((tarjeta) => (
            <div key={tarjeta.titulo} className="bg-white border border-brand-gold/30 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-lg bg-brand-cream flex items-center justify-center mb-4">
                <BolaCriolla tamano="h-6 w-6" />
              </div>
              <h3 className="font-bold text-brand-brown mb-2">{tarjeta.titulo}</h3>
              <p className="text-sm text-brand-brown/70 leading-relaxed">{tarjeta.texto}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-brand-gold/30 pt-8 pb-4 text-center">
        <p className="font-bold text-brand-brown tracking-tight">CONMINGO</p>
        <p className="text-sm text-brand-brown/60 mt-1">Sistema de gestion de ligas de bolas criollas.</p>
      </footer>
    </div>
  );
}
