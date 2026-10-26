const { PESOS, PARAMETROS, calcularPuntajes, motivosDescarte } = require('../domain/matching');
const { ESTADOS_ABIERTOS } = require('../domain/estadosCarga');

class ErrorMatching extends Error {
    constructor(message, estado) {
        super(message);
        this.estado = estado;
    }
}

/** HU 9 todavía no está integrada. Su ausencia no impide calcular otros criterios. */
function obtenerProveedorDistancia() {
    let ruta;
    try {
        ruta = require.resolve('./mapas');
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') return null;
        throw error;
    }
    return require(ruta).obtenerDistanciaKm;
}

async function distanciaSegura(proveedor, ubicacion, origen, esperaMs) {
    if (typeof proveedor !== 'function' || typeof ubicacion !== 'string' || !ubicacion.trim()) return null;
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
        ? obtenerProveedorDistancia() : opciones.obtenerDistanciaKm;
    const distancias = new Map();
    const candidatos = await Promise.all(carga.candidatos.map(async (candidato) => {
        if (motivosDescarte(Number(carga.peso_kg), candidato).length > 0) return candidato;
        // La memoria dura solo esta consulta; cambios posteriores recalculan todo.
        const ubicacion = candidato.ubicacion?.trim() ?? '';
        if (!distancias.has(ubicacion)) {
            distancias.set(ubicacion, distanciaSegura(proveedor, ubicacion, carga.origen, opciones.esperaMs ?? 5000));
        }
        return { ...candidato, distancia_km: await distancias.get(ubicacion) };
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
