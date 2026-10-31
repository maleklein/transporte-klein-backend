const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomBytes } = require('node:crypto');

test('circuito integrado: login → carga → postulaciones → mapas → ranking → asignación e historial', {
    skip: process.env.MATCHING_DB_TEST !== '1',
}, async (t) => {
    require('dotenv').config();
    const { Client } = require('pg');
    const db = new Client({
        user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
        connectionTimeoutMillis: 5000, statement_timeout: 5000,
    });
    let servidor;
    const fetchHttp = global.fetch.bind(global);
    // Solo el proveedor externo se simula. HTTP, controladores, SQL, transacciones,
    // bitácora y notificaciones son los del proyecto, con tablas temporales.
    const peticionesMapas = [];
    t.mock.method(global, 'fetch', async (url, opciones) => {
        const peticion = new URL(url);
        if (peticion.origin !== 'https://api.openrouteservice.org') return fetchHttp(url, opciones);
        const inicio = peticion.searchParams.get('start');
        const fin = peticion.searchParams.get('end');
        assert.ok(inicio && fin && !`${inicio}${fin}`.includes('undefined'));
        peticionesMapas.push({ inicio, fin });
        return new Response(JSON.stringify({ features: [{ properties: { summary: { distance: 42000 } } }] }));
    });
    try {
        await db.connect();
        // Impide que las consultas del circuito resuelvan tablas públicas.
        await db.query('SET search_path TO pg_temp, pg_catalog');
        const esquema = readFileSync(join(__dirname, '../script_tablas.sql'), 'utf8')
            .split('CREATE OR REPLACE FUNCTION')[0].replace(/^CREATE TABLE /gm, 'CREATE TEMP TABLE ');
        await db.query(esquema);
        await db.query("INSERT INTO PROVINCIA VALUES ('30', 'Entre Ríos'), ('82', 'Santa Fe')");
        await db.query(`INSERT INTO LOCALIDAD VALUES
            ('30084160', '30', 'Paraná', 'Paraná', -31.740148, -60.527466),
            ('82063170', '82', 'Santa Fe', 'La Capital', -31.646557, -60.709996)`);

        const password = randomBytes(18).toString('hex');
        const hash = await require('bcrypt').hash(password, 4);
        await db.query(`INSERT INTO USUARIO (nombre, apellido, dni, email, contraseña_hash, rol, estado)
            VALUES ('Admin', 'Prueba', 'PRUEBA-1', 'admin@example.test', $1, 'administrador', 'activo'),
                   ('Ana', 'Prueba', 'PRUEBA-2', 'ana@example.test', $1, 'camionero', 'activo'),
                   ('Bruno', 'Prueba', 'PRUEBA-3', 'bruno@example.test', $1, 'camionero', 'activo')`, [hash]);
        await db.query(`INSERT INTO CAMIONERO (id_usuario, ubicacion, disponibilidad, tipo_vehiculo, capacidad_kg)
            VALUES (2, 'parana, entre rios', TRUE, 'Camión', 1000),
                   (3, 'Paraná, Entre Ríos', TRUE, 'Camión', 2000)`);

        const conexion = { query: db.query.bind(db), release() {} };
        require.cache[require.resolve('../src/db')] = { exports: {
            query: db.query.bind(db), connect: async () => conexion,
        } };
        process.env.JWT_SECRET = randomBytes(32).toString('hex');
        process.env.ORS_API_KEY = 'solo-prueba-no-envia-datos-a-internet';
        const app = require('../index');
        servidor = app.listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => { servidor.once('listening', resolve); servidor.once('error', reject); });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const pedir = async (ruta, { token, body, method = 'GET' } = {}) => {
            const respuesta = await fetchHttp(`${base}${ruta}`, { method, headers: {
                'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
            }, ...(body ? { body: JSON.stringify(body) } : {}) });
            return { status: respuesta.status, body: await respuesta.json() };
        };
        const login = async (email) => {
            const respuesta = await pedir('/auth/login', { method: 'POST', body: { email, contraseña: password } });
            assert.equal(respuesta.status, 200);
            return respuesta.body.token;
        };
        const admin = await login('admin@example.test');
        const ana = await login('ana@example.test');
        const bruno = await login('bruno@example.test');
        const alta = await pedir('/cargas', { token: admin, method: 'POST', body: {
            origen_id: '82063170', destino_id: '30084160', tipo_carga: 'Granos',
            peso: 1000, fecha: '2026-11-10', observaciones: 'Prueba temporal HU5-HU9',
        } });
        assert.equal(alta.status, 201);
        const id = alta.body.id_carga;
        assert.ok(id);
        assert.equal(alta.body.estado_calculo_km, 'ok');
        assert.equal(Number(alta.body.kilometros_estimados), 42);
        for (const token of [ana, bruno]) {
            assert.equal((await pedir(`/cargas/${id}/postulaciones`, { token, method: 'POST' })).status, 201);
        }
        assert.equal((await pedir(`/matching/${id}`, { token: ana })).status, 403);
        const ranking = await pedir(`/matching/${id}`, { token: admin });
        assert.equal(ranking.status, 200);
        assert.deepEqual(ranking.body.sugeridos.map((c) => c.id_camionero), [2, 3]);
        assert.equal(ranking.body.sugeridos[0].distancia_km, 42);
        assert.equal(ranking.body.sugeridos[0].puntaje_total, 81.5);
        assert.equal(ranking.body.sugeridos[1].puntaje_total, 61.5);
        assert.deepEqual(peticionesMapas[1], { inicio: '-60.527466,-31.740148', fin: '-60.709996,-31.646557' });
        assert.equal(peticionesMapas.length, 2, 'una llamada de alta y una de matching para dos perfiles en la misma ciudad');

        const asignacion = await pedir(`/cargas/${id}/asignar`, { token: admin, method: 'POST', body: { id_camionero: 2 } });
        assert.equal(asignacion.status, 200);
        assert.equal(asignacion.body.estado_actual, 'aceptada');
        assert.equal(asignacion.body.id_camionero_asignado, 2);
        const postulantes = await pedir(`/cargas/${id}/postulaciones`, { token: admin });
        assert.deepEqual(postulantes.body.map((p) => p.estado), ['aceptada', 'rechazada']);
        const historial = await pedir(`/cargas/${id}/historial`, { token: admin });
        assert.equal(historial.status, 200);
        assert.deepEqual(historial.body.map((e) => e.estado_nuevo), ['disponible', 'pendiente', 'aceptada']);
        const avisos = await pedir('/notificaciones', { token: ana });
        assert.equal(avisos.status, 200);
        const notificaciones = Array.isArray(avisos.body) ? avisos.body : avisos.body.notificaciones;
        assert.ok(notificaciones.some((n) => n.tipo_evento === 'carga_asignada'));
        assert.equal((await pedir(`/matching/${id}`, { token: admin })).status, 409);
    } finally {
        if (servidor) await new Promise((resolve) => servidor.close(resolve));
        // Los COMMIT reales de los controladores solo afectaron tablas temporales.
        // Cerrar la conexión elimina las tablas y sus secuencias automáticamente.
        await db.end();
    }
});
