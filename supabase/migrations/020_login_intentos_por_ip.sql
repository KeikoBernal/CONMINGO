-- ============================================================================
-- MIGRACION 020: bloqueo de login por (correo, IP)
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor (SIEMPRE desde este archivo del repo,
-- nunca desde copias editadas a mano). Idempotente: puede re-ejecutarse.
--
-- Contexto (revision de seguridad): el bloqueo persistente del login-proxy
-- contaba los intentos fallidos solo por correo, asi que cualquiera podia
-- bloquear la cuenta de un oficial enviando 5 claves erradas (negacion de
-- servicio el dia de un partido). El backend pasa a contar los intentos por
-- (correo, IP): la restriccion UNIQUE de login_intentos pasa de (email) a
-- (email, ip) y el ON CONFLICT del login-proxy usa la pareja.
--
-- Nota: ejecutar esta migracion y fusionar el PR en la misma ventana de
-- tiempo; mientras el esquema y el codigo no coinciden, un intento de login
-- fallido devuelve 500 (los logins con credenciales correctas no se afectan).
-- ============================================================================

-- 1) La columna ip pasa a obligatoria (el backend siempre escribe un valor).
UPDATE public.login_intentos SET ip = 'desconocida' WHERE ip IS NULL;
ALTER TABLE public.login_intentos ALTER COLUMN ip SET NOT NULL;

-- 2) Unicidad (email, ip) en vez de solo (email).
DO $$
DECLARE
  definicion_unico text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO definicion_unico
  FROM pg_constraint c
  WHERE c.conrelid = 'public.login_intentos'::regclass
    AND c.contype = 'u'
    AND c.conname = 'login_intentos_email_key';

  IF definicion_unico IS DISTINCT FROM 'UNIQUE (email, ip)' THEN
    IF definicion_unico IS NOT NULL THEN
      EXECUTE 'ALTER TABLE public.login_intentos DROP CONSTRAINT login_intentos_email_key';
    END IF;
    EXECUTE 'ALTER TABLE public.login_intentos ADD CONSTRAINT login_intentos_email_key UNIQUE (email, ip)';
  END IF;
END $$;

-- 3) Verificacion (solo lectura): la definicion debe quedar UNIQUE (email, ip).
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.login_intentos'::regclass AND contype = 'u';