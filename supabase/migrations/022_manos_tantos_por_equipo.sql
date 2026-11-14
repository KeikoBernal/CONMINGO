-- ============================================================
-- LOTE 8K: TANTOS POR EQUIPO EN CADA MANO
-- En bolas criollas los DOS equipos pueden puntuar en la misma
-- mano. Antes la tabla manos solo guardaba el equipo ganador y
-- sus tantos (equipo_ganador_id + tantos_anotados), lo que
-- perdia los tantos del perdedor y obligaba a celdas en blanco
-- en la planilla. Se agregan tantos_local y tantos_visita con
-- backfill desde las manos legacy (el ganador se deduce del
-- equipo_ganador_id del partido).
-- Ejecutar en el SQL Editor de Supabase.
-- ============================================================

ALTER TABLE public.manos ADD COLUMN IF NOT EXISTS tantos_local INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.manos ADD COLUMN IF NOT EXISTS tantos_visita INTEGER NOT NULL DEFAULT 0;

-- Backfill: manos legacy que solo guardaron el ganador y sus tantos.
UPDATE public.manos m
SET tantos_local = CASE WHEN m.equipo_ganador_id = p.equipo_local_id THEN m.tantos_anotados ELSE 0 END,
    tantos_visita = CASE WHEN m.equipo_ganador_id = p.equipo_visita_id THEN m.tantos_anotados ELSE 0 END
FROM public.partidos p
WHERE m.partido_id = p.id
  AND m.tantos_local = 0
  AND m.tantos_visita = 0
  AND m.tantos_anotados > 0;

-- Reglas de dominio: cada equipo anota entre 0 y 6 tantos por mano.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_manos_tantos_local') THEN
    ALTER TABLE public.manos ADD CONSTRAINT chk_manos_tantos_local CHECK (tantos_local >= 0 AND tantos_local <= 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_manos_tantos_visita') THEN
    ALTER TABLE public.manos ADD CONSTRAINT chk_manos_tantos_visita CHECK (tantos_visita >= 0 AND tantos_visita <= 6);
  END IF;
END $$;
