/**
 * Parámetros operativos y estimación económica de las cargas (HU 10).
 *
 * Lo que toca la base va acá, y la cuenta en `costos.js`, que es pura. Lo usan
 * las cargas (en los tres lugares donde se resuelven los kilómetros) y la
 * pantalla de parámetros del administrador.
 */

const pool = require('../db');
const { PARAMETROS_COSTO, calcularCostos } = require('./costos');

/**
 * Columnas de la estimación económica. Mismo criterio que `COLUMNAS_DISTANCIA`:
 * van en todas las consultas del administrador que devuelven una carga, para
 * que el detalle no pierda el bloque económico después de editarla, cambiarle
 * el estado o asignarla.
 *
 * El ingreso no se guarda: es costo + ganancia. `estimacion_economica` le dice
 * al front por qué falta la cuenta, en vez de dejarlo adivinar con un null:
 *   ok             → hay costo y ganancia.
 *   sin_distancia  → el cálculo de kilómetros está pendiente.
 *   sin_calcular   → hay kilómetros pero no se pudo estimar (por ejemplo, si
 *                    faltaba un parámetro). Se arregla recalculando.
 *
 * Al camionero no se le devuelven: son datos del negocio.
 */
const COLUMNAS_COSTOS = `
                    c.costo_estimado, c.ganancia_estimada,
                    c.costo_estimado + c.ganancia_estimada AS ingreso_estimado,
                    c.parametros_costo,
                    CASE WHEN c.costo_estimado IS NOT NULL THEN 'ok'
                         WHEN c.estado_calculo_km <> 'ok' OR c.kilometros_estimados IS NULL THEN 'sin_distancia'
                         ELSE 'sin_calcular' END AS estimacion_economica`;

/** Campos de `COLUMNAS_COSTOS`, para sacárselos a la respuesta del camionero. */
const CAMPOS_COSTOS = [
    'costo_estimado', 'ganancia_estimada', 'ingreso_estimado', 'parametros_costo', 'estimacion_economica',
];

/**
 * Lee los parámetros que usa la fórmula.
 *
 * @returns {Promise<Record<string, number>>} valor de cada clave presente en la tabla.
 */
const leerParametrosCosto = async () => {
    const resultado = await pool.query(
        'SELECT clave, valor FROM PARAMETRO_OPERATIVO WHERE clave = ANY($1::varchar[])',
        [PARAMETROS_COSTO]
    );
    // NUMERIC llega como texto desde el driver.
    return Object.fromEntries(resultado.rows.map((fila) => [fila.clave, Number(fila.valor)]));
};

/**
 * Estima costo y ganancia de un viaje con los parámetros vigentes.
 *
 * Igual que el cálculo de kilómetros, nunca hace fallar a quien la llama
 * (RN-04): si no hay kilómetros, falta un parámetro o la tabla no responde,
 * devuelve `null` y la carga se guarda sin estimación. Usa el pool y no la
 * transacción del alta a propósito: en Postgres, una consulta que falla dentro
 * de una transacción la deja inutilizable, y eso sí haría fallar el alta.
 *
 * @param {number|string|null} km - kilómetros ya calculados, o null.
 * @returns {Promise<ReturnType<typeof calcularCostos>>} la cuenta, o null.
 */
const estimarCostos = async (km) => {
    if (km === null || km === undefined) {
        return null;
    }

    try {
        return calcularCostos(km, await leerParametrosCosto());
    } catch (error) {
        console.error('No se pudo estimar el costo del viaje:', error.message);
        return null;
    }
};

module.exports = {
    COLUMNAS_COSTOS,
    CAMPOS_COSTOS,
    estimarCostos,
};
