/**
 * Máquina de estados de una carga (HU 7).
 *
 * Define los estados posibles y qué transiciones son válidas entre ellos.
 * Vive aparte del controlador a propósito: el frontend necesita las mismas
 * reglas para decidir qué acciones ofrecer, y las HU que vienen (postulación,
 * asignación, calificación) van a cambiar estados desde otros endpoints.
 */

/**
 * Los seis estados del ciclo de vida, según el SRS §219 y la HU 7.
 *
 * Nota: el SRS también menciona "publicada" en el criterio de aceptación de
 * HU 2.3, pero no aparece ni en la lista normativa de §219 ni en HU 7, y HU 3
 * pide que el camionero vea las cargas en "disponible". Se sigue la lista de
 * §219, que es la de la sección de requisitos.
 *
 * Se guarda `en_viaje` con guión bajo en la base; el texto para mostrar
 * ("En viaje") lo arma el frontend.
 */
const ESTADOS = Object.freeze({
    DISPONIBLE: 'disponible',
    PENDIENTE: 'pendiente',
    ACEPTADA: 'aceptada',
    EN_VIAJE: 'en_viaje',
    ENTREGADA: 'entregada',
    CANCELADA: 'cancelada',
});

/** Lista plana de estados válidos, para validar lo que llega por la API. */
const ESTADOS_VALIDOS = Object.freeze(Object.values(ESTADOS));

/**
 * Transiciones permitidas desde cada estado.
 *
 * Sale de las reglas del SRS:
 * - RN-01: una carga entregada no puede volver a estados anteriores, así que
 *   `entregada` no tiene salidas.
 * - HU 2.4: cancelar sólo se permite desde "disponible" o "pendiente"; desde
 *   "en viaje" o "entregada" tiene que dar error.
 * - `cancelada` también queda sin salidas: una carga cancelada se da de alta
 *   de nuevo, no se revive.
 *
 * Que un estado tenga `[]` significa que es terminal.
 */
const TRANSICIONES = Object.freeze({
    [ESTADOS.DISPONIBLE]: [ESTADOS.PENDIENTE, ESTADOS.CANCELADA],
    [ESTADOS.PENDIENTE]: [ESTADOS.ACEPTADA, ESTADOS.CANCELADA],
    [ESTADOS.ACEPTADA]: [ESTADOS.EN_VIAJE],
    [ESTADOS.EN_VIAJE]: [ESTADOS.ENTREGADA],
    [ESTADOS.ENTREGADA]: [],
    [ESTADOS.CANCELADA]: [],
});

/**
 * Indica si un texto es uno de los seis estados conocidos.
 *
 * @param {*} valor - lo que llegó en el body o en un query param.
 * @returns {boolean} true si es un estado válido.
 */
const esEstadoValido = (valor) => typeof valor === 'string' && ESTADOS_VALIDOS.includes(valor);

/**
 * Devuelve los estados a los que se puede pasar desde el estado dado.
 *
 * @param {string} estadoActual - estado en el que está la carga.
 * @returns {string[]} estados alcanzables; vacío si el estado es terminal o desconocido.
 */
const transicionesDesde = (estadoActual) => TRANSICIONES[estadoActual] ?? [];

/**
 * Indica si se puede pasar de un estado a otro.
 *
 * @param {string} estadoActual - estado en el que está la carga.
 * @param {string} estadoNuevo - estado al que se la quiere llevar.
 * @returns {boolean} true si la transición está permitida.
 */
const puedeTransicionar = (estadoActual, estadoNuevo) =>
    transicionesDesde(estadoActual).includes(estadoNuevo);

module.exports = {
    ESTADOS,
    ESTADOS_VALIDOS,
    TRANSICIONES,
    esEstadoValido,
    transicionesDesde,
    puedeTransicionar,
};
