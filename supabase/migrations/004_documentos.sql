-- ============================================================================
-- MIGRACION - LOTE 3B: REPOSITORIO DE DOCUMENTOS (C4)
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
-- Orden interno: 1) tabla e indices -> 2) CHECK -> 3) RLS de la tabla ->
--                4) bucket privado de Storage -> 5) politicas RLS de Storage.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLA, INDICES Y CHECK
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id uuid NOT NULL REFERENCES public.organizaciones(id),
  subido_por uuid REFERENCES public.usuarios(id),
  titulo character varying(200) NOT NULL,
  tipo character varying NOT NULL DEFAULT 'Otro',
  torneo_id integer REFERENCES public.torneos(id),
  archivo_path text NOT NULL,
  tamano_bytes bigint,
  mime_type text,
  creado_en timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_organizacion_id ON public.documentos (organizacion_id);
CREATE INDEX IF NOT EXISTS idx_documentos_torneo_id ON public.documentos (torneo_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_documentos_tipo') THEN
    ALTER TABLE public.documentos ADD CONSTRAINT chk_documentos_tipo
      CHECK (tipo IN ('Reglamento','Convocatoria','Acta','Inscripcion','Comunicado','Otro')) NOT VALID;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. RLS SOBRE LA TABLA public.documentos
-- El backend consulta con el rol de servicio (dueno de las tablas, no afecto
-- a RLS). Estas politicas cubren el acceso directo desde el navegador.
-- Miembro de la org = fila en usuario_organizaciones o organizacion_id en usuarios.
-- ----------------------------------------------------------------------------
ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documentos_lectura_miembros ON public.documentos;
CREATE POLICY documentos_lectura_miembros ON public.documentos
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.usuario_organizaciones uo
            WHERE uo.usuario_id = auth.uid()
              AND uo.organizacion_id = documentos.organizacion_id)
    OR EXISTS (SELECT 1 FROM public.usuarios u
               WHERE u.id = auth.uid()
                 AND u.organizacion_id = documentos.organizacion_id)
  );

DROP POLICY IF EXISTS documentos_insert_admin ON public.documentos;
CREATE POLICY documentos_insert_admin ON public.documentos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.usuario_organizaciones uo
            WHERE uo.usuario_id = auth.uid()
              AND uo.organizacion_id = documentos.organizacion_id
              AND uo.rol IN ('Administrador de Liga','Superadmin'))
    OR EXISTS (SELECT 1 FROM public.usuarios u
               WHERE u.id = auth.uid()
                 AND u.organizacion_id = documentos.organizacion_id
                 AND u.rol IN ('Administrador de Liga','Superadmin'))
  );

DROP POLICY IF EXISTS documentos_delete_admin ON public.documentos;
CREATE POLICY documentos_delete_admin ON public.documentos
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.usuario_organizaciones uo
            WHERE uo.usuario_id = auth.uid()
              AND uo.organizacion_id = documentos.organizacion_id
              AND uo.rol IN ('Administrador de Liga','Superadmin'))
    OR EXISTS (SELECT 1 FROM public.usuarios u
               WHERE u.id = auth.uid()
                 AND u.organizacion_id = documentos.organizacion_id
                 AND u.rol IN ('Administrador de Liga','Superadmin'))
  );

-- ----------------------------------------------------------------------------
-- 3. BUCKET PRIVADO DE STORAGE
-- La ruta de cada archivo es {organizacion_id}/{uuid}.{ext}
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. POLITICAS RLS SOBRE storage.objects (carpeta por organizacion)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "documentos_storage_lectura_miembros" ON storage.objects;
CREATE POLICY "documentos_storage_lectura_miembros" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (
      EXISTS (SELECT 1 FROM public.usuario_organizaciones uo
              WHERE uo.usuario_id = auth.uid()
                AND uo.organizacion_id::text = (storage.foldername(name))[1])
      OR EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid()
                   AND u.organizacion_id::text = (storage.foldername(name))[1])
    )
  );

DROP POLICY IF EXISTS "documentos_storage_subida_admin" ON storage.objects;
CREATE POLICY "documentos_storage_subida_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos'
    AND (
      EXISTS (SELECT 1 FROM public.usuario_organizaciones uo
              WHERE uo.usuario_id = auth.uid()
                AND uo.organizacion_id::text = (storage.foldername(name))[1]
                AND uo.rol IN ('Administrador de Liga','Superadmin'))
      OR EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid()
                   AND u.organizacion_id::text = (storage.foldername(name))[1]
                   AND u.rol IN ('Administrador de Liga','Superadmin'))
    )
  );

DROP POLICY IF EXISTS "documentos_storage_borrado_admin" ON storage.objects;
CREATE POLICY "documentos_storage_borrado_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND (
      EXISTS (SELECT 1 FROM public.usuario_organizaciones uo
              WHERE uo.usuario_id = auth.uid()
                AND uo.organizacion_id::text = (storage.foldername(name))[1]
                AND uo.rol IN ('Administrador de Liga','Superadmin'))
      OR EXISTS (SELECT 1 FROM public.usuarios u
                 WHERE u.id = auth.uid()
                   AND u.organizacion_id::text = (storage.foldername(name))[1]
                   AND u.rol IN ('Administrador de Liga','Superadmin'))
    )
  );
