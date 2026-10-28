/**
 * Controlador del módulo de Notificaciones (HU 12).
 *
 * Sólo consulta y marca como leídas: los avisos los genera
 * `services/notificaciones.js`, desde los endpoints que producen cada evento.
 * Cada usuario ve únicamente los suyos, sea administrador o camionero.
 */

const pool = require('../db');

/**
 * Cuántas notificaciones devuelve como máximo `GET /notificaciones`, de la
 * más nueva para atrás.
 *
 * El contador de la barra superior consulta este endpoint cada medio minuto
 * por cada usuario conectado, y cada carga nueva le deja un aviso a cada
 * camionero: sin tope, la respuesta crecería para siempre. Con 100 alcanza
 * para el centro de notificaciones, y el contador muestra "99+" de ahí en más.
 */
const MAXIMO_NOTIFICACIONES = 100;

/**
 * Interpreta el query param `solo_no_leidas`.
 *
 * @param {*} valor - lo que llegó en `req.query.solo_no_leidas`.
 * @returns {boolean|null} true o false; null si el valor no se entiende.
 */
const leerSoloNoLeidas = (valor) => {
    if (valor === undefined) return false;

    const texto = String(valor).trim().toLowerCase();
    if (texto === 'true' || texto === '1') return true;
    if (texto === 'false' || texto === '0' || texto === '') return false;
    return null;
};

/**
 * GET /notificaciones (HU 12): devuelve las notificaciones del usuario del
 * token, de la más reciente a la más vieja.
 *
 * Acepta `solo_no_leidas=true` para traer únicamente las que faltan leer, que
 * es lo que usa el contador de la barra superior. Devuelve como mucho
 * `MAXIMO_NOTIFICACIONES`.
 *
 * Respuestas: 200 con el array (vacío si no tiene ninguna) · 400 si
 * `solo_no_leidas` no es true ni false · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express. Query param opcional: solo_no_leidas.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const listarNotificaciones = async (req, res) => {
    const soloNoLeidas = leerSoloNoLeidas(req.query.solo_no_leidas);
    if (soloNoLeidas === null) {
        return res.status(400).json({ message: "El filtro 'solo_no_leidas' debe ser 'true' o 'false'" });
    }

    try {
        const resultado = await pool.query(
            `SELECT id_notificacion, tipo_evento, contenido, id_carga, leida, creado_en
             FROM NOTIFICACION
             WHERE id_usuario = $1
               AND ($2 = false OR leida = false)
             -- El id desempata los avisos de una misma transacción, que
             -- comparten creado_en: sin él, su orden cambiaría entre pedidos.
             ORDER BY creado_en DESC, id_notificacion DESC
             LIMIT $3`,
            [req.usuario.id, soloNoLeidas, MAXIMO_NOTIFICACIONES]
        );

        return res.status(200).json(resultado.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * PUT /notificaciones/:id/leida (HU 12): marca como leída una notificación del
 * usuario del token.
 *
 * La pertenencia se valida en el mismo UPDATE: la condición sobre
 * `id_usuario` hace que una notificación ajena no se encuentre, igual que una
 * que no existe. Se responde 404 en los dos casos para no confirmarle a nadie
 * que hay un aviso de otro usuario con ese id (mismo criterio que
 * `obtenerCarga` con el camionero).
 *
 * Marcar una que ya estaba leída no es un error: responde 200 igual.
 *
 * Respuestas: 200 con la notificación actualizada · 400 si `id` no es
 * numérico · 404 si no existe o es de otro usuario · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express. Params: id.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const marcarNotificacionLeida = async (req, res) => {
    const idNotificacion = Number(req.params.id);
    if (!Number.isInteger(idNotificacion) || idNotificacion <= 0) {
        return res.status(400).json({ message: "El parámetro 'id' debe ser numérico" });
    }

    try {
        const resultado = await pool.query(
            `UPDATE NOTIFICACION
             SET leida = true
             WHERE id_notificacion = $1 AND id_usuario = $2
             RETURNING id_notificacion, tipo_evento, contenido, id_carga, leida, creado_en`,
            [idNotificacion, req.usuario.id]
        );

        if (resultado.rows.length === 0) {
            return res.status(404).json({ message: `No existe una notificación con id ${idNotificacion}` });
        }

        return res.status(200).json(resultado.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    listarNotificaciones,
    marcarNotificacionLeida,
};
