/**
 * Prueba manual del módulo de mapas (HU 9, Bloque 1).
 *
 * Resuelve dos ids de localidad a sus coordenadas y llama a
 * obtenerDistanciaKm, para confirmar que el módulo funciona antes de
 * integrarlo a ningún endpoint.
 *
 * Uso:
 *   node scripts/probar-mapas.js <id_localidad_origen> <id_localidad_destino>
 *
 * Para conseguir ids de prueba:
 *   SELECT id_localidad, nombre FROM LOCALIDAD LIMIT 5;
 */

require('dotenv').config();
const pool = require('../src/db');
const { obtenerDistanciaKm } = require('../src/services/mapas');

(async () => {
    const [idOrigen, idDestino] = process.argv.slice(2);

    if (!idOrigen || !idDestino) {
        console.error('Uso: node scripts/probar-mapas.js <id_localidad_origen> <id_localidad_destino>');
        process.exit(1);
    }

    try {
        const resultado = await pool.query(
            'SELECT id_localidad, nombre, latitud, longitud FROM LOCALIDAD WHERE id_localidad = ANY($1::char(8)[])',
            [[idOrigen, idDestino]],
        );

        const porId = Object.fromEntries(resultado.rows.map((fila) => [fila.id_localidad.trim(), fila]));
        const origen = porId[idOrigen];
        const destino = porId[idDestino];

        if (!origen || !destino) {
            console.error('No se encontró alguna de las dos localidades. Revisá los ids con el SELECT del encabezado.');
            process.exit(1);
        }

        console.log(`Origen:  ${origen.nombre} (${origen.latitud}, ${origen.longitud})`);
        console.log(`Destino: ${destino.nombre} (${destino.latitud}, ${destino.longitud})`);

        const km = await obtenerDistanciaKm(
            { lat: origen.latitud, lon: origen.longitud },
            { lat: destino.latitud, lon: destino.longitud },
        );

        console.log(
            km === null
                ? 'No se pudo calcular la distancia (revisá ORS_API_KEY en tu .env, o mirá el mensaje de error de arriba).'
                : `Distancia: ${km} km`,
        );
    } finally {
        await pool.end();
    }
})();
