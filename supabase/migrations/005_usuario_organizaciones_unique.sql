-- =====================================================================
-- Migración 005: restricción UNIQUE en public.usuario_organizaciones (LOTE J).
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
--
-- Causa raíz del 500 en POST /api/admin-liga/crear-credencial: la ruta usa
-- INSERT ... ON CONFLICT (usuario_id, organizacion_id), que exige una
-- restricción UNIQUE (o PK compuesta) sobre esas columnas. La tabla no la
-- tenía (la migración 003 solo creó un índice común sobre organizacion_id),
-- por lo que PostgreSQL lanzaba 42710/42P10 y la ruta respondía 500.
-- =====================================================================

-- 1) Deduplicar antes de crear la restricción (conserva la fila insertada primero).
DELETE FROM public.usuario_organizaciones a
USING public.usuario_organizaciones b
WHERE a.usuario_id = b.usuario_id
  AND a.organizacion_id = b.organizacion_id
  AND a.ctid > b.ctid;

-- 2) Crear la restricción solo si no existe ya (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'usuario_organizaciones'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%usuario_id%'
      AND indexdef ILIKE '%organizacion_id%'
  ) THEN
    ALTER TABLE public.usuario_organizaciones
      ADD CONSTRAINT uq_usuario_organizaciones UNIQUE (usuario_id, organizacion_id);
  END IF;
END $$;
