-- ============================================================
-- FIX #16: persistencia del estado de la planilla en vivo.
-- Ejecutar en Supabase SQL Editor (una sola vez).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.planilla_estado (
  partido_id BIGINT PRIMARY KEY,
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sin políticas: solo el backend (conexión directa por DATABASE_URL) puede leerla/escribirla.
ALTER TABLE public.planilla_estado ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.planilla_estado IS 'Estado en vivo de la planilla de cada partido (FIX #16): sobrevive reinicios y redeploys del backend.';
