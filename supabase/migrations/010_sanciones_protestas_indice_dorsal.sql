-- ============================================================================
-- MIGRACION - LOTE 4A: BASE DE DATOS PARA SANCIONES Y PROTESTAS
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Este lote SOLO prepara la base de datos para los lotes siguientes:
-- 4b (M1 middlewares), 4c (N6 sanciones) y 4d (P1 protestas). No incluye
-- codigo de backend ni de frontend.
--
-- Contenido:
--   N6 - Tabla public.sanciones: suspensiones de jugadores con duracion en
--        partidos, generadas por Tarjeta Roja, por Acumulacion de tarjetas
--        o de forma Manual por el AdminLiga. Incluye levantamiento explícito.
--   P1 - Tabla public.protestas: protesta formal de un partido presentada por
--        el delegado del equipo, resuelta por el AdminLiga, que puede incluir
--        una medida contra el equipo infractor (ej. W.O. o descuento).
--   M1 - Indice unico de dorsal por equipo entre jugadores NO inactivos
--        (activos y suspendidos: el dorsal queda reservado mientras dura
--        una suspension).
--
-- RLS: usa las funciones puente SECURITY DEFINER ya existentes
-- (es_miembro_organizacion y es_admin_organizacion, migraciones 005/006/007).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. N6: TABLA DE SANCIONES (SUSPENSIONES DE JUGADORES)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sanciones (
  id BIGSERIAL PRIMARY KEY,
  organizacion_id uuid NOT NULL REFERENCES public.organizaciones(id),
  jugador_id integer NOT NULL REFERENCES public.jugadores(id),
  partido_id BIGINT REFERENCES public.partidos(id),
  tipo character varying(30) NOT NULL CHECK (tipo IN ('Tarjeta Roja','Acumulacion','Manual')),
  motivo text,
  partidos_suspension integer NOT NULL DEFAULT 1 CHECK (partidos_suspension >= 0),
  partidos_cumplidos integer NOT NULL DEFAULT 0 CHECK (partidos_cumplidos >= 0),
  estado character varying(20) NOT NULL DEFAULT 'Activa' CHECK (estado IN ('Activa','Cumplida','Levantada')),
  fecha_inicio date NOT NULL DEFAULT CURRENT_DATE,
  creada_por uuid REFERENCES public.usuarios(id),
  levantada_por uuid REFERENCES public.usuarios(id),
  levantada_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sanciones_organizacion_idx ON public.sanciones (organizacion_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS sanciones_jugador_idx ON public.sanciones (jugador_id);
CREATE INDEX IF NOT EXISTS sanciones_partido_idx ON public.sanciones (partido_id);

ALTER TABLE public.sanciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sanciones_lectura_miembros ON public.sanciones;
CREATE POLICY sanciones_lectura_miembros ON public.sanciones
  FOR SELECT TO authenticated
  USING (public.es_miembro_organizacion(organizacion_id));

DROP POLICY IF EXISTS sanciones_insert_admin ON public.sanciones;
CREATE POLICY sanciones_insert_admin ON public.sanciones
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin_organizacion(organizacion_id));

DROP POLICY IF EXISTS sanciones_update_admin ON public.sanciones;
CREATE POLICY sanciones_update_admin ON public.sanciones
  FOR UPDATE TO authenticated
  USING (public.es_admin_organizacion(organizacion_id))
  WITH CHECK (public.es_admin_organizacion(organizacion_id));

COMMENT ON TABLE public.sanciones IS 'LOTE 4A (N6): suspensiones de jugadores con duracion en partidos (Tarjeta Roja, Acumulacion de tarjetas o Manual), con levantamiento explícito.';

-- ----------------------------------------------------------------------------
-- 2. P1: TABLA DE PROTESTAS FORMALES DE PARTIDO
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.protestas (
  id BIGSERIAL PRIMARY KEY,
  organizacion_id uuid NOT NULL REFERENCES public.organizaciones(id),
  partido_id BIGINT NOT NULL REFERENCES public.partidos(id),
  equipo_protestante_id integer NOT NULL REFERENCES public.equipos(id),
  presentada_por uuid REFERENCES public.usuarios(id),
  motivo character varying(200) NOT NULL,
  descripcion text NOT NULL,
  documento_id uuid REFERENCES public.documentos(id),
  estado character varying(20) NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Resuelta','Retirada')),
  resolucion character varying(20) CHECK (resolucion IN ('Procedente','Improcedente')),
  medida text,
  resuelta_por uuid REFERENCES public.usuarios(id),
  resuelta_en timestamptz,
  nota_resolucion text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS protestas_organizacion_idx ON public.protestas (organizacion_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS protestas_partido_idx ON public.protestas (partido_id);
CREATE INDEX IF NOT EXISTS protestas_estado_idx ON public.protestas (organizacion_id, estado);

-- Un equipo no puede tener mas de una protesta viva por partido
-- (una protesta Retirada si puede reemplazarse por una nueva).
CREATE UNIQUE INDEX IF NOT EXISTS protestas_partido_equipo_unicas
  ON public.protestas (partido_id, equipo_protestante_id)
  WHERE estado IN ('Pendiente','Resuelta');

ALTER TABLE public.protestas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS protestas_lectura_miembros ON public.protestas;
CREATE POLICY protestas_lectura_miembros ON public.protestas
  FOR SELECT TO authenticated
  USING (public.es_miembro_organizacion(organizacion_id));

DROP POLICY IF EXISTS protestas_insert_miembros ON public.protestas;
CREATE POLICY protestas_insert_miembros ON public.protestas
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_organizacion(organizacion_id));

DROP POLICY IF EXISTS protestas_update_admin ON public.protestas;
CREATE POLICY protestas_update_admin ON public.protestas
  FOR UPDATE TO authenticated
  USING (public.es_admin_organizacion(organizacion_id))
  WITH CHECK (public.es_admin_organizacion(organizacion_id));

COMMENT ON TABLE public.protestas IS 'LOTE 4A (P1): protestas formales de partido presentadas por el delegado del equipo y resueltas por el AdminLiga (Procedente/Improcedente, con medida opcional).';

-- ----------------------------------------------------------------------------
-- 3. M1: INDICE UNICO DE DORSAL POR EQUIPO
-- Aplica solo a jugadores NO inactivos: el dorsal queda reservado tambien
-- mientras el jugador esta Suspendido (la suspension es temporal).
-- Pre-chequeo amable: si ya existen dorsales repetidos en produccion,
-- se aborta con un mensaje claro indicando los pares equipo:dorsal a
-- corregir antes de re-ejecutar (las tablas de arriba ya quedaron creadas).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  duplicados text;
BEGIN
  SELECT string_agg(equipo_id::text || ':' || numero_dorsal::text, ', ')
    INTO duplicados
    FROM (
      SELECT equipo_id, numero_dorsal
      FROM public.jugadores
      WHERE estado <> 'Inactivo' AND numero_dorsal IS NOT NULL
      GROUP BY equipo_id, numero_dorsal
      HAVING COUNT(*) > 1
    ) d;
  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION 'M1: hay dorsales duplicados en el mismo equipo (equipo:dorsal -> %). Pasa a Inactivo los jugadores repetidos o reasigna sus dorsales, y vuelve a ejecutar la migracion.', duplicados;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS jugadores_dorsal_unico_por_equipo
  ON public.jugadores (equipo_id, numero_dorsal)
  WHERE estado <> 'Inactivo';

COMMENT ON INDEX public.jugadores_dorsal_unico_por_equipo IS 'LOTE 4A (M1): un dorsal no puede repetirse dentro de un equipo entre jugadores activos o suspendidos.';

-- ----------------------------------------------------------------------------
-- 4. VERIFICACION (solo lectura, informativa)
-- Deben devolver 0 al inicio.
-- ----------------------------------------------------------------------------
SELECT COUNT(*) AS sanciones_registradas FROM public.sanciones;
SELECT COUNT(*) AS protestas_registradas FROM public.protestas;
