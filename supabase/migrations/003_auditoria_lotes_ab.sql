-- ============================================================================
-- MIGRACIÓN — AUDITORÍA DEL SISTEMA (LOTE A: ESQUEMA)
-- Proyecto: CONMINGO
-- Ejecutar a mano en Supabase SQL Editor DESPUÉS de fusionar el PR.
-- Idempotente: puede re-ejecutarse sin errores.
-- Orden interno: 1) deduplicaciones -> 2) índices -> 3) UNIQUEs ->
--                4) columnas -> 5) CHECKs (NOT VALID) -> 6) VALIDATE (comentado)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DEDUPLICACIÓN (obligatorio ANTES de crear los UNIQUE)
-- ----------------------------------------------------------------------------

-- 1a. torneo_equipos: mismo equipo inscrito varias veces en un mismo torneo.
--     Se conserva la fila con el id más bajo.
DELETE FROM public.torneo_equipos a
USING public.torneo_equipos b
WHERE a.torneo_id = b.torneo_id
  AND a.equipo_id = b.equipo_id
  AND a.id > b.id;

-- 1b. manos: misma mano (partido_id + numero_mano) registrada más de una vez.
--     Las jugadas de las copias se reasignan a la mano conservada (mayor id)
--     antes de borrar los duplicados.
UPDATE public.detalle_jugadas dj
SET mano_id = keep.id
FROM public.manos dup
JOIN (
    SELECT DISTINCT ON (partido_id, numero_mano) partido_id, numero_mano, id
    FROM public.manos
    ORDER BY partido_id, numero_mano, id DESC
) keep ON keep.partido_id = dup.partido_id
      AND keep.numero_mano = dup.numero_mano
WHERE dj.mano_id = dup.id
  AND keep.id <> dup.id;

DELETE FROM public.manos a
USING public.manos b
WHERE a.partido_id = b.partido_id
  AND a.numero_mano = b.numero_mano
  AND a.id < b.id;

-- ----------------------------------------------------------------------------
-- 2. ÍNDICES (FKs sin índice = seq-scans y locks largos en cascada)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_partidos_torneo_id            ON public.partidos (torneo_id);
CREATE INDEX IF NOT EXISTS idx_partidos_equipo_local_id       ON public.partidos (equipo_local_id);
CREATE INDEX IF NOT EXISTS idx_partidos_equipo_visita_id     ON public.partidos (equipo_visita_id);
CREATE INDEX IF NOT EXISTS idx_partidos_sede_id              ON public.partidos (sede_id);
CREATE INDEX IF NOT EXISTS idx_partidos_arbitro_id           ON public.partidos (arbitro_id);
CREATE INDEX IF NOT EXISTS idx_partidos_anotador_id          ON public.partidos (anotador_id);
CREATE INDEX IF NOT EXISTS idx_partidos_capitan_local_id     ON public.partidos (capitan_local_id);
CREATE INDEX IF NOT EXISTS idx_partidos_capitan_visita_id    ON public.partidos (capitan_visita_id);
CREATE INDEX IF NOT EXISTS idx_partidos_partido_siguiente_id ON public.partidos (partido_siguiente_id);
CREATE INDEX IF NOT EXISTS idx_partidos_estado_fecha         ON public.partidos (estado, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_jugadores_equipo_id           ON public.jugadores (equipo_id);
CREATE INDEX IF NOT EXISTS idx_torneo_equipos_torneo_id     ON public.torneo_equipos (torneo_id);
CREATE INDEX IF NOT EXISTS idx_torneo_equipos_equipo_id      ON public.torneo_equipos (equipo_id);
CREATE INDEX IF NOT EXISTS idx_manos_partido_id              ON public.manos (partido_id);
CREATE INDEX IF NOT EXISTS idx_detalle_jugadas_mano_id       ON public.detalle_jugadas (mano_id);
CREATE INDEX IF NOT EXISTS idx_detalle_jugadas_jugador_id    ON public.detalle_jugadas (jugador_id);
CREATE INDEX IF NOT EXISTS idx_tarjetas_partido_id           ON public.tarjetas (partido_id);
CREATE INDEX IF NOT EXISTS idx_tarjetas_jugador_id           ON public.tarjetas (jugador_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_remitente_id   ON public.notificaciones (remitente_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_destinatario_id ON public.notificaciones (destinatario_id);
CREATE INDEX IF NOT EXISTS idx_notificaciones_organizacion_id ON public.notificaciones (organizacion_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario_id         ON public.audit_logs (usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_fecha              ON public.audit_logs (fecha);
CREATE INDEX IF NOT EXISTS idx_usuarios_organizacion_id      ON public.usuarios (organizacion_id);
CREATE INDEX IF NOT EXISTS idx_torneos_organizacion_id        ON public.torneos (organizacion_id);
CREATE INDEX IF NOT EXISTS idx_sedes_organizacion_id          ON public.sedes (organizacion_id);
CREATE INDEX IF NOT EXISTS idx_equipos_organizacion_id        ON public.equipos (organizacion_id);
CREATE INDEX IF NOT EXISTS idx_equipos_delegado_id            ON public.equipos (delegado_id);
CREATE INDEX IF NOT EXISTS idx_usuario_organizaciones_org_id ON public.usuario_organizaciones (organizacion_id);

-- ----------------------------------------------------------------------------
-- 3. UNIQUE (impiden duplicados silenciosos)
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_torneo_equipos
  ON public.torneo_equipos (torneo_id, equipo_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_manos_partido_numero
  ON public.manos (partido_id, numero_mano);

-- Dorsal único por equipo entre jugadores ACTIVOS.
-- Si existen dorsales duplicados históricos NO rompe la migración:
-- deja un aviso para corregir y volver a ejecutar.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.jugadores
    WHERE estado = 'Activo'
    GROUP BY equipo_id, numero_dorsal
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'AVISO: existen dorsales duplicados (activos). Corregirlos y re-ejecutar para crear uq_jugadores_dorsal_equipo.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_jugadores_dorsal_equipo
      ON public.jugadores (equipo_id, numero_dorsal)
      WHERE estado = 'Activo';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. COLUMNAS Y AJUSTES
-- ----------------------------------------------------------------------------
-- Motivo de la sanción (la columna no existía y el dato se perdía)
ALTER TABLE public.tarjetas ADD COLUMN IF NOT EXISTS motivo varchar(255);

-- Estado del torneo como columna de primera clase (antes vivía en reglas JSONB).
-- Backfill desde reglas->>'estado'.
ALTER TABLE public.torneos ADD COLUMN IF NOT EXISTS estado varchar NOT NULL DEFAULT 'Activo';
UPDATE public.torneos
SET estado = reglas->>'estado'
WHERE reglas->>'estado' IS NOT NULL
  AND reglas->>'estado' <> ''
  AND reglas->>'estado' <> estado;

-- Estado para soft-delete de equipos y sedes (nada se elimina, se desactiva)
ALTER TABLE public.equipos ADD COLUMN IF NOT EXISTS estado varchar NOT NULL DEFAULT 'Activo';
ALTER TABLE public.sedes   ADD COLUMN IF NOT EXISTS estado varchar NOT NULL DEFAULT 'Activo';

-- La mensajería entre ligas guarda la organización del destinatario;
-- un mensaje puede no pertenecer a la organización del remitente.
ALTER TABLE public.notificaciones ALTER COLUMN organizacion_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. CHECKs NOT VALID (validan solo filas NUEVAS; no tocan datos históricos)
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_partidos_estado') THEN
    ALTER TABLE public.partidos ADD CONSTRAINT chk_partidos_estado
      CHECK (estado IN ('Agendado','En Curso','Finalizado','Suspendido','Cancelado')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usuarios_estado') THEN
    ALTER TABLE public.usuarios ADD CONSTRAINT chk_usuarios_estado
      CHECK (estado IN ('Activo','Inactivo')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jugadores_estado') THEN
    ALTER TABLE public.jugadores ADD CONSTRAINT chk_jugadores_estado
      CHECK (estado IN ('Activo','Inactivo','Suspendido','Lesionado')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_jugadores_dorsal') THEN
    ALTER TABLE public.jugadores ADD CONSTRAINT chk_jugadores_dorsal
      CHECK (numero_dorsal BETWEEN 1 AND 99) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_manos_tantos') THEN
    ALTER TABLE public.manos ADD CONSTRAINT chk_manos_tantos
      CHECK (tantos_anotados >= 0) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_resultados_marcadores') THEN
    ALTER TABLE public.resultados ADD CONSTRAINT chk_resultados_marcadores
      CHECK (marcador_local >= 0 AND marcador_visita >= 0) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tarjetas_color') THEN
    ALTER TABLE public.tarjetas ADD CONSTRAINT chk_tarjetas_color
      CHECK (color IN ('Amarilla','Azul','Roja')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_detalle_jugadas_destreza') THEN
    ALTER TABLE public.detalle_jugadas ADD CONSTRAINT chk_detalle_jugadas_destreza
      CHECK (UPPER(tipo_destreza) IN ('A','B','N')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_torneos_fechas') THEN
    ALTER TABLE public.torneos ADD CONSTRAINT chk_torneos_fechas
      CHECK (fecha_fin >= fecha_inicio) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_torneos_estado') THEN
    ALTER TABLE public.torneos ADD CONSTRAINT chk_torneos_estado
      CHECK (estado IN ('Activo','En Curso','Finalizado','Suspendido','Cancelado','Inactivo')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_equipos_estado') THEN
    ALTER TABLE public.equipos ADD CONSTRAINT chk_equipos_estado
      CHECK (estado IN ('Activo','Inactivo')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sedes_estado') THEN
    ALTER TABLE public.sedes ADD CONSTRAINT chk_sedes_estado
      CHECK (estado IN ('Activo','Inactivo')) NOT VALID;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. VALIDACIÓN PENDIENTE (opcional)
-- Cuando se hayan revisado/corregido los datos históricos, descomentar para
-- que los CHECKs auditen también las filas existentes:
-- ----------------------------------------------------------------------------
-- ALTER TABLE public.partidos         VALIDATE CONSTRAINT chk_partidos_estado;
-- ALTER TABLE public.usuarios         VALIDATE CONSTRAINT chk_usuarios_estado;
-- ALTER TABLE public.jugadores        VALIDATE CONSTRAINT chk_jugadores_estado;
-- ALTER TABLE public.jugadores        VALIDATE CONSTRAINT chk_jugadores_dorsal;
-- ALTER TABLE public.manos            VALIDATE CONSTRAINT chk_manos_tantos;
-- ALTER TABLE public.resultados       VALIDATE CONSTRAINT chk_resultados_marcadores;
-- ALTER TABLE public.tarjetas         VALIDATE CONSTRAINT chk_tarjetas_color;
-- ALTER TABLE public.detalle_jugadas  VALIDATE CONSTRAINT chk_detalle_jugadas_destreza;
-- ALTER TABLE public.torneos          VALIDATE CONSTRAINT chk_torneos_fechas;
-- ALTER TABLE public.torneos          VALIDATE CONSTRAINT chk_torneos_estado;
-- ALTER TABLE public.equipos          VALIDATE CONSTRAINT chk_equipos_estado;
-- ALTER TABLE public.sedes            VALIDATE CONSTRAINT chk_sedes_estado;
