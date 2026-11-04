const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');

process.env.JWT_SECRET = randomBytes(32).toString('hex');

const pool = require('../src/db');
const { login } = require('../src/controllers/authControllers');

/** Respuesta de Express mínima: guarda el código y el cuerpo. */
function respuesta() {
    return {
        codigo: null,
        cuerpo: null,
        status(codigo) { this.codigo = codigo; return this; },
        json(cuerpo) { this.cuerpo = cuerpo; return this; },
    };
}

test('el login devuelve el nombre y el apellido junto con el id, el email y el rol', async (t) => {
    const fila = {
        id_usuario: 7,
        nombre: 'Lucía',
        apellido: 'Pérez',
        email: 'lucia@example.test',
        rol: 'camionero',
        estado: 'activo',
        contraseña_hash: await bcrypt.hash('ClaveSoloParaPruebas', 4),
    };
    t.after(() => mock.restoreAll());
    mock.method(pool, 'query', async () => ({ rows: [fila] }));

    const res = respuesta();
    await login({ body: { email: fila.email, contraseña: 'ClaveSoloParaPruebas' } }, res);

    assert.equal(res.codigo, 200);
    assert.deepEqual(res.cuerpo.user, {
        id: 7,
        email: 'lucia@example.test',
        rol: 'camionero',
        nombre: 'Lucía',
        apellido: 'Pérez',
    });
    assert.ok(res.cuerpo.token);
});
