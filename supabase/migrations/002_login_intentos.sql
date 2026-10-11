-- =====================================================================
-- Migración 002: tabla login_intentos (hallazgo #18).
-- Bloqueo persistente de intentos de inicio de sesión:
-- 5 intentos fallidos → 15 minutos de bloqueo por correo.
-- Ejecutar en el SQL Editor de Supabase del proyecto.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.login_intentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip text,
  intentos integer NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  ultimo_intento timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_intentos_email_key UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_login_intentos_bloqueado
  ON public.login_intentos (bloqueado_hasta);

-- RLS activado SIN políticas: la tabla queda inaccesible desde la API
-- anónima de Supabase. El backend la consulta por conexión directa
-- PostgreSQL (DATABASE_URL), que no está sujeta a RLS.
ALTER TABLE public.login_intentos ENABLE ROW LEVEL SECURITY;
