/**
 * Controlador del módulo de Postulaciones (HU 4).
 */
const pool = require('../db');

/**
 * POST /cargas/:id/postulaciones: registra la postulación de un camionero a una carga.
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

    try {
        // 2. Validar que la carga exista y esté en estado 'disponible'[cite: 1]
        const cargaResult = await pool.query(
            'SELECT estado_actual FROM CARGA WHERE id_carga = $1',
            [idCarga]
        );

        if (cargaResult.rows.length === 0) {
            return res.status(404).json({ message: `No existe una carga con id ${idCarga}` });
        }

        if (cargaResult.rows[0].estado_actual !== 'disponible') {
            return res.status(400).json({ message: 'La carga ya no se encuentra disponible para postulaciones' });
        }

        // 3. Insertar la postulación en la base de datos
        const insertResult = await pool.query(
            `INSERT INTO POSTULACION (id_carga, id_camionero, estado)
             VALUES ($1, $2, 'pendiente')
             RETURNING id_postulacion, id_carga, id_camionero, estado, fecha_postulacion`,
            [idCarga, idCamionero]
        );

        return res.status(201).json({
            message: 'Postulación registrada con éxito',
            postulacion: insertResult.rows[0]
        });

    } catch (error) {
        // 4. Capturar el error 23505: Violación de la restricción UNIQUE que creaste en SQL[cite: 1]
        if (error.code === '23505') {
            return res.status(400).json({ message: 'Ya te has postulado a esta carga anteriormente' });
        }
        console.error('Error al crear postulación:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};


/**
 * GET /postulaciones/mis-postulaciones: trae el historial de postulaciones del camionero logueado.
 */
const obtenerMisPostulaciones = async (req, res) => {
    const idCamionero = req.usuario.id;

    try {
        const result = await pool.query(
            `SELECT p.id_postulacion, p.estado, p.fecha_postulacion,
                    c.id_carga, c.origen, c.destino, c.tipo_carga, c.fecha as fecha_retiro
             FROM POSTULACION p
             JOIN CARGA c ON p.id_carga = c.id_carga
             WHERE p.id_camionero = $1
             ORDER BY p.fecha_postulacion DESC`,
            [idCamionero]
        );
        return res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error al obtener mis postulaciones:', error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { crearPostulacion, obtenerMisPostulaciones };
