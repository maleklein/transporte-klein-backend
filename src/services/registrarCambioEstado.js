/**
 * Servicio de bitácora de estados de carga (HU 8).
 * Deja registrado cada cambio de estado en ESTADO_CARGA y avisa del cambio a
 * las partes de la carga (HU 12).
 */

const { notificarCambioEstado } = require('./notificaciones');

/**
 * Inserta un registro de cambio de estado para una carga.
 *
 * No abre transacción propia: recibe el `client` de una transacción ya
 * iniciada por quien llama (por ejemplo, el endpoint que cambia el estado de
 * la carga), para que el UPDATE de la carga y este INSERT se confirmen o se
 * deshagan juntos.
 *
 * Además guarda, en la misma transacción, el aviso del cambio para las partes
 * de la carga (HU 12). Se engancha acá y no en cada endpoint porque todo
 * cambio de estado pasa por la bitácora: así ninguna transición, de hoy o
 * futura, se queda sin aviso por olvido.
 *
 * @param {number} idCarga - id de la carga a la que pertenece el cambio.
 * @param {string|null} estadoAnterior - estado antes del cambio, o null si es el alta.
 * @param {string} estadoNuevo - estado luego del cambio.
 * @param {number|null} idActor - id del usuario responsable, o null si el cambio lo hizo el sistema.
 * @param {import('pg').PoolClient} client - client de la transacción abierta por quien llama.
 * @returns {Promise<object>} la fila insertada en ESTADO_CARGA.
 */
const registrarCambioEstado = async (idCarga, estadoAnterior, estadoNuevo, idActor, client) => {
    const resultado = await client.query(
        `INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor)
         VALUES ($1, $2, $3, $4)
         RETURNING id_estado_carga, id_carga, estado_anterior, estado_nuevo, id_actor, marca_tiempo`,
        [idCarga, estadoAnterior, estadoNuevo, idActor]
    );

    await notificarCambioEstado(idCarga, estadoAnterior, estadoNuevo, idActor, client);

    return resultado.rows[0];
};

module.exports = { registrarCambioEstado };
