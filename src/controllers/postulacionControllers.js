/**
 * Controlador del módulo de Postulaciones (HU 4).
 *
 * El camionero se postula a una carga abierta y sigue sus postulaciones; el
 * administrador ve quiénes se postularon a cada carga para elegir a quién
 * asignarla (HU 6, `asignacionControllers.js`).
 */
const pool = require('../db');
const { registrarCambioEstado } = require('../services/registrarCambioEstado');
const { COLUMNAS_UBICACION, JOIN_UBICACION } = require('../services/ubicacionCarga');
const { ESTADOS, ESTADOS_ABIERTOS } = require('../domain/estadosCarga');

/**
 * POST /cargas/:id/postulaciones: registra la postulación del camionero del
 * token a una carga.
 *
 * El camionero sale del token y nunca del body: si no, cualquiera podría
 * postular a otro. Su id de usuario es también su id en CAMIONERO, porque la
 * tabla hereda de USUARIO compartiendo la clave.
 *
 * La primera postulación pasa la carga de "disponible" a "pendiente" ("un
 * transportista pidió esta carga"), con el camionero como actor en la
 * bitácora. Las que llegan después la encuentran pendiente y no la mueven:
 * la carga sigue abierta hasta que el administrador la asigna. Todo va en una
 * transacción, con la carga bloqueada (`FOR UPDATE`): si dos camioneros se
 * postulan a la vez a una disponible, el segundo espera y ya la ve pendiente.
 *
 * Respuestas: 201 con la postulación · 400 si `id` no es numérico ·
 * 403 si el usuario no tiene perfil de camionero · 404 si la carga no existe ·
 * 409 si la carga ya no recibe postulaciones o si ya se había postulado ·
 * 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - Params: id (id de la carga). req.usuario lo provee verifyToken.
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const crearPostulacion = async (req, res) => {
    // 1. Extraemos el ID de la carga de la URL y el ID del camionero del token de sesión
    const idCarga = Number(req.params.id);
    const idCamionero = req.usuario.id;

    if (!Number.isInteger(idCarga) || idCarga <= 0) {
        return res.status(400).json({ message: "El parámetro 'id' de la carga debe ser numérico" });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 2. Validar que la carga exista y siga recibiendo postulaciones
        const cargaResult = await client.query(
            'SELECT estado_actual FROM CARGA WHERE id_carga = $1 FOR UPDATE',
            [idCarga]
        );

        if (cargaResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: `No existe una carga con id ${idCarga}` });
        }

        const estadoActual = cargaResult.rows[0].estado_actual;
        if (!ESTADOS_ABIERTOS.includes(estadoActual)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: 'La carga ya no se encuentra disponible para postulaciones' });
        }

        // 3. Insertar la postulación en la base de datos
        const insertResult = await client.query(
            `INSERT INTO POSTULACION (id_carga, id_camionero)
             VALUES ($1, $2)
             RETURNING id_postulacion, id_carga, id_camionero, estado, fecha_postulacion`,
            [idCarga, idCamionero]
        );

        // 4. La primera postulación pasa la carga a pendiente, con aviso al
        // administrador que la creó (HU 12, desde registrarCambioEstado).
        if (estadoActual === ESTADOS.DISPONIBLE) {
            await client.query(
                'UPDATE CARGA SET estado_actual = $1 WHERE id_carga = $2',
                [ESTADOS.PENDIENTE, idCarga]
            );
            await registrarCambioEstado(idCarga, ESTADOS.DISPONIBLE, ESTADOS.PENDIENTE, idCamionero, client);
        }

        await client.query('COMMIT');

        return res.status(201).json({
            message: 'Postulación registrada con éxito',
            postulacion: insertResult.rows[0],
        });
    } catch (error) {
        await client.query('ROLLBACK');

        // 23505: violación del UNIQUE (id_carga, id_camionero).
        if (error.code === '23505') {
            return res.status(409).json({ message: 'Ya te postulaste a esta carga.' });
        }
        // 23503: el usuario tiene rol de camionero pero no fila en CAMIONERO.
        if (error.code === '23503') {
            return res.status(403).json({ message: 'Tu usuario no tiene un perfil de camionero.' });
        }
        console.error('Error al crear postulación:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

/**
 * GET /cargas/:id/postulaciones: los camioneros que se postularon a una carga,
 * del primero al último. Es lo que mira el administrador para asignarla (HU 6).
 *
 * Trae lo que hace falta para elegir: nombre, vehículo, capacidad, dónde está
 * y si sigue disponible. La calificación queda para cuando exista la de la
 * HU 11.
 *
 * Respuestas: 200 con el array (vacío si nadie se postuló) · 400 si `id` no
 * es numérico · 404 si la carga no existe · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - Params: id (id de la carga).
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const listarPostulantes = async (req, res) => {
    const idCarga = Number(req.params.id);
    if (!Number.isInteger(idCarga) || idCarga <= 0) {
        return res.status(400).json({ message: "El parámetro 'id' de la carga debe ser numérico" });
    }

    try {
        const carga = await pool.query('SELECT 1 FROM CARGA WHERE id_carga = $1', [idCarga]);
        if (carga.rows.length === 0) {
            return res.status(404).json({ message: `No existe una carga con id ${idCarga}` });
        }

        const resultado = await pool.query(
            `SELECT p.id_postulacion, p.id_camionero, p.estado, p.fecha_postulacion,
                    u.nombre, u.apellido,
                    ca.tipo_vehiculo, ca.capacidad_kg, ca.ubicacion, ca.disponibilidad
             FROM POSTULACION p
             JOIN CAMIONERO ca ON ca.id_usuario = p.id_camionero
             JOIN USUARIO u ON u.id_usuario = p.id_camionero
             WHERE p.id_carga = $1
             ORDER BY p.fecha_postulacion, p.id_postulacion`,
            [idCarga]
        );

        return res.status(200).json(resultado.rows);
    } catch (error) {
        console.error('Error al listar postulantes:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * GET /postulaciones/mis-postulaciones: trae el historial de postulaciones del
 * camionero logueado, la más nueva primero.
 *
 * Cada una trae el estado de la postulación (pendiente, aceptada, rechazada) y
 * también el de la carga, para que "Mis viajes" pueda separar los viajes
 * asignados y avisar si una carga se canceló mientras esperaba.
 *
 * @param {import('express').Request} req - req.usuario lo provee verifyToken.
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const obtenerMisPostulaciones = async (req, res) => {
    const idCamionero = req.usuario.id;

    try {
        const result = await pool.query(
            `SELECT p.id_postulacion, p.estado, p.fecha_postulacion,
                    c.id_carga, c.tipo_carga, c.estado_actual,${COLUMNAS_UBICACION},
                    -- Sin el TO_CHAR el driver devuelve un Date de JS corrido
                    -- por la zona horaria local (mismo criterio que en cargas).
                    TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha_retiro
             FROM POSTULACION p
             JOIN CARGA c ON p.id_carga = c.id_carga${JOIN_UBICACION}
             WHERE p.id_camionero = $1
             ORDER BY p.fecha_postulacion DESC, p.id_postulacion DESC`,
            [idCamionero]
        );
        return res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener mis postulaciones:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { crearPostulacion, listarPostulantes, obtenerMisPostulaciones };
