-- ============================================================================
-- 007_trazabilidad_indices.sql — LOTE O (bitácoras e infra)
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
-- Contenido:
--   1) audit_logs.organizacion_id + backfill  → bitácoras por liga robustas
--   2) Backfill de usuarios.organizacion_id para delegados históricos
--   3) Índices que faltan para las consultas de bitácora
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ORGANIZACIÓN DIRECTAMENTE EN CADA REGISTRO DE AUDITORÍA
-- Antes la bitácora de una liga dependía del organizacion_id DEL USUARIO que
-- actuó (si el usuario cambiaba de liga o se borraba, su historial se perdía
-- o aparecía en otra liga). Ahora cada fila lleva su organización.
-- ----------------------------------------------------------------------------
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS organizacion_id UUID;

-- Backfill del historial existente (si el usuario aún tiene organización)
UPDATE public.audit_logs a
SET organizacion_id = u.organizacion_id
FROM public.usuarios u
WHERE a.usuario_id = u.id
  AND a.organizacion_id IS NULL
  AND u.organizacion_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. FIX DELEGADOS: usuarios (delegados de equipo) históricos sin
-- organizacion_id. Sin ese dato el middleware no resuelve su liga y la
-- bitácora los excluye. Se rellena desde el equipo que delegan y, si no,
-- desde usuario_organizaciones cuando solo pertenecen a una liga.
-- ----------------------------------------------------------------------------
UPDATE public.usuarios us
SET organizacion_id = e.organizacion_id
FROM public.equipos e
WHERE e.delegado_id = us.id
  AND us.organizacion_id IS NULL
  AND e.organizacion_id IS NOT NULL;

UPDATE public.usuarios us
SET organizacion_id = uo.organizacion_id
FROM (
  SELECT usuario_id, MIN(organizacion_id) AS organizacion_id, COUNT(DISTINCT organizacion_id) AS n
  FROM public.usuario_organizaciones
  GROUP BY usuario_id
) uo
WHERE uo.usuario_id = us.id
  AND uo.n = 1
  AND us.organizacion_id IS NULL;

-- ----------------------------------------------------------------------------
-- 3. ÍNDICES PARA LAS CONSULTAS DE BITÁCORA (filtro por organización y acción)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_organizacion_fecha ON public.audit_logs (organizacion_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_accion             ON public.audit_logs (accion);

COMMENT ON COLUMN public.audit_logs.organizacion_id IS 'LOTE O: organización dueña del registro; la bitácora por liga deja de depender del usuario que actuó.';
