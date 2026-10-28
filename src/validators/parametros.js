/**
 * Validación del body de PUT /parametros-operativos (HU 10).
 *
 * Síncrona y sin acceso a la base, igual que `validators/carga.js`: devuelve
 * los errores agrupados por campo para que la pantalla muestre cada mensaje
 * debajo de su input.
 */

const { PARAMETROS_COSTO } = require('../services/costos');

/** Tope de NUMERIC(12, 4): ocho dígitos enteros. Más grande, Postgres da un 500. */
const VALOR_MAXIMO = 99999999.9999;

/** Hasta cuatro decimales, que es lo que guarda la columna. */
const FORMATO_DECIMALES = /^\d+(\.\d{1,4})?$/;

/**
 * Valida los tres parámetros de la fórmula. Se piden los tres siempre, igual
 * que la edición de una carga pide sus seis campos: la pantalla los muestra
 * juntos y los guarda juntos.
 *
 * Acepta números o texto numérico ("1800.5"), porque un input del navegador
 * puede mandar cualquiera de los dos. No acepta coma decimal: el front ya
 * manda el número con punto.
 *
 * @param {object} body - lo que llegó en `req.body`.
 * @returns {{errores: Record<string, string>, valores: Record<string, number>}}
 */
const validarParametros = (body) => {
    const errores = {};
    const valores = {};

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        for (const clave of PARAMETROS_COSTO) {
            errores[clave] = `El campo '${clave}' es obligatorio`;
        }
        return { errores, valores };
    }

    for (const clave of Object.keys(body)) {
        if (!PARAMETROS_COSTO.includes(clave)) {
            errores[clave] = `'${clave}' no es un parámetro operativo`;
        }
    }

    for (const clave of PARAMETROS_COSTO) {
        const crudo = body[clave];

        if (crudo === undefined || crudo === null || (typeof crudo === 'string' && crudo.trim() === '')) {
            errores[clave] = `El campo '${clave}' es obligatorio`;
            continue;
        }

        const texto = typeof crudo === 'number' ? String(crudo) : typeof crudo === 'string' ? crudo.trim() : null;
        const valor = Number(texto);

        if (texto === null || !Number.isFinite(valor)) {
            errores[clave] = `El campo '${clave}' debe ser un número`;
        } else if (valor <= 0) {
            errores[clave] = `El campo '${clave}' debe ser mayor a cero`;
        } else if (valor > VALOR_MAXIMO) {
            errores[clave] = `El campo '${clave}' no puede superar ${VALOR_MAXIMO}`;
        } else if (!FORMATO_DECIMALES.test(texto)) {
            errores[clave] = `El campo '${clave}' admite hasta 4 decimales`;
        } else {
            valores[clave] = valor;
        }
    }

    return { errores, valores };
};

module.exports = { validarParametros };
