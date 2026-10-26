-- ============================================================================
-- MIGRACION - LOTE 3B (FIX 2): NORMALIZACION DE ROL EN LAS POLITICAS RLS
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Problema: al subir un documento fallaba con
--   "new row violates row-level security policy".
-- La funcion es_admin_organizacion comparaba el rol de forma EXACTA
-- (IN ('Administrador de Liga','Superadmin')), sensible a mayusculas,
-- acentos y espacios. El backend del sistema en cambio normaliza el rol
-- (minusculas, sin acentos, sin espacios; ver normalizarRol en
-- backend/src/middleware/authMiddleware.js) antes de autorizar. Un rol
-- guardado como "ADMINISTRADOR DE LIGA" o "Administrador de Liga "
-- pasa el middleware pero rebotaba la politica de Storage.
--
-- Solucion: comparar el rol normalizado igual que el backend. Las politicas
-- no se tocan: siguen llamando a la misma funcion (CREATE OR REPLACE
-- conserva el identificador de la funcion).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. NORMALIZADOR DE ROL (equivalente a normalizarRol del backend)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalizar_rol(p_rol text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT TRANSLATE(LOWER(TRIM(COALESCE(p_rol, ''))), 'áéíóúñü', 'aeiounu');
$$;

-- ----------------------------------------------------------------------------
-- 2. ES_ADMIN_ORGANIZACION REESCRITA CON ROL NORMALIZADO
-- ----------------------------------------------------------------------------
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
      AND public.normalizar_rol(uo.rol) IN ('administrador de liga','superadmin')
  ) OR EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.organizacion_id = p_organizacion_id
      AND public.normalizar_rol(u.rol) IN ('administrador de liga','superadmin')
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. VERIFICACION (solo lectura, informativa)
-- Muestra el rol de cada usuario y si, ya normalizado, cuenta como
-- administrador de liga. Tu usuario debe aparecer con rol_admin_ok = true.
-- Si sale false, envia el texto exacto de la columna rol para agregarlo.
-- ----------------------------------------------------------------------------
SELECT u.id, u.email, u.rol, public.normalizar_rol(u.rol) AS rol_normalizado,
       u.organizacion_id,
       (public.normalizar_rol(u.rol) IN ('administrador de liga','superadmin')) AS rol_admin_ok
FROM public.usuarios u
ORDER BY u.email;
