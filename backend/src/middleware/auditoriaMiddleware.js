// ============================================================
// LOTE 8A: middleware de auditoria automatica unificado.
// La bitacora (public.audit_logs) deja de depender de que cada
// archivo de rutas recuerde llamar a registrarAuditoria: cualquier
// escritura autenticada de cualquier rol queda registrada siempre,
// con quien la hizo (usuario_id), que endpoint toco (accion), a que
// familia de rutas pertenece (tabla), desde que IP y de que
// organizacion. Las lecturas solo se registran cuando son sensibles
// (decision de Keiko: los GET comunes llenarian la bitacora de
// ruido). El cuerpo de la peticion NUNCA se registra: puede traer
// contrasenas; solo se guardan los parametros de ruta.
// ============================================================
const { registrarAuditoria } = require('../utilidades/auditoria');

const METODOS_ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// GETs sensibles que SI se auditan (rutas relativas a /api).
const GETS_SENSIBLES = [
  /^\/superadmin\/ligas\/[^/]+\/detalle$/
];

const middlewareAuditoriaAutomatica = (req, res, next) => {
  // La ruta se captura ANTES de que los routers la recorten: es la
  // vista estable del endpoint (/superadmin/ligas, /operativo/partidos...).
  const metodo = req.method;
  const ruta = req.path;
  res.on('finish', () => {
    try {
      // Solo peticiones autenticadas: verificarToken resolvio req.usuario
      // durante el enrutado; sin usuario no hay a quien atribuir la accion
      // (publico y login-proxy quedan fuera, cada uno con su propio registro).
      if (!req.usuario || !req.usuario.id) return;
      // El AdminLiga ya audita TODAS sus peticiones con su propio middleware
      // (con rutas relativas que alimentan las traducciones de su bitacora):
      // no se duplica aqui.
      if (ruta.startsWith('/admin-liga')) return;
      // Solo acciones realizadas, el mismo criterio que usa el AdminLiga.
      if (res.statusCode >= 400) return;
      const esEscritura = METODOS_ESCRITURA.has(metodo);
      const esGetSensible = metodo === 'GET' && GETS_SENSIBLES.some((re) => re.test(ruta));
      if (!esEscritura && !esGetSensible) return;
      const familia = ruta.split('/')[1] || 'api';
      registrarAuditoria(
        req.usuario.id,
        metodo + ' ' + ruta,
        familia,
        null,
        { status: res.statusCode, parametros: req.params },
        req.ip,
        req.usuario.organizacion_id || null
      );
    } catch (_) {
      // La auditoria nunca rompe la respuesta; a lo sumo el propio
      // registrarAuditoria deja el error en el log del servidor.
    }
  });
  next();
};

module.exports = { middlewareAuditoriaAutomatica };
