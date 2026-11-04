const { PESOS, PARAMETROS, calcularPuntajes, motivosDescarte } = require('../domain/matching');
const { ESTADOS_ABIERTOS } = require('../domain/estadosCarga');
const { obtenerDistanciaKm } = require('./mapas');
const { crearResolutorUbicacion, coordenadasValidas } = require('./ubicacionMatching');

class ErrorMatching extends Error {
    constructor(message, estado) {
        super(message);
        this.estado = estado;
    }
}

async function distanciaSegura(proveedor, ubicacion, origen, esperaMs) {
    if (typeof proveedor !== 'function' || !ubicacion || !origen) return null;
    let temporizador;
    try {
        return await Promise.race([
            Promise.resolve().then(() => proveedor(ubicacion, origen)),
            new Promise((resolve) => { temporizador = setTimeout(() => resolve(null), esperaMs); }),
        ]);
    } catch {
        return null;
    } finally {
        clearTimeout(temporizador);
    }
}

/**
 * Una consulta obtiene carga, postulaciones y conteos en la misma instantánea.
 * Otra lee el catálogo de localidades para resolver los perfiles en texto.
 * No hay escrituras ni una consulta de historial por candidato. Las dependencias
 * opcionales permiten probar sin PostgreSQL y sin una API externa.
 */
async function calcularRanking(idCarga, opciones = {}) {
    const id = Number(idCarga);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ErrorMatching('El id de la carga debe ser un entero positivo.', 400);
    }
    const db = opciones.db ?? require('../db');
    const resultado = await db.query(
        `SELECT c.id_carga, c.peso_kg, c.estado_actual, c.id_camionero_asignado,
                lo.nombre || ', ' || pr.nombre AS origen,
                lo.id_localidad AS origen_id, lo.latitud AS origen_latitud, lo.longitud AS origen_longitud,
                COALESCE((
                    SELECT json_agg(datos ORDER BY datos.id_camionero)
                    FROM (
                        SELECT p.id_postulacion, p.id_camionero, p.estado AS estado_postulacion,
                               u.nombre, u.apellido, u.estado AS estado_cuenta, u.rol,
                               ca.tipo_vehiculo, ca.capacidad_kg, ca.ubicacion, ca.disponibilidad,
                               (SELECT COUNT(*) FROM CARGA entregada
                                WHERE entregada.id_camionero_asignado = ca.id_usuario
                                  AND entregada.estado_actual = 'entregada') AS viajes_entregados
                        FROM POSTULACION p
                        JOIN CAMIONERO ca ON ca.id_usuario = p.id_camionero
                        JOIN USUARIO u ON u.id_usuario = ca.id_usuario
                        WHERE p.id_carga = c.id_carga AND p.estado = 'pendiente'
                    ) datos
                ), '[]'::json) AS candidatos
         FROM CARGA c
         JOIN LOCALIDAD lo ON lo.id_localidad = c.id_localidad_origen
         JOIN PROVINCIA pr ON pr.id_provincia = lo.id_provincia
         WHERE c.id_carga = $1`,
        [id]
    );
    const carga = resultado.rows[0];
    if (!carga) throw new ErrorMatching('La carga no existe.', 404);
    if (!ESTADOS_ABIERTOS.includes(carga.estado_actual) || carga.id_camionero_asignado !== null) {
        throw new ErrorMatching('Solo se generan sugerencias para cargas abiertas sin camionero asignado.', 409);
    }
    // Valida el peso antes de llamar al proveedor de mapas.
    try {
        calcularPuntajes(carga, []);
    } catch (error) {
        if (error instanceof RangeError) throw new ErrorMatching(error.message, 409);
        throw error;
    }

    const proveedor = opciones.obtenerDistanciaKm === undefined
        ? obtenerDistanciaKm : opciones.obtenerDistanciaKm;
    const origen = coordenadasValidas(carga.origen_latitud, carga.origen_longitud);
    const hayAptos = carga.candidatos.some((c) => motivosDescarte(Number(carga.peso_kg), c).length === 0);
    const catalogo = hayAptos && origen ? await db.query(
        `SELECT l.id_localidad, l.nombre, l.departamento, p.nombre AS provincia, l.latitud, l.longitud
         FROM LOCALIDAD l JOIN PROVINCIA p ON p.id_provincia = l.id_provincia`
    ) : { rows: [] };
    const resolver = crearResolutorUbicacion(catalogo.rows);
    const distancias = new Map();
    const candidatos = await Promise.all(carga.candidatos.map(async (candidato) => {
        if (motivosDescarte(Number(carga.peso_kg), candidato).length > 0) return candidato;
        if (!origen) return { ...candidato, distancia_km: null, motivo_distancia: 'El origen de la carga no tiene coordenadas válidas.' };
        const ubicacion = resolver(candidato.ubicacion);
        if (!ubicacion.coordenadas) {
            return { ...candidato, distancia_km: null, motivo_distancia: ubicacion.advertencia };
        }
        // La memoria dura solo esta consulta; cambios posteriores recalculan todo.
        const idLocalidad = ubicacion.localidad.id_localidad;
        if (!distancias.has(idLocalidad)) {
            const mismaLocalidad = idLocalidad === carga.origen_id?.trim();
            distancias.set(idLocalidad, mismaLocalidad ? Promise.resolve(0)
                : distanciaSegura(proveedor, ubicacion.coordenadas, origen, opciones.esperaMs ?? 5000));
        }
        return {
            ...candidato, distancia_km: await distancias.get(idLocalidad),
            ubicacion_resuelta: ubicacion.localidad,
        };
    }));
    return {
        id_carga: id,
        alcance: 'postulados_pendientes',
        calculado_en: new Date().toISOString(),
        pesos: PESOS,
        parametros: PARAMETROS,
        ...calcularPuntajes(carga, candidatos),
    };
}

module.exports = { calcularRanking, ErrorMatching };
