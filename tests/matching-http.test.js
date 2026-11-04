const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

// Cada archivo de node:test tiene su proceso: no sustituye la conexión de la app real.
process.env.JWT_SECRET = randomBytes(32).toString('hex');
require.cache[require.resolve('../src/db')] = { exports: {
    async query(sql, params) {
        if (sql.includes('SELECT id_usuario, rol, estado FROM USUARIO')) {
            return { rows: [{ id_usuario: params[0], rol: params[0] === 2 ? 'camionero' : 'administrador',
                estado: params[0] === 3 ? 'inactivo' : 'activo' }] };
        }
        return { rows: params[0] === 1 ? [{
            id_carga: 1, peso_kg: 8000, estado_actual: 'pendiente', id_camionero_asignado: null,
            origen: 'Paraná, Entre Ríos', candidatos: [],
        }] : [] };
    },
} };
const app = require('../index');
const jwt = require('jsonwebtoken');

test('ruta HTTP de matching aplica JWT, permisos y errores controlados', async (t) => {
    const servidor = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { servidor.once('listening', resolve); servidor.once('error', reject); });
    const url = `http://127.0.0.1:${servidor.address().port}/matching`;
    const token = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1m' });
    try {
        for (const [nombre, ruta, sesion, estado] of [
            ['sin token', '1', null, 401], ['token inválido', '1', 'invalido', 401],
            ['camionero', '1', token(2), 403], ['cuenta inactiva', '1', token(3), 403],
            ['id inválido', 'abc', token(1), 400], ['carga inexistente', '99', token(1), 404],
            ['administrador', '1', token(1), 200],
        ]) {
            await t.test(nombre, async () => {
                const respuesta = await fetch(`${url}/${ruta}`, {
                    headers: sesion ? { Authorization: `Bearer ${sesion}` } : {},
                });
                assert.equal(respuesta.status, estado);
                const cuerpo = await respuesta.json();
                if (estado === 200) {
                    assert.deepEqual(cuerpo.sugeridos, []);
                    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
                } else assert.equal(typeof cuerpo.message, 'string');
            });
        }
    } finally {
        await new Promise((resolve) => servidor.close(resolve));
    }
});
