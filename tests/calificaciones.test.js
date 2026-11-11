const { test } = require('node:test');
const assert = require('node:assert/strict');

const { emitirCalificacion, ErrorCalificacion } = require('../src/services/calificaciones');

/**
 * Cliente de transacción simulado: responde según la tabla que pregunte la
 * consulta, sin tocar una base real. `rolReceptor` imita lo que hoy garantiza
 * la FK de CARGA.id_camionero_asignado (siempre apunta a un camionero), para
 * poder probar la guarda aun en un escenario que en producción no ocurre.
 */
function clienteSimulado({ carga, rolReceptor = 'camionero' }) {
    const consultas = [];
    return {
        consultas,
        async query(sql, params) {
            consultas.push(sql.replace(/\s+/g, ' ').trim());
            const texto = consultas[consultas.length - 1];
            if (texto.startsWith('SELECT id_carga, estado_actual, id_admin_creador, id_camionero_asignado FROM CARGA')) {
                return { rows: [carga] };
            }
            if (texto.startsWith('SELECT rol FROM USUARIO WHERE id_usuario')) {
                return { rows: [{ rol: rolReceptor }] };
            }
            if (texto.startsWith('INSERT INTO CALIFICACION')) {
                const [id_emisor, id_receptor, id_carga, puntaje, comentario] = params;
                return { rows: [{ id_calificacion: 1, id_emisor, id_receptor, id_carga, puntaje, comentario }] };
            }
            return { rows: [] }; // BEGIN, COMMIT, ROLLBACK
        },
        release() {},
    };
}

/** `db` inyectable con el mismo `connect()` que usa `emitirCalificacion`. */
function dbSimulada(client) {
    return { connect: async () => client };
}

const cargaEntregada = { id_carga: 1, estado_actual: 'entregada', id_admin_creador: 10, id_camionero_asignado: 20 };
const datosValidos = { id_carga: 1, puntaje: 5 };

test('emitirCalificacion: solo el administrador califica al camionero asignado', async (t) => {
    await t.test('un camionero que intenta calificar: 403 con mensaje claro, sin tocar la base', async () => {
        const client = clienteSimulado({ carga: cargaEntregada });
        const db = {
            connect: async () => { throw new Error('no debería conectarse a la base: se rechaza antes'); },
        };

        await assert.rejects(
            emitirCalificacion(datosValidos, { id: 20, rol: 'camionero' }, db),
            (error) => {
                assert.ok(error instanceof ErrorCalificacion);
                assert.equal(error.estado, 403);
                assert.match(error.message, /camioner/i);
                return true;
            }
        );
        assert.equal(client.consultas.length, 0);
    });

    await t.test('no se puede calificar a un administrador, aunque la carga lo marque como receptor', async () => {
        // Simula el caso que la FK de la base nunca permite: id_camionero_asignado
        // apuntando a alguien que en USUARIO figura como administrador.
        const client = clienteSimulado({ carga: cargaEntregada, rolReceptor: 'administrador' });
        const db = dbSimulada(client);

        await assert.rejects(
            emitirCalificacion(datosValidos, { id: 10, rol: 'administrador' }, db),
            (error) => {
                assert.ok(error instanceof ErrorCalificacion);
                assert.equal(error.estado, 403);
                assert.match(error.message, /administrador/i);
                return true;
            }
        );
        assert.ok(client.consultas.some((q) => q === 'ROLLBACK'));
        assert.ok(!client.consultas.some((q) => q.startsWith('INSERT INTO CALIFICACION')));
    });

    await t.test('caso válido: el administrador creador califica al camionero asignado', async () => {
        const client = clienteSimulado({ carga: cargaEntregada, rolReceptor: 'camionero' });
        const db = dbSimulada(client);

        const resultado = await emitirCalificacion({ id_carga: 1, puntaje: 5, comentario: 'Buen viaje' }, { id: 10, rol: 'administrador' }, db);

        assert.equal(resultado.id_emisor, 10);
        assert.equal(resultado.id_receptor, 20);
        assert.equal(resultado.puntaje, 5);
        assert.ok(client.consultas.some((q) => q.startsWith('INSERT INTO CALIFICACION')));
        assert.ok(client.consultas.some((q) => q === 'COMMIT'));
    });
});
