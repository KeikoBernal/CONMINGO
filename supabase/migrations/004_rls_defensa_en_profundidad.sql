-- ============================================================================
-- 004_rls_defensa_en_profundidad.sql — LOTE I
-- ============================================================================
-- OBJETIVO
-- La anon key de Supabase es PÚBLICA por diseño: viaja compilada dentro del
-- bundle JS del frontend (frontend/src/supabaseClient.js la lee de
-- VITE_SUPABASE_ANON_KEY), así que cualquier visitante puede extraerla del
-- navegador. Mientras RLS esté desactivado, cualquiera con esa key puede leer
-- y escribir TODAS las tablas directamente contra el REST API de Supabase,
-- saltándose por completo al backend Express.
--
-- Este archivo activa RLS en todas las tablas de public SIN crear políticas:
-- «RLS activado sin políticas» = denegación total para anon y authenticated.
--
-- POR QUÉ NO ROMPE LA APP (verificado en la auditoría Lotes A–H)
-- 1) El backend lee y escribe datos por dos vías que NO se rigen por RLS:
--    - db.js: pool pg directo con el rol postgres (dueño de las tablas;
--      los dueños no están sujetos a RLS salvo FORCE, que aquí NO se usa).
--    - supabaseAdmin: cliente con la service_role key (bypass de RLS).
-- 2) Los clientes del backend que usan la anon key (authMiddleware,
--    login-proxy, validación de sockets) SOLO llaman endpoints de
--    autenticación (auth.getUser / signInWithOtp / verifyOtp), que no
--    consultan tablas de public.
-- 3) El frontend SOLO usa supabase.auth.* (sesión) y el API Express para
--    todos los datos. Ningún componente llama a .from(), storage o realtime
--    (verificado componente por componente).
--
-- CÓMO APLICAR (desde el dashboard de Supabase)
-- 1. SQL Editor → pegar y ejecutar este archivo completo.
-- 2. Confirmar que la verificación (sección 3) devuelve rowsecurity = true.
-- 3. Probar la app de punta a punta: login, dashboards, planilla en vivo.
--
-- v2: corregido error 42703 (alias del record inconsistente: tabla/tablename).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) DIAGNÓSTICO PREVIO (guardar el resultado: sirve como «antes»)
-- ----------------------------------------------------------------------------
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
-- order by tablename;

-- ----------------------------------------------------------------------------
-- 1) ACTIVAR RLS EN TODAS LAS TABLAS ACTUALES DE public (idempotente)
--    Sin políticas = nadie fuera del dueño / service_role ve una sola fila.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security;', r.tablename);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2) REVOCAR PERMISOS DIRECTOS DE anon / authenticated (doble cierre)
--    RLS niega filas; el REVOKE niega hasta el intento. Aunque en el futuro
--    alguien cree una política permisiva por accidente, sin GRANT no hay acceso.
-- ----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Que las tablas que se creen EN EL FUTURO tampoco concedan acceso por defecto
-- (aplica a las creadas por el rol que ejecuta esta migración, normalmente postgres).
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) VERIFICACIÓN (ejecutar; todas las filas deben mostrar rowsecurity = true)
-- ----------------------------------------------------------------------------
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
-- order by tablename;

-- ----------------------------------------------------------------------------
-- ROLLBACK (solo por emergencia; no debería hacer falta)
-- ----------------------------------------------------------------------------
-- do $$
-- declare r record;
-- begin
--   for r in select c.relname as tablename from pg_class c
--            join pg_namespace n on n.oid = c.relnamespace
--            where n.nspname = 'public' and c.relkind = 'r' loop
--     execute format('alter table public.%I disable row level security;', r.tablename);
--   end loop;
-- end $$;
--
-- grant all on all tables in schema public to anon, authenticated, service_role;
-- grant all on all sequences in schema public to anon, authenticated, service_role;
-- alter default privileges in schema public
--   grant all on tables to anon, authenticated, service_role;
