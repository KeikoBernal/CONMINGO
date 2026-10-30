-- ============================================================================
-- MIGRACION - 017: NORMALIZACION DE TIPOS EN LLAVES FORANEAS ENTERAS
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
--
-- Contexto (revision de ingenieria, 30/10/2026): partidos.id y torneos.id
-- son integer, pero varias tablas nuevas declararon sus referencias como
-- bigint (migraciones 006, 010 y 011). PostgreSQL ACEPTA FKs int8 -> int4
-- (existen operadores de igualdad cruzados en la familia btree de enteros)
-- y esas FK ya viven y funcionan en produccion; no es un error. Pero lo
-- correcto es que FK y PK coincidan en ancho: evita confusion, casts
-- implicitos en los joins y sustos con herramientas de modelado.
--
-- Conversion segura: todas estas tablas son pequenas; el ALTER TYPE
-- reescribe la tabla con un lock breve. Las PK bigint propias (sanciones.id,
-- protestas.id, votos_mvp.id, incidencias_partido.id, suscripciones_push.id,
-- firmas_acta.id) NO se tocan: no referencian a nadie y sus secuencias ya
-- son bigint en produccion.
-- ============================================================================

ALTER TABLE public.incidencias_partido ALTER COLUMN partido_id TYPE integer USING partido_id::integer;
ALTER TABLE public.incidencias_partido ALTER COLUMN jugador_id  TYPE integer USING jugador_id::integer;
ALTER TABLE public.sanciones           ALTER COLUMN partido_id  TYPE integer USING partido_id::integer;
ALTER TABLE public.protestas           ALTER COLUMN partido_id  TYPE integer USING partido_id::integer;
ALTER TABLE public.votos_mvp           ALTER COLUMN torneo_id   TYPE integer USING torneo_id::integer;
ALTER TABLE public.planilla_estado     ALTER COLUMN partido_id  TYPE integer USING partido_id::integer;

-- ----------------------------------------------------------------------------
-- VERIFICACION (solo lectura): debe devolver 0 filas
-- FKs cuyo tipo no coincide con la columna referenciada.
-- ----------------------------------------------------------------------------
SELECT conname AS fk_con_tipo_distinto, conrelid::regclass AS tabla
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
WHERE c.contype = 'f' AND a.atttypid <> ra.atttypid;
