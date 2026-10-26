// N2: graficas de las estadisticas globales de la liga.
// Componente de solo lectura y SIN dependencias externas: se dibuja con divs,
// gradientes conicos y la paleta de marca. Recibe los agregados del endpoint
// /admin-liga/estadisticas/graficos y no hace peticiones por si mismo.
const COLORES_TARJETA = {
  Amarilla: '#D9A03F',
  Azul: '#4A6B76',
  Roja: '#B3392B'
};

const COLOR_BASE = '#572C19';

const nombreMes = (mes) => {
  const partes = String(mes || '').split('-');
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const indice = parseInt(partes[1], 10);
  return (meses[indice - 1] || '') + ' ' + String(partes[0] || '').slice(2);
};

export default function GraficasEstadisticas({ datos }) {
  if (!datos) return null;

  const porMes = Array.isArray(datos.partidos_por_mes) ? datos.partidos_por_mes : [];
  const tarjetas = Array.isArray(datos.tarjetas_por_color) ? datos.tarjetas_por_color : [];
  const victorias = Array.isArray(datos.victorias_por_equipo) ? datos.victorias_por_equipo : [];

  const maxPartidos = Math.max(1, ...porMes.map(f => Number(f.partidos) || 0));
  const maxVictorias = Math.max(1, ...victorias.map(v => Number(v.victorias) || 0));
  const totalTarjetas = tarjetas.reduce((acc, t) => acc + (Number(t.total) || 0), 0);

  let acumulado = 0;
  const segmentos = tarjetas.map(t => {
    const total = Number(t.total) || 0;
    const inicio = totalTarjetas > 0 ? (acumulado / totalTarjetas) * 100 : 0;
    acumulado += total;
    const fin = totalTarjetas > 0 ? (acumulado / totalTarjetas) * 100 : 0;
    return {
      color: t.color || 'Otra',
      total,
      inicio,
      fin,
      relleno: COLORES_TARJETA[t.color] || COLOR_BASE
    };
  });

  const gradiente = segmentos.length > 0
    ? 'conic-gradient(' + segmentos.map(s => s.relleno + ' ' + s.inicio.toFixed(2) + '% ' + s.fin.toFixed(2) + '%').join(', ') + ')'
    : 'conic-gradient(#E7BA67 0% 100%)';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

      {/* Partidos finalizados por mes */}
      <div className="bg-white p-6 rounded-xl border border-brand-gold/20 shadow-sm">
        <h3 className="text-sm font-bold text-brand-brown/70 uppercase tracking-wider mb-4">Partidos finalizados por mes</h3>
        {porMes.length === 0 ? (
          <p className="text-sm text-brand-brown/50 py-8 text-center">Sin partidos finalizados registrados.</p>
        ) : (
          <div className="flex items-end justify-between gap-2 h-40">
            {porMes.map(f => (
              <div key={f.mes} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={(Number(f.partidos) || 0) + ' partidos en ' + nombreMes(f.mes)}>
                <span className="text-[0.65rem] font-bold text-brand-brown/70">{f.partidos}</span>
                <div className="w-full max-w-10 rounded-t-md bg-brand-rust hover:bg-brand-brown transition-colors" style={{ height: Math.max(4, ((Number(f.partidos) || 0) / maxPartidos) * 100) + '%' }}></div>
                <span className="text-[0.6rem] font-semibold text-brand-brown/60 uppercase">{nombreMes(f.mes)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tarjetas por color */}
      <div className="bg-white p-6 rounded-xl border border-brand-gold/20 shadow-sm">
        <h3 className="text-sm font-bold text-brand-brown/70 uppercase tracking-wider mb-4">Tarjetas por color</h3>
        {totalTarjetas === 0 ? (
          <p className="text-sm text-brand-brown/50 py-8 text-center">Sin tarjetas registradas.</p>
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative w-28 h-28 rounded-full shrink-0" style={{ background: gradiente }} title={totalTarjetas + ' tarjetas en total'}>
              <div className="absolute inset-3 rounded-full bg-white flex items-center justify-center">
                <span className="text-lg font-black text-brand-brown">{totalTarjetas}</span>
              </div>
            </div>
            <div className="space-y-2">
              {segmentos.map(s => (
                <div key={s.color} className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ background: s.relleno }}></span>
                  <span className="text-brand-brown/80 font-semibold">{s.color}:</span>
                  <span className="font-bold text-brand-brown">{s.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Victorias por equipo */}
      <div className="bg-white p-6 rounded-xl border border-brand-gold/20 shadow-sm">
        <h3 className="text-sm font-bold text-brand-brown/70 uppercase tracking-wider mb-4">Victorias por equipo (Top 8)</h3>
        {victorias.length === 0 ? (
          <p className="text-sm text-brand-brown/50 py-8 text-center">Sin resultados registrados.</p>
        ) : (
          <div className="space-y-3">
            {victorias.map(v => (
              <div key={v.equipo} title={(Number(v.victorias) || 0) + ' victorias de ' + v.equipo}>
                <div className="flex justify-between text-xs font-bold text-brand-brown/80 mb-1">
                  <span className="truncate pr-2">{v.equipo}</span>
                  <span>{v.victorias}</span>
                </div>
                <div className="w-full h-3 bg-brand-cream rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-brand-blue transition-all" style={{ width: ((Number(v.victorias) || 0) / maxVictorias) * 100 + '%' }}></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
