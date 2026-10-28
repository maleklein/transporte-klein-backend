const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validarParametros } = require('../src/validators/parametros');

const validos = { costo_por_km: 1800, peaje_por_km: 150.5, tarifa_por_km: '2600.1234' };

test('acepta números y texto numérico y los devuelve como número', () => {
    const { errores, valores } = validarParametros(validos);
    assert.deepEqual(errores, {});
    assert.deepEqual(valores, { costo_por_km: 1800, peaje_por_km: 150.5, tarifa_por_km: 2600.1234 });
});

test('los tres son obligatorios', () => {
    for (const body of [{}, null, undefined, [], 'texto']) {
        assert.deepEqual(Object.keys(validarParametros(body).errores).sort(),
            ['costo_por_km', 'peaje_por_km', 'tarifa_por_km']);
    }
    assert.match(validarParametros({ ...validos, peaje_por_km: '  ' }).errores.peaje_por_km, /obligatorio/);
});

test('rechaza cero, negativos y lo que no es número', () => {
    const casos = [[0, /mayor a cero/], [-3, /mayor a cero/], ['abc', /número/], [true, /número/],
        [{}, /número/], ['1,5', /número/], [Infinity, /número/]];
    for (const [valor, mensaje] of casos) {
        assert.match(validarParametros({ ...validos, costo_por_km: valor }).errores.costo_por_km, mensaje);
    }
});

test('respeta la precisión de NUMERIC(12, 4)', () => {
    assert.match(validarParametros({ ...validos, tarifa_por_km: 1.23456 }).errores.tarifa_por_km, /4 decimales/);
    assert.match(validarParametros({ ...validos, tarifa_por_km: 100000000 }).errores.tarifa_por_km, /superar/);
    assert.deepEqual(validarParametros({ ...validos, tarifa_por_km: 99999999.9999 }).errores, {});
});

test('rechaza claves que no son parámetros de la fórmula', () => {
    assert.match(validarParametros({ ...validos, iva: 21 }).errores.iva, /no es un parámetro/);
});
