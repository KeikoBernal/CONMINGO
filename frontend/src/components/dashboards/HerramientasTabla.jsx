import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import CampoTexto from '../CampoTexto';
import { formatearFechaHora } from '../fechas'; // LOTE FECHAS: sello y columnas de fecha de los reportes en dd/mm/aaaa
import { encabezadoMarca, MARCA_PDF } from '../pdfMarca'; // LOTE PDF MARCA: encabezado de marca (logo y nombre de la liga) en los PDF

// Componente compartido de filtrado, busqueda y descargas para las tablas del
// sistema (Administrador de liga, Delegado, Arbitro y Anotador). El modulo se
// pasa por prop para el encabezado de los reportes generados.
export const EMPTY_FILTER = { search: '', categories: [], dateFrom: '', dateTo: '', datePreset: 'all' };

const normalizeValue = value => String(value ?? '').toLocaleLowerCase('es');
export const rowMatchesFilter = (row, filter, categoryFields = [], dateFields = []) => {
  const searchable = Object.values(row).map(normalizeValue).join(' ');
  const matchesSearch = !filter.search || searchable.includes(normalizeValue(filter.search));
  const categoryValue = categoryFields.flatMap(field => {
    const value = row[field];
    return Array.isArray(value) ? value : [value];
  }).filter(Boolean).map(normalizeValue);
  const matchesCategory = !filter.categories?.length || filter.categories.some(category => categoryValue.includes(normalizeValue(category)));
  const dates = dateFields.map(field => row[field]).filter(Boolean).map(value => new Date(value).getTime()).filter(Number.isFinite);
  const from = filter.dateFrom ? new Date(`${filter.dateFrom}T00:00:00`).getTime() : -Infinity;
  const to = filter.dateTo ? new Date(`${filter.dateTo}T23:59:59`).getTime() : Infinity;
  const matchesDate = !dateFields.length || !filter.dateFrom && !filter.dateTo || dates.some(date => date >= from && date <= to);
  return matchesSearch && matchesCategory && matchesDate;
};

export function TableTools({ rows, filteredRows, filter, setFilter, columns, categoryFields = [], dateFields = [], filename, modulo = 'Administrador de liga', reportContext = {}, logoUrl, nombreLiga = '' }) {
  const categoryOptions = [...new Set(rows.flatMap(row => categoryFields.flatMap(field => {
    const value = row[field];
    return Array.isArray(value) ? value : [value];
  }).filter(Boolean)))].sort();
  const update = patch => setFilter({ ...filter, ...patch });
  const context = {
    modulo,
    usuario: reportContext.usuario || 'Administrador de liga',
    generado: formatearFechaHora(new Date()),
    filtros: { busqueda: filter.search || 'Todas', categorias: filter.categories?.length ? filter.categories.join(', ') : 'Todas', desde: filter.dateFrom || 'Sin límite', hasta: filter.dateTo || 'Sin límite' },
  };
  const exportRows = (format) => {
    const safeName = filename.replace(/[^a-z0-9áéíóúñ_-]+/gi, '_');
    const data = filteredRows.map(row => Object.fromEntries(columns.map(({ key, label }) => [label, dateFields.includes(key) ? (row[key] ? formatearFechaHora(row[key]) : '') : row[key] ?? ''])));
    const csvCell = value => `"${String(value).replaceAll('"', '""')}"`;
    if (format === 'json') {
      descargarBlob(new Blob([JSON.stringify({ contexto: context, registros: data }, null, 2)], { type: 'application/json' }), `${safeName}.json`);
    } else if (format === 'csv') {
      const info = [`# Reporte: ${context.modulo}`, `# Usuario: ${context.usuario}`, `# Generado: ${context.generado}`, `# Filtros: ${JSON.stringify(context.filtros)}`];
      descargarBlob(new Blob([[...info, columns.map(column => csvCell(column.label)).join(','), ...data.map(row => columns.map(column => csvCell(row[column.label])).join(','))].join('\n')], { type: 'text/csv;charset=utf-8;' }), `${safeName}.csv`);
    } else if (format === 'excel') {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data), 'Datos filtrados');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Campo: 'Módulo', Valor: context.modulo }, { Campo: 'Usuario', Valor: context.usuario }, { Campo: 'Generado', Valor: context.generado }, ...Object.entries(context.filtros).map(([Campo, Valor]) => ({ Campo, Valor }))]), 'Contexto del reporte');
      XLSX.writeFile(workbook, `${safeName}.xlsx`);
    } else {
      const pdf = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
      // LOTE PDF MARCA: banda de marca con logo y nombre de la liga (si el panel los pasa).
      encabezadoMarca(pdf, { nombreLiga, logoUrl, titulo: 'REPORTE OFICIAL', subtitulo: context.modulo });
      pdf.setTextColor(70, 45, 30); pdf.setFontSize(8); pdf.text(`Usuario: ${context.usuario}   |   Generado: ${context.generado}`, 14, 30); pdf.text(`Filtros: ${Object.values(context.filtros).join(' · ')}`, 14, 35);
      autoTable(pdf, { startY: 42, head: [columns.map(column => column.label)], body: data.map(row => columns.map(column => row[column.label])), styles: { fontSize: 8 }, headStyles: { fillColor: MARCA_PDF.brown, textColor: MARCA_PDF.cream }, didDrawPage: () => { pdf.setFontSize(8); pdf.setTextColor(100); pdf.text(`Documento generado desde el módulo ${modulo} · CONMINGO`, 14, pdf.internal.pageSize.getHeight() - 10); } });
      pdf.save(`${safeName}.pdf`);
    }
  };
  const setDatePreset = preset => { if (preset === 'custom') { update({ datePreset: 'custom', dateFrom: '', dateTo: '' }); return; } const today = new Date(); const from = new Date(today); if (preset === 'week') from.setDate(today.getDate() - 7); if (preset === 'month') from.setMonth(today.getMonth() - 1); update({ datePreset: preset, dateFrom: preset === 'all' ? '' : from.toISOString().slice(0, 10), dateTo: preset === 'all' ? '' : today.toISOString().slice(0, 10) }); };
  return <div className="mb-4 rounded-xl border border-brand-gold/30 bg-white p-4 shadow-sm">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <CampoTexto etiqueta="Buscar en todas las columnas" className="flex-1" valor={filter.search} onChange={event => update({ search: event.target.value })} />
      {categoryOptions.length > 0 && <label className="min-w-0 text-xs font-bold uppercase tracking-wide text-brand-brown/70 lg:w-56">Categoría<select value={filter.categories[0] || ''} onChange={event => update({ categories: event.target.value ? [event.target.value] : [] })} className="mt-1 w-full min-h-11 rounded-lg border border-brand-gold/40 bg-white px-3 py-2 text-sm font-semibold text-brand-brown focus:border-brand-rust focus:outline-none"><option value="">Todas</option>{categoryOptions.map(option => <option key={option} value={option}>{option}</option>)}</select></label>}
      {dateFields.length > 0 && <label className="min-w-0 text-xs font-bold uppercase tracking-wide text-brand-brown/70 lg:w-48">Fecha<select value={filter.datePreset} onChange={event => setDatePreset(event.target.value)} className="mt-1 w-full min-h-11 rounded-lg border border-brand-gold/40 bg-white px-3 py-2 text-sm font-semibold text-brand-brown focus:border-brand-rust focus:outline-none"><option value="all">Todo</option><option value="week">Últimos 7 días</option><option value="month">Últimos 30 días</option><option value="custom">Rango personalizado</option></select></label>}{dateFields.length > 0 && filter.datePreset === 'custom' && <div className="flex flex-1 gap-2"><CampoTexto etiqueta="Desde" tipo="date" className="flex-1" valor={filter.dateFrom} onChange={event => update({ dateFrom: event.target.value, datePreset: 'custom' })} /><CampoTexto etiqueta="Hasta" tipo="date" className="flex-1" valor={filter.dateTo} onChange={event => update({ dateTo: event.target.value, datePreset: 'custom' })} /></div>}
      <button type="button" onClick={() => setFilter(EMPTY_FILTER)} className="w-full rounded-lg border border-brand-gold/40 bg-white px-3 py-2 text-sm font-bold text-brand-brown transition-colors hover:bg-brand-rust hover:text-white sm:w-auto">Limpiar filtros</button>
    </div>
    <div className="mt-3 flex flex-col gap-2 border-t border-brand-gold/20 pt-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs font-bold uppercase tracking-wide text-brand-brown/70">{filteredRows.length} de {rows.length} registros</span><select value="" onChange={event => { const formato = event.target.value; if (formato) exportRows(formato); }} className="w-full min-h-11 rounded-lg border border-brand-gold/40 bg-white px-4 py-2 text-sm font-bold text-brand-brown focus:border-brand-rust focus:outline-none sm:w-52"><option value="">Descargar reporte</option><option value="pdf">Descargar PDF</option><option value="excel">Descargar Excel</option><option value="csv">Descargar CSV</option><option value="json">Descargar JSON</option></select></div>
  </div>;
}

// FASE 2 UX (consolidacion de tablas): encabezado, paginacion y acciones de
// tabla compartidos por todos los paneles. Mismas convenciones de marca:
// rounded-lg, hovers solo brand-*, iconos SVG, sin emojis.
export function EncabezadoTabla({ titulo, total, icono, acciones }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 className="flex items-center gap-2 text-lg font-bold text-brand-brown">
        {icono}
        {titulo}
        {typeof total === 'number' && (
          <span className="bg-brand-cream text-brand-brown px-2 py-0.5 rounded-full text-xs font-bold border border-brand-gold/30">{total}</span>
        )}
      </h3>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </div>
  );
}

// Paginacion del lado del cliente: recorta las filas ya filtradas y mantiene
// la pagina segura cuando los filtros reducen el listado.
export function usePaginacion(filas, porPagina = 12) {
  const [pagina, setPagina] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(filas.length / porPagina));
  useEffect(() => { if (pagina > totalPaginas) setPagina(totalPaginas); }, [pagina, totalPaginas]);
  const paginaSegura = Math.min(pagina, totalPaginas);
  const inicio = (paginaSegura - 1) * porPagina;
  return {
    pagina: paginaSegura,
    setPagina,
    filasPagina: filas.slice(inicio, inicio + porPagina),
    totalPaginas,
    total: filas.length,
    desde: filas.length === 0 ? 0 : inicio + 1,
    hasta: Math.min(inicio + porPagina, filas.length),
  };
}

export function PaginacionTabla({ pagina, setPagina, totalPaginas, desde, hasta, total }) {
  if (totalPaginas <= 1) return null;
  const boton = 'px-3 py-2 rounded-lg border border-brand-gold/40 bg-white text-sm font-bold text-brand-brown transition-colors hover:bg-brand-rust hover:text-white disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed';
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-brand-gold/20 pt-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs font-bold uppercase tracking-wide text-brand-brown/70">Mostrando {desde} a {hasta} de {total} registros</span>
      <div className="flex items-center gap-2">
        <button type="button" className={boton} onClick={() => setPagina(Math.max(1, pagina - 1))} disabled={pagina <= 1}>Anterior</button>
        <span className="text-xs font-bold text-brand-brown/70">Página {pagina} de {totalPaginas}</span>
        <button type="button" className={boton} onClick={() => setPagina(Math.min(totalPaginas, pagina + 1))} disabled={pagina >= totalPaginas}>Siguiente</button>
      </div>
    </div>
  );
}

// Boton de accion de tabla: siempre visible (nada de aparecer solo al pasar el
// mouse, que rompe en pantallas tactiles) y con los tonos permitidos de marca.
export function BotonAccionTabla({ titulo, onClick, tono = 'editar', deshabilitado = false, children }) {
  const tonos = {
    editar: 'bg-brand-blue/10 text-brand-blue hover:bg-brand-blue hover:text-white',
    peligro: 'bg-red-100 text-red-600 hover:bg-red-600 hover:text-white',
    neutro: 'bg-brand-cream text-brand-brown hover:bg-brand-rust hover:text-white border border-brand-gold/30',
  };
  return (
    <button type="button" onClick={onClick} disabled={deshabilitado} title={titulo} aria-label={titulo}
      className={`p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tonos[tono] || tonos.editar}`}>
      {children}
    </button>
  );
}

const descargarBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

