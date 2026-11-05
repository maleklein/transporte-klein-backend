const { test } = require('node:test');
const assert = require('node:assert/strict');

// No abre conexiones: el Pool de pg solo conecta en la primera consulta.
const pool = require('../src/db');

test('una conexión libre cortada por PostgreSQL no tira abajo el proceso', (t) => {
    const registro = t.mock.method(console, 'error', () => {});
    const corte = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });

    // Sin manejador, emit('error') lanza la excepción: es lo que cerraba el servidor.
    assert.doesNotThrow(() => pool.emit('error', corte));
    assert.equal(registro.mock.callCount(), 1);
    assert.deepEqual(registro.mock.calls[0].arguments, ['PostgreSQL cortó una conexión libre:', '57P01']);
});
