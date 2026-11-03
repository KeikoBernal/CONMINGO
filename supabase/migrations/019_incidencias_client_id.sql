-- FASE D UX (offline): idempotencia del reenvio de incidencias registradas
-- sin conexion. Cada incidencia offline lleva un client_id generado en el
-- dispositivo del oficial; el backend deduplica por (partido_id, client_id)
-- para que el replay al reconectar no duplique registros.
ALTER TABLE public.incidencias_partido ADD COLUMN IF NOT EXISTS client_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_incidencias_client_id
  ON public.incidencias_partido (partido_id, client_id)
  WHERE client_id IS NOT NULL;
