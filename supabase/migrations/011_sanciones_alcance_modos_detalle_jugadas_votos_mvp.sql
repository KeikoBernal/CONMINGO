-- ============================================================================
-- MIGRACION - LOTE 4C: SANCIONES ALCANCE/MODO + ESTADISTICAS INDIVIDUALES + MVP
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Contenido:
--   N6 - public.sanciones: columnas alcance ('Equipo' | 'Liga') y
--        modo_cumplimiento ('Partidos del equipo' | 'Partidos de cualquiera'
--        | 'Dias'). partidos_suspension se reutiliza como la cantidad
--        (partidos o dias) segun el modo.
--   N3 - public.detalle_jugadas: tabla de lanzamientos por jugador y mano.
--        Ya existia en produccion pero nunca fue migrada; se formaliza aqui
--        con el boche rastrero ('r') incluido y CHECKs nombrados.
--   N3 - public.votos_mvp: votacion del Jugador Mas Util del torneo; votan
--        todos los usuarios de la liga, un voto por persona y torneo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. N6: ALCANCE Y MODO DE CUMPLIMIENTO DE LAS SANCIONES
-- ----------------------------------------------------------------------------
ALTER TABLE public.sanciones ADD COLUMN IF NOT EXISTS alcance character varying(10) NOT NULL DEFAULT 'Equipo';
ALTER TABLE public.sanciones ADD COLUMN IF NOT EXISTS modo_cumplimiento character varying(30) NOT NULL DEFAULT 'Partidos del equipo';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sanciones_alcance_valores') THEN
    ALTER TABLE public.sanciones ADD CONSTRAINT sanciones_alcance_valores CHECK (alcance IN ('Equipo', 'Liga'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sanciones_modo_cumplimiento_valores') THEN
    ALTER TABLE public.sanciones ADD CONSTRAINT sanciones_modo_cumplimiento_valores
      CHECK (modo_cumplimiento IN ('Partidos del equipo', 'Partidos de cualquiera', 'Dias'));
  END IF;
END $$;

COMMENT ON COLUMN public.sanciones.alcance IS 'LOTE 4C (N6): Equipo = solo el equipo del jugador; Liga = todos los equipos de la persona en la organizacion (emparejando por cedula).';
COMMENT ON COLUMN public.sanciones.modo_cumplimiento IS 'LOTE 4C (N6): como se cumple la suspension; partidos_suspension guarda la cantidad (partidos o dias) segun el modo.';

-- ----------------------------------------------------------------------------
-- 2. N3: DETALLE DE JUGADAS (LANZAMIENTOS POR JUGADOR Y MANO)
-- Ya existia en produccion sin migracion formal; se crea con IF NOT EXISTS
-- para no tocarla si ya existe. Los CHECK viejos de tipo_destreza (si los
-- hay) se reemplazan por uno nombrado que admite el boche rastrero 'r'.
-- Sin politicas RLS: la escriben el anotador y el AdminLiga via backend.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.detalle_jugadas (
  id BIGSERIAL PRIMARY KEY,
  mano_id BIGINT NOT NULL REFERENCES public.manos(id) ON DELETE CASCADE,
  jugador_id integer NOT NULL REFERENCES public.jugadores(id),
  tipo_destreza character varying(1) NOT NULL,
  efectividad boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  nombre_constraint text;
BEGIN
  FOR nombre_constraint IN
    SELECT conname FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'c' AND n.nspname = 'public' AND t.relname = 'detalle_jugadas'
      AND pg_get_constraintdef(c.oid) ILIKE '%tipo_destreza%'
      AND conname <> 'detalle_jugadas_tipo_destreza_valores'
  LOOP
    EXECUTE format('ALTER TABLE public.detalle_jugadas DROP CONSTRAINT %I', nombre_constraint);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'detalle_jugadas_tipo_destreza_valores') THEN
    ALTER TABLE public.detalle_jugadas ADD CONSTRAINT detalle_jugadas_tipo_destreza_valores
      CHECK (tipo_destreza IN ('a', 'b', 'r', 'n'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS detalle_jugadas_mano_idx ON public.detalle_jugadas (mano_id);
CREATE INDEX IF NOT EXISTS detalle_jugadas_jugador_idx ON public.detalle_jugadas (jugador_id);

ALTER TABLE public.detalle_jugadas ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.detalle_jugadas IS 'LOTE 4C (N3): lanzamientos por jugador y mano. a = arrime, b = boche de aire, r = boche rastrero (si la liga lo registra), n = nulo general.';

-- ----------------------------------------------------------------------------
-- 3. N3: VOTACION DEL MVP DEL TORNEO
-- Votan todos los usuarios de la liga; el AdminLiga abre y cierra la
-- votacion por torneo (torneos.reglas.votacion_mvp) y un usuario emite
-- un solo voto por torneo.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.votos_mvp (
  id BIGSERIAL PRIMARY KEY,
  organizacion_id uuid NOT NULL REFERENCES public.organizaciones(id),
  torneo_id BIGINT NOT NULL REFERENCES public.torneos(id),
  votante_id uuid NOT NULL REFERENCES public.usuarios(id),
  jugador_id integer NOT NULL REFERENCES public.jugadores(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT votos_mvp_un_voto_por_votante UNIQUE (torneo_id, votante_id)
);

CREATE INDEX IF NOT EXISTS votos_mvp_organizacion_idx ON public.votos_mvp (organizacion_id);
CREATE INDEX IF NOT EXISTS votos_mvp_torneo_idx ON public.votos_mvp (torneo_id);

ALTER TABLE public.votos_mvp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS votos_mvp_lectura_miembros ON public.votos_mvp;
CREATE POLICY votos_mvp_lectura_miembros ON public.votos_mvp
  FOR SELECT TO authenticated
  USING (public.es_miembro_organizacion(organizacion_id));

DROP POLICY IF EXISTS votos_mvp_insert_miembros ON public.votos_mvp;
CREATE POLICY votos_mvp_insert_miembros ON public.votos_mvp
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_organizacion(organizacion_id));

COMMENT ON TABLE public.votos_mvp IS 'LOTE 4C (N3): votacion del Jugador Mas Util del torneo; un voto por persona y torneo, apertura y cierre a cargo del AdminLiga.';

-- ----------------------------------------------------------------------------
-- 4. VERIFICACION (informativa)
-- ----------------------------------------------------------------------------
SELECT COUNT(*) AS sanciones_registradas FROM public.sanciones;
SELECT COUNT(*) AS jugadas_registradas FROM public.detalle_jugadas;
SELECT COUNT(*) AS votos_registrados FROM public.votos_mvp;
