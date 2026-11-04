/**
 * Controlador de la ruta de salud del backend.
 *
 * La consulta Railway antes de pasar el tráfico a una versión nueva (healthcheck
 * del deploy). El servidor arranca aunque la base no responda, así que sin esta
 * ruta un deploy con mal las variables `DB_*` se daría por bueno y recién
 * fallaría con el primer pedido real.
 */

const pool = require('../db');

/**
 * GET /health: confirma que el servidor está arriba y que la base contesta.
 *
 * Es pública a propósito: Railway la llama sin token. No devuelve datos de la
 * base ni detalles del error, solo si está disponible o no.
 *
 * Respuestas: 200 si la base responde · 503 si no se puede consultar.
 *
 * @param {import('express').Request} req - request de Express.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const verificarSalud = async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ estado: 'ok' });
    } catch (error) {
        console.error('Healthcheck: la base no responde:', error.code ?? error.name);
        res.status(503).json({ estado: 'sin_base', message: 'La base de datos no responde.' });
    }
};

module.exports = { verificarSalud };
