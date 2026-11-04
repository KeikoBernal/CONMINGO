import { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../supabaseClient';

import EmptyState from './EmptyState';
import NavIcon from './NavIcon';
import { SkeletonTabla, SkeletonTarjetas } from './SkeletonCarga';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// PREMIACION DEL TORNEO: vista destacada de los campeones que salen de las
// actas que llena el anotador (arrimador, bochador, rastrero y Jugador Mas
// Util) y del MVP elegido por votacion de la liga. Componente compartido por
// el AdminLiga (Resultados > Premiacion) y los delegados (Premiacion de la
// Liga). Genera el acta de premiacion del torneo y el diploma individual de
// cada campeon en PDF, con la paleta de marca.

// Paleta de marca en RGB para los PDF (mismos valores del tema de index.css).
const MARCA = {
  rust: [158, 63, 35],
  brown: [87, 44, 25],
  blue: [138, 176, 188],
  cream: [242, 235, 224],
  gold: [231, 186, 103]
};

const ESPECIALIDADES = [
  { clave: 'arrimador', titulo: 'Campeón Arrimador', subtitulo: 'Mejor average de arrime', detalle: (c) => 'Average ' + c.average_arrime + ' con ' + c.lances_arrime + ' lances y ' + c.buenos_arrime + ' buenos' },
  { clave: 'bochador', titulo: 'Campeón Bochador', subtitulo: 'Mejor average de boche de aire', detalle: (c) => 'Average ' + c.average_boche + ' con ' + c.lances_boche + ' lances y ' + c.buenos_boche + ' buenos' },
  { clave: 'rastrero', titulo: 'Campeón Rastrero', subtitulo: 'Mejor average de boche rastrero', detalle: (c) => 'Average ' + c.average_rastrero + ' con ' + c.lances_rastrero + ' lances y ' + c.buenos_rastrero + ' buenos' },
  { clave: 'mas_util', titulo: 'Jugador Más Útil', subtitulo: 'Mejor average global del acta', detalle: (c) => 'Average global ' + c.average_global + ' con ' + c.lances + ' lances y ' + c.buenos + ' buenos' }
];

const nombreJugador = (c) => String(c.nombre || '') + (c.apellido ? ' ' + c.apellido : '');

// Nombre seguro para el archivo descargado: sin acentos ni caracteres raros.
const limpiarNombre = (t) => {
  let salida = '';
  for (const ch of String(t).normalize('NFD')) {
    const cp = ch.codePointAt(0);
    if (cp < 0x0300 || cp > 0x036F) salida += ch;
  }
  return salida.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'documento';
};

const formatearFecha = (f) => {
  if (!f) return '';
  const partes = String(f).split('T')[0].split('-');
  return partes.length === 3 ? partes[2] + '/' + partes[1] + '/' + partes[0] : String(f);
};

const rangoFechas = (torneo) => {
  const fechas = [formatearFecha(torneo.fecha_inicio), formatearFecha(torneo.fecha_fin)].filter(Boolean);
  return fechas.length === 2 ? fechas[0] + ' al ' + fechas[1] : fechas[0] || '';
};

// Diploma individual de un campeon: hoja horizontal con doble marco de marca.
const generarDiploma = (datos, clave, campeon) => {
  const esMvp = clave === 'mvp';
  const esp = esMvp
    ? { titulo: 'Jugador Más Valioso del Torneo', subtitulo: 'MVP por votación de la liga' }
    : ESPECIALIDADES.find(e => e.clave === clave);
  const nombre = esMvp ? String(campeon.jugador_nombre || '') : nombreJugador(campeon);
  const detalle = esMvp
    ? 'Votación de la liga: ' + campeon.votos + ' voto' + (campeon.votos === 1 ? '' : 's') + ' de ' + campeon.total_votos + ' emitido' + (campeon.total_votos === 1 ? '' : 's')
    : esp.detalle(campeon);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdf.setFillColor(MARCA.cream[0], MARCA.cream[1], MARCA.cream[2]);
  pdf.rect(0, 0, 297, 210, 'F');
  pdf.setDrawColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.setLineWidth(1.5);
  pdf.rect(10, 10, 277, 190);
  pdf.setDrawColor(MARCA.gold[0], MARCA.gold[1], MARCA.gold[2]);
  pdf.setLineWidth(0.5);
  pdf.rect(14, 14, 269, 182);
  pdf.setTextColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text('CONMINGO', 148.5, 27, { align: 'center' });
  pdf.setFontSize(8);
  pdf.setTextColor(MARCA.rust[0], MARCA.rust[1], MARCA.rust[2]);
  pdf.text('SISTEMA DE GESTION DE LIGAS DE BOLAS CRIOLLAS', 148.5, 32, { align: 'center' });
  pdf.setTextColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.setFontSize(23);
  pdf.text('DIPLOMA DE RECONOCIMIENTO', 148.5, 49, { align: 'center' });
  pdf.setFontSize(12);
  pdf.setTextColor(MARCA.rust[0], MARCA.rust[1], MARCA.rust[2]);
  pdf.text(esp.titulo.toUpperCase(), 148.5, 61, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.text('La liga otorga con honor este reconocimiento a', 148.5, 77, { align: 'center' });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(26);
  pdf.text(nombre, 148.5, 93, { align: 'center' });
  pdf.setFontSize(12);
  pdf.text(campeon.equipo_nombre ? 'Equipo: ' + campeon.equipo_nombre : '', 148.5, 102, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(detalle, 148.5, 111, { align: 'center' });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('Torneo: ' + datos.torneo.nombre, 148.5, 127, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const fechas = rangoFechas(datos.torneo);
  pdf.text(fechas ? 'Celebrado del ' + fechas : '', 148.5, 133, { align: 'center' });
  pdf.text('Emitido el ' + new Date().toLocaleDateString('es-VE'), 148.5, 139, { align: 'center' });
  pdf.setDrawColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.setLineWidth(0.4);
  pdf.line(90, 168, 207, 168);
  pdf.setFontSize(9);
  pdf.text('Administrador de la Liga', 148.5, 174, { align: 'center' });
  pdf.save('Diploma_' + limpiarNombre(esp.titulo) + '_' + limpiarNombre(nombre) + '.pdf');
};

// Acta de premiacion del torneo: los 4 campeones del acta, el MVP y el
// ranking por average global, con linea de firma del AdminLiga.
const generarActaPremiacion = (datos) => {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  pdf.setFillColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.rect(0, 0, 210, 24, 'F');
  pdf.setTextColor(MARCA.cream[0], MARCA.cream[1], MARCA.cream[2]);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('CONMINGO', 105, 11, { align: 'center' });
  pdf.setFontSize(9);
  pdf.setTextColor(MARCA.gold[0], MARCA.gold[1], MARCA.gold[2]);
  pdf.text('ACTA DE PREMIACIÓN DEL TORNEO', 105, 17.5, { align: 'center' });
  pdf.setTextColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.setFontSize(13);
  pdf.text(String(datos.torneo.nombre), 14, 34);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  const fechas = rangoFechas(datos.torneo);
  pdf.text(fechas ? 'Celebrado del ' + fechas : '', 14, 39.5);
  pdf.text('Emitida el ' + new Date().toLocaleDateString('es-VE'), 196, 39.5, { align: 'right' });

  const filasCampeones = ESPECIALIDADES.map(e => {
    const c = datos.campeones[e.clave];
    return c
      ? [e.titulo, nombreJugador(c), c.equipo_nombre || '-', e.detalle(c)]
      : [e.titulo, 'Sin campeón todavía', '-', 'Se exigen mínimo ' + datos.lances_minimos + ' lances válidos'];
  });
  let estadoMvp = 'Votación abierta';
  if (datos.torneo.votacion_mvp !== 'Abierta') estadoMvp = datos.mvp ? datos.mvp.votos + ' de ' + datos.mvp.total_votos + ' votos' : 'Sin votos registrados';
  filasCampeones.push([
    'Jugador Más Valioso (votación)',
    datos.mvp ? String(datos.mvp.jugador_nombre) : 'Por definir',
    datos.mvp ? String(datos.mvp.equipo_nombre) : '-',
    estadoMvp
  ]);

  autoTable(pdf, {
    startY: 46,
    head: [['Reconocimiento', 'Jugador', 'Equipo', 'Estadística']],
    body: filasCampeones,
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: MARCA.brown, textColor: MARCA.cream },
    columnStyles: { 3: { cellWidth: 52 } }
  });

  let y = (pdf.lastAutoTable ? pdf.lastAutoTable.finalY : 60) + 14;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.text('Ranking del torneo por average global', 14, y);
  autoTable(pdf, {
    startY: y + 4,
    head: [['#', 'Jugador', 'Equipo', 'Lances', 'Buenos', 'Average']],
    body: datos.ranking.map((f, i) => [
      String(i + 1), nombreJugador(f), f.equipo_nombre || '-', String(f.lances), String(f.buenos), f.average_global === null ? '-' : String(f.average_global)
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: MARCA.rust, textColor: [255, 255, 255] }
  });

  const yNota = (pdf.lastAutoTable ? pdf.lastAutoTable.finalY : 200) + 10;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(110, 110, 110);
  pdf.text('Para optar a un campeonato de especialidad se exigen mínimo ' + datos.lances_minimos + ' lances válidos en la especialidad, sobre actas de partidos finalizados.', 14, yNota);
  pdf.setDrawColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.setLineWidth(0.4);
  pdf.line(60, 272, 150, 272);
  pdf.setFontSize(9);
  pdf.setTextColor(MARCA.brown[0], MARCA.brown[1], MARCA.brown[2]);
  pdf.text('Administrador de la Liga', 105, 277.5, { align: 'center' });
  pdf.save('Acta_Premiacion_' + limpiarNombre(datos.torneo.nombre) + '.pdf');
};

export default function Premiacion() {
  const [torneos, setTorneos] = useState([]);
  const [cargandoTorneos, setCargandoTorneos] = useState(true);
  const [torneoId, setTorneoId] = useState('');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const fetchOperativo = async (endpoint) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(API_URL + '/operativo' + endpoint, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session ? session.access_token : '') }
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  };

  useEffect(() => {
    (async () => {
      const { ok, data } = await fetchOperativo('/torneos-premiacion');
      if (ok && Array.isArray(data)) setTorneos(data);
      setCargandoTorneos(false);
    })();
  }, []);

  const cargarPremiacion = async (id) => {
    setMensaje('');
    setDatos(null);
    if (!id) return;
    setCargando(true);
    const { ok, data } = await fetchOperativo('/torneos/' + encodeURIComponent(id) + '/premiacion');
    setCargando(false);
    if (ok) setDatos(data);
    else setMensaje(data.error || 'No se pudo calcular la premiación del torneo.');
  };

  const campeonDesde = (clave) => (datos && datos.campeones ? datos.campeones[clave] : null);

  return (
    <div className="bg-white p-6 rounded-xl border border-brand-gold/20 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <label className="text-sm font-bold text-brand-brown whitespace-nowrap">Torneo:</label>
        <select
          value={torneoId}
          onChange={(e) => { setTorneoId(e.target.value); cargarPremiacion(e.target.value); }}
          className="flex-1 p-2 border border-brand-gold/30 rounded-lg text-brand-brown"
        >
          <option value="">-- Selecciona el torneo --</option>
          {torneos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </div>

      {cargandoTorneos && <SkeletonTabla filas={4} columnas={4} compacto />}

      {!cargandoTorneos && torneos.length === 0 && (
        <EmptyState icono="trofeo" titulo="Sin torneos para premiar" descripcion="Cuando la liga registre torneos aparecerán aquí para consultar su premiación." />
      )}

      {cargando && <SkeletonTarjetas cantidad={3} clasesGrid="grid-cols-1 md:grid-cols-3" />}
      {mensaje && <p className="text-sm font-semibold text-brand-rust">{mensaje}</p>}

      {datos && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h3 className="text-xl font-bold text-brand-brown flex items-center gap-2">
              <NavIcon nombre="trofeo" />
              Premiación del torneo
            </h3>
            <button
              onClick={() => generarActaPremiacion(datos)}
              className="w-full sm:w-auto px-5 py-2.5 rounded-lg font-bold text-sm bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white transition-colors"
            >
              Descargar acta de premiación
            </button>
          </div>
          <p className="text-xs text-brand-brown/60">
            Los campeones salen de las actas finalizadas del anotador (average = buenos x 1000 / lances, mínimo {datos.lances_minimos} lances por especialidad). El MVP lo elige la votación de la liga.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ESPECIALIDADES.map((e) => {
              const c = campeonDesde(e.clave);
              return (
                <div key={e.clave} className="bg-white rounded-xl border border-brand-gold/40 shadow-sm p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-lg bg-brand-brown text-brand-gold flex items-center justify-center shrink-0"><NavIcon nombre="trofeo" /></span>
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider text-brand-rust">{e.titulo}</p>
                      <p className="text-[0.65rem] text-brand-brown/60 font-semibold">{e.subtitulo}</p>
                    </div>
                  </div>
                  {c ? (
                    <>
                      <p className="text-2xl font-black text-brand-brown leading-tight">{nombreJugador(c)}</p>
                      <p className="text-sm font-semibold text-brand-brown/70">{c.equipo_nombre}</p>
                      <p className="text-xs text-brand-brown/60">{e.detalle(c)}</p>
                      <button
                        onClick={() => generarDiploma(datos, e.clave, c)}
                        className="mt-auto self-start px-4 py-2 rounded-lg font-bold text-sm bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white transition-colors"
                      >
                        Descargar diploma
                      </button>
                    </>
                  ) : (
                    <div className="mt-1 rounded-lg bg-brand-cream/60 border border-brand-gold/20 p-3">
                      <p className="text-sm font-bold text-brand-brown/50">Sin campeón todavía</p>
                      <p className="text-xs text-brand-brown/50 mt-1">Se exigen mínimo {datos.lances_minimos} lances válidos de la especialidad en actas de partidos finalizados.</p>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="bg-white rounded-xl border border-brand-gold/40 shadow-sm p-5 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-lg bg-brand-rust text-white flex items-center justify-center shrink-0"><NavIcon nombre="votacion" /></span>
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-brand-rust">Jugador Más Valioso</p>
                  <p className="text-[0.65rem] text-brand-brown/60 font-semibold">MVP por votación de la liga</p>
                </div>
              </div>
              {datos.mvp ? (
                <>
                  <p className="text-2xl font-black text-brand-brown leading-tight">{datos.mvp.jugador_nombre}</p>
                  <p className="text-sm font-semibold text-brand-brown/70">{datos.mvp.equipo_nombre}</p>
                  <p className="text-xs text-brand-brown/60">{datos.mvp.votos} voto{datos.mvp.votos === 1 ? '' : 's'} de {datos.mvp.total_votos} emitido{datos.mvp.total_votos === 1 ? '' : 's'}</p>
                  <button
                    onClick={() => generarDiploma(datos, 'mvp', datos.mvp)}
                    className="mt-auto self-start px-4 py-2 rounded-lg font-bold text-sm bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white transition-colors"
                  >
                    Descargar diploma
                  </button>
                </>
              ) : (
                <div className="mt-1 rounded-lg bg-brand-cream/60 border border-brand-gold/20 p-3">
                  <p className="text-sm font-bold text-brand-brown/50">{datos.torneo.votacion_mvp === 'Abierta' ? 'Votación abierta' : 'Sin MVP todavía'}</p>
                  <p className="text-xs text-brand-brown/50 mt-1">
                    {datos.torneo.votacion_mvp === 'Abierta'
                      ? 'El ganador se conocerá cuando el Administrador de la Liga cierre la votación.'
                      : 'La votación de este torneo está cerrada y no recibió votos.'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {datos.ranking.length > 0 && (
            <div className="bg-white rounded-xl border border-brand-gold/20 shadow-sm p-4 sm:p-6">
              <h3 className="text-lg font-black text-brand-brown uppercase tracking-wider mb-4">Ranking del torneo por average global</h3>
              <div className="overflow-x-auto">
                <table className="tabla-admin">
                  <thead>
                    <tr>
                      <th scope="col" className="px-4 py-2">#</th>
                      <th scope="col" className="px-4 py-2">Jugador</th>
                      <th scope="col" className="px-4 py-2">Equipo</th>
                      <th scope="col" className="px-4 py-2 text-right">Lances</th>
                      <th scope="col" className="px-4 py-2 text-right">Buenos</th>
                      <th scope="col" className="px-4 py-2 text-right">Average</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.ranking.map((f, i) => (
                      <tr key={f.jugador_id} className={i === 0 ? 'bg-brand-gold/10 font-bold' : ''}>
                        <td className="px-4 py-2">{i + 1}</td>
                        <td className="px-4 py-2">{nombreJugador(f)}</td>
                        <td className="px-4 py-2">{f.equipo_nombre}</td>
                        <td className="px-4 py-2 text-right">{f.lances}</td>
                        <td className="px-4 py-2 text-right">{f.buenos}</td>
                        <td className="px-4 py-2 text-right">{f.average_global === null ? '-' : f.average_global}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
