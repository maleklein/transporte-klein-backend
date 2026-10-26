const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { calcularRanking } = require('../src/services/matching');

test('SQL real: postulados, descartes, conteo de entregas y recálculo', {
    skip: process.env.MATCHING_DB_TEST !== '1',
}, async () => {
    require('dotenv').config();
    const { Client } = require('pg');
    const db = new Client({
        user: process.env.DB_USER, password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
        connectionTimeoutMillis: 5000, statement_timeout: 5000,
    });
    try {
        await db.connect();
        await db.query('BEGIN');
        await db.query(readFileSync(join(__dirname, 'fixtures/matching.sql'), 'utf8'));
        const opciones = { db, obtenerDistanciaKm: async () => 100 };
        const resultado = await calcularRanking(1, opciones);
        assert.deepEqual(resultado.sugeridos.map((c) => c.id_camionero), [1, 2]);
        assert.equal(resultado.sugeridos[0].puntaje_total, 76.17);
        assert.equal(resultado.sugeridos[0].viajes_entregados, 5);
        assert.equal(resultado.sugeridos[1].viajes_entregados, 0);
        assert.deepEqual(resultado.descartados.map((c) => c.id_camionero), [3, 4, 5]);

        await db.query('UPDATE pg_temp.CAMIONERO SET disponibilidad = FALSE WHERE id_usuario = 1');
        assert.deepEqual((await calcularRanking(1, opciones)).sugeridos.map((c) => c.id_camionero), [2]);
        await db.query("UPDATE pg_temp.CARGA SET estado_actual = 'aceptada' WHERE id_carga = 1");
        await assert.rejects(calcularRanking(1, opciones), (error) => error.estado === 409);
    } finally {
        await db.query('ROLLBACK').catch(() => {});
        await db.end();
    }
});
