-- ============================================================================
-- MIGRACION 018 (LOTE 6G): VERIFICACION DE CORREO
--
-- - usuarios.correo_verificado / verificado_en: puerta del login-proxy
--   (bloquea el acceso hasta verificar el correo). Backfill: TODAS las
--   cuentas existentes quedan verificadas (nadie re-verifica).
-- - usuarios.email_pendiente: correo nuevo en espera de confirmacion.
-- - tabla tokens_correo: tokens hasheados (sha256) para verificacion,
--   cambio de correo y (futuro lote) recuperacion de contrasena.
--
-- Idempotente y aditiva: corre en produccion sin coordinar deploys.
-- ============================================================================

-- 1) Columnas de verificacion en usuarios
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS correo_verificado boolean NOT NULL DEFAULT false;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS verificado_en timestamp with time zone;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS email_pendiente character varying(255);

-- 2) Backfill: las cuentas actuales quedan verificadas
UPDATE public.usuarios SET correo_verificado = true, verificado_en = now() WHERE correo_verificado = false;

-- 3) Tabla de tokens de correo
CREATE TABLE IF NOT EXISTS public.tokens_correo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  tipo character varying NOT NULL CHECK (tipo IN ('verificacion','cambio_correo','recuperacion')),
  token_hash character varying(128) NOT NULL,
  expira_en timestamp with time zone NOT NULL,
  usado boolean NOT NULL DEFAULT false,
  usado_en timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tokens_correo_hash ON public.tokens_correo (token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_correo_usuario ON public.tokens_correo (usuario_id, tipo) WHERE usado = false;

ALTER TABLE public.tokens_correo ENABLE ROW LEVEL SECURITY;
