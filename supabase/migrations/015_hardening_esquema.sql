-- ============================================================================
-- MIGRACION - LOTE 6E: HARDENING DEL ESQUEMA
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUES de fusionar el PR del lote.
-- Idempotente: puede re-ejecutarse sin errores.
--
-- Contenido:
--   1. Pre-chequeo amable de datos (estados fuera de lista, NULLs, duplicados).
--   2. jugadores.cedula: UNIQUE global fuera (una persona PUEDE jugar en
--      varios equipos de la misma liga, regla del lote 4a/4b); queda indice
--      normal para las busquedas por cedula (sanciones de alcance Liga).
--   3. Dorsal: se queda SOLO el indice de la migracion 010
--      (jugadores_dorsal_unico_por_equipo, WHERE estado <> 'Inactivo');
--      los otros dos uniques (sin WHERE y WHERE estado = 'Activo') sobran.
--   4. Limpieza de indices redundantes acumulados por migraciones viejas.
--   5. equipos: organizacion_id y categoria NOT NULL + nombre unico por
--      organizacion+categoria (regla de Keiko, mismo patron del dorsal:
--      el nombre queda libre al pasar el equipo a Inactivo).
--   6. inactivo_en (timestamp de baja logica) en jugadores, equipos, sedes
--      y usuarios, con trigger que la registra automaticamente.
--   7. Normalizacion de convenciones: creado_en -> created_at en
--      organizaciones, plantillas_reglas, documentos, pagos, protestas,
--      sanciones y suscripciones_push; audit_logs.fecha -> created_at.
--      (El backend ya consulta los nombres nuevos y mantiene las claves
--      de la API con alias, asi que el frontend no cambia.)
--   8. VALIDATE de los CHECKs que la migracion 003 dejo NOT VALID.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRE-CHEQUEO AMABLE: aborta con detalle si hay datos que incumplen
--    las reglas que este lote va a exigir.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_incumplidos text;
  v_duplicados text;
BEGIN
  SELECT string_agg(etiqueta || ' (' || cantidad || ')', ', ') INTO v_incumplidos
  FROM (
    SELECT 'jugadores.estado' etiqueta, count(*) cantidad FROM public.jugadores WHERE estado IS NOT NULL AND estado NOT IN ('Activo','Inactivo','Suspendido','Lesionado')
    UNION ALL SELECT 'jugadores.numero_dorsal', count(*) FROM public.jugadores WHERE numero_dorsal < 1 OR numero_dorsal > 99
    UNION ALL SELECT 'partidos.estado', count(*) FROM public.partidos WHERE estado IS NOT NULL AND estado NOT IN ('Agendado','En Curso','Finalizado','Suspendido','Cancelado')
    UNION ALL SELECT 'equipos.estado', count(*) FROM public.equipos WHERE estado IS NOT NULL AND estado NOT IN ('Activo','Inactivo')
    UNION ALL SELECT 'sedes.estado', count(*) FROM public.sedes WHERE estado IS NOT NULL AND estado NOT IN ('Activo','Inactivo')
    UNION ALL SELECT 'usuarios.estado', count(*) FROM public.usuarios WHERE estado IS NOT NULL AND estado NOT IN ('Activo','Inactivo')
    UNION ALL SELECT 'torneos.estado', count(*) FROM public.torneos WHERE estado IS NOT NULL AND estado NOT IN ('Activo','En Curso','Finalizado','Suspendido','Cancelado','Inactivo')
    UNION ALL SELECT 'torneos.fechas', count(*) FROM public.torneos WHERE fecha_fin < fecha_inicio
    UNION ALL SELECT 'tarjetas.color', count(*) FROM public.tarjetas WHERE color NOT IN ('Amarilla','Azul','Roja')
    UNION ALL SELECT 'manos.tantos_anotados', count(*) FROM public.manos WHERE tantos_anotados < 0
    UNION ALL SELECT 'resultados.marcadores', count(*) FROM public.resultados WHERE marcador_local < 0 OR marcador_visita < 0
    UNION ALL SELECT 'documentos.tipo', count(*) FROM public.documentos WHERE tipo NOT IN ('Reglamento','Convocatoria','Acta','Inscripcion','Comunicado','Otro')
    UNION ALL SELECT 'equipos.organizacion_id NULL', count(*) FROM public.equipos WHERE organizacion_id IS NULL
    UNION ALL SELECT 'equipos.categoria NULL', count(*) FROM public.equipos WHERE categoria IS NULL
  ) sub WHERE cantidad > 0;

  IF v_incumplidos IS NOT NULL THEN
    RAISE EXCEPTION 'LOTE 6E: hay datos que incumplen las reglas antes del hardening: %. Corrigelos y vuelve a ejecutar la migracion.', v_incumplidos;
  END IF;

  SELECT string_agg(organizacion_id::text || '/' || categoria || '/' || nombre, ' | ') INTO v_duplicados
  FROM (SELECT organizacion_id, categoria, nombre FROM public.equipos WHERE estado <> 'Inactivo' GROUP BY 1, 2, 3 HAVING count(*) > 1) d;

  IF v_duplicados IS NOT NULL THEN
    RAISE EXCEPTION 'LOTE 6E: hay nombres de equipo repetidos por organizacion+categoria (%). Renombra los equipos y vuelve a ejecutar la migracion.', v_duplicados;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. CEDULA: UNIQUE global fuera (regla lote 4a/4b: una persona puede
--    inscribirse en varios equipos de la misma liga)
-- ----------------------------------------------------------------------------
ALTER TABLE public.jugadores DROP CONSTRAINT IF EXISTS jugadores_cedula_key;
CREATE INDEX IF NOT EXISTS idx_jugadores_cedula ON public.jugadores (cedula);
COMMENT ON INDEX public.idx_jugadores_cedula IS 'LOTE 6E: la cedula identifica a la persona entre sus varias inscripciones; NO es unica (misma persona en varios equipos de la liga).';

-- ----------------------------------------------------------------------------
-- 3. DORSAL: un solo indice unico, el de la migracion 010
-- ----------------------------------------------------------------------------
ALTER TABLE public.jugadores DROP CONSTRAINT IF EXISTS unique_dorsal_por_equipo;
DROP INDEX IF EXISTS public.uq_jugadores_dorsal_equipo;
COMMENT ON INDEX public.jugadores_dorsal_unico_por_equipo IS 'LOTE 6E: unico indice de dorsal (migracion 010): no se repite dentro de un equipo entre jugadores activos o suspendidos; al pasar a Inactivo el dorsal queda libre.';

-- ----------------------------------------------------------------------------
-- 4. LIMPIEZA DE INDICES REDUNDANTES (migraciones viejas superpuestas)
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.detalle_jugadas_jugador_idx;  -- duplica idx_detalle_jugadas_jugador_id
DROP INDEX IF EXISTS public.detalle_jugadas_mano_idx;     -- duplica idx_detalle_jugadas_mano_id
DROP INDEX IF EXISTS public.idx_jugadas_mano;             -- duplica idx_detalle_jugadas_mano_id
DROP INDEX IF EXISTS public.idx_manos_partido;           -- duplica idx_manos_partido_id
DROP INDEX IF EXISTS public.idx_partidos_torneo;          -- duplica idx_partidos_torneo_id
DROP INDEX IF EXISTS public.idx_jugadores_equipo;         -- duplica idx_jugadores_equipo_id
DROP INDEX IF EXISTS public.uq_torneo_equipos;            -- duplica el constraint torneo_equipos_torneo_id_equipo_id_key

-- ----------------------------------------------------------------------------
-- 5. EQUIPOS: categoria obligatoria, organizacion obligatoria y nombre
--    unico por organizacion+categoria entre equipos no inactivos
-- ----------------------------------------------------------------------------
ALTER TABLE public.equipos ALTER COLUMN organizacion_id SET NOT NULL;
ALTER TABLE public.equipos ALTER COLUMN categoria SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS equipos_nombre_unico_por_categoria
  ON public.equipos (organizacion_id, categoria, nombre)
  WHERE estado <> 'Inactivo';
COMMENT ON INDEX public.equipos_nombre_unico_por_categoria IS 'LOTE 6E: el nombre de equipo puede repetirse entre categorias o ligas distintas, pero no dentro de la misma categoria de la liga mientras el equipo este activo.';

-- ----------------------------------------------------------------------------
-- 6. INACTIVO_EN: timestamp de baja logica (auditoria de cuando paso)
-- ----------------------------------------------------------------------------
ALTER TABLE public.jugadores ADD COLUMN IF NOT EXISTS inactivo_en timestamptz;
ALTER TABLE public.equipos     ADD COLUMN IF NOT EXISTS inactivo_en timestamptz;
ALTER TABLE public.sedes       ADD COLUMN IF NOT EXISTS inactivo_en timestamptz;
ALTER TABLE public.usuarios   ADD COLUMN IF NOT EXISTS inactivo_en timestamptz;
COMMENT ON COLUMN public.jugadores.inactivo_en IS 'LOTE 6E: momento de la baja logica (estado = Inactivo). Las bajas anteriores a este lote quedan NULL porque la fecha se desconoce.';

CREATE OR REPLACE FUNCTION public.registrar_inactivo_en() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.estado = 'Inactivo' AND OLD.estado IS DISTINCT FROM 'Inactivo' AND NEW.inactivo_en IS NULL THEN
    NEW.inactivo_en := now();
  ELSIF NEW.estado IS DISTINCT FROM 'Inactivo' AND NEW.inactivo_en IS NOT NULL THEN
    NEW.inactivo_en := NULL; -- reactivar limpia la marca de baja
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_inactivo_en_jugadores ON public.jugadores;
CREATE TRIGGER trg_inactivo_en_jugadores BEFORE UPDATE ON public.jugadores
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.registrar_inactivo_en();

DROP TRIGGER IF EXISTS trg_inactivo_en_equipos ON public.equipos;
CREATE TRIGGER trg_inactivo_en_equipos BEFORE UPDATE ON public.equipos
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.registrar_inactivo_en();

DROP TRIGGER IF EXISTS trg_inactivo_en_sedes ON public.sedes;
CREATE TRIGGER trg_inactivo_en_sedes BEFORE UPDATE ON public.sedes
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.registrar_inactivo_en();

DROP TRIGGER IF EXISTS trg_inactivo_en_usuarios ON public.usuarios;
CREATE TRIGGER trg_inactivo_en_usuarios BEFORE UPDATE ON public.usuarios
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.registrar_inactivo_en();

-- ----------------------------------------------------------------------------
-- 7. CONVENCIONES: unificado created_at (renombres guardados: si la
--    columna ya esta renombrada, el paso se salta sin error)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizaciones' AND column_name = 'creado_en') THEN
    ALTER TABLE public.organizaciones RENAME COLUMN creado_en TO created_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plantillas_reglas' AND column_name = 'creado_en') THEN
    ALTER TABLE public.plantillas_reglas RENAME COLUMN creado_en TO created_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documentos' AND column_name = 'creado_en') THEN
    ALTER TABLE public.documentos RENAME COLUMN creado_en TO created_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pagos' AND column_name = 'creado_en') THEN
    ALTER TABLE public.pagos RENAME COLUMN creado_en TO created_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'protestas' AND column_name = 'creado_en') THEN
    ALTER TABLE public.protestas RENAME COLUMN creado_en TO created_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sanciones' AND column_name = 'creado_en') THEN
    ALTER TABLE public.sanciones RENAME COLUMN creado_en TO created_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'suscripciones_push' AND column_name = 'creado_en') THEN
    ALTER TABLE public.suscripciones_push RENAME COLUMN creado_en TO created_at;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'fecha') THEN
    ALTER TABLE public.audit_logs RENAME COLUMN fecha TO created_at;
  END IF;
END $$;

ALTER INDEX IF EXISTS public.idx_audit_logs_fecha RENAME TO idx_audit_logs_created_at;
ALTER INDEX IF EXISTS public.idx_audit_logs_organizacion_fecha RENAME TO idx_audit_logs_organizacion_created_at;

-- ----------------------------------------------------------------------------
-- 8. VALIDATE: los CHECKs de la migracion 003 pasan a auditar tambien
--    las filas existentes (el pre-chequeo ya garantizo que cumplen)
-- ----------------------------------------------------------------------------
ALTER TABLE public.documentos  VALIDATE CONSTRAINT chk_documentos_tipo;
ALTER TABLE public.equipos    VALIDATE CONSTRAINT chk_equipos_estado;
ALTER TABLE public.jugadores  VALIDATE CONSTRAINT chk_jugadores_dorsal;
ALTER TABLE public.jugadores  VALIDATE CONSTRAINT chk_jugadores_estado;
ALTER TABLE public.manos      VALIDATE CONSTRAINT chk_manos_tantos;
ALTER TABLE public.partidos   VALIDATE CONSTRAINT chk_partidos_estado;
ALTER TABLE public.resultados VALIDATE CONSTRAINT chk_resultados_marcadores;
ALTER TABLE public.sedes      VALIDATE CONSTRAINT chk_sedes_estado;
ALTER TABLE public.tarjetas   VALIDATE CONSTRAINT chk_tarjetas_color;
ALTER TABLE public.torneos    VALIDATE CONSTRAINT chk_torneos_estado;
ALTER TABLE public.torneos    VALIDATE CONSTRAINT chk_torneos_fechas;
ALTER TABLE public.usuarios   VALIDATE CONSTRAINT chk_usuarios_estado;

-- ----------------------------------------------------------------------------
-- 9. VERIFICACION (solo lectura, informativa)
-- ----------------------------------------------------------------------------
SELECT count(*) AS checks_pendientes_de_validar
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'c' AND NOT convalidated;
SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'jugadores' ORDER BY indexname;
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'created_at' ORDER BY table_name;
