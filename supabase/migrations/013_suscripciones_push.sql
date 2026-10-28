-- ============================================================
-- LOTE 5 (N4): NOTIFICACIONES PUSH (WEB PUSH)
-- Guarda las suscripciones de navegador (RFC 8030) de cada usuario
-- para enviarles notificaciones push con web-push (claves VAPID).
-- Idempotente: puede ejecutarse varias veces sin errores.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS public.suscripciones_push_id_seq;

CREATE TABLE IF NOT EXISTS public.suscripciones_push (
  id bigint NOT NULL DEFAULT nextval('public.suscripciones_push_id_seq'::regclass),
  usuario_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  creado_en timestamp without time zone DEFAULT now(),
  CONSTRAINT suscripciones_push_pkey PRIMARY KEY (id),
  CONSTRAINT suscripciones_push_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_suscripciones_push_usuario ON public.suscripciones_push (usuario_id);

COMMENT ON TABLE public.suscripciones_push IS 'LOTE 5 (N4): suscripciones Web Push por usuario (una fila por endpoint de navegador).';
COMMENT ON COLUMN public.suscripciones_push.endpoint IS 'URL del push service del navegador; si responde 404/410 la suscripcion murio y la fila se elimina.';
COMMENT ON COLUMN public.suscripciones_push.p256dh IS 'Clave publica de cifrado de la suscripcion (base64url).';
COMMENT ON COLUMN public.suscripciones_push.auth IS 'Secreto de autenticacion de la suscripcion (base64url).';

-- Verificacion informativa
SELECT COUNT(*) AS suscripciones_existentes FROM public.suscripciones_push;
