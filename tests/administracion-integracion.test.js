const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Usuarios (HU 1.1 a 1.4), parámetros operativos (HU 10), catálogo geográfico
// y métricas (HU 13), contra la API y un PostgreSQL reales.
test('administración: usuarios, parámetros, geografía y métricas con PostgreSQL real', {
    skip: process.env.ADMINISTRACION_DB_TEST !== '1', timeout: 60000,
}, async (t) => {
    require('dotenv').config();
    const { Pool } = require('pg');
    const bcrypt = require('bcrypt');
    const jwt = require('jsonwebtoken');
    const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, host: process.env.DB_HOST,
        port: process.env.DB_PORT, database: process.env.DB_NAME, connectionTimeoutMillis: 5000, statement_timeout: 10000 };
    // Esquema exclusivo y aleatorio: nunca usa ni modifica tablas de public.
    const esquema = `admin_test_${randomBytes(8).toString('hex')}`;
    const control = new Pool(config);
    const db = new Pool({ ...config, options: `-c search_path=${esquema},pg_catalog`, max: 5 });
    let servidor;
    try {
        await control.query(`CREATE SCHEMA "${esquema}"`);
        await db.query(readFileSync(join(__dirname, '../script_tablas.sql'), 'utf8'));
        const hash = await bcrypt.hash('ClaveSoloParaPruebas', 4);
        for (const [id, nombre, rol, estado] of [[1, 'Ana', 'administrador', 'activo'], [2, 'Bruno', 'camionero', 'activo'],
            [3, 'Carla', 'camionero', 'inactivo']]) {
            await db.query(`INSERT INTO USUARIO (id_usuario,nombre,apellido,dni,email,contraseña_hash,rol,estado)
                VALUES ($1,$2,'Prueba',$3,$4,$5,$6,$7)`, [id, nombre, String(20000000 + id), `admin-${id}@example.test`, hash, rol, estado]);
            if (rol === 'camionero') {
                await db.query(`INSERT INTO CAMIONERO (id_usuario,ubicacion,tipo_vehiculo,capacidad_kg)
                    VALUES ($1,'Paraná, Entre Ríos','Semirremolque',20000)`, [id]);
            }
        }
        // Los ids siguientes los genera la base: el SERIAL tiene que arrancar después de los cargados a mano.
        await db.query("SELECT setval(pg_get_serial_sequence('usuario','id_usuario'), 3)");
        await db.query("INSERT INTO PROVINCIA VALUES ('30','Entre Ríos'),('82','Santa Fe')");
        await db.query(`INSERT INTO LOCALIDAD VALUES ('30000001','30','Paraná','Paraná',-31.73,-60.52),
            ('30000002','30','Concordia','Concordia',-31.39,-58.02),('82000001','82','Rosario','Rosario',-32.95,-60.64)`);

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
            return { estado: respuesta.status, cuerpo: await respuesta.json(), headers: respuesta.headers };
        }
        const login = (email) => pedir('/auth/login', null, 'POST', { email, contraseña: 'ClaveSoloParaPruebas' });

        await t.test('el listado de usuarios es solo para el administrador y filtra', async () => {
            assert.equal((await pedir('/usuarios', null)).estado, 401);
            assert.equal((await pedir('/usuarios', 2)).estado, 403);

            const todos = await pedir('/usuarios', 1);
            assert.equal(todos.estado, 200);
            assert.deepEqual(todos.cuerpo.map((u) => u.nombre), ['Ana', 'Bruno', 'Carla']);
            assert.equal(todos.cuerpo[0].camionero, undefined);
            assert.equal(todos.cuerpo[1].camionero.tipo_vehiculo, 'Semirremolque');
            assert.equal(todos.cuerpo[0].contraseña_hash, undefined);

            assert.deepEqual((await pedir('/usuarios?rol=camionero', 1)).cuerpo.map((u) => u.nombre), ['Bruno', 'Carla']);
            assert.deepEqual((await pedir('/usuarios?estado=inactivo', 1)).cuerpo.map((u) => u.nombre), ['Carla']);
            assert.deepEqual((await pedir('/usuarios?nombre=run', 1)).cuerpo.map((u) => u.nombre), ['Bruno']);
            assert.deepEqual((await pedir('/usuarios?dni=20000001', 1)).cuerpo.map((u) => u.nombre), ['Ana']);
            assert.equal((await pedir('/usuarios?rol=chofer', 1)).estado, 400);
            assert.equal((await pedir('/usuarios?estado=borrado', 1)).estado, 400);
        });

        const nuevo = { nombre: 'Diego', apellido: 'Núñez', dni: '30111222', email: 'diego@example.test',
            contraseña: 'OtraClaveDePrueba', rol: 'camionero', ubicacion: 'Rosario, Santa Fe',
            tipo_vehiculo: 'Chasis', capacidad_kg: 12000 };

        await t.test('el alta rechaza cada dato inválido con 400', async () => {
            const casos = [
                { nombre: '' }, { apellido: undefined }, { rol: null },
                { nombre: '-Diego' }, { nombre: 'x'.repeat(51) }, { apellido: 'Núñez2' },
                { dni: '30.111.222' }, { dni: '123456' }, { email: 'diego@' }, { email: `${'x'.repeat(95)}@ex.test` },
                { contraseña: 'corta' }, { contraseña: 'x'.repeat(73) }, { rol: 'chofer' },
                { ubicacion: '' }, { ubicacion: 'x'.repeat(151) }, { tipo_vehiculo: 'x'.repeat(101) },
                { capacidad_kg: 'mucha' }, { capacidad_kg: 0 },
                { dni: '20000001' }, { email: 'ADMIN-1@example.test' },
            ];
            for (const cambio of casos) {
                const respuesta = await pedir('/usuarios', 1, 'POST', { ...nuevo, ...cambio });
                assert.equal(respuesta.estado, 400, JSON.stringify(cambio));
                assert.equal(typeof respuesta.cuerpo.message, 'string');
            }
            assert.equal((await pedir('/usuarios', 2, 'POST', nuevo)).estado, 403);
        });

        let idNuevo;
        await t.test('el alta de un camionero crea las dos filas y el usuario puede iniciar sesión', async () => {
            const alta = await pedir('/usuarios', 1, 'POST', { ...nuevo, nombre: '  Diego ', rol: 'CAMIONERO' });
            assert.equal(alta.estado, 201);
            assert.equal(alta.cuerpo.nombre, 'Diego');
            assert.equal(alta.cuerpo.rol, 'camionero');
            assert.equal(alta.cuerpo.estado, 'activo');
            assert.equal(alta.cuerpo.camionero.ubicacion, 'Rosario, Santa Fe');
            assert.equal(alta.cuerpo.contraseña_hash, undefined);
            idNuevo = alta.cuerpo.id_usuario;

            const sesion = await pedir('/auth/login', null, 'POST', { email: nuevo.email, contraseña: nuevo.contraseña });
            assert.equal(sesion.estado, 200);
            assert.deepEqual(sesion.cuerpo.user, { id: idNuevo, email: nuevo.email, rol: 'camionero', nombre: 'Diego', apellido: 'Núñez' });

            const admin = await pedir('/usuarios', 1, 'POST', { nombre: 'Elena', apellido: 'Paz', dni: '30111223',
                email: 'elena@example.test', contraseña: 'OtraClaveDePrueba', rol: 'administrador' });
            assert.equal(admin.estado, 201);
            assert.equal(admin.cuerpo.camionero, undefined);
        });

        const edicion = { nombre: 'Diego', apellido: 'Núñez', email: 'diego@example.test', estado: 'activo',
            ubicacion: 'Rosario, Santa Fe', tipo_vehiculo: 'Chasis', capacidad_kg: 12000 };

        await t.test('la edición rechaza cada dato inválido', async () => {
            assert.equal((await pedir('/usuarios/abc', 1, 'PUT', edicion)).estado, 400);
            assert.equal((await pedir('/usuarios/999', 1, 'PUT', edicion)).estado, 404);
            const casos = [
                { dni: '30111222' }, { rol: 'administrador' }, { contraseña: 'NuevaClave123' },
                { nombre: '' }, { estado: undefined }, { nombre: 'D1ego' }, { apellido: '-' },
                { email: 'sin-arroba' }, { estado: 'borrado' },
                { ubicacion: '' }, { ubicacion: 'x'.repeat(151) }, { tipo_vehiculo: 'x'.repeat(101) },
                { capacidad_kg: 'mucha' }, { capacidad_kg: -5 }, { email: 'Admin-1@Example.test' },
            ];
            for (const cambio of casos) {
                const respuesta = await pedir(`/usuarios/${idNuevo}`, 1, 'PUT', { ...edicion, ...cambio });
                assert.equal(respuesta.estado, 400, JSON.stringify(cambio));
            }
        });

        await t.test('la edición actualiza los datos y dar de baja corta el inicio de sesión', async () => {
            const cambio = await pedir(`/usuarios/${idNuevo}`, 1, 'PUT',
                { ...edicion, apellido: 'Núñez Paz', capacidad_kg: 15000, estado: 'INACTIVO' });
            assert.equal(cambio.estado, 200);
            assert.equal(cambio.cuerpo.apellido, 'Núñez Paz');
            assert.equal(cambio.cuerpo.estado, 'inactivo');
            assert.equal(Number(cambio.cuerpo.camionero.capacidad_kg), 15000);
            assert.equal((await pedir('/auth/login', null, 'POST', { email: nuevo.email, contraseña: nuevo.contraseña })).estado, 403);

            // Un administrador no tiene datos de camionero: alcanza con los campos comunes.
            const admin = await pedir('/usuarios/1', 1, 'PUT', { nombre: 'Ana María', apellido: 'Prueba',
                email: 'admin-1@example.test', estado: 'activo' });
            assert.equal(admin.estado, 200);
            assert.equal(admin.cuerpo.camionero, undefined);
        });

        await t.test('un administrador no puede darse de baja a sí mismo', async () => {
            const propia = { nombre: 'Ana María', apellido: 'Prueba', email: 'admin-1@example.test' };

            const baja = await pedir('/usuarios/1', 1, 'PUT', { ...propia, estado: 'inactivo' });
            assert.equal(baja.estado, 409);
            assert.match(baja.cuerpo.message, /tu propia cuenta/);

            // Sigue activa y pudiendo trabajar: el rechazo no dejó la cuenta a medias.
            assert.equal((await pedir('/usuarios', 1)).estado, 200);
            // Dar de baja a otro administrador sí se puede.
            const otro = await pedir('/usuarios', 1, 'POST', { nombre: 'Fede', apellido: 'Paz', dni: '30111224',
                email: 'fede@example.test', contraseña: 'OtraClaveDePrueba', rol: 'administrador' });
            assert.equal(otro.estado, 201);
            const bajaOtro = await pedir(`/usuarios/${otro.cuerpo.id_usuario}`, 1, 'PUT',
                { nombre: 'Fede', apellido: 'Paz', email: 'fede@example.test', estado: 'inactivo' });
            assert.equal(bajaOtro.estado, 200);
            assert.equal(bajaOtro.cuerpo.estado, 'inactivo');
        });

        await t.test('una cuenta dada de baja no puede usar la API, y el 403 lo dice con un código', async () => {
            // `idNuevo` quedó inactivo en la prueba anterior; su token sigue siendo válido.
            const respuesta = await pedir('/cargas', idNuevo);
            assert.equal(respuesta.estado, 403);
            assert.equal(respuesta.cuerpo.codigo, 'cuenta_inactiva');

            // El 403 por falta de permisos no trae ese código: el front no debe cerrar la sesión ahí.
            const sinPermiso = await pedir('/usuarios', 2);
            assert.equal(sinPermiso.estado, 403);
            assert.equal(sinPermiso.cuerpo.codigo, undefined);
        });

        await t.test('el inicio de sesión rechaza datos faltantes y credenciales incorrectas', async () => {
            assert.equal((await pedir('/auth/login', null, 'POST', { email: 'admin-1@example.test' })).estado, 400);
            assert.equal((await pedir('/auth/login', null, 'POST', { email: 'nadie@example.test', contraseña: 'x' })).estado, 401);
            assert.equal((await pedir('/auth/login', null, 'POST', { email: 'admin-1@example.test', contraseña: 'mal' })).estado, 401);
            assert.equal((await login('admin-3@example.test')).estado, 403);
            assert.equal((await login('admin-1@example.test')).estado, 200);
        });

        await t.test('parámetros operativos: consultar y cambiar, solo el administrador', async () => {
            assert.equal((await pedir('/parametros-operativos', 2)).estado, 403);
            const actuales = await pedir('/parametros-operativos', 1);
            assert.equal(actuales.estado, 200);
            assert.deepEqual(actuales.cuerpo.map((p) => [p.clave, p.valor]),
                [['costo_por_km', 1800], ['peaje_por_km', 150], ['tarifa_por_km', 2600]]);

            const invalido = await pedir('/parametros-operativos', 1, 'PUT', { costo_por_km: 0, peaje_por_km: 150, tarifa_por_km: 2600 });
            assert.equal(invalido.estado, 400);
            assert.ok(invalido.cuerpo.errores.costo_por_km);

            const cambio = await pedir('/parametros-operativos', 1, 'PUT', { costo_por_km: 1900.5, peaje_por_km: 150, tarifa_por_km: '2700' });
            assert.equal(cambio.estado, 200);
            assert.deepEqual(cambio.cuerpo.map((p) => p.valor), [1900.5, 150, 2700]);
        });

        await t.test('catálogo geográfico: provincias y localidades', async () => {
            assert.equal((await pedir('/provincias', null)).estado, 401);
            const provincias = await pedir('/provincias', 2);
            assert.equal(provincias.estado, 200);
            assert.deepEqual(provincias.cuerpo, [{ id: '30', nombre: 'Entre Ríos' }, { id: '82', nombre: 'Santa Fe' }]);
            assert.match(provincias.headers.get('cache-control'), /max-age=86400/);

            for (const consulta of ['', '?provincia=3', '?provincia=abc']) {
                assert.equal((await pedir(`/localidades${consulta}`, 2)).estado, 400);
            }
            assert.equal((await pedir('/localidades?provincia=99', 2)).estado, 404);
            const localidades = await pedir('/localidades?provincia=30', 2);
            assert.equal(localidades.estado, 200);
            assert.deepEqual(localidades.cuerpo.map((l) => l.nombre), ['Concordia', 'Paraná']);
        });

        await t.test('métricas: período, indicadores y entregas por semana', async () => {
            // Carga 1: pendiente → aceptada en 4 h → entregada 48 h después. Carga 2: cancelada.
            await db.query(`INSERT INTO CARGA (id_carga,id_localidad_origen,id_localidad_destino,tipo_carga,peso_kg,fecha,
                estado_actual,id_admin_creador,id_camionero_asignado,creado_en) VALUES
                (1,'30000001','82000001','Soja',1000,'2026-10-10','entregada',1,2,'2026-10-05 09:00'),
                (2,'30000001','82000001','Maíz',1000,'2026-10-10','cancelada',1,NULL,'2026-10-06 09:00')`);
            await db.query(`INSERT INTO ESTADO_CARGA (id_carga,estado_anterior,estado_nuevo,id_actor,marca_tiempo) VALUES
                (1,'disponible','pendiente',2,'2026-10-05 10:00'), (1,'pendiente','aceptada',1,'2026-10-05 14:00'),
                (1,'aceptada','en_viaje',1,'2026-10-06 08:00'), (1,'en_viaje','entregada',1,'2026-10-07 14:00'),
                (2,'disponible','cancelada',1,'2026-10-06 12:00')`);

            assert.equal((await pedir('/metricas', 2)).estado, 403);
            for (const consulta of ['?fecha_desde=05/10/2026', '?fecha_hasta=2026-13-01',
                '?fecha_desde=2026-10-31&fecha_hasta=2026-10-01']) {
                assert.equal((await pedir(`/metricas${consulta}`, 1)).estado, 400, consulta);
            }

            const octubre = await pedir('/metricas?fecha_desde=2026-10-01&fecha_hasta=2026-10-31', 1);
            assert.equal(octubre.estado, 200);
            assert.deepEqual(octubre.cuerpo.periodo, { fecha_desde: '2026-10-01', fecha_hasta: '2026-10-31' });
            assert.equal(octubre.cuerpo.total_cargas, 2);
            assert.equal(octubre.cuerpo.cargas_por_estado.entregada, 1);
            assert.equal(octubre.cuerpo.cargas_por_estado.cancelada, 1);
            assert.equal(octubre.cuerpo.cargas_por_estado.disponible, 0);
            assert.equal(octubre.cuerpo.tiempo_promedio_asignacion_horas, 4);
            assert.equal(octubre.cuerpo.tiempo_promedio_entrega_horas, 48);
            assert.equal(octubre.cuerpo.tasa_cumplimiento, 0.5);
            assert.equal(octubre.cuerpo.camioneros_con_viaje, 1);
            assert.equal(octubre.cuerpo.hay_datos, true);
            const semana = octubre.cuerpo.entregadas_por_semana.find((s) => s.semana_inicio === '2026-10-05');
            assert.equal(semana.cantidad, 1);
            assert.equal(octubre.cuerpo.entregadas_por_semana.reduce((suma, s) => suma + s.cantidad, 0), 1);

            // Un período sin movimientos: todo en cero y sin promedios.
            const vacio = await pedir('/metricas?fecha_desde=2025-01-01&fecha_hasta=2025-01-31', 1);
            assert.equal(vacio.cuerpo.total_cargas, 0);
            assert.equal(vacio.cuerpo.tiempo_promedio_asignacion_horas, null);
            assert.equal(vacio.cuerpo.tasa_cumplimiento, null);
            assert.equal(vacio.cuerpo.hay_datos, false);

            // Sin fechas, toma los últimos 30 días; con una sola, completa la otra.
            const porDefecto = await pedir('/metricas', 1);
            assert.equal(porDefecto.estado, 200);
            assert.equal(porDefecto.cuerpo.periodo.fecha_hasta, new Date().toISOString().slice(0, 10));
            assert.equal((await pedir('/metricas?fecha_hasta=2026-10-31', 1)).cuerpo.periodo.fecha_desde, '2026-10-01');
            assert.equal((await pedir('/metricas?fecha_desde=2026-10-01', 1)).cuerpo.periodo.fecha_hasta,
                new Date().toISOString().slice(0, 10));
        });
    } finally {
        if (servidor) await new Promise((resolve) => servidor.close(resolve));
        await db.end();
        await control.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
        await control.end();
    }
});
