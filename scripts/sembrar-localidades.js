/**
 * Siembra el catálogo geográfico (PROVINCIA y LOCALIDAD) desde la API georef
 * del gobierno argentino.
 *
 * Hace falta correrlo una vez sobre una base recién armada, ANTES de crear
 * cargas: CARGA referencia a LOCALIDAD, así que sin catálogo no se puede dar
 * de alta nada.
 *
 * De georef se usa la entidad `localidades-censales` y no `localidades` ni
 * `municipios`. El motivo está explicado en `script_tablas.sql`, arriba de la
 * definición de las tablas.
 *
 * Es idempotente: inserta con ON CONFLICT DO UPDATE, así que se puede volver a
 * correr cuando georef actualice el catálogo (pasa muy de vez en cuando) sin
 * romper las cargas que ya apuntan a una localidad.
 *
 * Además guarda lo que bajó en `scripts/localidades.json`, que va commiteado.
 * Si georef no responde, siembra desde ese archivo: la base se tiene que poder
 * armar sin internet.
 *
 * Uso:
 *   node scripts/sembrar-localidades.js              (baja de georef, con respaldo)
 *   node scripts/sembrar-localidades.js --offline    (usa el archivo directamente)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

const URL_GEOREF = 'https://apis.datos.gob.ar/georef/api';
const ARCHIVO_RESPALDO = path.join(__dirname, 'localidades.json');

/** El tope que acepta georef en `max` es 5000, y hay ~4000 localidades. */
const MAXIMO_POR_PEDIDO = 5000;

/** Si georef tarda más que esto, se usa el respaldo en vez de quedarse colgado. */
const TIEMPO_LIMITE_MS = 20000;

/**
 * Pide un recurso a georef y devuelve el arreglo de resultados.
 *
 * La respuesta trae los datos en una clave con el nombre del recurso
 * ("provincias", "localidades_censales"), así que se busca el primer arreglo
 * en vez de hardcodear la clave.
 *
 * @param {string} recurso - ruta del recurso, ej 'provincias'.
 * @param {Record<string, string>} parametros - query params.
 * @returns {Promise<object[]>} los registros devueltos.
 */
async function pedirAGeoref(recurso, parametros) {
    const consulta = new URLSearchParams({ ...parametros, max: String(MAXIMO_POR_PEDIDO) });
    const respuesta = await fetch(`${URL_GEOREF}/${recurso}?${consulta}`, {
        signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });

    if (!respuesta.ok) {
        throw new Error(`georef respondió ${respuesta.status} al pedir ${recurso}`);
    }

    const cuerpo = await respuesta.json();
    const datos = Object.values(cuerpo).find((valor) => Array.isArray(valor));

    if (!datos || datos.length === 0) {
        throw new Error(`georef no devolvió datos para ${recurso}`);
    }

    return datos;
}

/**
 * Trae el catálogo completo de georef y lo deja guardado como respaldo.
 *
 * @returns {Promise<{provincias: object[], localidades: object[]}>}
 */
async function bajarDeGeoref() {
    const provincias = await pedirAGeoref('provincias', { campos: 'id,nombre' });
    const localidades = await pedirAGeoref('localidades-censales', {
        campos: 'id,nombre,provincia,departamento,centroide',
    });

    const catalogo = { bajado_en: new Date().toISOString(), provincias, localidades };
    fs.writeFileSync(ARCHIVO_RESPALDO, JSON.stringify(catalogo), 'utf8');

    return catalogo;
}

/**
 * Lee el catálogo del archivo de respaldo commiteado en el repo.
 *
 * @returns {{provincias: object[], localidades: object[]}}
 */
function leerRespaldo() {
    if (!fs.existsSync(ARCHIVO_RESPALDO)) {
        throw new Error(
            `No hay respaldo en ${ARCHIVO_RESPALDO}. Hace falta internet para la primera siembra.`,
        );
    }
    return JSON.parse(fs.readFileSync(ARCHIVO_RESPALDO, 'utf8'));
}

/**
 * Inserta (o actualiza) el catálogo en la base, todo en una transacción: si
 * algo falla a mitad de camino, no queda un catálogo incompleto que haría
 * fallar las FK de CARGA.
 *
 * @param {object[]} provincias - registros de georef.
 * @param {object[]} localidades - registros de georef.
 * @returns {Promise<void>}
 */
async function guardarEnLaBase(provincias, localidades) {
    const cliente = await pool.connect();

    try {
        await cliente.query('BEGIN');

        // UNNEST inserta las 4000 filas en una sola sentencia. Fila por fila
        // serían 4000 idas y vueltas a Postgres.
        await cliente.query(
            `INSERT INTO PROVINCIA (id_provincia, nombre)
             SELECT * FROM UNNEST($1::char(2)[], $2::varchar[])
             ON CONFLICT (id_provincia) DO UPDATE SET nombre = EXCLUDED.nombre`,
            [provincias.map((p) => p.id), provincias.map((p) => p.nombre)],
        );

        await cliente.query(
            `INSERT INTO LOCALIDAD (id_localidad, id_provincia, nombre, departamento, latitud, longitud)
             SELECT * FROM UNNEST($1::char(8)[], $2::char(2)[], $3::varchar[], $4::varchar[], $5::numeric[], $6::numeric[])
             ON CONFLICT (id_localidad) DO UPDATE SET
                 id_provincia = EXCLUDED.id_provincia,
                 nombre       = EXCLUDED.nombre,
                 departamento = EXCLUDED.departamento,
                 latitud      = EXCLUDED.latitud,
                 longitud     = EXCLUDED.longitud`,
            [
                localidades.map((l) => l.id),
                localidades.map((l) => l.provincia.id),
                localidades.map((l) => l.nombre),
                localidades.map((l) => l.departamento?.nombre ?? null),
                localidades.map((l) => l.centroide.lat),
                localidades.map((l) => l.centroide.lon),
            ],
        );

        await cliente.query('COMMIT');
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
    } finally {
        cliente.release();
    }
}

(async () => {
    const soloOffline = process.argv.includes('--offline');

    try {
        let catalogo;

        if (soloOffline) {
            console.log('Modo offline: leyendo el respaldo del repo.');
            catalogo = leerRespaldo();
        } else {
            try {
                console.log('Bajando el catálogo de georef...');
                catalogo = await bajarDeGeoref();
                console.log(`  respaldo actualizado en ${path.relative(process.cwd(), ARCHIVO_RESPALDO)}`);
            } catch (error) {
                console.warn(`No se pudo consultar georef (${error.message}).`);
                console.warn('Sigo con el respaldo del repo.');
                catalogo = leerRespaldo();
            }
        }

        const { provincias, localidades } = catalogo;
        await guardarEnLaBase(provincias, localidades);

        const total = await pool.query(
            'SELECT (SELECT COUNT(*) FROM PROVINCIA) AS provincias, (SELECT COUNT(*) FROM LOCALIDAD) AS localidades',
        );

        console.log('\nCatálogo sembrado:');
        console.log(`  provincias  ${total.rows[0].provincias}`);
        console.log(`  localidades ${total.rows[0].localidades}`);
    } catch (error) {
        console.error('No se pudo sembrar el catálogo:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
})();
