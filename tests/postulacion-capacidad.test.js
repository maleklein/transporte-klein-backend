const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db');
const { crearPostulacion } = require('../src/controllers/postulacionControllers');

/** Respuesta de Express mínima: guarda el código y el cuerpo. */
function respuesta() {
    return {
        codigo: null,
        cuerpo: null,
        status(codigo) { this.codigo = codigo; return this; },
        json(cuerpo) { this.cuerpo = cuerpo; return this; },
    };
}

/** Request mínimo: carga pedida por id y camionero logueado por token. */
function pedido(idCarga, idCamionero) {
    return { params: { id: String(idCarga) }, usuario: { id: idCamionero } };
}

/**
 * Cliente de transacción simulado. Devuelve, según la tabla que pregunte la
 * consulta, lo que cada test necesita — como pg, con NUMERIC como string — y
 * deja un registro de las consultas para poder revisar el flujo (ROLLBACK vs
 * COMMIT) sin depender de una base real.
 *
 * @param {{ estadoActual: string, pesoCarga: string, filaCamionero: object|null }} datos
 */
function clienteSimulado({ estadoActual, pesoCarga, filaCamionero }) {
    const consultas = [];
    return {
        consultas,
        async query(sql) {
            consultas.push(sql.replace(/\s+/g, ' ').trim());
            const texto = consultas[consultas.length - 1];
            if (texto.startsWith('SELECT estado_actual, peso_kg FROM CARGA')) {
                return { rows: [{ estado_actual: estadoActual, peso_kg: pesoCarga }] };
            }
            if (texto.startsWith('SELECT capacidad_kg FROM CAMIONERO')) {
                return { rows: filaCamionero ? [filaCamionero] : [] };
            }
            if (texto.startsWith('INSERT INTO POSTULACION')) {
                return { rows: [{ id_postulacion: 1, id_carga: 2, id_camionero: 2, estado: 'pendiente', fecha_postulacion: new Date() }] };
            }
            return { rows: [] }; // BEGIN, COMMIT, ROLLBACK
        },
        release() {},
    };
}

test('crearPostulacion valida la capacidad del camionero sin tocar la base real', async (t) => {
    // Un solo mock de pool.connect para todo el bloque: node:test no permite
    // volver a mockear la misma propiedad sin restaurarla antes. Cada subtest
    // sólo cambia qué cliente simulado devuelve la próxima conexión.
    let client;
    mock.method(pool, 'connect', async () => client);
    t.after(() => mock.restoreAll());

    await t.test('peso mayor que la capacidad: 409 con el mensaje con los kilos', async () => {
        client = clienteSimulado({ estadoActual: 'disponible', pesoCarga: '1500', filaCamionero: { capacidad_kg: '1000' } });

        const res = respuesta();
        await crearPostulacion(pedido(1, 2), res);

        assert.equal(res.codigo, 409);
        assert.equal(res.cuerpo.message, 'La carga pesa 1500 kg y tu capacidad es 1000 kg.');
        assert.ok(client.consultas.some((q) => q === 'ROLLBACK'));
        assert.ok(!client.consultas.some((q) => q.startsWith('INSERT INTO POSTULACION')));
    });

    await t.test('peso igual a la capacidad: pasa la validación y sigue a la inserción', async () => {
        // 'pendiente' evita el UPDATE de estado + bitácora de la primera
        // postulación: ese flujo ya está cubierto en otro lado y no es lo
        // que este test necesita probar.
        client = clienteSimulado({ estadoActual: 'pendiente', pesoCarga: '1000', filaCamionero: { capacidad_kg: '1000' } });

        const res = respuesta();
        await crearPostulacion(pedido(2, 2), res);

        assert.equal(res.codigo, 201);
        assert.ok(client.consultas.some((q) => q.startsWith('INSERT INTO POSTULACION')));
        assert.ok(client.consultas.some((q) => q === 'COMMIT'));
    });

    await t.test("900 contra 1000 como NUMERIC-string: numéricamente entra, aunque '900' > '1000' como texto", async () => {
        client = clienteSimulado({ estadoActual: 'pendiente', pesoCarga: '900', filaCamionero: { capacidad_kg: '1000' } });

        const res = respuesta();
        await crearPostulacion(pedido(3, 2), res);

        assert.equal(res.codigo, 201);
        assert.ok(client.consultas.some((q) => q.startsWith('INSERT INTO POSTULACION')));
    });

    await t.test('camionero sin capacidad cargada en el perfil (NULL): 409', async () => {
        client = clienteSimulado({ estadoActual: 'disponible', pesoCarga: '500', filaCamionero: { capacidad_kg: null } });

        const res = respuesta();
        await crearPostulacion(pedido(4, 3), res);

        assert.equal(res.codigo, 409);
        assert.equal(res.cuerpo.message, 'No podés postularte porque tu vehículo no tiene la capacidad cargada. Pedile a un administrador que la cargue.');
        assert.ok(client.consultas.some((q) => q === 'ROLLBACK'));
        assert.ok(!client.consultas.some((q) => q.startsWith('INSERT INTO POSTULACION')));
    });
});
