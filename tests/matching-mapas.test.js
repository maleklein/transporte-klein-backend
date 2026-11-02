const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularRanking } = require('../src/services/matching');

const localidades = [
    { id_localidad: '30084160', nombre: 'Paraná', provincia: 'Entre Ríos', departamento: 'Paraná', latitud: '-31.740148', longitud: '-60.527466' },
    { id_localidad: '82063170', nombre: 'Santa Fe', provincia: 'Santa Fe', departamento: 'La Capital', latitud: '-31.646557', longitud: '-60.709996' },
];
const candidato = (id, ubicacion = 'Paraná, Entre Ríos') => ({
    id_camionero: id, id_postulacion: id, nombre: 'Prueba', apellido: 'Matching',
    estado_cuenta: 'activo', rol: 'camionero', estado_postulacion: 'pendiente',
    disponibilidad: true, capacidad_kg: 10000, viajes_entregados: 5, ubicacion,
});
const db = { query: async (sql) => sql.includes('FROM LOCALIDAD l')
    ? { rows: localidades } : { rows: [{ id_carga: 1, peso_kg: 8000, estado_actual: 'pendiente',
        id_camionero_asignado: null, origen_id: '82063170', origen_latitud: '-31.646557', origen_longitud: '-60.709996',
        candidatos: [candidato(1), candidato(2, 'parana, ENTRE RIOS')],
    }] },
};

test('matching reutiliza el módulo real de HU 9: coordenadas, km y puntaje', async (t) => {
    const claveAnterior = process.env.ORS_API_KEY;
    process.env.ORS_API_KEY = 'solo-prueba-sin-acceso-a-proveedor';
    let llamadas = 0;
    t.mock.method(global, 'fetch', async (url, opciones) => {
        llamadas++;
        const peticion = new URL(url);
        assert.equal(peticion.origin, 'https://api.heigit.org');
        assert.equal(peticion.pathname, '/openrouteservice/v2/directions/driving-car');
        assert.equal(peticion.searchParams.get('start'), '-60.527466,-31.740148');
        assert.equal(peticion.searchParams.get('end'), '-60.709996,-31.646557');
        assert.ok(opciones.headers.Authorization);
        assert.ok(opciones.signal);
        return new Response(JSON.stringify({ features: [{ properties: { summary: { distance: 42000 } } }] }));
    });
    try {
        const resultado = await calcularRanking(1, { db });
        assert.equal(llamadas, 1, 'dos textos para la misma localidad no duplican llamadas');
        assert.equal(resultado.sugeridos[0].distancia_km, 42);
        assert.equal(resultado.sugeridos[0].desglose.cercania.puntos, 21.5);
        assert.equal(resultado.sugeridos[0].puntaje_total, 81);
        assert.deepEqual(resultado.sugeridos[0].advertencias, []);
    } finally {
        if (claveAnterior === undefined) delete process.env.ORS_API_KEY;
        else process.env.ORS_API_KEY = claveAnterior;
    }
});

test('sin clave o con respuesta de error de HU 9 mantiene ranking y advertencia', async (t) => {
    const claveAnterior = process.env.ORS_API_KEY;
    t.mock.method(console, 'error', () => {});
    const fetchSimulado = t.mock.method(global, 'fetch', async () => new Response('{}', { status: 503 }));
    try {
        delete process.env.ORS_API_KEY;
        const sinClave = await calcularRanking(1, { db });
        assert.equal(fetchSimulado.mock.callCount(), 0);
        assert.equal(sinClave.sugeridos[0].distancia_km, null);
        process.env.ORS_API_KEY = 'solo-prueba-sin-acceso-a-proveedor';
        const conFallo = await calcularRanking(1, { db });
        assert.equal(conFallo.sugeridos[0].puntaje_total, 59.5);
        assert.equal(conFallo.sugeridos[0].advertencias.length, 1);
    } finally {
        if (claveAnterior === undefined) delete process.env.ORS_API_KEY;
        else process.env.ORS_API_KEY = claveAnterior;
    }
});
