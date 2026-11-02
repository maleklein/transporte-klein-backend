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
    origen: 'Santa Fe, Santa Fe', origen_id: '82063170', origen_latitud: '-31.646557', origen_longitud: '-60.709996',
    candidatos: [candidato()], ...cambios,
});
const localidades = [
    { id_localidad: '30084160', nombre: 'Paraná', provincia: 'Entre Ríos', departamento: 'Paraná', latitud: '-31.740148', longitud: '-60.527466' },
    { id_localidad: '82063170', nombre: 'Santa Fe', provincia: 'Santa Fe', departamento: 'La Capital', latitud: '-31.646557', longitud: '-60.709996' },
];
const base = (fila) => ({ query: async (sql, params) => {
    if (sql.includes('FROM LOCALIDAD l')) return { rows: localidades };
    assert.deepEqual(params, [1]);
    return { rows: fila ? [fila] : [] };
} });

test('obtiene ranking con distancia y envía coordenadas de camionero → origen a HU 9', async () => {
    const resultado = await calcularRanking(1, { db: base(carga()), obtenerDistanciaKm: async (desde, hasta) => {
        assert.deepEqual(desde, { lat: -31.740148, lon: -60.527466 });
        assert.deepEqual(hasta, { lat: -31.646557, lon: -60.709996 });
        return 100;
    } });
    assert.equal(resultado.sugeridos[0].puntaje_total, 76.17);
    assert.equal(resultado.alcance, 'postulados_pendientes');
    assert.equal(resultado.sugeridos[0].ubicacion_resuelta.id_localidad, '30084160');
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

test('ubicación no encontrada mantiene al apto con advertencia y sin consultar mapas', async () => {
    const resultado = await calcularRanking(1, {
        db: base(carga({ candidatos: [candidato({ ubicacion: 'Dirección sin localidad' })] })),
        obtenerDistanciaKm: () => assert.fail('No debe enviar coordenadas inventadas'),
    });
    assert.equal(resultado.sugeridos[0].distancia_km, null);
    assert.equal(resultado.sugeridos[0].puntaje_total, 59.5);
    assert.match(resultado.sugeridos[0].advertencias[0], /catálogo/);
});

test('misma localidad del origen aporta distancia cero sin consumir la API', async () => {
    const resultado = await calcularRanking(1, {
        db: base(carga({ candidatos: [candidato({ ubicacion: 'Santa Fe, Santa Fe' })] })),
        obtenerDistanciaKm: () => assert.fail('La distancia entre el mismo centroide es cero'),
    });
    assert.equal(resultado.sugeridos[0].distancia_km, 0);
    assert.equal(resultado.sugeridos[0].desglose.cercania.puntos, 25);
});

test('origen sin coordenadas no se interpreta como 0,0', async () => {
    const resultado = await calcularRanking(1, {
        db: base(carga({ origen_latitud: null })),
        obtenerDistanciaKm: () => assert.fail('No debe consultar sin origen válido'),
    });
    assert.equal(resultado.sugeridos[0].distancia_km, null);
    assert.match(resultado.sugeridos[0].advertencias[0], /origen/);
});
