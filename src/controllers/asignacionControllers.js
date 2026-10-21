/**
 * Controlador de la asignación de cargas (HU 6).
 *
 * El administrador elige a uno de los camioneros que se postularon (HU 4) y
 * la carga pasa a "aceptada" con ese camionero asignado.
 */
const pool = require('../db');
const { registrarCambioEstado } = require('../services/registrarCambioEstado');
const { notificarAsignacion } = require('../services/notificaciones');
const { COLUMNAS_UBICACION, JOIN_UBICACION } = require('../services/ubicacionCarga');
const { ESTADOS } = require('../domain/estadosCarga');

/**
 * POST /cargas/:id/asignar: asigna una carga a uno de sus camioneros postulados.
 * Body: `{ id_camionero }`.
 *
 * Todo va en una sola transacción, con un `client` de `pool.connect()`: con
 * `pool.query('BEGIN')` cada consulta puede salir por otra conexión del pool y
 * no habría nada que deshacer si algo falla a mitad de camino.
 *
 * Sólo se asigna una carga pendiente, que es la que tiene postulaciones, y
 * sólo a un camionero con una postulación pendiente en ella y la cuenta
 * activa. Al asignar:
 * - la carga pasa a "aceptada" por la máquina de estados y queda en la
 *   bitácora con el administrador como actor (HU 8);
 * - la postulación elegida pasa a "aceptada" y las demás a "rechazada";
 * - avisa al camionero elegido, al administrador y a los rechazados (HU 12).
 *
 * RN-02 (un solo camionero activo por carga) la garantiza el esquema, porque
 * el asignado es una sola columna, y acá se rechaza asignar una carga que ya
 * tiene camionero. La fila queda bloqueada (`FOR UPDATE`) para que dos
 * administradores no puedan asignarla a la vez.
 *
 * Respuestas: 200 con la carga actualizada · 400 si el id de la carga o el
 * del camionero no son válidos · 404 si la carga no existe · 409 si la carga no
 * está pendiente, ya tiene camionero, o el camionero no está postulado o no
 * tiene la cuenta activa · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - Params: id (id de la carga). Body: { id_camionero }.
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const asignarCamionero = async (req, res) => {
    const idCarga = Number(req.params.id);
    if (!Number.isInteger(idCarga) || idCarga <= 0) {
        return res.status(400).json({ message: "El parámetro 'id' de la carga debe ser numérico" });
    }

    const idCamionero = Number(req.body?.id_camionero);
    if (!Number.isInteger(idCamionero) || idCamionero <= 0) {
        return res.status(400).json({ message: "El campo 'id_camionero' es obligatorio y debe ser numérico" });
    }

    const idAdmin = req.usuario.id;
    const client = await pool.connect();

    try {
        // Iniciamos una transacción SQL para que si algo falla, no se guarde nada a medias
        await client.query('BEGIN');

        // 1. Validar que la carga exista, esté pendiente y no tenga otro camionero asignado
        const cargaRes = await client.query(
            'SELECT estado_actual, id_camionero_asignado FROM CARGA WHERE id_carga = $1 FOR UPDATE',
            [idCarga]
        );

        if (cargaRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: `No existe una carga con id ${idCarga}` });
        }

        const carga = cargaRes.rows[0];
        if (carga.id_camionero_asignado !== null) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'Esta carga ya tiene un camionero asignado de forma activa.' });
        }

        if (carga.estado_actual !== ESTADOS.PENDIENTE) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                message: `Sólo se puede asignar una carga pendiente, es decir, con postulaciones. Esta está en '${carga.estado_actual}'.`,
            });
        }

        // 2. Validar que el camionero se haya postulado y pueda tomar el viaje
        const postulacionRes = await client.query(
            `SELECT p.id_postulacion, u.estado AS estado_cuenta
             FROM POSTULACION p
             JOIN USUARIO u ON u.id_usuario = p.id_camionero
             WHERE p.id_carga = $1 AND p.id_camionero = $2 AND p.estado = 'pendiente'
             FOR UPDATE OF p`,
            [idCarga, idCamionero]
        );

        if (postulacionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'Ese camionero no tiene una postulación pendiente para esta carga.' });
        }

        const { id_postulacion: idPostulacion, estado_cuenta: estadoCuenta } = postulacionRes.rows[0];
        if (estadoCuenta !== 'activo') {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'La cuenta de ese camionero no está activa.' });
        }

        // 3. Pasar la carga a aceptada y dejarlo en la bitácora. Va antes de
        // asignar el camionero a propósito: el aviso de cambio de estado les
        // llega a las partes de la carga, y si el camionero ya figurara como
        // asignado recibiría dos avisos por lo mismo. El suyo es el de la
        // asignación, que además trae los datos del viaje.
        await client.query(
            'UPDATE CARGA SET estado_actual = $1 WHERE id_carga = $2',
            [ESTADOS.ACEPTADA, idCarga]
        );
        await registrarCambioEstado(idCarga, ESTADOS.PENDIENTE, ESTADOS.ACEPTADA, idAdmin, client);

        // 4. Asignar el camionero. Devuelve la carga entera, con el catálogo
        // resuelto, para que el detalle se redibuje sin recargar.
        const resultado = await client.query(
            `WITH modificada AS (
                 UPDATE CARGA
                 SET id_camionero_asignado = $1
                 WHERE id_carga = $2
                 RETURNING *
             )
             SELECT c.id_carga,${COLUMNAS_UBICACION},
                    c.tipo_carga, c.peso_kg,
                    TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
                    c.observaciones, c.estado_actual, c.id_camionero_asignado,
                    c.id_admin_creador, c.creado_en, c.actualizado_en
             FROM modificada c${JOIN_UBICACION}`,
            [idCamionero, idCarga]
        );

        // 5. La postulación elegida pasa a aceptada y las demás a rechazada
        await client.query(
            "UPDATE POSTULACION SET estado = 'aceptada' WHERE id_postulacion = $1",
            [idPostulacion]
        );
        const rechazadas = await client.query(
            `UPDATE POSTULACION SET estado = 'rechazada'
             WHERE id_carga = $1 AND id_postulacion <> $2 AND estado = 'pendiente'
             RETURNING id_camionero`,
            [idCarga, idPostulacion]
        );

        // 6. Avisos de la HU 12: al camionero asignado, al administrador y a los rechazados
        await notificarAsignacion(
            idCarga,
            idCamionero,
            idAdmin,
            rechazadas.rows.map((fila) => fila.id_camionero),
            client
        );

        // Confirmamos la transacción
        await client.query('COMMIT');
        return res.status(200).json(resultado.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error al asignar carga:', error);
        return res.status(500).json({ message: 'Error interno del servidor al intentar asignar la carga.' });
    } finally {
        client.release();
    }
};

module.exports = { asignarCamionero };
