const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularReputacion } = require('../src/domain/reputacion');
const evaluar = (id, puntaje, fecha = '2026-11-02T12:00:00Z') => ({ id_calificacion: id, puntaje, creado_en: fecha });

test('sin calificaciones no representa una reputación de cero', () => {
    assert.deepEqual(calcularReputacion([]), { promedio: null, evaluaciones_utilizadas: 0 });
});
test('una evaluación conserva su puntaje y extremos 1 y 5', () => {
    for (const puntaje of [1, 5]) assert.equal(calcularReputacion([evaluar(1, puntaje)]).promedio, puntaje);
});
test('ejemplo acordado: 5 reciente y 3 anterior producen 4,05', () => {
    assert.equal(calcularReputacion([evaluar(1, 3), evaluar(2, 5)]).promedio, 4.05);
});
test('la fecha decide antes que el id y la entrada no se modifica', () => {
    const datos = [evaluar(2, 3, '2026-01-01'), evaluar(1, 5, '2026-02-01')];
    const copia = JSON.stringify(datos);
    assert.equal(calcularReputacion(datos).promedio, 4.05);
    assert.equal(JSON.stringify(datos), copia);
});
test('la undécima más antigua queda fuera y el desempate es estable por id', () => {
    const datos = Array.from({ length: 11 }, (_, i) => evaluar(i + 1, i ? 5 : 1));
    assert.deepEqual(calcularReputacion(datos.reverse()), { promedio: 5, evaluaciones_utilizadas: 10 });
});
