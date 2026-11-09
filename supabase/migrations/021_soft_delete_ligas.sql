-- ============================================================================
-- MIGRACION 021 - LOTE 8B: SOFT DELETE DE LIGAS (baja logica de organizaciones)
-- ============================================================================
-- El DELETE /api/superadmin/ligas/:id estampa eliminado_en en vez de tocar el
-- resto de los datos: la liga sale del directorio, de las metricas y del sitio
-- publico, sus usuarios quedan bloqueados (ban de Supabase Auth + rechazo en
-- login-proxy) y todo se puede restaurar desde el panel del superadmin
-- (POST /api/superadmin/ligas/:id/restaurar).
--
-- Idempotente: puede ejecutarse mas de una vez sin error.
-- Ejecutar SIEMPRE desde este archivo del repo, nunca desde copias editadas.

ALTER TABLE public.organizaciones
  ADD COLUMN IF NOT EXISTS eliminado_en timestamp with time zone;

COMMENT ON COLUMN public.organizaciones.eliminado_en IS
  'LOTE 8B: fecha de eliminacion (baja logica) de la liga; NULL = liga viva. La estampa DELETE /superadmin/ligas/:id y la limpia POST /superadmin/ligas/:id/restaurar.';

-- Indice parcial para el listado de ligas eliminadas (restauracion).
CREATE INDEX IF NOT EXISTS idx_organizaciones_eliminado_en
  ON public.organizaciones (eliminado_en)
  WHERE eliminado_en IS NOT NULL;

-- Verificacion informativa (debe mostrar la columna timestamptz).
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'organizaciones' AND column_name = 'eliminado_en';
