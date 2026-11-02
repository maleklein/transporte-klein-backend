/**
 * Estimación económica de un viaje (HU 10).
 *
 * Función pura a propósito: no conoce la base ni Express. Recibe los
 * kilómetros y los parámetros y devuelve la cuenta, así el criterio de
 * reproducibilidad se puede probar con datos fijos (`tests/costos.test.js`)
 * sin levantar nada. La fórmula está escrita también en el README, que es
 * contra lo que se verifica.
 */

/** Claves de PARAMETRO_OPERATIVO que usa la fórmula, en el orden en que se muestran. */
const PARAMETROS_COSTO = ['costo_por_km', 'peaje_por_km', 'tarifa_por_km'];

/**
 * Redondea a centavos. Se redondea cada monto antes de restar, para que la
 * ganancia sea exactamente ingreso − costo con los montos que se muestran, y
 * no difiera en un centavo de la cuenta que haría alguien con calculadora.
 *
 * @param {number} valor
 * @returns {number}
 */
const aCentavos = (valor) => Math.round(valor * 100) / 100;

/**
 * Calcula costo, ingreso y ganancia estimados de un viaje.
 *
 *   costo    = km × (costo_por_km + peaje_por_km)
 *   ingreso  = km × tarifa_por_km
 *   ganancia = ingreso − costo
 *
 * Sin kilómetros no hay estimación: devuelve `null` en vez de una cuenta sobre
 * cero, que mostraría un viaje gratis. La ganancia puede ser negativa si la
 * tarifa no cubre el costo: es un dato, no un error.
 *
 * @param {number|string|null} km - kilómetros del viaje (NUMERIC llega como texto del driver).
 * @param {Record<string, number|string>} parametros - los de `PARAMETROS_COSTO`.
 * @returns {{costo_estimado: number, ingreso_estimado: number, ganancia_estimada: number,
 *            parametros: Record<string, number>}|null} la cuenta, o null si no hay kilómetros.
 * @throws {TypeError} si los kilómetros no son un número válido o falta algún parámetro.
 */
const calcularCostos = (km, parametros) => {
    if (km === null || km === undefined) {
        return null;
    }

    const distancia = Number(km);
    if (!Number.isFinite(distancia) || distancia < 0) {
        throw new TypeError(`Kilómetros inválidos: ${km}`);
    }

    const usados = {};
    for (const clave of PARAMETROS_COSTO) {
        const valor = Number(parametros?.[clave]);
        if (parametros?.[clave] === null || parametros?.[clave] === undefined || !Number.isFinite(valor) || valor <= 0) {
            throw new TypeError(`Falta el parámetro '${clave}' o no es un número positivo`);
        }
        usados[clave] = valor;
    }

    const costo = aCentavos(distancia * (usados.costo_por_km + usados.peaje_por_km));
    const ingreso = aCentavos(distancia * usados.tarifa_por_km);

    return {
        costo_estimado: costo,
        ingreso_estimado: ingreso,
        ganancia_estimada: aCentavos(ingreso - costo),
        parametros: usados,
    };
};

module.exports = { PARAMETROS_COSTO, calcularCostos };
