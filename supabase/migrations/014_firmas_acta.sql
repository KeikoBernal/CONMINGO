-- ============================================================
-- LOTE 6D: FIRMAS DIGITALES DEL ACTA DEL PARTIDO
-- Cada partido puede llevar hasta cuatro firmas: arbitro, anotador
-- y los delegados de ambos equipos (cuando estan registrados). La
-- imagen PNG de cada firma se guarda en el bucket privado
-- firmas-actas de Supabase Storage y se sirve por URL firmada.
-- Migracion idempotente: ejecutar en Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.firmas_acta (
  id BIGSERIAL PRIMARY KEY,
  partido_id INTEGER NOT NULL REFERENCES public.partidos(id) ON DELETE CASCADE,
  -- Rol que firma: arbitro, anotador, delegado_local o delegado_visita.
  rol_firma TEXT NOT NULL CHECK (rol_firma IN ('arbitro', 'anotador', 'delegado_local', 'delegado_visita')),
  -- Usuario del sistema que registro la firma: el oficial que tenia
  -- el dispositivo cuando se dibujo (los delegados firman en el
  -- dispositivo del anotador o del arbitro asignado).
  registrada_por UUID NOT NULL REFERENCES public.usuarios(id),
  imagen_path TEXT NOT NULL,
  firmado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT firmas_acta_partido_rol_unico UNIQUE (partido_id, rol_firma)
);

CREATE INDEX IF NOT EXISTS idx_firmas_acta_partido ON public.firmas_acta(partido_id);

-- Bucket privado para las imagenes de firma; las URLs se generan
-- firmadas desde el backend con la service role key.
INSERT INTO storage.buckets (id, name, public)
SELECT 'firmas-actas', 'firmas-actas', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'firmas-actas');
