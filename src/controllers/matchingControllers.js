const { calcularRanking, ErrorMatching } = require('../services/matching');

/** GET /matching/:idCarga. La ruta aplica autenticación y rol administrador. */
async function obtenerSugerencias(req, res) {
    if (!/^[1-9]\d*$/.test(req.params.idCarga) || !Number.isSafeInteger(Number(req.params.idCarga))) {
        return res.status(400).json({ message: 'El id de la carga debe ser un entero positivo.' });
    }
    try {
        const ranking = await calcularRanking(req.params.idCarga);
        res.set('Cache-Control', 'no-store');
        return res.status(200).json(ranking);
    } catch (error) {
        if (error instanceof ErrorMatching) return res.status(error.estado).json({ message: error.message });
        // No registrar datos de conexión ni contenido personal del candidato.
        console.error('Error al calcular matching:', error.code ?? error.name);
        return res.status(500).json({ message: 'No se pudieron obtener los camioneros sugeridos.' });
    }
}

module.exports = { obtenerSugerencias };
