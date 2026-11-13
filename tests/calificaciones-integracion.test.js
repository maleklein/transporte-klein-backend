const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('HU11: API y PostgreSQL reales, permisos, entrega y reputación', {
    skip: process.env.CALIFICACIONES_DB_TEST !== '1', timeout: 60000,
}, async (t) => {
    require('dotenv').config();
    const { Pool } = require('pg');
    const bcrypt = require('bcrypt');
    const jwt = require('jsonwebtoken');
    const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, host: process.env.DB_HOST,
        port: process.env.DB_PORT, database: process.env.DB_NAME, connectionTimeoutMillis: 5000, statement_timeout: 10000 };
    // Esquema exclusivo y aleatorio: nunca usa ni modifica tablas de public.
    const esquema = `hu11_test_${randomBytes(8).toString('hex')}`;
    const control = new Pool(config);
    const db = new Pool({ ...config, options: `-c search_path=${esquema},pg_catalog`, max: 5 });
    let servidor;
    try {
        await control.query(`CREATE SCHEMA "${esquema}"`);
        await db.query(readFileSync(join(__dirname, '../script_tablas.sql'), 'utf8'));
        const hash = await bcrypt.hash('ClaveSoloParaPruebas11', 4);
        for (const [id, rol, estado] of [[1, 'administrador', 'activo'], [2, 'camionero', 'activo'],
            [3, 'administrador', 'activo'], [4, 'camionero', 'activo'], [5, 'camionero', 'inactivo']]) {
            await db.query(`INSERT INTO USUARIO (id_usuario,nombre,apellido,dni,email,contraseña_hash,rol,estado)
                VALUES ($1,'Persona','Prueba',$2,$3,$4,$5,$6)`, [id, String(10000000 + id), `hu11-${id}@example.test`, hash, rol, estado]);
            if (rol === 'camionero') await db.query('INSERT INTO CAMIONERO (id_usuario,capacidad_kg,ubicacion) VALUES ($1,10000,$2)', [id, 'Paraná, Entre Ríos']);
        }
        await db.query("INSERT INTO PROVINCIA VALUES ('30','Entre Ríos')");
        await db.query("INSERT INTO LOCALIDAD VALUES ('30000001','30','Paraná','Paraná',-31.73,-60.52),('30000002','30','Otra localidad','Prueba',-32,-60)");
        for (const [id, estado, asignado] of [[1,'entregada',2],[2,'en_viaje',2],[3,'cancelada',2],[4,'disponible',null],[5,'entregada',2]]) {
            await db.query(`INSERT INTO CARGA (id_carga,id_localidad_origen,id_localidad_destino,tipo_carga,peso_kg,fecha,estado_actual,id_admin_creador,id_camionero_asignado)
                VALUES ($1,'30000001','30000002','Prueba',1000,'2026-12-01',$2,1,$3)`, [id, estado, asignado]);
        }
        process.env.JWT_SECRET = randomBytes(32).toString('hex');
        require.cache[require.resolve('../src/db')] = { exports: db };
        const app = require('../index');
        servidor = app.listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => { servidor.once('listening', resolve); servidor.once('error', reject); });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const token = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '2m' });
        async function pedir(ruta, id, metodo = 'GET', datos) {
            const respuesta = await fetch(base + ruta, { method: metodo,
                headers: { ...(id ? { Authorization: `Bearer ${token(id)}` } : {}), 'Content-Type': 'application/json' },
                ...(datos === undefined ? {} : { body: JSON.stringify(datos) }) });
            return { estado: respuesta.status, cuerpo: await respuesta.json() };
        }
        const calificar = (id, datos = {}) => pedir('/calificaciones', id, 'POST', { id_carga: 1, puntaje: 5, ...datos });

        await t.test('inicio de sesión real con bcrypt y consulta del viaje entregado', async () => {
            const login = await pedir('/auth/login', null, 'POST', { email: 'hu11-1@example.test', contraseña: 'ClaveSoloParaPruebas11' });
            assert.equal(login.estado, 200);
            assert.equal(jwt.verify(login.cuerpo.token, process.env.JWT_SECRET).id, 1);
            const viaje = await pedir('/cargas/1/calificacion', 1);
            assert.equal(viaje.cuerpo.contraparte.id_usuario, 2);
            assert.equal(viaje.cuerpo.puede_calificar, true);
        });
        await t.test('sesión, cuenta activa y participación obligatorias', async () => {
            for (const [id, esperado] of [[null,401],[3,403],[4,403],[5,403]]) assert.equal((await calificar(id)).estado, esperado);
            assert.equal((await pedir('/cargas/1/calificacion', 4)).estado, 403);
            assert.equal((await calificar(1, { id_carga: 999 })).estado, 404);
        });
        await t.test('validación estricta del puntaje, ids, comentario e identidad', async () => {
            for (const puntaje of [0,6,1.5,'5',null,true,{},[]]) assert.equal((await calificar(1, { puntaje })).estado, 400);
            for (const id_carga of [0,-1,'1.5','1e0',true,[1],2147483648]) assert.equal((await calificar(1, { id_carga })).estado, 400);
            for (const comentario of [5,{},'x'.repeat(1001)]) assert.equal((await calificar(1, { comentario })).estado, 400);
            assert.equal((await calificar(1, { id_receptor: 4 })).estado, 400);
            assert.equal((await calificar(1, { id_emisor: 3 })).estado, 400);
        });
        await t.test('en viaje o cancelada no permite calificar; sin asignar tampoco', async () => {
            for (const id_carga of [2,3]) assert.equal((await calificar(1, { id_carga })).estado, 409);
            assert.equal((await calificar(1, { id_carga: 4 })).estado, 403);
            assert.equal((await pedir('/cargas/2/calificacion', 2)).cuerpo.puede_calificar, false);
        });
        await t.test('solo el administrador califica al camionero asignado, una sola vez', async () => {
            const primero = await calificar(1, { comentario: '  Buen viaje  ' });
            assert.equal(primero.estado, 201);
            assert.equal(primero.cuerpo.id_receptor, 2);
            assert.equal(primero.cuerpo.comentario, 'Buen viaje');
            assert.equal((await calificar(1)).estado, 409);
            const intentoCamionero = await calificar(2, { puntaje: 4 });
            assert.equal(intentoCamionero.estado, 403);
            assert.match(intentoCamionero.cuerpo.message, /camioner/i);
            const viaje = await pedir('/cargas/1/calificacion', 1);
            assert.equal(viaje.cuerpo.emitida.puntaje, 5);
            assert.equal(viaje.cuerpo.puede_calificar, false);
        });
        await t.test('dos envíos concurrentes crean una sola evaluación', async () => {
            const resultados = await Promise.all([calificar(1, { id_carga: 5 }), calificar(1, { id_carga: 5 })]);
            assert.deepEqual(resultados.map((r) => r.estado).sort(), [201,409]);
            assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM CALIFICACION WHERE id_carga=5')).rows[0].n, 1);
        });
        await t.test('perfil propio y de contraparte; datos personales protegidos', async () => {
            assert.equal((await pedir('/usuarios/1/reputacion', 2)).estado, 200);
            assert.equal((await pedir('/usuarios/3/reputacion', 2)).estado, 403);
            assert.equal((await pedir('/usuarios/2/reputacion', 4)).estado, 403);
            assert.equal((await pedir('/usuarios/999/reputacion', 1)).estado, 404);
            assert.equal((await pedir('/usuarios/2/reputacion?pagina=abc', 1)).estado, 400);
            const perfil = await pedir('/usuarios/2/reputacion', 2);
            assert.equal(perfil.cuerpo.reputacion.promedio, 5);
            assert.deepEqual(Object.keys(perfil.cuerpo.usuario).sort(), ['apellido','id_usuario','nombre','rol']);
            const vacio = await pedir('/usuarios/4/reputacion', 4);
            assert.equal(vacio.cuerpo.reputacion.promedio, null);
            assert.deepEqual(vacio.cuerpo.reputacion.distribucion, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
            assert.deepEqual((await pedir('/usuarios/1/reputacion', 1)).cuerpo.reputacion.distribucion, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
        });
        await t.test('circuito postular, asignar, entregar y calificar en endpoints reales', async () => {
            assert.equal((await pedir('/cargas/4/postulaciones', 2, 'POST', {})).estado, 201);
            assert.equal((await pedir('/cargas/4/asignar', 1, 'POST', { id_camionero: 2 })).estado, 200);
            assert.equal((await calificar(1, { id_carga: 4 })).estado, 409);
            assert.equal((await calificar(2, { id_carga: 4 })).estado, 403);
            for (const estado of ['en_viaje', 'entregada']) assert.equal((await pedir('/cargas/4/estado', 1, 'PATCH', { estado })).estado, 200);
            assert.equal((await pedir('/cargas/4', 2)).estado, 200);
            assert.equal((await calificar(1, { id_carga: 4, puntaje: 3 })).estado, 201);
            assert.equal((await pedir('/usuarios/2/reputacion', 1)).cuerpo.reputacion.promedio, 4.26);
            assert.equal((await pedir('/usuarios/1/reputacion', 2)).cuerpo.reputacion.promedio, null);
        });
        await t.test('historial conserva más de diez, pagina y descarta antiguas del promedio', async () => {
            for (let i = 10; i < 32; i++) {
                await db.query(`INSERT INTO CARGA (id_carga,id_localidad_origen,id_localidad_destino,tipo_carga,peso_kg,fecha,estado_actual,id_admin_creador,id_camionero_asignado)
                    VALUES ($1,'30000001','30000002','Prueba',1000,'2026-12-01','entregada',1,4)`, [i]);
                await db.query(`INSERT INTO CALIFICACION (id_emisor,id_receptor,id_carga,puntaje,creado_en)
                    VALUES (1,4,$1,$2,'2026-11-02T12:00:00Z')`, [i, i < 22 ? 1 : 5]);
            }
            const pagina1 = (await pedir('/usuarios/4/reputacion', 4)).cuerpo;
            // La distribución cuenta las 22, no solo las 10 del promedio ni las 20 de la página.
            assert.deepEqual(pagina1.reputacion, { promedio: 5, evaluaciones_utilizadas: 10, total: 22,
                distribucion: { 1: 12, 2: 0, 3: 0, 4: 0, 5: 10 } });
            // De a 5 por página: 22 son cuatro páginas llenas y una de 2.
            assert.equal(pagina1.por_pagina, 5);
            assert.equal(pagina1.historial.length, 5);
            assert.equal(pagina1.hay_mas, true);
            const pagina2 = (await pedir('/usuarios/4/reputacion?pagina=2', 4)).cuerpo;
            assert.equal(pagina2.historial.length, 5);
            assert.ok(pagina1.historial[4].id_calificacion > pagina2.historial[0].id_calificacion);
            const ultima = (await pedir('/usuarios/4/reputacion?pagina=5', 4)).cuerpo;
            assert.equal(ultima.historial.length, 2);
            assert.equal(ultima.hay_mas, false);
        });
        await t.test('restricciones SQL impiden duplicados, autopuntaje y puntajes fuera de rango', async () => {
            await assert.rejects(db.query('INSERT INTO CALIFICACION (id_emisor,id_receptor,id_carga,puntaje) VALUES (1,2,1,3)'), { code: '23505' });
            await assert.rejects(db.query('INSERT INTO CALIFICACION (id_emisor,id_receptor,id_carga,puntaje) VALUES (3,3,1,3)'), { code: '23514' });
            await assert.rejects(db.query('INSERT INTO CALIFICACION (id_emisor,id_receptor,id_carga,puntaje) VALUES (3,2,1,6)'), { code: '23514' });
        });
    } finally {
        if (servidor) await new Promise((resolve) => servidor.close(resolve));
        await db.end();
        if (!/^hu11_test_[a-f0-9]{16}$/.test(esquema)) throw new Error('Nombre de esquema de prueba inválido');
        await control.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
        await control.end();
    }
});
