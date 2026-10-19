-- ============================================================================
-- 008_torneos_flash.sql — LOTE P (torneos flash)
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
-- Contenido:
--   1) Columna tipo en torneos: 'Regular' (por defecto) | 'Flash'
--   2) Índice para listar los torneos flash de cada organización
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TIPO DE TORNEO
-- Un torneo flash se arma en un solo paso: registro rápido de equipos y
-- jugadores, sorteo aleatorio Fisher-Yates y calendario todos contra todos.
-- La columna tipo los distingue en la UI y en las consultas.
-- ----------------------------------------------------------------------------
ALTER TABLE public.torneos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'Regular';

COMMENT ON COLUMN public.torneos.tipo IS 'LOTE P: ''Regular'' | ''Flash'' — un flash se genera en un paso con sorteo y calendario automático.';

-- ----------------------------------------------------------------------------
-- 2. ÍNDICE DE LISTADO (torneos de una organización por tipo)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_torneos_org_tipo ON public.torneos (organizacion_id, tipo);
