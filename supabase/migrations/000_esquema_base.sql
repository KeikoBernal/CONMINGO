-- ============================================================================
-- BASELINE 000 - ESQUEMA COMPLETO DE CONMINGO (LOTE 6E)
-- Proyecto: CONMINGO
--
-- Reconstruye desde cero el esquema completo de la base de datos al estado
-- POST-migracion 015 (hardening). NO ejecutar en produccion: alla el esquema
-- ya existe y las migraciones 001-015 son la fuente historica. Este archivo
-- es para bases de datos nuevas (staging, local, pruebas).
--
-- Fuentes (30/10/2026): dump DDL de Supabase, diagnostico de constraints /
-- indices / RLS / politicas / funciones, migraciones 001-015 del repo y
-- query de triggers sobre resultados y auth.users.
--
-- Convenciones ya normalizadas aqui (NO volver a aplicar 001-015 encima):
--   - created_at en organizaciones, plantillas_reglas, documentos, pagos,
--     protestas, sanciones, suscripciones_push y audit_logs.
--   - Sin UNIQUE global de cedula en jugadores (regla lote 4a/4b: una
--     persona puede inscribirse en varios equipos de la misma liga).
--   - Un solo indice unico de dorsal (parcial, estado <> 'Inactivo').
--   - equipos: organizacion_id y categoria NOT NULL, nombre unico por
--     organizacion+categoria entre equipos no inactivos.
--   - inactivo_en en jugadores, equipos, sedes y usuarios (trigger).
--   - Todos los CHECKs VALID (la 003 los creo NOT VALID; la 015 los valido).
--   - Indices redundantes ya eliminados (no estan en este baseline).
--   - FKs enteras normalizadas a integer (partidos.id y torneos.id son
--     integer; la migracion 017 alineo las bigint de incidencias_partido,
--     sanciones, protestas, votos_mvp y planilla_estado).
--
-- NOTA: auth.users y los buckets de Storage pertenecen al proyecto Supabase;
-- el trigger on_auth_user_created solo aplica con auth habilitado.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONES
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 2. FUNCIONES
-- ----------------------------------------------------------------------------

-- Normalizador de rol (equivalente a normalizarRol del backend)
CREATE OR REPLACE FUNCTION public.normalizar_rol(p_rol text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT TRANSLATE(LOWER(TRIM(COALESCE(p_rol, ''))), 'áéíóúñü', 'aeiounu');
$$;

-- Puentes RLS SECURITY DEFINER (el rol authenticated no tiene SELECT sobre
-- las tablas de usuarios; estas responden solo sobre el propio llamador)
CREATE OR REPLACE FUNCTION public.es_miembro_organizacion(p_organizacion_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
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
SET search_path TO public
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

CREATE OR REPLACE FUNCTION public.es_miembro_de_alguna_organizacion()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
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
SET search_path TO public
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

-- Carpetas de Storage del bucket documentos: {organizacion_id}/... o __global/...
CREATE OR REPLACE FUNCTION public.documentos_carpeta_legible(p_nombre text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
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
SET search_path TO public
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

-- Trigger de auth: cada usuario nuevo de auth.users espeja su fila en public.usuarios
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.usuarios (
    id,
    email,
    rol,
    nombre,
    apellido,
    cedula,
    debe_cambiar_password
  )
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'rol', 'Usuario'),
    new.raw_user_meta_data->>'nombre',
    new.raw_user_meta_data->>'apellido',
    new.raw_user_meta_data->>'cedula',
    COALESCE((new.raw_user_meta_data->>'debe_cambiar_password')::boolean, true)
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      rol = EXCLUDED.rol,
      nombre = EXCLUDED.nombre,
      apellido = EXCLUDED.apellido,
      cedula = EXCLUDED.cedula,
      debe_cambiar_password = EXCLUDED.debe_cambiar_password;

  RETURN new;
END;
$function$;

-- Trigger de bracket: el ganador avanza al partido siguiente
CREATE OR REPLACE FUNCTION public.avanzar_ganador_a_siguiente_ronda()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_siguiente_partido_id INTEGER;
    v_es_local_siguiente BOOLEAN;
BEGIN
    -- Obtener datos del partido actual
    SELECT partido_siguiente_id, es_local_siguiente
    INTO v_siguiente_partido_id, v_es_local_siguiente
    FROM public.partidos
    WHERE id = NEW.partido_id;

    -- Si existe un partido siguiente vinculado, actualizar la llave correspondiente
    IF v_siguiente_partido_id IS NOT NULL THEN
        IF v_es_local_siguiente THEN
            UPDATE public.partidos
            SET equipo_local_id = NEW.equipo_ganador_id
            WHERE id = v_siguiente_partido_id;
        ELSE
            UPDATE public.partidos
            SET equipo_visita_id = NEW.equipo_ganador_id
            WHERE id = v_siguiente_partido_id;
        END IF;

        -- Cambiar el estado del partido siguiente a 'Agendado' si ya cuenta con ambos equipos
        UPDATE public.partidos
        SET estado = 'Agendado'
        WHERE id = v_siguiente_partido_id
          AND equipo_local_id IS NOT NULL
          AND equipo_visita_id IS NOT NULL;
    END IF;

    RETURN NEW;
END;
$function$;

-- Trigger de baja logica: estampa inactivo_en al pasar a Inactivo y la limpia al reactivar
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

-- ----------------------------------------------------------------------------
-- 3. TABLAS (orden de dependencia; equipos<->jugadores se enlazan despues)
-- ----------------------------------------------------------------------------

CREATE TABLE public.organizaciones (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  nombre character varying NOT NULL,
  estado_activa boolean DEFAULT true,
  logo_url text,
  responsable_nombre character varying NOT NULL,
  responsable_telefono character varying NOT NULL,
  responsable_email character varying NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT organizaciones_pkey PRIMARY KEY (id)
);

CREATE TABLE public.usuarios (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  organizacion_id uuid,
  rol character varying NOT NULL,
  email character varying NOT NULL,
  password_hash character varying,
  nombre character varying,
  apellido character varying,
  cedula character varying,
  debe_cambiar_password boolean DEFAULT true,
  estado character varying DEFAULT 'Activo',
  inactivo_en timestamp with time zone,
  CONSTRAINT usuarios_pkey PRIMARY KEY (id),
  CONSTRAINT usuarios_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  CONSTRAINT chk_usuarios_estado CHECK (((estado)::text = ANY ((ARRAY['Activo'::character varying, 'Inactivo'::character varying])::text[]))),
  CONSTRAINT usuarios_email_unique UNIQUE (email),
  CONSTRAINT usuarios_cedula_key UNIQUE (cedula)
);

CREATE TABLE public.torneos (
  id integer NOT NULL DEFAULT nextval('torneos_id_seq'::regclass),
  organizacion_id uuid NOT NULL,
  nombre character varying NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  reglas jsonb NOT NULL,
  categorias_permitidas jsonb DEFAULT '[]'::jsonb,
  temporada character varying DEFAULT '2026'::character varying,
  estado character varying NOT NULL DEFAULT 'Activo',
  tipo text NOT NULL DEFAULT 'Regular',
  CONSTRAINT torneos_pkey PRIMARY KEY (id),
  CONSTRAINT torneos_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  CONSTRAINT chk_torneos_estado CHECK (((estado)::text = ANY ((ARRAY['Activo'::character varying, 'En Curso'::character varying, 'Finalizado'::character varying, 'Suspendido'::character varying, 'Cancelado'::character varying, 'Inactivo'::character varying])::text[]))),
  CONSTRAINT chk_torneos_fechas CHECK ((fecha_fin >= fecha_inicio))
);

CREATE TABLE public.sedes (
  id integer NOT NULL DEFAULT nextval('sedes_id_seq'::regclass),
  organizacion_id uuid NOT NULL,
  nombre character varying NOT NULL,
  direccion text,
  estado character varying NOT NULL DEFAULT 'Activo',
  inactivo_en timestamp with time zone,
  CONSTRAINT sedes_pkey PRIMARY KEY (id),
  CONSTRAINT sedes_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  CONSTRAINT chk_sedes_estado CHECK (((estado)::text = ANY ((ARRAY['Activo'::character varying, 'Inactivo'::character varying])::text[])))
);

-- capitan_id -> jugadores se agrega por ALTER despues de crear jugadores
CREATE TABLE public.equipos (
  id integer NOT NULL DEFAULT nextval('equipos_id_seq'::regclass),
  delegado_id uuid,
  nombre character varying NOT NULL,
  logo_url text,
  capitan_id integer,
  organizacion_id uuid NOT NULL,
  categoria character varying NOT NULL,
  tipo_genero character varying DEFAULT 'Mixto'::character varying,
  estado character varying NOT NULL DEFAULT 'Activo',
  inactivo_en timestamp with time zone,
  CONSTRAINT equipos_pkey PRIMARY KEY (id),
  CONSTRAINT equipos_delegado_id_fkey FOREIGN KEY (delegado_id) REFERENCES public.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT equipos_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  CONSTRAINT chk_equipos_estado CHECK (((estado)::text = ANY ((ARRAY['Activo'::character varying, 'Inactivo'::character varying])::text[])))
);

CREATE TABLE public.jugadores (
  id integer NOT NULL DEFAULT nextval('jugadores_id_seq'::regclass),
  equipo_id integer NOT NULL,
  cedula character varying NOT NULL,
  nombre character varying NOT NULL,
  apellido character varying NOT NULL,
  fecha_nacimiento date NOT NULL,
  correo character varying,
  telefono character varying,
  numero_dorsal integer NOT NULL,
  estado character varying DEFAULT 'Activo',
  foto_url text,
  inactivo_en timestamp with time zone,
  CONSTRAINT jugadores_pkey PRIMARY KEY (id),
  CONSTRAINT jugadores_equipo_id_fkey FOREIGN KEY (equipo_id) REFERENCES public.equipos(id) ON DELETE CASCADE,
  CONSTRAINT chk_jugadores_dorsal CHECK (((numero_dorsal >= 1) AND (numero_dorsal <= 99))),
  CONSTRAINT chk_jugadores_estado CHECK (((estado)::text = ANY ((ARRAY['Activo'::character varying, 'Inactivo'::character varying, 'Suspendido'::character varying, 'Lesionado'::character varying])::text[])))
);

ALTER TABLE public.equipos
  ADD CONSTRAINT fk_equipo_capitan FOREIGN KEY (capitan_id) REFERENCES public.jugadores(id) ON DELETE SET NULL;

CREATE TABLE public.partidos (
  id integer NOT NULL DEFAULT nextval('partidos_id_seq'::regclass),
  torneo_id integer NOT NULL,
  equipo_local_id integer,
  equipo_visita_id integer,
  sede_id integer NOT NULL,
  arbitro_id uuid,
  anotador_id uuid,
  capitan_local_id integer,
  capitan_visita_id integer,
  fecha_hora timestamp without time zone NOT NULL,
  hora_inicio character varying,
  estado character varying NOT NULL DEFAULT 'Agendado',
  sorteo_data jsonb,
  snapshot_data jsonb,
  partido_siguiente_id integer,
  es_local_siguiente boolean,
  fase character varying DEFAULT 'Fase de Grupos',
  hora_final character varying,
  CONSTRAINT partidos_pkey PRIMARY KEY (id),
  CONSTRAINT partidos_torneo_id_fkey FOREIGN KEY (torneo_id) REFERENCES public.torneos(id) ON DELETE CASCADE,
  CONSTRAINT partidos_equipo_local_id_fkey FOREIGN KEY (equipo_local_id) REFERENCES public.equipos(id),
  CONSTRAINT partidos_equipo_visita_id_fkey FOREIGN KEY (equipo_visita_id) REFERENCES public.equipos(id),
  CONSTRAINT partidos_sede_id_fkey FOREIGN KEY (sede_id) REFERENCES public.sedes(id),
  CONSTRAINT partidos_capitan_local_id_fkey FOREIGN KEY (capitan_local_id) REFERENCES public.jugadores(id),
  CONSTRAINT partidos_capitan_visita_id_fkey FOREIGN KEY (capitan_visita_id) REFERENCES public.jugadores(id),
  CONSTRAINT partidos_partido_siguiente_id_fkey FOREIGN KEY (partido_siguiente_id) REFERENCES public.partidos(id),
  CONSTRAINT partidos_arbitro_id_fkey FOREIGN KEY (arbitro_id) REFERENCES public.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT partidos_anotador_id_fkey FOREIGN KEY (anotador_id) REFERENCES public.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT chk_partidos_estado CHECK (((estado)::text = ANY ((ARRAY['Agendado'::character varying, 'En Curso'::character varying, 'Finalizado'::character varying, 'Suspendido'::character varying, 'Cancelado'::character varying])::text[])))
);

CREATE TABLE public.manos (
  id integer NOT NULL DEFAULT nextval('manos_id_seq'::regclass),
  partido_id integer NOT NULL,
  numero_mano integer NOT NULL,
  equipo_ganador_id integer,
  tantos_anotados integer NOT NULL DEFAULT 0,
  CONSTRAINT manos_pkey PRIMARY KEY (id),
  CONSTRAINT manos_partido_id_fkey FOREIGN KEY (partido_id) REFERENCES public.partidos(id) ON DELETE CASCADE,
  CONSTRAINT manos_equipo_ganador_id_fkey FOREIGN KEY (equipo_ganador_id) REFERENCES public.equipos(id),
  CONSTRAINT chk_manos_tantos CHECK ((tantos_anotados >= 0))
);

CREATE TABLE public.detalle_jugadas (
  id integer NOT NULL DEFAULT nextval('detalle_jugadas_id_seq'::regclass),
  mano_id integer NOT NULL,
  jugador_id integer NOT NULL,
  tipo_destreza character(1) NOT NULL,
  efectividad boolean NOT NULL,
  minuto_registro timestamp without time zone DEFAULT now(),
  estado_validacion character varying DEFAULT 'Pendiente',
  CONSTRAINT detalle_jugadas_pkey PRIMARY KEY (id),
  CONSTRAINT detalle_jugadas_mano_id_fkey FOREIGN KEY (mano_id) REFERENCES public.manos(id) ON DELETE CASCADE,
  CONSTRAINT detalle_jugadas_jugador_id_fkey FOREIGN KEY (jugador_id) REFERENCES public.jugadores(id),
  CONSTRAINT detalle_jugadas_tipo_destreza_valores CHECK ((tipo_destreza = ANY (ARRAY['a'::bpchar, 'b'::bpchar, 'r'::bpchar, 'n'::bpchar])))
);

CREATE TABLE public.tarjetas (
  id integer NOT NULL DEFAULT nextval('tarjetas_id_seq'::regclass),
  partido_id integer NOT NULL,
  jugador_id integer NOT NULL,
  color character varying NOT NULL,
  minuto_registro timestamp without time zone DEFAULT now(),
  motivo character varying,
  CONSTRAINT tarjetas_pkey PRIMARY KEY (id),
  CONSTRAINT tarjetas_partido_id_fkey FOREIGN KEY (partido_id) REFERENCES public.partidos(id) ON DELETE CASCADE,
  CONSTRAINT tarjetas_jugador_id_fkey FOREIGN KEY (jugador_id) REFERENCES public.jugadores(id),
  CONSTRAINT chk_tarjetas_color CHECK (((color)::text = ANY ((ARRAY['Amarilla'::character varying, 'Azul'::character varying, 'Roja'::character varying])::text[])))
);

CREATE TABLE public.resultados (
  id integer NOT NULL DEFAULT nextval('resultados_id_seq'::regclass),
  partido_id integer NOT NULL,
  marcador_local integer NOT NULL,
  marcador_visita integer NOT NULL,
  equipo_ganador_id integer,
  tipo_resolucion character varying NOT NULL,
  aprobado_por uuid,
  observaciones text,
  fecha_registro timestamp without time zone DEFAULT now(),
  CONSTRAINT resultados_pkey PRIMARY KEY (id),
  CONSTRAINT resultados_partido_id_fkey FOREIGN KEY (partido_id) REFERENCES public.partidos(id) ON DELETE CASCADE,
  CONSTRAINT resultados_equipo_ganador_id_fkey FOREIGN KEY (equipo_ganador_id) REFERENCES public.equipos(id),
  CONSTRAINT resultados_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES public.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT resultados_partido_id_key UNIQUE (partido_id),
  CONSTRAINT chk_resultados_marcadores CHECK (((marcador_local >= 0) AND (marcador_visita >= 0)))
);

CREATE TABLE public.notificaciones (
  id integer NOT NULL DEFAULT nextval('notificaciones_id_seq'::regclass),
  organizacion_id uuid,
  remitente_id uuid NOT NULL,
  destinatario_id uuid,
  titulo character varying NOT NULL,
  mensaje text NOT NULL,
  hora_envio timestamp without time zone DEFAULT now(),
  hora_lectura timestamp without time zone,
  CONSTRAINT notificaciones_pkey PRIMARY KEY (id),
  CONSTRAINT notificaciones_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id) ON DELETE CASCADE,
  CONSTRAINT notificaciones_remitente_id_fkey FOREIGN KEY (remitente_id) REFERENCES public.usuarios(id) ON DELETE CASCADE,
  CONSTRAINT notificaciones_destinatario_id_fkey FOREIGN KEY (destinatario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE
);

CREATE TABLE public.audit_logs (
  id integer NOT NULL DEFAULT nextval('audit_logs_id_seq'::regclass),
  usuario_id uuid,
  accion character varying NOT NULL,
  tabla character varying NOT NULL,
  valores_previos jsonb,
  nuevos_valores jsonb,
  ip character varying,
  created_at timestamp without time zone DEFAULT now(),
  organizacion_id uuid,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL
);

CREATE TABLE public.plantillas_reglas (
  id integer NOT NULL DEFAULT nextval('plantillas_reglas_id_seq'::regclass),
  organizacion_id uuid NOT NULL,
  nombre character varying NOT NULL,
  descripcion text,
  reglas jsonb NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT plantillas_reglas_pkey PRIMARY KEY (id),
  CONSTRAINT plantillas_reglas_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id) ON DELETE CASCADE
);

CREATE TABLE public.torneo_equipos (
  id integer NOT NULL DEFAULT nextval('torneo_equipos_id_seq'::regclass),
  torneo_id integer NOT NULL,
  equipo_id integer NOT NULL,
  grupo character varying,
  CONSTRAINT torneo_equipos_pkey PRIMARY KEY (id),
  CONSTRAINT torneo_equipos_torneo_id_fkey FOREIGN KEY (torneo_id) REFERENCES public.torneos(id) ON DELETE CASCADE,
  CONSTRAINT torneo_equipos_equipo_id_fkey FOREIGN KEY (equipo_id) REFERENCES public.equipos(id) ON DELETE CASCADE,
  CONSTRAINT torneo_equipos_torneo_id_equipo_id_key UNIQUE (torneo_id, equipo_id)
);

CREATE TABLE public.usuario_organizaciones (
  usuario_id uuid NOT NULL,
  organizacion_id uuid NOT NULL,
  rol character varying NOT NULL,
  CONSTRAINT usuario_organizaciones_pkey PRIMARY KEY (usuario_id, organizacion_id),
  CONSTRAINT usuario_organizaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE,
  CONSTRAINT usuario_organizaciones_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id) ON DELETE CASCADE
);

CREATE TABLE public.login_intentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip text,
  intentos integer NOT NULL DEFAULT 0,
  bloqueado_hasta timestamp with time zone,
  ultimo_intento timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT login_intentos_pkey PRIMARY KEY (id),
  CONSTRAINT login_intentos_email_key UNIQUE (email)
);

CREATE TABLE public.planilla_estado (
  partido_id integer NOT NULL,
  datos jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT planilla_estado_pkey PRIMARY KEY (partido_id)
);

CREATE TABLE public.incidencias_partido (
  id bigint NOT NULL DEFAULT nextval('incidencias_partido_id_seq'::regclass),
  partido_id integer NOT NULL,
  usuario_id uuid,
  jugador_id integer,
  tipo character varying NOT NULL,
  descripcion text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT incidencias_partido_pkey PRIMARY KEY (id),
  CONSTRAINT fk_incidencias_partido_partido FOREIGN KEY (partido_id) REFERENCES public.partidos(id) ON DELETE CASCADE,
  CONSTRAINT fk_incidencias_partido_usuario FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_incidencias_partido_jugador FOREIGN KEY (jugador_id) REFERENCES public.jugadores(id) ON DELETE SET NULL
);

-- organizacion_id NULL = documento global del Superadmin compartido a todas las ligas
CREATE TABLE public.documentos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organizacion_id uuid,
  subido_por uuid,
  titulo character varying(200) NOT NULL,
  tipo character varying NOT NULL DEFAULT 'Otro',
  torneo_id integer,
  archivo_path text NOT NULL,
  tamano_bytes bigint,
  mime_type text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT documentos_pkey PRIMARY KEY (id),
  CONSTRAINT documentos_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id),
  CONSTRAINT documentos_subido_por_fkey FOREIGN KEY (subido_por) REFERENCES public.usuarios(id),
  CONSTRAINT documentos_torneo_id_fkey FOREIGN KEY (torneo_id) REFERENCES public.torneos(id),
  CONSTRAINT chk_documentos_tipo CHECK (((tipo)::text = ANY ((ARRAY['Reglamento'::character varying, 'Convocatoria'::character varying, 'Acta'::character varying, 'Inscripcion'::character varying, 'Comunicado'::character varying, 'Otro'::character varying])::text[])))
);

CREATE TABLE public.pagos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organizacion_id uuid NOT NULL,
  torneo_id integer,
  equipo_id integer,
  jugador_id integer,
  monto numeric(12,2) NOT NULL,
  moneda character varying(10) NOT NULL DEFAULT 'Bs.',
  metodo character varying(30) NOT NULL DEFAULT 'Efectivo',
  referencia character varying(100),
  nota text,
  registrado_por uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pagos_pkey PRIMARY KEY (id),
  CONSTRAINT pagos_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id),
  CONSTRAINT pagos_torneo_id_fkey FOREIGN KEY (torneo_id) REFERENCES public.torneos(id),
  CONSTRAINT pagos_equipo_id_fkey FOREIGN KEY (equipo_id) REFERENCES public.equipos(id),
  CONSTRAINT pagos_jugador_id_fkey FOREIGN KEY (jugador_id) REFERENCES public.jugadores(id),
  CONSTRAINT pagos_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES public.usuarios(id),
  CONSTRAINT pagos_monto_check CHECK ((monto > (0)::numeric)),
  CONSTRAINT pagos_moneda_check CHECK (((moneda)::text = ANY ((ARRAY['Bs.'::character varying, 'USD'::character varying])::text[]))),
  CONSTRAINT pagos_metodo_check CHECK (((metodo)::text = ANY ((ARRAY['Efectivo'::character varying, 'Pago Movil'::character varying, 'Transferencia'::character varying, 'Zelle'::character varying, 'Otro'::character varying])::text[])))
);

CREATE TABLE public.sanciones (
  id bigint NOT NULL DEFAULT nextval('sanciones_id_seq'::regclass),
  organizacion_id uuid NOT NULL,
  jugador_id integer NOT NULL,
  partido_id integer,
  tipo character varying(30) NOT NULL,
  motivo text,
  partidos_suspension integer NOT NULL DEFAULT 1,
  partidos_cumplidos integer NOT NULL DEFAULT 0,
  estado character varying(20) NOT NULL DEFAULT 'Activa',
  fecha_inicio date NOT NULL DEFAULT CURRENT_DATE,
  creada_por uuid,
  levantada_por uuid,
  levantada_en timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  alcance character varying(10) NOT NULL DEFAULT 'Equipo',
  modo_cumplimiento character varying(30) NOT NULL DEFAULT 'Partidos del equipo',
  CONSTRAINT sanciones_pkey PRIMARY KEY (id),
  CONSTRAINT sanciones_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id),
  CONSTRAINT sanciones_jugador_id_fkey FOREIGN KEY (jugador_id) REFERENCES public.jugadores(id),
  CONSTRAINT sanciones_partido_id_fkey FOREIGN KEY (partido_id) REFERENCES public.partidos(id),
  CONSTRAINT sanciones_creada_por_fkey FOREIGN KEY (creada_por) REFERENCES public.usuarios(id),
  CONSTRAINT sanciones_levantada_por_fkey FOREIGN KEY (levantada_por) REFERENCES public.usuarios(id),
  CONSTRAINT sanciones_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['Tarjeta Roja'::character varying, 'Acumulacion'::character varying, 'Manual'::character varying])::text[]))),
  CONSTRAINT sanciones_estado_check CHECK (((estado)::text = ANY ((ARRAY['Activa'::character varying, 'Cumplida'::character varying, 'Levantada'::character varying])::text[]))),
  CONSTRAINT sanciones_partidos_suspension_check CHECK ((partidos_suspension >= 0)),
  CONSTRAINT sanciones_partidos_cumplidos_check CHECK ((partidos_cumplidos >= 0)),
  CONSTRAINT sanciones_alcance_valores CHECK (((alcance)::text = ANY ((ARRAY['Equipo'::character varying, 'Liga'::character varying])::text[]))),
  CONSTRAINT sanciones_modo_cumplimiento_valores CHECK (((modo_cumplimiento)::text = ANY ((ARRAY['Partidos del equipo'::character varying, 'Partidos de cualquiera'::character varying, 'Dias'::character varying])::text[])))
);

CREATE TABLE public.protestas (
  id bigint NOT NULL DEFAULT nextval('protestas_id_seq'::regclass),
  organizacion_id uuid NOT NULL,
  partido_id integer NOT NULL,
  equipo_protestante_id integer NOT NULL,
  presentada_por uuid,
  motivo character varying(200) NOT NULL,
  descripcion text NOT NULL,
  documento_id uuid,
  estado character varying(30) NOT NULL DEFAULT 'Pendiente',
  resolucion character varying(20),
  medida text,
  medida_marcador_local integer,
  medida_marcador_visita integer,
  confirmacion_arbitro uuid,
  confirmacion_arbitro_en timestamp with time zone,
  confirmacion_anotador uuid,
  confirmacion_anotador_en timestamp with time zone,
  resuelta_por uuid,
  resuelta_en timestamp with time zone,
  nota_resolucion text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT protestas_pkey PRIMARY KEY (id),
  CONSTRAINT protestas_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id),
  CONSTRAINT protestas_partido_id_fkey FOREIGN KEY (partido_id) REFERENCES public.partidos(id),
  CONSTRAINT protestas_equipo_protestante_id_fkey FOREIGN KEY (equipo_protestante_id) REFERENCES public.equipos(id),
  CONSTRAINT protestas_presentada_por_fkey FOREIGN KEY (presentada_por) REFERENCES public.usuarios(id),
  CONSTRAINT protestas_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.documentos(id),
  CONSTRAINT protestas_confirmacion_arbitro_fkey FOREIGN KEY (confirmacion_arbitro) REFERENCES public.usuarios(id),
  CONSTRAINT protestas_confirmacion_anotador_fkey FOREIGN KEY (confirmacion_anotador) REFERENCES public.usuarios(id),
  CONSTRAINT protestas_resuelta_por_fkey FOREIGN KEY (resuelta_por) REFERENCES public.usuarios(id),
  CONSTRAINT protestas_estado_check CHECK (((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Pendiente Confirmacion'::character varying, 'Resuelta'::character varying, 'Retirada'::character varying])::text[]))),
  CONSTRAINT protestas_resolucion_check CHECK (((resolucion)::text = ANY ((ARRAY['Procedente'::character varying, 'Improcedente'::character varying])::text[]))),
  CONSTRAINT protestas_medida_requiere_confirmaciones CHECK ((((estado)::text <> 'Resuelta'::text) OR (resolucion IS NULL) OR ((resolucion)::text = 'Improcedente'::text) OR ((confirmacion_arbitro IS NOT NULL) AND (confirmacion_anotador IS NOT NULL)))),
  CONSTRAINT protestas_medida_marcador_coherente CHECK ((((medida_marcador_local IS NULL) AND (medida_marcador_visita IS NULL)) OR ((medida_marcador_local IS NOT NULL) AND (medida_marcador_visita IS NOT NULL) AND (medida_marcador_local >= 0) AND (medida_marcador_visita >= 0))))
);

CREATE TABLE public.votos_mvp (
  id bigint NOT NULL DEFAULT nextval('votos_mvp_id_seq'::regclass),
  organizacion_id uuid NOT NULL,
  torneo_id integer NOT NULL,
  votante_id uuid NOT NULL,
  jugador_id integer NOT NULL,
  creado_en timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT votos_mvp_pkey PRIMARY KEY (id),
  CONSTRAINT votos_mvp_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES public.organizaciones(id),
  CONSTRAINT votos_mvp_torneo_id_fkey FOREIGN KEY (torneo_id) REFERENCES public.torneos(id),
  CONSTRAINT votos_mvp_votante_id_fkey FOREIGN KEY (votante_id) REFERENCES public.usuarios(id),
  CONSTRAINT votos_mvp_jugador_id_fkey FOREIGN KEY (jugador_id) REFERENCES public.jugadores(id),
  CONSTRAINT votos_mvp_un_voto_por_votante UNIQUE (torneo_id, votante_id)
);

CREATE TABLE public.suscripciones_push (
  id bigint NOT NULL DEFAULT nextval('suscripciones_push_id_seq'::regclass),
  usuario_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT suscripciones_push_pkey PRIMARY KEY (id),
  CONSTRAINT suscripciones_push_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE,
  CONSTRAINT suscripciones_push_endpoint_key UNIQUE (endpoint)
);

CREATE TABLE public.firmas_acta (
  id bigint NOT NULL DEFAULT nextval('firmas_acta_id_seq'::regclass),
  partido_id integer NOT NULL,
  rol_firma text NOT NULL,
  registrada_por uuid NOT NULL,
  imagen_path text NOT NULL,
  firmado_en timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT firmas_acta_pkey PRIMARY KEY (id),
  CONSTRAINT firmas_acta_partido_id_fkey FOREIGN KEY (partido_id) REFERENCES public.partidos(id) ON DELETE CASCADE,
  CONSTRAINT firmas_acta_registrada_por_fkey FOREIGN KEY (registrada_por) REFERENCES public.usuarios(id),
  CONSTRAINT firmas_acta_partido_rol_unico UNIQUE (partido_id, rol_firma),
  CONSTRAINT firmas_acta_rol_firma_check CHECK ((rol_firma = ANY (ARRAY['arbitro'::text, 'anotador'::text, 'delegado_local'::text, 'delegado_visita'::text])))
);

-- ----------------------------------------------------------------------------
-- 4. SECUENCIAS EXPLICITAS (los DEFAULT ya las crearon; esto las deja
--    declaradas por si se reconstruye tabla por tabla)
-- ----------------------------------------------------------------------------
-- Las columnas SERIAL/BIGSERIAL de arriba crean automaticamente las
-- secuencias {tabla}_id_seq con los nombres correctos de produccion.

-- ----------------------------------------------------------------------------
-- 5. INDICES (set post-015: sin duplicados)
-- ----------------------------------------------------------------------------
CREATE INDEX idx_usuarios_organizacion_id ON public.usuarios (organizacion_id);
CREATE INDEX idx_torneos_organizacion_id ON public.torneos (organizacion_id);
CREATE INDEX idx_torneos_org_tipo ON public.torneos (organizacion_id, tipo);
CREATE INDEX idx_sedes_organizacion_id ON public.sedes (organizacion_id);
CREATE INDEX idx_equipos_organizacion_id ON public.equipos (organizacion_id);
CREATE INDEX idx_equipos_delegado_id ON public.equipos (delegado_id);
CREATE UNIQUE INDEX equipos_nombre_unico_por_categoria
  ON public.equipos (organizacion_id, categoria, nombre)
  WHERE estado <> 'Inactivo';
CREATE INDEX idx_jugadores_equipo_id ON public.jugadores (equipo_id);
CREATE INDEX idx_jugadores_cedula ON public.jugadores (cedula);
CREATE UNIQUE INDEX jugadores_dorsal_unico_por_equipo
  ON public.jugadores (equipo_id, numero_dorsal)
  WHERE estado <> 'Inactivo';
CREATE INDEX idx_partidos_torneo_id ON public.partidos (torneo_id);
CREATE INDEX idx_partidos_equipo_local_id ON public.partidos (equipo_local_id);
CREATE INDEX idx_partidos_equipo_visita_id ON public.partidos (equipo_visita_id);
CREATE INDEX idx_partidos_sede_id ON public.partidos (sede_id);
CREATE INDEX idx_partidos_arbitro_id ON public.partidos (arbitro_id);
CREATE INDEX idx_partidos_anotador_id ON public.partidos (anotador_id);
CREATE INDEX idx_partidos_capitan_local_id ON public.partidos (capitan_local_id);
CREATE INDEX idx_partidos_capitan_visita_id ON public.partidos (capitan_visita_id);
CREATE INDEX idx_partidos_partido_siguiente_id ON public.partidos (partido_siguiente_id);
CREATE INDEX idx_partidos_estado_fecha ON public.partidos (estado, fecha_hora);
CREATE INDEX idx_manos_partido_id ON public.manos (partido_id);
CREATE UNIQUE INDEX uq_manos_partido_numero ON public.manos (partido_id, numero_mano);
CREATE INDEX idx_detalle_jugadas_mano_id ON public.detalle_jugadas (mano_id);
CREATE INDEX idx_detalle_jugadas_jugador_id ON public.detalle_jugadas (jugador_id);
CREATE INDEX idx_tarjetas_partido_id ON public.tarjetas (partido_id);
CREATE INDEX idx_tarjetas_jugador_id ON public.tarjetas (jugador_id);
CREATE INDEX idx_notificaciones_organizacion_id ON public.notificaciones (organizacion_id);
CREATE INDEX idx_notificaciones_remitente_id ON public.notificaciones (remitente_id);
CREATE INDEX idx_notificaciones_destinatario_id ON public.notificaciones (destinatario_id);
CREATE INDEX idx_audit_logs_usuario_id ON public.audit_logs (usuario_id);
CREATE INDEX idx_audit_logs_accion ON public.audit_logs (accion);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at);
CREATE INDEX idx_audit_logs_organizacion_created_at ON public.audit_logs (organizacion_id, created_at DESC);
CREATE INDEX idx_torneo_equipos_torneo_id ON public.torneo_equipos (torneo_id);
CREATE INDEX idx_torneo_equipos_equipo_id ON public.torneo_equipos (equipo_id);
CREATE INDEX idx_usuario_organizaciones_org_id ON public.usuario_organizaciones (organizacion_id);
CREATE INDEX idx_login_intentos_bloqueado ON public.login_intentos (bloqueado_hasta);
CREATE INDEX idx_incidencias_partido_id ON public.incidencias_partido (partido_id);
CREATE INDEX idx_incidencias_usuario_id ON public.incidencias_partido (usuario_id);
CREATE INDEX idx_documentos_organizacion_id ON public.documentos (organizacion_id);
CREATE INDEX idx_documentos_torneo_id ON public.documentos (torneo_id);
CREATE INDEX documentos_globales_idx ON public.documentos (created_at DESC) WHERE organizacion_id IS NULL;
CREATE INDEX pagos_organizacion_idx ON public.pagos (organizacion_id, created_at DESC);
CREATE INDEX pagos_torneo_idx ON public.pagos (torneo_id);
CREATE INDEX sanciones_organizacion_idx ON public.sanciones (organizacion_id, created_at DESC);
CREATE INDEX sanciones_jugador_idx ON public.sanciones (jugador_id);
CREATE INDEX sanciones_partido_idx ON public.sanciones (partido_id);
CREATE INDEX protestas_organizacion_idx ON public.protestas (organizacion_id, created_at DESC);
CREATE INDEX protestas_partido_idx ON public.protestas (partido_id);
CREATE INDEX protestas_estado_idx ON public.protestas (organizacion_id, estado);
CREATE UNIQUE INDEX protestas_partido_equipo_unicas
  ON public.protestas (partido_id, equipo_protestante_id)
  WHERE ((estado)::text = ANY ((ARRAY['Pendiente'::character varying, 'Pendiente Confirmacion'::character varying, 'Resuelta'::character varying])::text[]));
CREATE INDEX votos_mvp_organizacion_idx ON public.votos_mvp (organizacion_id);
CREATE INDEX votos_mvp_torneo_idx ON public.votos_mvp (torneo_id);
CREATE INDEX idx_suscripciones_push_usuario ON public.suscripciones_push (usuario_id);
CREATE INDEX idx_firmas_acta_partido ON public.firmas_acta (partido_id);

-- ----------------------------------------------------------------------------
-- 6. TRIGGERS
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_avanzar_ronda AFTER INSERT OR UPDATE OF equipo_ganador_id ON public.resultados
  FOR EACH ROW WHEN ((new.equipo_ganador_id IS NOT NULL)) EXECUTE FUNCTION avanzar_ganador_a_siguiente_ronda();

CREATE TRIGGER trg_inactivo_en_jugadores BEFORE UPDATE ON public.jugadores
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.registrar_inactivo_en();
CREATE TRIGGER trg_inactivo_en_equipos BEFORE UPDATE ON public.equipos
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.registrar_inactivo_en();
CREATE TRIGGER trg_inactivo_en_sedes BEFORE UPDATE ON public.sedes
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.registrar_inactivo_en();
CREATE TRIGGER trg_inactivo_en_usuarios BEFORE UPDATE ON public.usuarios
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado) EXECUTE FUNCTION public.registrar_inactivo_en();

-- ----------------------------------------------------------------------------
-- 7. RLS Y POLITICAS
-- El backend consulta con la service role key (dueno de las tablas, no
-- afecto a RLS); estas politicas cubren el acceso directo desde el navegador.
-- ----------------------------------------------------------------------------
ALTER TABLE public.organizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.torneos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sedes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jugadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detalle_jugadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarjetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resultados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantillas_reglas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.torneo_equipos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_organizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_intentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planilla_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidencias_partido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sanciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protestas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votos_mvp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suscripciones_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firmas_acta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir lectura de perfil propio" ON public.usuarios
  FOR SELECT TO public
  USING (auth.uid() = id);

CREATE POLICY documentos_lectura_miembros ON public.documentos
  FOR SELECT TO authenticated
  USING (
    (organizacion_id IS NULL AND public.es_miembro_de_alguna_organizacion())
    OR public.es_miembro_organizacion(organizacion_id)
  );
CREATE POLICY documentos_insert_admin ON public.documentos
  FOR INSERT TO authenticated
  WITH CHECK (
    public.es_admin_organizacion(organizacion_id)
    OR (organizacion_id IS NULL AND public.es_superadmin())
  );
CREATE POLICY documentos_delete_admin ON public.documentos
  FOR DELETE TO authenticated
  USING (
    public.es_admin_organizacion(organizacion_id)
    OR (organizacion_id IS NULL AND public.es_superadmin())
  );

CREATE POLICY pagos_lectura_miembros ON public.pagos
  FOR SELECT TO authenticated
  USING (public.es_miembro_organizacion(organizacion_id));
CREATE POLICY pagos_insert_admin ON public.pagos
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin_organizacion(organizacion_id));
CREATE POLICY pagos_delete_admin ON public.pagos
  FOR DELETE TO authenticated
  USING (public.es_admin_organizacion(organizacion_id));

CREATE POLICY sanciones_lectura_miembros ON public.sanciones
  FOR SELECT TO authenticated
  USING (public.es_miembro_organizacion(organizacion_id));
CREATE POLICY sanciones_insert_admin ON public.sanciones
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin_organizacion(organizacion_id));
CREATE POLICY sanciones_update_admin ON public.sanciones
  FOR UPDATE TO authenticated
  USING (public.es_admin_organizacion(organizacion_id))
  WITH CHECK (public.es_admin_organizacion(organizacion_id));

CREATE POLICY protestas_lectura_miembros ON public.protestas
  FOR SELECT TO authenticated
  USING (public.es_miembro_organizacion(organizacion_id));
CREATE POLICY protestas_insert_miembros ON public.protestas
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_organizacion(organizacion_id));
CREATE POLICY protestas_update_admin ON public.protestas
  FOR UPDATE TO authenticated
  USING (public.es_admin_organizacion(organizacion_id))
  WITH CHECK (public.es_admin_organizacion(organizacion_id));

CREATE POLICY votos_mvp_lectura_miembros ON public.votos_mvp
  FOR SELECT TO authenticated
  USING (public.es_miembro_organizacion(organizacion_id));
CREATE POLICY votos_mvp_insert_miembros ON public.votos_mvp
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_organizacion(organizacion_id));

-- ----------------------------------------------------------------------------
-- 8. STORAGE: BUCKETS PRIVADOS Y POLITICAS DEL BUCKET documentos
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
SELECT 'firmas-actas', 'firmas-actas', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'firmas-actas');

CREATE POLICY "documentos_storage_lectura_miembros" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos'
    AND public.documentos_carpeta_legible(name)
  );
CREATE POLICY "documentos_storage_subida_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos'
    AND public.documentos_carpeta_escribible(name)
  );
CREATE POLICY "documentos_storage_borrado_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos'
    AND public.documentos_carpeta_escribible(name)
  );

-- ----------------------------------------------------------------------------
-- 9. TRIGGER DE AUTH (espejo de auth.users en public.usuarios)
--    Solo para proyectos Supabase con auth habilitado; en una BD limpia sin
--    esquema auth, comentar esta seccion.
-- ----------------------------------------------------------------------------
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 10. VERIFICACION (solo lectura, informativa)
-- Debe devolver 26 tablas, 0 CHECKs NOT VALID y RLS activo en todas.
-- ----------------------------------------------------------------------------
SELECT count(*) AS tablas_public
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

SELECT count(*) AS checks_sin_validar
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype = 'c' AND NOT convalidated;

SELECT relname AS tabla_con_rls
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relrowsecurity = true
ORDER BY relname;
