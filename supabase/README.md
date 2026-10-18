# Endurecimiento de la base de datos (Supabase)

## Por qué RLS: el hueco que cierra

La anon key de Supabase es **pública**: viaja dentro del bundle del frontend.
En Supabase, los grants por defecto permiten a los roles `anon` y
`authenticated` leer y modificar **todas las tablas** vía la API REST
(PostgREST). Hoy, cualquiera con la anon key puede saltarse el backend
Express — con sus roles, su autenticación y su rate limiting — y consultar la
tabla `usuarios` completa (emails, cédulas, hashes de contraseñas).

## Arquitectura de accesos (verificada en el código)

| Camino | Rol | ¿Le afecta el RLS? |
|---|---|---|
| Backend Express (pool `pg`, `DATABASE_URL`) | `postgres` (BYPASSRLS) | No |
| Operaciones admin (`SUPABASE_SERVICE_ROLE_KEY`) | `service_role` (BYPASSRLS) | No |
| Frontend (`supabase.auth.*`) | Solo esquema `auth` | No |
| API REST de Supabase con la anon key | `anon` / `authenticated` | **Sí: queda bloqueada** |

Ninguna parte legítima del sistema consulta tablas vía PostgREST, por lo que
el RLS se aplica en modo **denegación total por defecto**: RLS habilitado en
todas las tablas y **cero políticas**. No hay nada que romper para los
caminos legítimos; el hueco queda cerrado.

## Lote I: cómo ejecutarlo

1. **Respaldo**: Dashboard → Database → Backups (tomar snapshot).
2. **Ventana tranquila** (sin partidos en vivo de ser posible).
3. SQL Editor → pegar y ejecutar completo
   `migrations/lote_i_rls_defensa_en_profundidad.sql`.
4. Confirmar en la sección 3 del script que todas las tablas quedan con
   `rls_activo = true`.

### Prueba de bloqueo (antes y después)

En una terminal, con la anon key (la misma del frontend):

```bash
curl "https://TU-PROYECTO.supabase.co/rest/v1/usuarios?select=id,email" \
     -H "apikey: TU_ANON_KEY" -H "Authorization: Bearer TU_ANON_KEY"
```

- **Antes**: devuelve la lista de usuarios (esto es el hueco).
- **Después**: `[]` (lista vacía) o error de permisos.

### Smoke tests post-migración (≈5 minutos)

1. Login de admin de liga (email + password).
2. Login de superadmin (email + password + código OTP).
3. Dashboard superadmin: métricas, usuarios y bitácora cargan.
4. Admin de liga: equipos y jugadores cargan; crear/editar un elemento.
5. Vista pública `/?vista=puntajes`: cargan los partidos activos.
6. Mensajería: enviar un mensaje directo.

Si algo falla → ejecutar la sección 4 del script (rollback) y revisar.

## Rollback

La sección 4 del `.sql` desactiva el RLS en todo `public` (descomentar y
ejecutar). Reversible en segundos.

## Notas de arquitectura

- La anon key sigue siendo necesaria para Supabase Auth: esto no la rompe.
- Si en el futuro el frontend consulta tablas directamente
  (`supabase.from(...)`), habrá que escribir políticas por rol usando el JWT
  (por ejemplo, anclar `organizacion_id` a los claims del usuario).
- El requisito para que nada se rompa es que `DATABASE_URL` conecte con el
  rol `postgres` (estándar en Supabase), que tiene BYPASSRLS.