/** Reglas puras de HU 5: sin Express, PostgreSQL ni llamadas a mapas. */
const PESOS = Object.freeze({ capacidad: 40, cercania: 25, disponibilidad: 20, historial: 15 });
const PARAMETROS = Object.freeze({ distancia_maxima_km: 300, entregas_referencia: 10 });

function numero(valor) {
    if (typeof valor !== 'number' && typeof valor !== 'string') return null;
    if (typeof valor === 'string' && valor.trim() === '') return null;
    const convertido = Number(valor);
    return Number.isFinite(convertido) ? convertido : null;
}

const redondear = (valor) => Math.round((valor + Number.EPSILON) * 100) / 100;

/** Devuelve motivos de descarte; un puntaje alto nunca compensa estos requisitos. */
function motivosDescarte(peso, candidato) {
    const motivos = [];
    const capacidad = numero(candidato.capacidad_kg);
    if (candidato.estado_cuenta !== 'activo' || candidato.rol !== 'camionero') {
        motivos.push('La cuenta no es un camionero activo.');
    }
    if (candidato.estado_postulacion !== 'pendiente') {
        motivos.push('No tiene una postulación pendiente.');
    }
    if (capacidad === null || capacidad <= 0) {
        motivos.push('La capacidad no está informada o no es válida.');
    } else if (capacidad < peso) {
        motivos.push('La capacidad es menor que el peso de la carga.');
    }
    if (candidato.disponibilidad !== true) {
        motivos.push('No tiene disponibilidad confirmada.');
    }
    return motivos;
}

/**
 * Datos de entrada planos. distancia_km proviene de mapas (null si no se pudo
 * calcular); viajes_entregados es un conteo de cargas, no una calificación.
 * Cada criterio devuelve puntos y una explicación para el administrador.
 */
function calcularPuntajes(carga, candidatos) {
    const peso = numero(carga.peso_kg);
    if (peso === null || peso <= 0) throw new RangeError('La carga debe tener un peso positivo válido.');

    const descartados = [];
    const aptos = [];
    for (const candidato of candidatos) {
        const motivos = motivosDescarte(peso, candidato);
        if (motivos.length > 0) {
            descartados.push({ id_camionero: candidato.id_camionero, motivos });
            continue;
        }

        const capacidad = numero(candidato.capacidad_kg);
        const distancia = numero(candidato.distancia_km);
        const distanciaValida = distancia !== null && distancia >= 0;
        const historial = numero(candidato.viajes_entregados);
        const entregas = historial !== null && Number.isInteger(historial) && historial >= 0 ? historial : 0;
        const puntos = {
            capacidad: PESOS.capacidad * peso / capacidad,
            cercania: distanciaValida
                ? PESOS.cercania * Math.max(0, 1 - distancia / PARAMETROS.distancia_maxima_km) : 0,
            disponibilidad: PESOS.disponibilidad,
            historial: PESOS.historial * Math.min(entregas / PARAMETROS.entregas_referencia, 1),
        };
        const explicaciones = {
            capacidad: `Capacidad de ${capacidad} kg para una carga de ${peso} kg.`,
            cercania: distanciaValida
                ? `Distancia estimada al origen: ${redondear(distancia)} km.`
                : 'Distancia no disponible; cercanía aporta cero puntos.',
            disponibilidad: 'Disponibilidad declarada confirmada.',
            historial: `${entregas} viajes entregados registrados; mide experiencia, no reputación.`,
        };

        aptos.push({
            id_camionero: candidato.id_camionero,
            id_postulacion: candidato.id_postulacion,
            nombre: candidato.nombre,
            apellido: candidato.apellido,
            tipo_vehiculo: candidato.tipo_vehiculo,
            ubicacion: candidato.ubicacion,
            capacidad_kg: capacidad,
            disponibilidad: true,
            viajes_entregados: entregas,
            distancia_km: distanciaValida ? distancia : null,
            puntaje_total: Object.values(puntos).reduce((total, valor) => total + valor, 0),
            desglose: Object.fromEntries(Object.keys(PESOS).map((criterio) => [criterio, {
                puntos: redondear(puntos[criterio]),
                maximo: PESOS[criterio],
                explicacion: explicaciones[criterio],
            }])),
            advertencias: distanciaValida ? [] : ['No se pudo calcular la distancia al origen.'],
        });
    }

    aptos.sort((a, b) => b.puntaje_total - a.puntaje_total || a.id_camionero - b.id_camionero);
    return {
        sugeridos: aptos.map((candidato, indice) => ({
            ...candidato, posicion: indice + 1, puntaje_total: redondear(candidato.puntaje_total),
        })),
        descartados,
    };
}

module.exports = { PESOS, PARAMETROS, calcularPuntajes, motivosDescarte };
