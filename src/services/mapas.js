/**
 * Servicio de cálculo de distancia entre dos puntos (HU 9).
 *
 * Encapsula por completo al proveedor de mapas: la URL, la key y el parseo de
 * la respuesta quedan acá adentro. Ningún otro archivo del proyecto sabe que
 * el proveedor es OpenRouteService (RD-03) — si el día de mañana se cambia,
 * esta es la única función que hay que tocar.
 *
 * Se eligió OpenRouteService por dar 2.000 consultas diarias gratis sin pedir
 * tarjeta. La alternativa evaluada, Google Distance Matrix, sí la pide aunque
 * se use el nivel gratuito.
 *
 * Se pide el perfil "driving-car" (auto) y no "driving-hgv" (camión): el
 * perfil de camión exige mandar peso, alto, ancho y largo del vehículo, datos
 * que el sistema todavía no le pide a ningún camionero. Como esto es una
 * estimación para planificación, no una ruta real para el chofer, la
 * distancia por ruta de auto es un proxy razonable.
 */

const URL_DIRECTIONS = 'https://api.openrouteservice.org/v2/directions/driving-car';

/** Si el proveedor tarda más que esto, se lo da por caído (RN-04). */
const TIEMPO_LIMITE_MS = 5000;

/**
 * Calcula la distancia por ruta (no en línea recta) entre dos coordenadas.
 *
 * Nunca lanza: cualquier fallo (sin key, timeout, respuesta 4xx/5xx, ruta no
 * encontrada) se traduce en `null`, para que quien llama pueda guardar la
 * carga igual con el cálculo pendiente en vez de que el alta explote (RN-04).
 *
 * @param {{lat: number, lon: number}} origen
 * @param {{lat: number, lon: number}} destino
 * @returns {Promise<number|null>} distancia en km (2 decimales), o null si no se pudo calcular.
 */
const obtenerDistanciaKm = async (origen, destino) => {
    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) {
        console.error('ORS_API_KEY no está configurada; no se puede calcular la distancia.');
        return null;
    }

    const parametros = new URLSearchParams({
        start: `${origen.lon},${origen.lat}`,
        end: `${destino.lon},${destino.lat}`,
    });

    try {
        const respuesta = await fetch(`${URL_DIRECTIONS}?${parametros}`, {
            headers: { Authorization: apiKey },
            signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
        });

        if (!respuesta.ok) {
            console.error(`OpenRouteService respondió ${respuesta.status} al calcular distancia.`);
            return null;
        }

        const cuerpo = await respuesta.json();
        const metros = cuerpo?.features?.[0]?.properties?.summary?.distance;

        if (typeof metros !== 'number') {
            console.error('OpenRouteService no devolvió una distancia utilizable.');
            return null;
        }

        return Math.round((metros / 1000) * 100) / 100;
    } catch (error) {
        console.error('No se pudo calcular la distancia con OpenRouteService:', error.message);
        return null;
    }
};

module.exports = { obtenerDistanciaKm };
