const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Alta, edición, listado y cancelación de cargas contra un PostgreSQL real:
 * fecha de retiro vencida, dirección y observaciones opcionales, capacidad del
 * camionero y los avisos de carga nueva y de cancelación (HU 2.1, 2.2, 2.4, 3,
 * 4 y 12).
 */
test('Cargas: fecha de retiro, dirección, capacidad y avisos', {
    skip: process.env.CARGAS_DB_TEST !== '1', timeout: 60000,
}, async (t) => {
    require('dotenv').config();
    // Sin clave, el alta no llama al servicio de mapas: la distancia queda pendiente.
    delete process.env.ORS_API_KEY;
    const { Pool } = require('pg');
    const jwt = require('jsonwebtoken');
    const { hoyEnArgentina } = require('../src/validators/carga');
    const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, host: process.env.DB_HOST,
        port: process.env.DB_PORT, database: process.env.DB_NAME, connectionTimeoutMillis: 5000, statement_timeout: 10000 };
    // Esquema exclusivo y aleatorio: nunca usa ni modifica tablas de public.
    const esquema = `cargas_test_${randomBytes(8).toString('hex')}`;
    const control = new Pool(config);
    const db = new Pool({ ...config, options: `-c search_path=${esquema},pg_catalog`, max: 5 });
    let servidor;
    try {
        await control.query(`CREATE SCHEMA "${esquema}"`);
        await db.query(readFileSync(join(__dirname, '../script_tablas.sql'), 'utf8'));

        // 1 administrador. Camioneros: 2 lleva 1000 kg, 3 no tiene capacidad
        // cargada, 4 y 5 llevan 5000 kg.
        const hash = await require('bcrypt').hash('ClaveSoloParaPruebas4', 4);
        for (const [id, rol] of [[1, 'administrador'], [2, 'camionero'], [3, 'camionero'], [4, 'camionero'], [5, 'camionero']]) {
            await db.query(`INSERT INTO USUARIO (id_usuario,nombre,apellido,dni,email,contraseña_hash,rol,estado)
                VALUES ($1,'Persona','Prueba',$2,$3,$4,$5,'activo')`, [id, String(30000000 + id), `cargas-${id}@example.test`, hash, rol]);
        }
        for (const [id, capacidad] of [[2, 1000], [3, null], [4, 5000], [5, 5000]]) {
            await db.query('INSERT INTO CAMIONERO (id_usuario,capacidad_kg,ubicacion) VALUES ($1,$2,$3)', [id, capacidad, 'Paraná, Entre Ríos']);
        }
        await db.query("INSERT INTO PROVINCIA VALUES ('30','Entre Ríos')");
        await db.query("INSERT INTO LOCALIDAD VALUES ('30000001','30','Paraná','Paraná',-31.73,-60.52),('30000002','30','Otra localidad','Prueba',-32,-60)");
        // Una carga disponible con el retiro ya vencido, cargada antes de esta regla.
        await db.query(`INSERT INTO CARGA (id_carga,id_localidad_origen,id_localidad_destino,tipo_carga,peso_kg,fecha,estado_actual,id_admin_creador)
            VALUES (100,'30000001','30000002','Vencida',500,'2020-01-01','disponible',1)`);
        await db.query("SELECT setval(pg_get_serial_sequence('carga','id_carga'), 100)");

        process.env.JWT_SECRET = randomBytes(32).toString('hex');
        require.cache[require.resolve('../src/db')] = { exports: db };
        const app = require('../index');
        servidor = app.listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => { servidor.once('listening', resolve); servidor.once('error', reject); });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const token = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '2m' });
        const pedir = async (ruta, idUsuario, { method = 'GET', body } = {}) => {
            const respuesta = await fetch(`${base}${ruta}`, {
                method,
                headers: { Authorization: `Bearer ${token(idUsuario)}`, 'Content-Type': 'application/json' },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            return { estado: respuesta.status, cuerpo: await respuesta.json() };
        };
        const avisos = async (idUsuario, idCarga) =>
            (await pedir('/notificaciones', idUsuario)).cuerpo.filter((aviso) => aviso.id_carga === idCarga);
        const hoy = hoyEnArgentina();
        const nueva = (cambios = {}) => ({
            origen_id: '30000001', destino_id: '30000002', tipo_carga: 'granos',
            peso: 3000, fecha: '2099-11-20', ...cambios,
        });

        let idCarga;

        await t.test('alta sin observaciones y con dirección: se guarda y la devuelve', async () => {
            const alta = await pedir('/cargas', 1, { method: 'POST', body: nueva({
                direccion_origen: ' Av. Ramírez 1500 ', direccion_destino: '',
            }) });
            assert.equal(alta.estado, 201);
            assert.equal(alta.cuerpo.observaciones, null);
            assert.equal(alta.cuerpo.direccion_origen, 'Av. Ramírez 1500');
            assert.equal(alta.cuerpo.direccion_destino, null);
            idCarga = alta.cuerpo.id_carga;
        });

        await t.test('alta con fecha de ayer: 400 en el campo fecha; con la de hoy, 201', async () => {
            const ayer = new Date(`${hoy}T12:00:00Z`);
            ayer.setUTCDate(ayer.getUTCDate() - 1);
            const vencida = await pedir('/cargas', 1, { method: 'POST', body: nueva({ fecha: ayer.toISOString().slice(0, 10) }) });
            assert.equal(vencida.estado, 400);
            assert.equal(vencida.cuerpo.errores.fecha, 'La fecha de retiro no puede ser anterior a hoy');

            const deHoy = await pedir('/cargas', 1, { method: 'POST', body: nueva({ fecha: hoy, peso: 100 }) });
            assert.equal(deHoy.estado, 201);
        });

        await t.test('el aviso de carga nueva sólo les llega a los que pueden llevarla', async () => {
            assert.equal((await avisos(2, idCarga)).length, 0, '1000 kg no alcanzan para 3000 kg');
            assert.equal((await avisos(3, idCarga)).length, 0, 'sin capacidad cargada no se puede postular');
            assert.equal((await avisos(4, idCarga))[0].tipo_evento, 'carga_nueva');
            assert.equal((await avisos(5, idCarga))[0].tipo_evento, 'carga_nueva');
        });

        await t.test('el camionero no ve las cargas con el retiro vencido y recibe su capacidad', async () => {
            const listado = await pedir('/cargas', 2);
            assert.equal(listado.estado, 200);
            assert.ok(!listado.cuerpo.some((carga) => carga.id_carga === 100));
            assert.ok(listado.cuerpo.some((carga) => carga.id_carga === idCarga));
            assert.ok(listado.cuerpo.every((carga) => carga.capacidad_camionero_kg === 1000));

            const detalle = await pedir(`/cargas/${idCarga}`, 3);
            assert.equal(detalle.cuerpo.capacidad_camionero_kg, null);

            const delAdmin = await pedir('/cargas', 1);
            assert.ok(delAdmin.cuerpo.some((carga) => carga.id_carga === 100), 'el administrador sí la ve');
            assert.ok(delAdmin.cuerpo.every((carga) => !('capacidad_camionero_kg' in carga)));
        });

        await t.test('no se puede postular a una carga con el retiro vencido', async () => {
            const postulacion = await pedir('/cargas/100/postulaciones', 4, { method: 'POST' });
            assert.equal(postulacion.estado, 409);
            assert.equal(postulacion.cuerpo.message, 'La fecha de retiro de esta carga ya pasó: no recibe más postulaciones.');
        });

        await t.test('editar: la fecha vencida se puede conservar, pero no poner una nueva en el pasado', async () => {
            const sinCambiarFecha = await pedir('/cargas/100', 1, { method: 'PUT', body: nueva({
                fecha: '2020-01-01', peso: 500, observaciones: 'Corregida',
            }) });
            assert.equal(sinCambiarFecha.estado, 200);
            assert.equal(sinCambiarFecha.cuerpo.observaciones, 'Corregida');

            const otraVencida = await pedir('/cargas/100', 1, { method: 'PUT', body: nueva({ fecha: '2020-01-02', peso: 500 }) });
            assert.equal(otraVencida.estado, 400);
            assert.equal(otraVencida.cuerpo.errores.fecha, 'La fecha de retiro no puede ser anterior a hoy');

            const conDireccion = await pedir(`/cargas/${idCarga}`, 1, { method: 'PUT', body: nueva({ direccion_destino: 'Campo La Esperanza' }) });
            assert.equal(conDireccion.estado, 200);
            assert.equal(conDireccion.cuerpo.direccion_origen, null, 'lo que no se manda queda vacío');
            assert.equal(conDireccion.cuerpo.direccion_destino, 'Campo La Esperanza');
        });

        await t.test('cancelar: se borra el aviso de carga nueva a quien no se postuló y se avisa al postulado', async () => {
            assert.equal((await pedir(`/cargas/${idCarga}/postulaciones`, 4, { method: 'POST' })).estado, 201);

            const cancelacion = await pedir(`/cargas/${idCarga}/cancelar`, 1, { method: 'PATCH' });
            assert.equal(cancelacion.estado, 200);

            assert.deepEqual(await avisos(5, idCarga), [], 'el que no se postuló se queda sin el aviso');

            const delPostulado = (await avisos(4, idCarga)).map((aviso) => aviso.tipo_evento);
            assert.ok(delPostulado.includes('carga_nueva'), 'conserva el aviso al que respondió');
            assert.ok(delPostulado.includes('carga_cancelada'));
            const cancelada = (await avisos(4, idCarga)).find((aviso) => aviso.tipo_evento === 'carga_cancelada');
            assert.equal(cancelada.contenido, 'Se canceló la carga Paraná, Entre Ríos → Otra localidad, Entre Ríos a la que te habías postulado.');
        });

        await t.test('el listado le dice al administrador cuántos postulados esperan, y al camionero no', async () => {
            const carga = await pedir('/cargas', 1, { method: 'POST', body: nueva({ tipo_carga: 'Con postulados', peso: 900 }) });
            assert.equal(carga.estado, 201);
            const id = carga.cuerpo.id_carga;
            const delAdmin = async () => (await pedir('/cargas', 1)).cuerpo.find((item) => item.id_carga === id);
            assert.equal((await delAdmin()).cantidad_postulados, 0);

            for (const camionero of [2, 4]) {
                assert.equal((await pedir(`/cargas/${id}/postulaciones`, camionero, { method: 'POST' })).estado, 201);
            }
            assert.equal((await delAdmin()).cantidad_postulados, 2);

            const delCamionero = (await pedir('/cargas', 5)).cuerpo.find((item) => item.id_carga === id);
            assert.ok(delCamionero, 'el camionero también la ve');
            assert.equal('cantidad_postulados' in delCamionero, false);

            // Al asignarla, los postulados dejan de esperar.
            assert.equal((await pedir(`/cargas/${id}/asignar`, 1, { method: 'POST', body: { id_camionero: 4 } })).estado, 200);
            assert.equal((await delAdmin()).cantidad_postulados, 0);
        });

        await t.test('filtro por fecha de creación: mismo período que las métricas, los dos días incluidos', async () => {
            const alta = await pedir('/cargas', 1, { method: 'POST', body: nueva({ tipo_carga: 'Creada en octubre' }) });
            assert.equal(alta.estado, 201);
            const id = alta.cuerpo.id_carga;
            await db.query("UPDATE CARGA SET creado_en = TIMESTAMP '2026-10-31 23:59:59' WHERE id_carga = $1", [id]);
            const ids = async (consulta) => (await pedir(`/cargas?${consulta}`, 1)).cuerpo.map((carga) => carga.id_carga);

            assert.ok((await ids('creada_desde=2026-10-31&creada_hasta=2026-10-31')).includes(id), 'el último día entra entero');
            assert.ok(!(await ids('creada_desde=2026-11-01')).includes(id));
            assert.ok(!(await ids('creada_hasta=2026-10-30')).includes(id));
            assert.deepEqual(await ids('creada_desde=2026-10-01&creada_hasta=2026-10-31&estado=disponible'), [id]);

            // El mismo número que las métricas para ese período.
            const metricas = await pedir('/metricas?fecha_desde=2026-10-01&fecha_hasta=2026-10-31', 1);
            assert.equal(metricas.cuerpo.cargas_por_estado.disponible, 1);

            for (const consulta of ['creada_desde=31-10-2026', 'creada_hasta=ayer', 'creada_desde=2026-11-02&creada_hasta=2026-11-01']) {
                assert.equal((await pedir(`/cargas?${consulta}`, 1)).estado, 400, consulta);
            }
        });

        await t.test('notificaciones de a partes: limite y antes_de, sin repetir ni saltear', async () => {
            // 25 avisos al camionero 5; varios comparten creado_en, como los de
            // una misma transacción, para probar el desempate por id.
            await db.query('DELETE FROM NOTIFICACION WHERE id_usuario = 5');
            for (let i = 0; i < 25; i += 1) {
                await db.query(
                    `INSERT INTO NOTIFICACION (id_usuario, tipo_evento, contenido, leida, creado_en)
                     VALUES (5, 'carga_nueva', $1, false, TIMESTAMP '2026-11-01 10:00' + ($2 * INTERVAL '1 minute'))`,
                    [`Aviso ${i}`, Math.floor(i / 3)],
                );
            }
            const todas = (await pedir('/notificaciones', 5)).cuerpo.map((aviso) => aviso.id_notificacion);
            assert.equal(todas.length, 25, 'sin limite, como antes: hasta 100');

            const leidas = [];
            let antesDe;
            for (const esperadas of [10, 10, 5]) {
                const ruta = `/notificaciones?limite=10${antesDe ? `&antes_de=${antesDe}` : ''}`;
                const pagina = await pedir(ruta, 5);
                assert.equal(pagina.estado, 200);
                assert.equal(pagina.cuerpo.length, esperadas);
                leidas.push(...pagina.cuerpo.map((aviso) => aviso.id_notificacion));
                antesDe = leidas.at(-1);
            }
            assert.deepEqual(leidas, todas, 'las páginas juntas son la lista completa, en el mismo orden');
            assert.equal((await pedir(`/notificaciones?limite=10&antes_de=${antesDe}`, 5)).cuerpo.length, 0);

            // El id de un aviso de otro usuario no sirve de punto de partida.
            const ajena = (await db.query('SELECT id_notificacion FROM NOTIFICACION WHERE id_usuario <> 5 LIMIT 1')).rows[0];
            if (ajena) {
                assert.deepEqual((await pedir(`/notificaciones?antes_de=${ajena.id_notificacion}`, 5)).cuerpo, []);
            }

            for (const consulta of ['limite=0', 'limite=101', 'limite=abc', 'antes_de=-1', 'antes_de=x']) {
                assert.equal((await pedir(`/notificaciones?${consulta}`, 5)).estado, 400, consulta);
            }
        });
    } finally {
        if (servidor) await new Promise((resolve) => servidor.close(resolve));
        await db.end();
        if (!/^cargas_test_[a-f0-9]{16}$/.test(esquema)) throw new Error('Nombre de esquema de prueba inválido');
        await control.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
        await control.end();
    }
});
