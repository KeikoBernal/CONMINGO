-- ============================================================================
-- MIGRACION - LOTE 3C (N8): PAGOS DE INSCRIPCION A TORNEOS
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Registro manual de pagos de inscripcion por parte del AdminLiga:
-- equipo y/o jugador inscrito a un torneo, con monto, moneda (Bs. o USD),
-- metodo de pago, referencia y nota. Los delegados consultan en modo
-- solo lectura los pagos de su equipo y sus jugadores.
--
-- RLS: usa las funciones puente SECURITY DEFINER ya existentes
-- (es_miembro_organizacion y es_admin_organizacion, migraciones 005/006/007).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLA E INDICES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid NOT NULL REFERENCES public.organizaciones(id),
  torneo_id integer REFERENCES public.torneos(id),
  equipo_id integer REFERENCES public.equipos(id),
  jugador_id integer REFERENCES public.jugadores(id),
  monto numeric(12,2) NOT NULL CHECK (monto > 0),
  moneda character varying(10) NOT NULL DEFAULT 'Bs.' CHECK (moneda IN ('Bs.','USD')),
  metodo character varying(30) NOT NULL DEFAULT 'Efectivo' CHECK (metodo IN ('Efectivo','Pago Movil','Transferencia','Zelle','Otro')),
  referencia character varying(100),
  nota text,
  registrado_por uuid REFERENCES public.usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pagos_organizacion_idx ON public.pagos (organizacion_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS pagos_torneo_idx ON public.pagos (torneo_id);

-- ----------------------------------------------------------------------------
-- 2. RLS Y POLITICAS
-- ----------------------------------------------------------------------------
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pagos_lectura_miembros ON public.pagos;
CREATE POLICY pagos_lectura_miembros ON public.pagos
  FOR SELECT TO authenticated
  USING (public.es_miembro_organizacion(organizacion_id));

DROP POLICY IF EXISTS pagos_insert_admin ON public.pagos;
CREATE POLICY pagos_insert_admin ON public.pagos
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin_organizacion(organizacion_id));

DROP POLICY IF EXISTS pagos_delete_admin ON public.pagos;
CREATE POLICY pagos_delete_admin ON public.pagos
  FOR DELETE TO authenticated
  USING (public.es_admin_organizacion(organizacion_id));

-- ----------------------------------------------------------------------------
-- 3. VERIFICACION (solo lectura, informativa)
-- Debe devolver 0 al inicio.
-- ----------------------------------------------------------------------------
SELECT COUNT(*) AS pagos_registrados FROM public.pagos;
