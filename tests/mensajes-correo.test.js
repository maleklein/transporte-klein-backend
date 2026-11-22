// Los mensajes que nombran el correo electrónico llegan tal cual a la pantalla:
// el frontend dice "correo electrónico", así que la API tiene que decir lo mismo.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

// authControllers exige JWT_SECRET al cargarse; en CI no hay .env.
process.env.JWT_SECRET = randomBytes(32).toString('hex');

const pool = require('../src/db');
const { login } = require('../src/controllers/authControllers');
const { crearUsuario, actualizarUsuario } = require('../src/controllers/usuarioControllers');

/** Respuesta de Express mínima: guarda el código y el cuerpo. */
function respuesta() {
    return {
        codigo: null,
        cuerpo: null,
        status(codigo) { this.codigo = codigo; return this; },
        json(cuerpo) { this.cuerpo = cuerpo; return this; },
    };
}

/** Un alta válida de administrador; cada test cambia lo que necesita. */
const alta = (cambios = {}) => ({
    nombre: 'Ana',
    apellido: 'Pérez',
    dni: '30111222',
    email: 'ana@example.test',
    contraseña: 'ClaveSoloParaPruebas',
    rol: 'administrador',
    ...cambios,
});

/** Una edición válida del usuario 2, hecha por el administrador 1. */
const edicion = (cambios = {}) => ({
    params: { id: '2' },
    usuario: { id: 1 },
    body: { nombre: 'Ana', apellido: 'Pérez', dni: '30111222', email: 'ana@example.test', estado: 'activo', ...cambios },
});

test('el login sin correo pide el correo electrónico y la contraseña', async () => {
    const res = respuesta();
    await login({ body: { contraseña: 'ClaveSoloParaPruebas' } }, res);

    assert.equal(res.codigo, 400);
    assert.equal(res.cuerpo.message, 'Por favor, ingresá el correo electrónico y la contraseña.');
});

test('el alta rechaza un correo de más de 100 caracteres', async () => {
    const res = respuesta();
    await crearUsuario({ body: alta({ email: `${'a'.repeat(95)}@mail.com` }) }, res);

    assert.equal(res.codigo, 400);
    assert.equal(res.cuerpo.message, 'El correo electrónico no puede superar los 100 caracteres.');
});

test('el alta rechaza un correo sin dominio', async () => {
    const res = respuesta();
    await crearUsuario({ body: alta({ email: 'ana@' }) }, res);

    assert.equal(res.codigo, 400);
    assert.equal(res.cuerpo.message, 'El correo electrónico no tiene un formato válido.');
});

test('el alta rechaza un correo que ya está registrado', async (t) => {
    t.after(() => mock.restoreAll());
    // Primero busca el DNI (libre) y después el correo (ocupado).
    let consulta = 0;
    mock.method(pool, 'query', async () => ({ rows: consulta++ === 0 ? [] : [{ id_usuario: 5 }] }));

    const res = respuesta();
    await crearUsuario({ body: alta() }, res);

    assert.equal(res.codigo, 400);
    assert.equal(res.cuerpo.message, 'El correo electrónico ya está registrado');
});

test('si dos altas con el mismo correo llegan juntas, la segunda recibe el mismo mensaje', async (t) => {
    t.after(() => mock.restoreAll());
    mock.method(pool, 'query', async () => ({ rows: [] }));
    const duplicado = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'usuario_email_key' });
    mock.method(pool, 'connect', async () => ({
        query: async (sql) => {
            if (String(sql).includes('INSERT')) throw duplicado;
            return { rows: [] };
        },
        release() {},
    }));

    const res = respuesta();
    await crearUsuario({ body: alta() }, res);

    assert.equal(res.codigo, 400);
    assert.equal(res.cuerpo.message, 'El correo electrónico ya está registrado');
});

test('la edición rechaza un correo de otro usuario', async (t) => {
    t.after(() => mock.restoreAll());
    // El usuario existe, el DNI está libre y el correo lo tiene otro.
    const respuestas = [{ rows: [{ id_usuario: 2, rol: 'administrador' }] }, { rows: [] }, { rows: [{ id_usuario: 5 }] }];
    mock.method(pool, 'query', async () => respuestas.shift());

    const res = respuesta();
    await actualizarUsuario(edicion(), res);

    assert.equal(res.codigo, 400);
    assert.equal(res.cuerpo.message, 'El correo electrónico ya está registrado');
});

test('la edición usa el mismo mensaje de formato que el alta', async () => {
    const res = respuesta();
    await actualizarUsuario(edicion({ email: 'ana@' }), res);

    assert.equal(res.codigo, 400);
    assert.equal(res.cuerpo.message, 'El correo electrónico no tiene un formato válido.');
});
