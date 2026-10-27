-- ============================================================================
-- MIGRACION - LOTE 4D: PROTESTAS CON MEDIDA Y RESULTADOS OFICIALES
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Contenido:
--   P1 - protestas: columnas medida_marcador_local / medida_marcador_visita.
--        Es el marcador corregido que el AdminLiga propone al declarar una
--        protesta Procedente; se aplica sobre public.resultados cuando el
--        arbitro y el anotador que presidieron el partido confirman.
--   P1 - resultados: la tabla public.resultados existia desde el esquema
--        original pero nadie la poblaba (la tabla de posiciones se calcula
--        desde ella y por eso quedaba vacia). Se hace backfill desde las
--        manos de los partidos ya finalizados; de ahora en adelante el
--        backend registra el resultado oficial al finalizar cada partido.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MARCADOR CORREGIDO PROPUESTO POR EL ADMINLIGA
-- ----------------------------------------------------------------------------
ALTER TABLE public.protestas ADD COLUMN IF NOT EXISTS medida_marcador_local integer;
ALTER TABLE public.protestas ADD COLUMN IF NOT EXISTS medida_marcador_visita integer;

-- CHECK nombrado: el marcador de la medida va completo o no va.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'protestas_medida_marcador_coherente') THEN
    ALTER TABLE public.protestas
      ADD CONSTRAINT protestas_medida_marcador_coherente CHECK (
        (medida_marcador_local IS NULL AND medida_marcador_visita IS NULL)
        OR (medida_marcador_local IS NOT NULL AND medida_marcador_visita IS NOT NULL
            AND medida_marcador_local >= 0 AND medida_marcador_visita >= 0)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.protestas.medida_marcador_local IS 'LOTE 4D (P1): tantos del equipo local en el marcador corregido de la medida. NULL si la medida no altera el resultado.';
COMMENT ON COLUMN public.protestas.medida_marcador_visita IS 'LOTE 4D (P1): tantos del equipo visita en el marcador corregido de la medida. NULL si la medida no altera el resultado.';

-- ----------------------------------------------------------------------------
-- 2. BACKFILL DEL RESULTADO OFICIAL DE PARTIDOS YA FINALIZADOS
--    Marcador calculado desde las manos del acta. No toca partidos que ya
--    tengan fila en resultados (por ejemplo, corregidos por protesta).
-- ----------------------------------------------------------------------------
INSERT INTO public.resultados (partido_id, marcador_local, marcador_visita, equipo_ganador_id, tipo_resolucion)
SELECT
  p.id,
  COALESCE(SUM(m.tantos_anotados) FILTER (WHERE m.equipo_ganador_id = p.equipo_local_id), 0),
  COALESCE(SUM(m.tantos_anotados) FILTER (WHERE m.equipo_ganador_id = p.equipo_visita_id), 0),
  CASE
    WHEN COALESCE(SUM(m.tantos_anotados) FILTER (WHERE m.equipo_ganador_id = p.equipo_local_id), 0)
       > COALESCE(SUM(m.tantos_anotados) FILTER (WHERE m.equipo_ganador_id = p.equipo_visita_id), 0) THEN p.equipo_local_id
    WHEN COALESCE(SUM(m.tantos_anotados) FILTER (WHERE m.equipo_ganador_id = p.equipo_local_id), 0)
       < COALESCE(SUM(m.tantos_anotados) FILTER (WHERE m.equipo_ganador_id = p.equipo_visita_id), 0) THEN p.equipo_visita_id
    ELSE NULL
  END,
  'Acta'
FROM public.partidos p
LEFT JOIN public.manos m ON m.partido_id = p.id
WHERE p.estado = 'Finalizado'
GROUP BY p.id, p.equipo_local_id, p.equipo_visita_id
ON CONFLICT (partido_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. VERIFICACION (solo lectura, informativa)
-- ----------------------------------------------------------------------------
SELECT COUNT(*) AS resultados_registrados FROM public.resultados;
SELECT COUNT(*) AS partidos_finalizados FROM public.partidos WHERE estado = 'Finalizado';
