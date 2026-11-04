/**
 * Middlewares de autenticación y autorización (GIA-39).
 *
 * `verifyToken` responde "¿quién sos?" y `requireRol` responde "¿podés hacer
 * esto?". Van siempre en ese orden en la definición de la ruta, porque el
 * segundo necesita el `req.usuario` que deja el primero.
 */

const jwt = require('jsonwebtoken');
const pool = require('../db');
const { SECRETO } = require('../config/jwt');

/**
 * Saca el token del header `Authorization: Bearer <token>`.
 *
 * Se acepta "Bearer" en cualquier combinación de mayúsculas porque el esquema
 * es insensible a mayúsculas según la RFC 7235, y algunos clientes lo mandan
 * en minúscula.
 *
 * @param {import('express').Request} req - request de Express.
 * @returns {string|null} el token, o null si el header falta o está mal armado.
 */
const extraerToken = (req) => {
    const header = req.header('Authorization');
    if (!header) return null;

    const partes = header.trim().split(/\s+/);
    if (partes.length !== 2 || partes[0].toLowerCase() !== 'bearer') return null;

    return partes[1] || null;
};

/**
 * Verifica el token y deja al usuario en `req.usuario` como `{ id, rol }`.
 *
 * No alcanza con validar la firma: el token dura 2 horas, así que un usuario
 * dado de baja seguiría entrando hasta que venza. Por eso se relee el usuario
 * de la base en cada pedido y se corta si ya no existe o quedó inactivo. Es
 * una consulta por id (clave primaria), así que el costo es despreciable.
 *
 * @param {import('express').Request} req - request de Express.
 * @param {import('express').Response} res - response de Express.
 * @param {import('express').NextFunction} next - siguiente middleware.
 * @returns {Promise<void>} 401 si el token falta, venció o es inválido;
 *   403 si la cuenta existe pero está inactiva.
 */
const verifyToken = async (req, res, next) => {
    const token = extraerToken(req);

    if (!token) {
        return res.status(401).json({ message: 'Falta el token de sesión. Iniciá sesión para continuar.' });
    }

    let payload;
    try {
        payload = jwt.verify(token, SECRETO);
    } catch (error) {
        // Se distingue el token vencido del inválido para que el frontend pueda
        // decir "se venció tu sesión" en vez de un genérico "no autorizado".
        const mensaje = error.name === 'TokenExpiredError'
            ? 'Tu sesión expiró. Volvé a iniciar sesión.'
            : 'El token de sesión no es válido.';
        return res.status(401).json({ message: mensaje });
    }

    try {
        const resultado = await pool.query(
            'SELECT id_usuario, rol, estado FROM USUARIO WHERE id_usuario = $1',
            [payload.id]
        );

        if (resultado.rows.length === 0) {
            return res.status(401).json({ message: 'El usuario de la sesión ya no existe.' });
        }

        const usuario = resultado.rows[0];
        if (usuario.estado !== 'activo') {
            return res.status(403).json({ message: 'La cuenta no está activa.' });
        }

        // El rol sale de la base, no del token: si a alguien le cambian el rol,
        // el cambio tiene efecto en el próximo pedido y no dentro de dos horas.
        req.usuario = { id: usuario.id_usuario, rol: usuario.rol };
        return next();
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * Deja pasar sólo a los roles indicados. Se usa después de `verifyToken`.
 *
 * @param {...string} rolesPermitidos - roles habilitados para la ruta.
 * @returns {import('express').RequestHandler} middleware que corta con 403 si el rol no alcanza.
 *
 * @example
 * app.post('/cargas', verifyToken, requireRol('administrador'), cargaControllers.crearCarga);
 */
const requireRol = (...rolesPermitidos) => (req, res, next) => {
    if (!req.usuario) {
        // Error de armado de la ruta, no del usuario: falta verifyToken adelante.
        console.error('requireRol se usó sin verifyToken delante.');
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    if (!rolesPermitidos.includes(req.usuario.rol)) {
        return res.status(403).json({ message: 'No tenés permisos para realizar esta acción.' });
    }

    return next();
};

module.exports = { verifyToken, requireRol };
