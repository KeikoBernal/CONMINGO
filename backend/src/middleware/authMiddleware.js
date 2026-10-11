const db = require('../config/db');

const verificarToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado o inválido.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    // Validar token con Supabase o decodificar según implementes
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido o expirado.' });
    }

    // Buscar información extendida del usuario en la base de datos local (incluyendo organizacion_id y rol)
    const userQuery = await db.query(
      `SELECT id, email, rol, organizacion_id, nombre FROM public.usuarios WHERE id = $1`, 
      [user.id]
    );

    if (userQuery.rows.length === 0) {
      // FIX #3: nunca confiar en user_metadata (la controla el cliente al registrarse).
      // Sin registro en la tabla usuarios no hay rol confiable: se rechaza el acceso.
      return res.status(403).json({ error: 'Usuario autenticado pero no registrado en el sistema. Contacta al administrador.' });
    }

    req.usuario = userQuery.rows[0];

    next();
  } catch (err) {
    console.error('Error en autenticación:', err);
    return res.status(401).json({ error: 'Error al procesar la autenticación.' });
  }
};

// FIX #10: normalización de roles (acentos, mayúsculas y espacios), igual que en mensajería,
// para que 'Árbitro', 'Arbitro' y 'árbitro' sean equivalentes al autorizar.
const normalizarRol = (rol) => (rol || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const autorizarRoles = (...rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.usuario || !rolesPermitidos.some(rol => normalizarRol(rol) === normalizarRol(req.usuario.rol))) {
      return res.status(403).json({ error: 'No tienes permisos para realizar esta acción.' });
    }
    next();
  };
};

module.exports = { verificarToken, autorizarRoles };