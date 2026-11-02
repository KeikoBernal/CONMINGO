// FASE 2 UX: esqueletos de carga con el estilo de la marca.
// SkeletonLinea para bloques sueltos y SkeletonTabla para listados en carga.

export function SkeletonLinea({ className = 'h-10' }) {
  return <div className={'animate-pulse bg-brand-cream border border-brand-gold/30 rounded-lg ' + className} />;
}

const CLASES_COLUMNAS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6', 7: 'grid-cols-7' };

export function SkeletonTabla({ filas = 6, columnas = 5, compacto = false }) {
  const claseColumnas = CLASES_COLUMNAS[columnas] || 'grid-cols-5';
  return (
    <div className="space-y-2" role="status" aria-label="Cargando datos">
      {Array.from({ length: filas }).map((_, indice) => (
        <div key={indice} className={'grid gap-2 ' + claseColumnas}>
          {Array.from({ length: columnas }).map((_, subindice) => (
            <div key={subindice} className={compacto ? 'h-5 animate-pulse bg-brand-cream border border-brand-gold/30 rounded-lg' : 'h-9 animate-pulse bg-brand-cream border border-brand-gold/30 rounded-lg'} />
          ))}
        </div>
      ))}
    </div>
  );
}
