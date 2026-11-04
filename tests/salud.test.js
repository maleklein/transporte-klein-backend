const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

// Cada archivo de node:test tiene su proceso: no sustituye la conexión de la app real.
process.env.JWT_SECRET = randomBytes(32).toString('hex');
let baseDisponible = true;
require.cache[require.resolve('../src/db')] = { exports: {
    async query() {
        if (!baseDisponible) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        return { rows: [{ '?column?': 1 }] };
    },
} };
const app = require('../index');

test('GET /health refleja si la base responde, sin pedir sesión', async (t) => {
    const servidor = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { servidor.once('listening', resolve); servidor.once('error', reject); });
    const url = `http://127.0.0.1:${servidor.address().port}/health`;
    try {
        await t.test('base disponible: 200', async () => {
            baseDisponible = true;
            const respuesta = await fetch(url);
            assert.equal(respuesta.status, 200);
            assert.deepEqual(await respuesta.json(), { estado: 'ok' });
            assert.equal(respuesta.headers.get('cache-control'), 'no-store');
        });
        await t.test('base caída: 503 sin detalles del error', async (st) => {
            baseDisponible = false;
            st.mock.method(console, 'error', () => {});
            const respuesta = await fetch(url);
            assert.equal(respuesta.status, 503);
            const cuerpo = await respuesta.json();
            assert.equal(cuerpo.estado, 'sin_base');
            assert.equal(cuerpo.message, 'La base de datos no responde.');
            assert.ok(!JSON.stringify(cuerpo).includes('ECONNREFUSED'));
        });
    } finally {
        await new Promise((resolve) => servidor.close(resolve));
    }
});
