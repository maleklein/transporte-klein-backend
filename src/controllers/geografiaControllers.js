/**
 * Controlador del catálogo geográfico (PROVINCIA y LOCALIDAD).
 *
 * Alimenta los selectores de provincia y localidad del alta, la edición y el
 * filtro del listado. Los datos salen de nuestra propia base, no de la API
 * georef: el catálogo se siembra una vez con `scripts/sembrar-localidades.js`
 * y de ahí en más la app no depende de que datos.gob.ar esté disponible.
 */

const pool = require('../db');

/**
 * Cuánto puede cachear el navegador estas respuestas. El catálogo oficial
 * cambia muy de vez en cuando, así que un día es conservador y evita que cada
 * apertura del formulario vuelva a pedir las mismas 24 provincias.
 */
const CACHE_SEGUNDOS = 86400;

/**
 * GET /provincias: las 24 provincias, ordenadas por nombre.
 *
 * No lleva `requireRol`: el alta de cargas la usa un administrador, pero el
 * filtro del listado lo usa cualquier usuario logueado, incluido el camionero.
 *
 * Respuestas: 200 con el arreglo · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const listarProvincias = async (req, res) => {
    try {
        const resultado = await pool.query(
            `SELECT id_provincia AS id, nombre
             FROM PROVINCIA
             ORDER BY nombre`,
        );

        res.set('Cache-Control', `public, max-age=${CACHE_SEGUNDOS}`);
        res.json(resultado.rows);
    } catch (error) {
        console.error('Error al listar provincias:', error);
        res.status(500).json({ message: 'Error al obtener las provincias' });
    }
};

/**
 * GET /localidades?provincia=<id>: las localidades de una provincia, ordenadas
 * por nombre.
 *
 * `provincia` es obligatorio. Sin filtro serían más de 4000 filas de una, y no
 * hay ninguna pantalla que las necesite: el selector de localidad siempre
 * viene después de elegir la provincia.
 *
 * Devuelve el departamento junto con el nombre porque hay 68 pares
 * (provincia, localidad) repetidos en el país: sin él, el selector mostraría
 * dos opciones idénticas y no habría forma de distinguirlas.
 *
 * Respuestas: 200 con el arreglo · 400 si falta o es inválido el parámetro ·
 * 404 si la provincia no existe · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express, con `provincia` en la query.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const listarLocalidades = async (req, res) => {
    const provincia = typeof req.query.provincia === 'string' ? req.query.provincia.trim() : '';

    // El id de provincia son siempre dos dígitos ('02' para CABA). Chequearlo
    // acá evita una consulta que se sabe de antemano que no va a devolver nada.
    if (!/^\d{2}$/.test(provincia)) {
        return res.status(400).json({
            message: "Falta el parámetro 'provincia', o no es un id de provincia válido",
        });
    }

    try {
        const existe = await pool.query('SELECT 1 FROM PROVINCIA WHERE id_provincia = $1', [provincia]);

        if (existe.rows.length === 0) {
            return res.status(404).json({ message: `No existe la provincia ${provincia}` });
        }

        const resultado = await pool.query(
            `SELECT id_localidad AS id, nombre, departamento
             FROM LOCALIDAD
             WHERE id_provincia = $1
             ORDER BY nombre`,
            [provincia],
        );

        res.set('Cache-Control', `public, max-age=${CACHE_SEGUNDOS}`);
        res.json(resultado.rows);
    } catch (error) {
        console.error('Error al listar localidades:', error);
        res.status(500).json({ message: 'Error al obtener las localidades' });
    }
};

module.exports = {
    listarProvincias,
    listarLocalidades,
};
