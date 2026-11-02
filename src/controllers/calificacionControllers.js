const { emitirCalificacion, consultarViaje, consultarPerfil, ErrorCalificacion } = require('../services/calificaciones');

const responder = (accion, estado = 200) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return res.status(estado).json(await accion(req)); }
    catch (error) {
        if (error instanceof ErrorCalificacion) return res.status(error.estado).json({ message: error.message });
        console.error('Error en calificaciones:', error.code || error.name);
        return res.status(500).json({ message: 'No se pudo completar la operación de calificaciones. Intentá nuevamente.' });
    }
};
module.exports = {
    crear: responder((req) => emitirCalificacion(req.body, req.usuario), 201),
    consultarViaje: responder((req) => consultarViaje(req.params.id, req.usuario)),
    consultarPerfil: responder((req) => consultarPerfil(req.params.id, req.query.pagina, req.usuario)),
};
