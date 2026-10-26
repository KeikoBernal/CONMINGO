-- ============================================================================
-- MIGRACION - LOTE 3B+ (C4): DOCUMENTOS GLOBALES COMPARTIDOS POR EL SUPERADMIN
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Que hace:
--   1) Permite documentos SIN organizacion (organizacion_id NULL): son los
--      documentos globales que el Superadmin comparte con TODAS las ligas.
--   2) Funciones puente nuevas: es_miembro_de_alguna_organizacion() y
--      es_superadmin(), SECURITY DEFINER (patron del FIX 1) y comparando
--      roles normalizados (patron del FIX 2).
--   3) Recrea las politicas RLS de public.documentos:
--        Lectura: cada miembro ve los documentos de SU liga y TODOS los
--        globales (organizacion_id IS NULL).
--        Insert/Delete: el admin de la liga en sus documentos; el Superadmin
--        en los globales.
--   4) Recrea las politicas del bucket "documentos" para soportar la carpeta
--      reservada __global/{uuid}.{ext} sin errores de casteo de UUID.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ORGANIZACION OPCIONAL + INDICE PARCIAL
-- ----------------------------------------------------------------------------
ALTER TABLE public.documentos ALTER COLUMN organizacion_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS documentos_globales_idx
  ON public.documentos (creado_en DESC)
  WHERE organizacion_id IS NULL;

-- ----------------------------------------------------------------------------
-- 2. FUNCIONES PUENTE (SECURITY DEFINER, ROLES NORMALIZADOS)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.es_miembro_de_alguna_organizacion()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuario_organizaciones uo
    WHERE uo.usuario_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.organizacion_id IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.es_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND public.normalizar_rol(u.rol) = 'superadmin'
  ) OR EXISTS (
    SELECT 1 FROM public.usuario_organizaciones uo
    WHERE uo.usuario_id = auth.uid()
      AND public.normalizar_rol(uo.rol) = 'superadmin'
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. POLITICAS RLS DE LA TABLA public.documentos (RECREADAS)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS documentos_lectura_miembros ON public.documentos;
CREATE POLICY documentos_lectura_miembros ON public.documentos
  FOR SELECT TO authenticated
  USING (
    (organizacion_id IS NULL AND public.es_miembro_de_alguna_organizacion())
    OR public.es_miembro_organizacion(organizacion_id)
  );

DROP POLICY IF EXISTS documentos_insert_admin ON public.documentos;
CREATE POLICY documentos_insert_admin ON public.documentos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.es_admin_organizacion(organizacion_id)
    OR (organizacion_id IS NULL AND public.es_superadmin())
  );

DROP POLICY IF EXISTS documentos_delete_admin ON public.documentos;
CREATE POLICY documentos_delete_admin ON public.documentos
  FOR DELETE TO authenticated
  USING (
    public.es_admin_organizacion(organizacion_id)
    OR (organizacion_id IS NULL AND public.es_superadmin())
  );

-- ----------------------------------------------------------------------------
-- 4. FUNCIONES DE CARPETA + POLITICAS RLS DE STORAGE
-- Se evaluan con CASE: la carpeta __global solo la escriben/borran Superadmins;
-- las carpetas de organizacion siguen con las reglas de siempre. El CASE evita
-- el error de castear '__global' a uuid.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.documentos_carpeta_legible(p_nombre text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE (storage.foldername(p_nombre))[1]
    WHEN '__global' THEN public.es_miembro_de_alguna_organizacion()
    ELSE CASE
      WHEN (storage.foldername(p_nombre))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.es_miembro_organizacion(((storage.foldername(p_nombre))[1])::uuid)
      ELSE false
    END
  END;
$$;

CREATE OR REPLACE FUNCTION public.documentos_carpeta_escribible(p_nombre text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE (storage.foldername(p_nombre))[1]
    WHEN '__global' THEN public.es_superadmin()
    ELSE CASE
      WHEN (storage.foldername(p_nombre))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.es_admin_organizacion(((storage.foldername(p_nombre))[1])::uuid)
      ELSE false
    END
  END;
$$;

DROP POLICY IF EXISTS "documentos_storage_lectura_miembros" ON storage.objects;
CREATE POLICY "documentos_storage_lectura_miembros" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND public.documentos_carpeta_legible(name)
  );

DROP POLICY IF EXISTS "documentos_storage_subida_admin" ON storage.objects;
CREATE POLICY "documentos_storage_subida_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos'
    AND public.documentos_carpeta_escribible(name)
  );

DROP POLICY IF EXISTS "documentos_storage_borrado_admin" ON storage.objects;
CREATE POLICY "documentos_storage_borrado_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND public.documentos_carpeta_escribible(name)
  );

-- ----------------------------------------------------------------------------
-- 5. VERIFICACION (solo lectura, informativa)
-- Debe listar tu usuario Superadmin y contar los globales (0 al inicio).
-- ----------------------------------------------------------------------------
SELECT u.email, u.rol, public.normalizar_rol(u.rol) AS rol_normalizado
FROM public.usuarios u
WHERE public.normalizar_rol(u.rol) = 'superadmin'
ORDER BY u.email;

SELECT COUNT(*) AS documentos_globales FROM public.documentos WHERE organizacion_id IS NULL;
