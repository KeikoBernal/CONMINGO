-- ============================================================
-- LOTE I: RLS (Row Level Security) — defensa en profundidad
-- Ejecutar COMPLETO en el SQL Editor de Supabase.
--
-- Por qué: la anon key de Supabase es pública (viaja en el bundle del
-- frontend) y los grants por defecto permiten a los roles anon y
-- authenticated leer y modificar TODAS las tablas vía la API REST
-- (PostgREST), saltándose el backend Express, sus roles y su rate
-- limiting. Este script habilita RLS en todo el esquema public SIN
-- políticas = denegación total por defecto para esos roles.
--
-- Por qué no rompe la app: ninguna parte legítima del sistema consulta
-- tablas vía PostgREST.
--   * Backend (pool pg, DATABASE_URL con rol postgres) → BYPASSRLS
--   * Operaciones admin (SUPABASE_SERVICE_ROLE_KEY)  → BYPASSRLS
--   * Frontend → solo usa Supabase Auth (supabase.auth.*), que no
--     está sujeto al RLS del esquema public.
-- ============================================================

-- ------------------------------------------------------------
-- 0. INVENTARIO ANTES DE EJECUTAR (informativo)
--    Guarda el resultado: sirve como punto de comparación.
-- ------------------------------------------------------------
SELECT c.relname AS tabla,
       c.relrowsecurity AS rls_activo,
       coalesce((SELECT count(*) FROM pg_catalog.pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = c.relname), 0) AS politicas
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- ------------------------------------------------------------
-- 1. HABILITAR RLS EN TODAS LAS TABLAS DE public (dinámico)
--    Sin políticas = default deny para anon y authenticated.
-- ------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t.relname);
    RAISE NOTICE 'RLS habilitado en public.%', t.relname;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. VISTAS: que no sirvan de puente para saltarse el RLS
--    Por defecto una vista se ejecuta con los privilegios de su dueño
--    (postgres), lo que anula el RLS de las tablas base si alguien la
--    consulta vía API. security_invoker hace que la vista respete el
--    rol de quien la llama. No afecta al backend (BYPASSRLS).
-- ------------------------------------------------------------
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on);', v.relname);
    RAISE NOTICE 'security_invoker activado en public.%', v.relname;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. VERIFICACIÓN (después de ejecutar)
--    Todas las tablas deben aparecer con rls_activo = true.
-- ------------------------------------------------------------
SELECT c.relname AS tabla, c.relrowsecurity AS rls_activo
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- Prueba de bloqueo con la anon key (fuera del SQL Editor, en una terminal).
-- Antes del Lote I devuelve usuarios; después devuelve [] (vacío):
--   curl "https://TU-PROYECTO.supabase.co/rest/v1/usuarios?select=id,email" \
--        -H "apikey: TU_ANON_KEY" -H "Authorization: Bearer TU_ANON_KEY"

-- ------------------------------------------------------------
-- 4. ROLLBACK (solo en caso de emergencia)
--    Descomentar y ejecutar para desactivar el RLS en todo public.
-- ------------------------------------------------------------
-- DO $$
-- DECLARE t record;
-- BEGIN
--   FOR t IN SELECT c.relname FROM pg_catalog.pg_class c
--     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
--     WHERE n.nspname = 'public' AND c.relkind = 'r'
--   LOOP
--     EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', t.relname);
--   END LOOP;
-- END $$;