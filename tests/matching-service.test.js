const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularRanking, ErrorMatching } = require('../src/services/matching');

const candidato = (cambios = {}) => ({
    id_camionero: 2, id_postulacion: 10, nombre: 'Camionero', apellido: 'Prueba',
    estado_cuenta: 'activo', rol: 'camionero', estado_postulacion: 'pendiente',
    capacidad_kg: 10000, disponibilidad: true, ubicacion: 'Paraná, Entre Ríos', viajes_entregados: 5,
    ...cambios,
});
const carga = (cambios = {}) => ({
    id_carga: 1, peso_kg: '8000', estado_actual: 'pendiente', id_camionero_asignado: null,
    origen: 'Santa Fe, Santa Fe', candidatos: [candidato()], ...cambios,
});
const base = (fila) => ({ query: async (_sql, params) => {
    assert.deepEqual(params, [1]);
    return { rows: fila ? [fila] : [] };
} });

test('obtiene ranking con distancia y conserva el contrato ubicación → origen', async () => {
    const resultado = await calcularRanking(1, { db: base(carga()), obtenerDistanciaKm: async (desde, hasta) => {
        assert.equal(desde, 'Paraná, Entre Ríos');
        assert.equal(hasta, 'Santa Fe, Santa Fe');
        return 100;
    } });
    assert.equal(resultado.sugeridos[0].puntaje_total, 76.17);
    assert.equal(resultado.alcance, 'postulados_pendientes');
});

test('carga inexistente, cerrada, asignada y peso inválido tienen errores controlados', async () => {
    for (const [fila, estado] of [
        [null, 404], [carga({ estado_actual: 'aceptada' }), 409],
        [carga({ id_camionero_asignado: 2 }), 409], [carga({ peso_kg: null }), 409],
    ]) {
        await assert.rejects(calcularRanking(1, { db: base(fila) }),
            (error) => error instanceof ErrorMatching && error.estado === estado);
    }
});

test('id inválido no consulta la base', async () => {
    for (const id of [0, -1, 'abc', 1.2, Infinity]) {
        await assert.rejects(calcularRanking(id, { db: { query() { assert.fail('No debe consultar'); } } }),
            (error) => error.estado === 400);
    }
});

test('sin postulados devuelve listas vacías', async () => {
    const resultado = await calcularRanking(1, { db: base(carga({ candidatos: [] })), obtenerDistanciaKm: null });
    assert.deepEqual(resultado.sugeridos, []);
    assert.deepEqual(resultado.descartados, []);
});

test('fallo, ausencia y timeout de mapas mantienen el resto del puntaje', async () => {
    for (const obtenerDistanciaKm of [null, async () => { throw new Error('Fallo externo'); },
        () => new Promise(() => {})]) {
        const resultado = await calcularRanking(1, { db: base(carga()), obtenerDistanciaKm, esperaMs: 10 });
        assert.equal(resultado.sugeridos[0].puntaje_total, 59.5);
        assert.equal(resultado.sugeridos[0].distancia_km, null);
        assert.equal(resultado.sugeridos[0].advertencias.length, 1);
    }
});

test('no consulta mapas para descartados y reutiliza distancia por ubicación en una consulta', async () => {
    let llamadas = 0;
    const resultado = await calcularRanking(1, {
        db: base(carga({ candidatos: [candidato(), candidato({ id_camionero: 3 }),
            candidato({ id_camionero: 4, disponibilidad: false, ubicacion: 'Otra ciudad' })] })),
        obtenerDistanciaKm: async () => { llamadas++; return 100; },
    });
    assert.equal(llamadas, 1);
    assert.equal(resultado.sugeridos.length, 2);
    assert.equal(resultado.descartados.length, 1);
});

test('relee datos y distancia en cada consulta sin conservar un ranking viejo', async () => {
    const fila = carga();
    const opciones = { db: base(fila), obtenerDistanciaKm: async () => 0 };
    assert.equal((await calcularRanking(1, opciones)).sugeridos.length, 1);
    fila.candidatos[0].disponibilidad = false;
    assert.equal((await calcularRanking(1, opciones)).sugeridos.length, 0);
});
