const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('HU4: la postulación respeta la capacidad del camionero, comparada como número', {
    skip: process.env.POSTULACION_DB_TEST !== '1', timeout: 60000,
}, async (t) => {
    require('dotenv').config();
    const { Pool } = require('pg');
    const jwt = require('jsonwebtoken');
    const config = { user: process.env.DB_USER, password: process.env.DB_PASSWORD, host: process.env.DB_HOST,
        port: process.env.DB_PORT, database: process.env.DB_NAME, connectionTimeoutMillis: 5000, statement_timeout: 10000 };
    // Esquema exclusivo y aleatorio: nunca usa ni modifica tablas de public.
    const esquema = `hu4_test_${randomBytes(8).toString('hex')}`;
    const control = new Pool(config);
    const db = new Pool({ ...config, options: `-c search_path=${esquema},pg_catalog`, max: 5 });
    let servidor;
    try {
        await control.query(`CREATE SCHEMA "${esquema}"`);
        await db.query(readFileSync(join(__dirname, '../script_tablas.sql'), 'utf8'));

        const hash = await require('bcrypt').hash('ClaveSoloParaPruebas4', 4);
        // Camionero 2: capacidad 1000. Camionero 3: sin capacidad cargada (NULL).
        for (const [id, rol] of [[1, 'administrador'], [2, 'camionero'], [3, 'camionero']]) {
            await db.query(`INSERT INTO USUARIO (id_usuario,nombre,apellido,dni,email,contraseña_hash,rol,estado)
                VALUES ($1,'Persona','Prueba',$2,$3,$4,$5,'activo')`, [id, String(20000000 + id), `hu4-${id}@example.test`, hash, rol]);
        }
        await db.query("INSERT INTO CAMIONERO (id_usuario,capacidad_kg,ubicacion) VALUES (2,1000,'Paraná, Entre Ríos')");
        await db.query("INSERT INTO CAMIONERO (id_usuario,capacidad_kg,ubicacion) VALUES (3,NULL,'Paraná, Entre Ríos')");
        await db.query("INSERT INTO PROVINCIA VALUES ('30','Entre Ríos')");
        await db.query("INSERT INTO LOCALIDAD VALUES ('30000001','30','Paraná','Paraná',-31.73,-60.52),('30000002','30','Otra localidad','Prueba',-32,-60)");
        // Pesos elegidos para que comparar como texto (en vez de número) dé el
        // resultado contrario al correcto: '900' > '1000' alfabéticamente, pero
        // 900 kg sí entra en una capacidad de 1000 kg.
        for (const [id, peso] of [[1, 1500], [2, 1000], [3, 900], [4, 500]]) {
            await db.query(`INSERT INTO CARGA (id_carga,id_localidad_origen,id_localidad_destino,tipo_carga,peso_kg,fecha,estado_actual,id_admin_creador)
                VALUES ($1,'30000001','30000002','Prueba',$2,'2026-12-01','disponible',1)`, [id, peso]);
        }

        process.env.JWT_SECRET = randomBytes(32).toString('hex');
        require.cache[require.resolve('../src/db')] = { exports: db };
        const app = require('../index');
        servidor = app.listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => { servidor.once('listening', resolve); servidor.once('error', reject); });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const token = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '2m' });
        const postular = async (idCarga, idCamionero) => {
            const respuesta = await fetch(`${base}/cargas/${idCarga}/postulaciones`, {
                method: 'POST', headers: { Authorization: `Bearer ${token(idCamionero)}`, 'Content-Type': 'application/json' },
            });
            return { estado: respuesta.status, cuerpo: await respuesta.json() };
        };

        await t.test('peso mayor que la capacidad: rechaza con 409 y el mensaje con los kilos', async () => {
            const resultado = await postular(1, 2);
            assert.equal(resultado.estado, 409);
            assert.equal(resultado.cuerpo.message, 'La carga pesa 1500 kg y tu capacidad es 1000 kg.');
        });

        await t.test('peso igual a la capacidad: es válido', async () => {
            const resultado = await postular(2, 2);
            assert.equal(resultado.estado, 201);
        });

        await t.test('peso menor con valores que fallarían comparados como texto: es válido', async () => {
            // Si la comparación fuera de texto, '900' > '1000' rechazaría esta
            // postulación por error; numéricamente 900 < 1000 y debe aceptarse.
            const resultado = await postular(3, 2);
            assert.equal(resultado.estado, 201);
        });

        await t.test('camionero sin capacidad cargada en el perfil: rechaza con 409', async () => {
            const resultado = await postular(4, 3);
            assert.equal(resultado.estado, 409);
            assert.equal(resultado.cuerpo.message, 'No podés postularte sin cargar la capacidad de tu vehículo en tu perfil.');
        });
    } finally {
        if (servidor) await new Promise((resolve) => servidor.close(resolve));
        await db.end();
        if (!/^hu4_test_[a-f0-9]{16}$/.test(esquema)) throw new Error('Nombre de esquema de prueba inválido');
        await control.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`);
        await control.end();
    }
});
