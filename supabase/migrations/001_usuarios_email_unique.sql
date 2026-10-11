-- =====================================================================
-- Migración 001: unicidad del email en public.usuarios (hallazgo #11).
-- Ejecutar en el SQL Editor de Supabase del proyecto.
-- =====================================================================

-- 1) Eliminar duplicados existentes: conserva el registro insertado primero.
DELETE FROM public.usuarios a
USING public.usuarios b
WHERE a.email = b.email
  AND a.ctid > b.ctid;

-- 2) Garantizar unicidad del email a nivel de base de datos,
--    evitando logins ambiguos (WHERE email = $1 devolviendo varias filas).
ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_email_unique UNIQUE (email);
