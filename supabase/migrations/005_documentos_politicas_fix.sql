-- ============================================================================
-- MIGRACION - LOTE 3B (FIX 1): PERMISOS DE LAS POLITICAS RLS DE DOCUMENTOS
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Problema: al subir un documento fallaba con
--   "permission denied for table usuario_organizaciones".
-- Las politicas RLS de storage.objects evaluaban subconsultas directas sobre
-- public.usuario_organizaciones y public.usuarios, tablas sobre las que el rol
-- authenticated no tiene permiso de SELECT.
--
-- Solucion: dos funciones SECURITY DEFINER (propietario postgres) que actuan
-- como puente seguro. No requieren grants sobre las tablas de usuarios y no
-- exponen nada por la API: solo responden sobre la membresia del propio
-- llamador (auth.uid()).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FUNCIONES PUENTE (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.es_miembro_organizacion(p_organizacion_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuario_organizaciones uo
    WHERE uo.usuario_id = auth.uid()
      AND uo.organizacion_id = p_organizacion_id
  ) OR EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.organizacion_id = p_organizacion_id
  );
$$;

CREATE OR REPLACE FUNCTION public.es_admin_organizacion(p_organizacion_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuario_organizaciones uo
    WHERE uo.usuario_id = auth.uid()
      AND uo.organizacion_id = p_organizacion_id
      AND uo.rol IN ('Administrador de Liga','Superadmin')
  ) OR EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.organizacion_id = p_organizacion_id
      AND u.rol IN ('Administrador de Liga','Superadmin')
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. POLITICAS DE LA TABLA public.documentos (RESCRITAS CON LAS FUNCIONES)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS documentos_lectura_miembros ON public.documentos;
CREATE POLICY documentos_lectura_miembros ON public.documentos
  FOR SELECT TO authenticated
  USING (public.es_miembro_organizacion(organizacion_id));

DROP POLICY IF EXISTS documentos_insert_admin ON public.documentos;
CREATE POLICY documentos_insert_admin ON public.documentos
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin_organizacion(organizacion_id));

DROP POLICY IF EXISTS documentos_delete_admin ON public.documentos;
CREATE POLICY documentos_delete_admin ON public.documentos
  FOR DELETE TO authenticated
  USING (public.es_admin_organizacion(organizacion_id));

-- ----------------------------------------------------------------------------
-- 3. POLITICAS DE storage.objects (RESCRITAS CON LAS FUNCIONES)
-- Carpeta por organizacion: {organizacion_id}/{uuid}.{ext}
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "documentos_storage_lectura_miembros" ON storage.objects;
CREATE POLICY "documentos_storage_lectura_miembros" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND public.es_miembro_organizacion(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "documentos_storage_subida_admin" ON storage.objects;
CREATE POLICY "documentos_storage_subida_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos'
    AND public.es_admin_organizacion(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "documentos_storage_borrado_admin" ON storage.objects;
CREATE POLICY "documentos_storage_borrado_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND public.es_admin_organizacion(((storage.foldername(name))[1])::uuid)
  );
