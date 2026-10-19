-- ============================================================================
-- 006_incidencias_partido.sql — LOTE N (módulo de incidencias del árbitro)
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
-- Registrar en el expediente del partido los reportes que hace el árbitro
-- (protestas, lesiones, retrasos, condiciones de sede, afición, otros).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.incidencias_partido (
  id BIGSERIAL PRIMARY KEY,
  partido_id BIGINT NOT NULL,
  usuario_id UUID,
  jugador_id BIGINT,
  tipo VARCHAR(50) NOT NULL,
  descripcion TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- FKs (idempotentes)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_incidencias_partido_partido') THEN
    ALTER TABLE public.incidencias_partido
      ADD CONSTRAINT fk_incidencias_partido_partido FOREIGN KEY (partido_id)
      REFERENCES public.partidos (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_incidencias_partido_usuario') THEN
    ALTER TABLE public.incidencias_partido
      ADD CONSTRAINT fk_incidencias_partido_usuario FOREIGN KEY (usuario_id)
      REFERENCES public.usuarios (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_incidencias_partido_jugador') THEN
    ALTER TABLE public.incidencias_partido
      ADD CONSTRAINT fk_incidencias_partido_jugador FOREIGN KEY (jugador_id)
      REFERENCES public.jugadores (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_incidencias_partido_id ON public.incidencias_partido (partido_id);
CREATE INDEX IF NOT EXISTS idx_incidencias_usuario_id  ON public.incidencias_partido (usuario_id);

-- Defensa en profundidad (patrón de la migración 004): sin políticas, solo el
-- backend (conexión directa / service_role) puede leer y escribir la tabla.
ALTER TABLE public.incidencias_partido ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.incidencias_partido IS 'LOTE N: reportes de incidencias registrados por el árbitro de un partido (protestas, lesiones, condiciones de sede, etc.).';
