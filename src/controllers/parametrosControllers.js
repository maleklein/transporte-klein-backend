/**
 * Controlador de Parámetros operativos (HU 10).
 *
 * El administrador consulta y cambia los valores de la fórmula de costos sin
 * tocar el código. Cambiarlos NO recalcula las cargas que ya tienen su
 * estimación: cada carga guarda la cuenta como foto del momento en que se
 * calculó (ver el README). Los valores nuevos se usan desde la próxima vez que
 * se calculen kilómetros.
 */

const pool = require('../db');
const { PARAMETROS_COSTO } = require('../services/costos');
const { validarParametros } = require('../validators/parametros');

/**
 * Lee los parámetros de la fórmula, en el orden de `PARAMETROS_COSTO`.
 *
 * @returns {Promise<Array<{clave: string, valor: number, descripcion: string|null, actualizado_en: Date}>>}
 */
const listarParametros = async () => {
    const resultado = await pool.query(
        `SELECT clave, valor, descripcion, actualizado_en
         FROM PARAMETRO_OPERATIVO
         WHERE clave = ANY($1::varchar[])
         ORDER BY array_position($1::varchar[], clave)`,
        [PARAMETROS_COSTO]
    );
    // NUMERIC llega como texto desde el driver; acá son valores de un
    // formulario, así que se devuelven como número.
    return resultado.rows.map((fila) => ({ ...fila, valor: Number(fila.valor) }));
};

/**
 * GET /parametros-operativos (HU 10): devuelve los valores vigentes con su
 * descripción y la fecha de la última modificación.
 *
 * Respuestas: 200 con el array · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const obtenerParametros = async (req, res) => {
    try {
        return res.status(200).json(await listarParametros());
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * PUT /parametros-operativos (HU 10): reemplaza los tres valores de la fórmula.
 *
 * Body: `{ costo_por_km, peaje_por_km, tarifa_por_km }`, los tres obligatorios,
 * numéricos y mayores a cero.
 *
 * `actualizado_en` sólo se toca en los que cambiaron de valor: es la "última
 * modificación" que muestra la pantalla, y guardar sin cambiar nada no es
 * modificar. Es un único INSERT ... ON CONFLICT, así que si por algún motivo
 * faltaba una fila en la tabla, la crea en vez de ignorarla.
 *
 * Respuestas: 200 con los parámetros ya actualizados · 400 si hay campos
 * inválidos · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
const actualizarParametros = async (req, res) => {
    const { errores, valores } = validarParametros(req.body);
    if (Object.keys(errores).length > 0) {
        return res.status(400).json({ message: 'Hay campos con errores', errores });
    }

    try {
        await pool.query(
            `INSERT INTO PARAMETRO_OPERATIVO AS p (clave, valor)
             SELECT * FROM UNNEST($1::varchar[], $2::numeric[])
             ON CONFLICT (clave) DO UPDATE
                 SET valor = EXCLUDED.valor, actualizado_en = CURRENT_TIMESTAMP
                 WHERE p.valor <> EXCLUDED.valor`,
            [PARAMETROS_COSTO, PARAMETROS_COSTO.map((clave) => valores[clave])]
        );

        return res.status(200).json(await listarParametros());
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { obtenerParametros, actualizarParametros };
