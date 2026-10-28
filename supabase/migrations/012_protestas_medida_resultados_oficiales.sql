-- ============================================================================
-- MIGRACION - LOTE 4D (P1): MEDIDA DE PROTESTA CON MARCADOR CORREGIDO
--                       Y RESULTADOS OFICIALES DE PARTIDO
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR del lote.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Contenido:
--   1. protestas: columnas medida_marcador_local / medida_marcador_visita
--      (marcador corregido propuesto por el AdminLiga al resolver una
--      protesta Procedente; se aplica al resultado oficial cuando el arbitro
--      y el anotador del partido confirman). CHECK de coherencia: ambos NULL
--      o ambos >= 0.
--   2. Backfill: resultados oficiales calculados desde las manos registradas
--      de los partidos Finalizados. ON CONFLICT (partido_id) DO NOTHING
--      preserva cualquier resultado ya existente (por ejemplo los forzados
--      por el AdminLiga). Desde este lote, finalizar un partido registra el
--      resultado oficial de forma automatica.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MARCADOR CORREGIDO EN PROTESTAS
-- ----------------------------------------------------------------------------
ALTER TABLE public.protestas
  ADD COLUMN IF NOT EXISTS medida_marcador_local integer,
  ADD COLUMN IF NOT EXISTS medida_marcador_visita integer;

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

COMMENT ON COLUMN public.protestas.medida_marcador_local IS 'LOTE 4D (P1): marcador local corregido propuesto al resolver la protesta como Procedente. Se aplica al resultado oficial cuando ambos oficiales confirman.';
COMMENT ON COLUMN public.protestas.medida_marcador_visita IS 'LOTE 4D (P1): marcador visita corregido propuesto al resolver la protesta como Procedente. Se aplica al resultado oficial cuando ambos oficiales confirman.';

-- ----------------------------------------------------------------------------
-- 2. BACKFILL: RESULTADOS OFICIALES DESDE LAS MANOS REGISTRADAS
-- ----------------------------------------------------------------------------
INSERT INTO public.resultados (partido_id, marcador_local, marcador_visita, equipo_ganador_id, tipo_resolucion, aprobado_por, observaciones)
SELECT p.id,
       l.total,
       v.total,
       CASE WHEN l.total > v.total THEN p.equipo_local_id
            WHEN v.total > l.total THEN p.equipo_visita_id
            ELSE NULL END,
       'Acta',
       NULL,
       'Marcador calculado desde las manos registradas (backfill lote 4d).'
FROM public.partidos p
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(m.tantos_anotados), 0) AS total
  FROM public.manos m
  WHERE m.partido_id = p.id AND m.equipo_ganador_id = p.equipo_local_id
) l
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(m.tantos_anotados), 0) AS total
  FROM public.manos m
  WHERE m.partido_id = p.id AND m.equipo_ganador_id = p.equipo_visita_id
) v
WHERE p.estado = 'Finalizado'
ON CONFLICT (partido_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. VERIFICACION (solo lectura, informativa)
-- ----------------------------------------------------------------------------
SELECT COUNT(*) AS partidos_finalizados FROM public.partidos WHERE estado = 'Finalizado';
SELECT COUNT(*) AS resultados_registrados FROM public.resultados;
SELECT COUNT(*) AS protestas_con_marcador FROM public.protestas WHERE medida_marcador_local IS NOT NULL;
