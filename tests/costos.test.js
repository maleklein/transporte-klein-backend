const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularCostos } = require('../src/services/costos');

const parametros = { costo_por_km: 1800, peaje_por_km: 150, tarifa_por_km: 2600 };

test('aplica la fórmula del README a un caso calculado a mano', () => {
    // 100 km: costo 100 × (1800 + 150) = 195.000; ingreso 100 × 2600 = 260.000.
    assert.deepEqual(calcularCostos(100, parametros), {
        costo_estimado: 195000,
        ingreso_estimado: 260000,
        ganancia_estimada: 65000,
        parametros,
    });
});

test('mismos datos de entrada, mismo resultado', () => {
    const primero = calcularCostos(199.7, parametros);
    for (let i = 0; i < 100; i++) {
        assert.deepEqual(calcularCostos(199.7, parametros), primero);
    }
    assert.equal(primero.costo_estimado, 389415);
    assert.equal(primero.ganancia_estimada, 129805);
});

test('acepta los NUMERIC que devuelve el driver como texto', () => {
    const conTexto = calcularCostos('199.70', { costo_por_km: '1800.0000', peaje_por_km: '150.0000', tarifa_por_km: '2600.0000' });
    assert.deepEqual(conTexto, calcularCostos(199.7, parametros));
});

test('redondea cada monto a centavos y la ganancia cierra con esos montos', () => {
    const resultado = calcularCostos(12.35, { costo_por_km: 1.111, peaje_por_km: 0.2222, tarifa_por_km: 3.3333 });
    assert.equal(resultado.costo_estimado, 16.47); // 12,35 × 1,3332 = 16,46502
    assert.equal(resultado.ingreso_estimado, 41.17); // 12,35 × 3,3333 = 41,166255
    assert.equal(resultado.ganancia_estimada, 24.7);
    assert.equal(resultado.ganancia_estimada, Math.round((resultado.ingreso_estimado - resultado.costo_estimado) * 100) / 100);
});

test('la ganancia puede ser negativa si la tarifa no cubre el costo', () => {
    const resultado = calcularCostos(10, { costo_por_km: 2000, peaje_por_km: 200, tarifa_por_km: 2000 });
    assert.equal(resultado.ganancia_estimada, -2000);
});

test('sin kilómetros no hay estimación, ni siquiera en cero', () => {
    assert.equal(calcularCostos(null, parametros), null);
    assert.equal(calcularCostos(undefined, parametros), null);
});

test('cero kilómetros es una cuenta válida', () => {
    assert.equal(calcularCostos(0, parametros).costo_estimado, 0);
});

test('kilómetros inválidos o parámetros faltantes lanzan TypeError', () => {
    for (const km of ['abc', -1, NaN, Infinity]) {
        assert.throws(() => calcularCostos(km, parametros), TypeError);
    }
    for (const clave of Object.keys(parametros)) {
        for (const valor of [undefined, null, 0, -5, 'abc']) {
            assert.throws(() => calcularCostos(100, { ...parametros, [clave]: valor }), TypeError);
        }
    }
    assert.throws(() => calcularCostos(100, null), TypeError);
});
