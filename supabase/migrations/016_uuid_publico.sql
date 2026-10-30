-- ============================================================================
-- MIGRACION - LOTE 7A: UUID PUBLICO + MAPEO LEGACY JSONB
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Programa uuid (fases): 7a BD (esta migracion) -> 7b backend resuelve
-- uuid_publico en endpoints -> 7c frontend con URLs opacas (QR del marcador
-- publico incluido).
--
-- Estrategia decidida por Keiko (30/10/2026):
--   - Columna uuid_publico ADICIONAL en todas las tablas con id entero;
--     los ids enteros siguen existiendo como llave interna. Cero riesgo
--     para el codigo vivo: nada deja de funcionar por ejecutar esto.
--   - Tabla mapeo_ids_legacy con detalle JSONB: puente legacy_id -> uuid
--     para que los links viejos (QR impresos con partido_id entero) sigan
--     resolviendo durante y despues de la transicion.
--
-- Esta migracion es puramente ADITIVA: no renombra, no borra, no valida.
-- Puede ejecutarse en produccion sin coordinacion con el deploy del backend
-- (el backend empieza a usar uuid_publico recien en 7b).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. UUID PUBLICO EN CADA TABLA CON ID ENTERO
--    El DEFAULT rellena las filas existentes automaticamente.
-- ----------------------------------------------------------------------------
ALTER TABLE public.torneos ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.sedes ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.equipos ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.jugadores ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.partidos ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.manos ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.detalle_jugadas ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.tarjetas ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.resultados ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.plantillas_reglas ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.torneo_equipos ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.incidencias_partido ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.sanciones ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.protestas ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.votos_mvp ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.suscripciones_push ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.firmas_acta ADD COLUMN IF NOT EXISTS uuid_publico uuid NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.partidos.uuid_publico IS 'LOTE 7A: id opaco para URLs y endpoints publicos (marcador del QR). El id entero queda como llave interna.';

-- ----------------------------------------------------------------------------
-- 2. INDICE UNICO POR UUID PUBLICO
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS torneos_uuid_publico_key ON public.torneos (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS sedes_uuid_publico_key ON public.sedes (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS equipos_uuid_publico_key ON public.equipos (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS jugadores_uuid_publico_key ON public.jugadores (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS partidos_uuid_publico_key ON public.partidos (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS manos_uuid_publico_key ON public.manos (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS detalle_jugadas_uuid_publico_key ON public.detalle_jugadas (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS tarjetas_uuid_publico_key ON public.tarjetas (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS resultados_uuid_publico_key ON public.resultados (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS notificaciones_uuid_publico_key ON public.notificaciones (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_uuid_publico_key ON public.audit_logs (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS plantillas_reglas_uuid_publico_key ON public.plantillas_reglas (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS torneo_equipos_uuid_publico_key ON public.torneo_equipos (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS incidencias_partido_uuid_publico_key ON public.incidencias_partido (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS sanciones_uuid_publico_key ON public.sanciones (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS protestas_uuid_publico_key ON public.protestas (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS votos_mvp_uuid_publico_key ON public.votos_mvp (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS suscripciones_push_uuid_publico_key ON public.suscripciones_push (uuid_publico);
CREATE UNIQUE INDEX IF NOT EXISTS firmas_acta_uuid_publico_key ON public.firmas_acta (uuid_publico);

-- ----------------------------------------------------------------------------
-- 3. MAPEO LEGACY ID -> UUID (con detalle JSONB)
--    Puente para links viejos en la calle (QR impresos con el id entero) y
--    base para la futura eliminacion de los ids enteros. El backend de 7b
--    puede resolver legacy -> uuid aqui o directamente en cada tabla
--    (el id entero sigue existiendo; esta tabla es el registro estable).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mapeo_ids_legacy (
  tabla text NOT NULL,
  legacy_id bigint NOT NULL,
  uuid_publico uuid NOT NULL,
  meta jsonb NOT NULL DEFAULT '{"migracion": "016"}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapeo_ids_legacy_pkey PRIMARY KEY (tabla, legacy_id),
  CONSTRAINT mapeo_ids_legacy_uuid_key UNIQUE (uuid_publico)
);

CREATE INDEX IF NOT EXISTS mapeo_ids_legacy_uuid_idx ON public.mapeo_ids_legacy (uuid_publico);

COMMENT ON TABLE public.mapeo_ids_legacy IS 'LOTE 7A: puente legacy_id -> uuid_publico por tabla, con detalle JSONB (meta). Sirve para resolver links viejos con id entero y para la futura eliminacion de las columnas id enteras.';

ALTER TABLE public.mapeo_ids_legacy ENABLE ROW LEVEL SECURITY;
-- Sin politicas: solo el backend (service role, dueno de las tablas) la usa.

INSERT INTO public.mapeo_ids_legacy (tabla, legacy_id, uuid_publico)
SELECT 'torneos', id, uuid_publico FROM public.torneos
UNION ALL
SELECT 'sedes', id, uuid_publico FROM public.sedes
UNION ALL
SELECT 'equipos', id, uuid_publico FROM public.equipos
UNION ALL
SELECT 'jugadores', id, uuid_publico FROM public.jugadores
UNION ALL
SELECT 'partidos', id, uuid_publico FROM public.partidos
UNION ALL
SELECT 'manos', id, uuid_publico FROM public.manos
UNION ALL
SELECT 'detalle_jugadas', id, uuid_publico FROM public.detalle_jugadas
UNION ALL
SELECT 'tarjetas', id, uuid_publico FROM public.tarjetas
UNION ALL
SELECT 'resultados', id, uuid_publico FROM public.resultados
UNION ALL
SELECT 'notificaciones', id, uuid_publico FROM public.notificaciones
UNION ALL
SELECT 'audit_logs', id, uuid_publico FROM public.audit_logs
UNION ALL
SELECT 'plantillas_reglas', id, uuid_publico FROM public.plantillas_reglas
UNION ALL
SELECT 'torneo_equipos', id, uuid_publico FROM public.torneo_equipos
UNION ALL
SELECT 'incidencias_partido', id, uuid_publico FROM public.incidencias_partido
UNION ALL
SELECT 'sanciones', id, uuid_publico FROM public.sanciones
UNION ALL
SELECT 'protestas', id, uuid_publico FROM public.protestas
UNION ALL
SELECT 'votos_mvp', id, uuid_publico FROM public.votos_mvp
UNION ALL
SELECT 'suscripciones_push', id, uuid_publico FROM public.suscripciones_push
UNION ALL
SELECT 'firmas_acta', id, uuid_publico FROM public.firmas_acta
ON CONFLICT (tabla, legacy_id) DO UPDATE SET uuid_publico = EXCLUDED.uuid_publico;

-- ----------------------------------------------------------------------------
-- 4. VERIFICACION (solo lectura, informativa)
--    En cada tabla, filas debe ser igual a uuids.
-- ----------------------------------------------------------------------------
SELECT 'torneos' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.torneos;
SELECT 'sedes' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.sedes;
SELECT 'equipos' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.equipos;
SELECT 'jugadores' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.jugadores;
SELECT 'partidos' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.partidos;
SELECT 'manos' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.manos;
SELECT 'detalle_jugadas' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.detalle_jugadas;
SELECT 'tarjetas' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.tarjetas;
SELECT 'resultados' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.resultados;
SELECT 'notificaciones' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.notificaciones;
SELECT 'audit_logs' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.audit_logs;
SELECT 'plantillas_reglas' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.plantillas_reglas;
SELECT 'torneo_equipos' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.torneo_equipos;
SELECT 'incidencias_partido' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.incidencias_partido;
SELECT 'sanciones' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.sanciones;
SELECT 'protestas' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.protestas;
SELECT 'votos_mvp' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.votos_mvp;
SELECT 'suscripciones_push' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.suscripciones_push;
SELECT 'firmas_acta' AS tabla, count(*) AS filas, count(uuid_publico) AS uuids FROM public.firmas_acta;
SELECT tabla, count(*) AS mapeos FROM public.mapeo_ids_legacy GROUP BY tabla ORDER BY tabla;
