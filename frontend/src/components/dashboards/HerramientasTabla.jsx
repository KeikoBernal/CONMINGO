import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

export function TableTools({ rows, filteredRows, filter, setFilter, columns, categoryFields = [], dateFields = [], filename, modulo = 'Administrador de liga', reportContext = {}, logoUrl }) {
  const categoryOptions = [...new Set(rows.flatMap(row => categoryFields.flatMap(field => {
    const value = row[field];
    return Array.isArray(value) ? value : [value];
  }).filter(Boolean)))].sort();
  const update = patch => setFilter({ ...filter, ...patch });
  const context = {
    modulo,
    usuario: reportContext.usuario || 'Administrador de liga',
    generado: new Date().toLocaleString('es-VE'),
    filtros: { busqueda: filter.search || 'Todas', categorias: filter.categories?.length ? filter.categories.join(', ') : 'Todas', desde: filter.dateFrom || 'Sin límite', hasta: filter.dateTo || 'Sin límite' },
  };
  const exportRows = (format) => {
    const safeName = filename.replace(/[^a-z0-9áéíóúñ_-]+/gi, '_');
    const data = filteredRows.map(row => Object.fromEntries(columns.map(({ key, label }) => [label, row[key] ?? ''])));
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
      const pageWidth = pdf.internal.pageSize.getWidth();
      pdf.setFillColor(34, 78, 105); pdf.rect(0, 0, pageWidth, 22, 'F');
      // LOTE L: logo de la organización en el encabezado del PDF (fallback si no hay o es WEBP).
      let margenTexto = 14;
      if (logoUrl && !logoUrl.startsWith('data:image/webp')) {
        try {
          pdf.setFillColor(255, 255, 255); pdf.rect(6, 2.5, 18, 17, 'F');
          pdf.addImage(logoUrl, logoUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', 7, 3.5, 16, 15);
          margenTexto = 28;
        } catch (e) { margenTexto = 14; }
      }
      pdf.setTextColor(255, 255, 255); pdf.setFontSize(14); pdf.text('CONMINGO · REPORTE OFICIAL', margenTexto, 10); pdf.setFontSize(9); pdf.text(context.modulo, margenTexto, 17);
      pdf.setTextColor(70, 45, 30); pdf.setFontSize(8); pdf.text(`Usuario: ${context.usuario}   |   Generado: ${context.generado}`, 14, 30); pdf.text(`Filtros: ${Object.values(context.filtros).join(' · ')}`, 14, 35);
      autoTable(pdf, { startY: 42, head: [columns.map(column => column.label)], body: data.map(row => columns.map(column => row[column.label])), styles: { fontSize: 8 }, headStyles: { fillColor: [34, 78, 105] }, didDrawPage: () => { pdf.setFontSize(8); pdf.setTextColor(100); pdf.text(`Documento generado desde el módulo ${modulo} · CONMINGO`, 14, pdf.internal.pageSize.getHeight() - 10); } });
      pdf.save(`${safeName}.pdf`);
    }
  };
  const setDatePreset = preset => { if (preset === 'custom') { update({ datePreset: 'custom', dateFrom: '', dateTo: '' }); return; } const today = new Date(); const from = new Date(today); if (preset === 'week') from.setDate(today.getDate() - 7); if (preset === 'month') from.setMonth(today.getMonth() - 1); update({ datePreset: preset, dateFrom: preset === 'all' ? '' : from.toISOString().slice(0, 10), dateTo: preset === 'all' ? '' : today.toISOString().slice(0, 10) }); };
  return <div className="mb-4 rounded-xl border border-brand-gold/30 bg-brand-cream/20 p-4 shadow-sm">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <label className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-brand-brown/70">Búsqueda libre<input value={filter.search} onChange={event => update({ search: event.target.value })} placeholder="Buscar en todas las columnas..." className="mt-1 w-full rounded-lg border border-brand-gold/40 bg-white px-3 py-2 text-sm text-brand-brown outline-none transition focus:border-brand-rust focus:ring-2 focus:ring-brand-gold/20" /></label>
      {categoryOptions.length > 0 && <label className="min-w-0 text-xs font-bold uppercase tracking-wide text-brand-brown/70 lg:w-56">Categoría<select value={filter.categories[0] || ''} onChange={event => update({ categories: event.target.value ? [event.target.value] : [] })} className="mt-1 w-full min-h-10 rounded-lg border border-brand-gold/40 bg-white px-3 py-2 text-sm font-semibold text-brand-brown focus:border-brand-rust focus:outline-none"><option value="">Todas</option>{categoryOptions.map(option => <option key={option} value={option}>{option}</option>)}</select></label>}
      {dateFields.length > 0 && <label className="min-w-0 text-xs font-bold uppercase tracking-wide text-brand-brown/70 lg:w-48">Fecha<select value={filter.datePreset} onChange={event => setDatePreset(event.target.value)} className="mt-1 w-full min-h-10 rounded-lg border border-brand-gold/40 bg-white px-3 py-2 text-sm font-semibold text-brand-brown focus:border-brand-rust focus:outline-none"><option value="all">Todo</option><option value="week">Últimos 7 días</option><option value="month">Últimos 30 días</option><option value="custom">Rango personalizado</option></select></label>}{dateFields.length > 0 && filter.datePreset === 'custom' && <div className="flex flex-1 gap-2"><label className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-brand-brown/70">Desde<input type="date" value={filter.dateFrom} onChange={event => update({ dateFrom: event.target.value, datePreset: 'custom' })} className="mt-1 w-full rounded-lg border border-brand-gold/40 bg-white px-2 py-2 text-sm text-brand-brown focus:border-brand-rust focus:outline-none" /></label><label className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-brand-brown/70">Hasta<input type="date" value={filter.dateTo} onChange={event => update({ dateTo: event.target.value, datePreset: 'custom' })} className="mt-1 w-full rounded-lg border border-brand-gold/40 bg-white px-2 py-2 text-sm text-brand-brown focus:border-brand-rust focus:outline-none" /></label></div>}
      <button type="button" onClick={() => setFilter(EMPTY_FILTER)} className="w-full rounded-lg border border-brand-gold/40 bg-white px-3 py-2 text-sm font-bold text-brand-brown transition-colors hover:bg-brand-cream/30 sm:w-auto">Limpiar filtros</button>
    </div>
    <div className="mt-3 flex flex-col gap-2 border-t border-brand-gold/20 pt-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs font-bold text-brand-brown/70">{filteredRows.length} de {rows.length} registros</span><select value="" onChange={event => { const formato = event.target.value; if (formato) exportRows(formato); }} className="w-full min-h-10 rounded-lg border border-brand-gold/40 bg-white px-4 py-2 text-sm font-bold text-brand-brown focus:border-brand-rust focus:outline-none sm:w-52"><option value="">Descargar reporte</option><option value="pdf">Descargar PDF</option><option value="excel">Descargar Excel</option><option value="csv">Descargar CSV</option><option value="json">Descargar JSON</option></select></div>
  </div>;
}

const descargarBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

