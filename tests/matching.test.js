const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularPuntajes, PESOS } = require('../src/domain/matching');

const carga = { peso_kg: 8000 };
const candidato = (cambios = {}) => ({
    id_camionero: 1, id_postulacion: 1, nombre: 'Camionero', apellido: 'Prueba',
    rol: 'camionero', estado_cuenta: 'activo', estado_postulacion: 'pendiente',
    disponibilidad: true, capacidad_kg: 10000, distancia_km: 100, viajes_entregados: 5,
    ...cambios,
});

test('ejemplo conocido: 8000 kg, capacidad 10000, 100 km y cinco entregas', () => {
    const { sugeridos, descartados } = calcularPuntajes(carga, [candidato()]);
    assert.equal(sugeridos[0].puntaje_total, 76.17);
    assert.deepEqual(Object.values(sugeridos[0].desglose).map((c) => c.puntos), [32, 16.67, 20, 7.5]);
    assert.deepEqual(descartados, []);
    assert.equal(Object.values(PESOS).reduce((suma, peso) => suma + peso, 0), 100);
});

for (const capacidad_kg of [7999, 0, -1, null, '', ' ', 'abc', Infinity, true]) {
    test(`descarta capacidad insuficiente o inválida: ${String(capacidad_kg)}`, () => {
        const resultado = calcularPuntajes(carga, [candidato({ capacidad_kg })]);
        assert.equal(resultado.sugeridos.length, 0);
        assert.equal(resultado.descartados.length, 1);
    });
}

for (const disponibilidad of [false, null, undefined, 'true']) {
    test(`exige disponibilidad booleana confirmada: ${String(disponibilidad)}`, () => {
        assert.equal(calcularPuntajes(carga, [candidato({ disponibilidad })]).sugeridos.length, 0);
    });
}

test('excluye cuentas inactivas, otros roles y postulaciones no pendientes', () => {
    const resultado = calcularPuntajes(carga, [
        candidato({ estado_cuenta: 'inactivo' }), candidato({ rol: 'administrador' }),
        candidato({ estado_postulacion: 'rechazada' }),
    ]);
    assert.equal(resultado.sugeridos.length, 0);
    assert.equal(resultado.descartados.length, 3);
});

test('capacidad exacta, en el origen y diez entregas alcanza 100; acepta NUMERIC de pg', () => {
    const resultado = calcularPuntajes({ peso_kg: '8000' }, [candidato({
        capacidad_kg: '8000', distancia_km: '0', viajes_entregados: '10',
    })]);
    assert.equal(resultado.sugeridos[0].puntaje_total, 100);
});

test('el historial se limita a diez entregas y admite camioneros nuevos', () => {
    const resultado = calcularPuntajes(carga, [candidato({ viajes_entregados: 100 }),
        candidato({ id_camionero: 2, viajes_entregados: 0 })]);
    assert.equal(resultado.sugeridos[0].desglose.historial.puntos, 15);
    assert.equal(resultado.sugeridos[1].desglose.historial.puntos, 0);
});

for (const distancia_km of [null, undefined, '', -1, NaN, Infinity]) {
    test(`distancia inválida no excluye ni se convierte en cercanía máxima: ${String(distancia_km)}`, () => {
        const [sugerido] = calcularPuntajes(carga, [candidato({ distancia_km })]).sugeridos;
        assert.equal(sugerido.distancia_km, null);
        assert.equal(sugerido.desglose.cercania.puntos, 0);
        assert.equal(sugerido.puntaje_total, 59.5);
        assert.equal(sugerido.advertencias.length, 1);
    });
}

test('distancias desde 300 km aportan cero sin excluir al candidato', () => {
    for (const distancia_km of [300, 500]) {
        const [sugerido] = calcularPuntajes(carga, [candidato({ distancia_km })]).sugeridos;
        assert.equal(sugerido.desglose.cercania.puntos, 0);
        assert.deepEqual(sugerido.advertencias, []);
    }
});

test('ordena por puntaje y resuelve empates por id, sin depender del orden de entrada', () => {
    const candidatos = [candidato({ id_camionero: 3 }), candidato({ id_camionero: 2 }),
        candidato({ id_camionero: 4, distancia_km: 0 })];
    const resultado = calcularPuntajes(carga, candidatos);
    assert.deepEqual(resultado.sugeridos.map((c) => c.id_camionero), [4, 2, 3]);
    assert.deepEqual(resultado.sugeridos.map((c) => c.posicion), [1, 2, 3]);
    assert.deepEqual(calcularPuntajes(carga, [...candidatos].reverse()), resultado);
});

test('ordena antes de redondear y recalcula al cambiar datos, sin mutar entradas', () => {
    const candidatos = [candidato({ id_camionero: 1, distancia_km: 100.001 }), candidato({ id_camionero: 2 })];
    const original = structuredClone(candidatos);
    assert.deepEqual(calcularPuntajes(carga, candidatos).sugeridos.map((c) => c.id_camionero), [2, 1]);
    assert.deepEqual(candidatos, original);
    candidatos[0].distancia_km = 0;
    assert.equal(calcularPuntajes(carga, candidatos).sugeridos[0].id_camionero, 1);
});

test('sin candidatos devuelve listas vacías; peso inválido produce error controlable', () => {
    assert.deepEqual(calcularPuntajes(carga, []), { sugeridos: [], descartados: [] });
    for (const peso_kg of [null, 0, -1, Infinity, 'abc']) {
        assert.throws(() => calcularPuntajes({ peso_kg }, []), RangeError);
    }
});
