const pool = require('../db'); 

/**
 * POST /asignaciones: Asigna una carga a un camionero, cambia estados y notifica.
 */
const asignarCamionero = async (req, res) => {
    const { id_carga, id_camionero } = req.body;
    const id_admin = req.usuario.id;

    try {
        // Iniciamos una transacción SQL para que si algo falla, no se guarde nada a medias
        await pool.query('BEGIN');

        // 1. Validar que la carga exista y no tenga otro camionero asignado
        const cargaRes = await pool.query(
            'SELECT estado_actual, id_camionero_asignado FROM CARGA WHERE id_carga = $1 FOR UPDATE', 
            [id_carga]
        );
        
        if (cargaRes.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.status(404).json({ message: 'Carga no encontrada' });
        }

        const carga = cargaRes.rows[0];
        if (carga.id_camionero_asignado) {
            await pool.query('ROLLBACK');
            return res.status(400).json({ message: 'Esta carga ya tiene un camionero asignado de forma activa.' });
        }

        // 2. Actualizar la CARGA: asignar el camionero y cambiar estado a 'aceptada'
        const estadoAnterior = carga.estado_actual;
        const estadoNuevo = 'aceptada';

        await pool.query(
            'UPDATE CARGA SET estado_actual = $1, id_camionero_asignado = $2 WHERE id_carga = $3',
            [estadoNuevo, id_camionero, id_carga]
        );

        // 3. Registrar la auditoría en el historial del sistema (ESTADO_CARGA)
        await pool.query(
            'INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor) VALUES ($1, $2, $3, $4)',
            [id_carga, estadoAnterior, estadoNuevo, id_admin]
        );

        // 4. Actualizar el estado de la POSTULACION elegida a 'aceptada'
        await pool.query(
            'UPDATE POSTULACION SET estado = $1 WHERE id_carga = $2 AND id_camionero = $3',
            ['aceptada', id_carga, id_camionero]
        );

        // 5. Generar notificación automática al camionero asignado
        const mensajeNotificacion = `¡Felicitaciones! Has sido asignado para transportar la carga #${id_carga}.`;
        await pool.query(
            'INSERT INTO NOTIFICACION (id_usuario_destino, tipo_evento, mensaje) VALUES ($1, $2, $3)',
            [id_camionero, 'asignacion_carga', mensajeNotificacion]
        );

        // Confirmamos la transacción
        await pool.query('COMMIT');
        return res.status(200).json({ message: 'Carga asignada exitosamente al camionero.' });

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Error al asignar carga:', error);
        return res.status(500).json({ message: 'Error interno del servidor al intentar asignar la carga.' });
    }
};

module.exports = { asignarCamionero };