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
 * Orden natural del ciclo de vida. Sirve para distinguir una transición que
 * avanza de una que retrocede: si el destino aparece antes que el estado
 * actual, es una corrección.
 *
 * `cancelada` queda afuera a propósito: no es un paso del flujo, es una salida.
 */
const FLUJO = Object.freeze([
    ESTADOS.DISPONIBLE,
    ESTADOS.PENDIENTE,
    ESTADOS.ACEPTADA,
    ESTADOS.EN_VIAJE,
    ESTADOS.ENTREGADA,
]);

/**
 * Transiciones permitidas desde cada estado.
 *
 * Además de avanzar, se puede retroceder un paso mientras la carga no haya
 * llegado a un estado final. Eso es deliberado: el administrador cambia los
 * estados a mano y un clic equivocado tiene que poder corregirse. La corrección
 * no borra nada — queda asentada en ESTADO_CARGA como cualquier otro cambio,
 * que es justamente lo que el SRS (§979) espera de la bitácora: "permite
 * auditar cualquier intento de transición inválida".
 *
 * Los dos estados finales salen de reglas distintas:
 * - `entregada` por RN-01: "una carga entregada no puede volver a estados
 *   anteriores". Es un hecho físico, la mercadería ya llegó.
 * - `cancelada` por decisión del equipo: si hace falta, se da de alta una
 *   carga nueva. Del clic accidental protege el diálogo de confirmación que
 *   pide HU 2.4.
 *
 * Cancelar sólo se puede desde "disponible" o "pendiente" (HU 2.4): desde
 * "en viaje" o "entregada" tiene que dar error.
 *
 * Que un estado tenga `[]` significa que es terminal.
 */
const TRANSICIONES = Object.freeze({
    [ESTADOS.DISPONIBLE]: [ESTADOS.PENDIENTE, ESTADOS.CANCELADA],
    [ESTADOS.PENDIENTE]: [ESTADOS.ACEPTADA, ESTADOS.DISPONIBLE, ESTADOS.CANCELADA],
    [ESTADOS.ACEPTADA]: [ESTADOS.EN_VIAJE, ESTADOS.PENDIENTE],
    [ESTADOS.EN_VIAJE]: [ESTADOS.ENTREGADA, ESTADOS.ACEPTADA],
    [ESTADOS.ENTREGADA]: [],
    [ESTADOS.CANCELADA]: [],
});

/**
 * Estados de los que ya no se vuelve. Las transiciones hacia ellos son las
 * únicas irreversibles, y por eso el frontend pide confirmación antes.
 */
const ESTADOS_FINALES = Object.freeze([ESTADOS.ENTREGADA, ESTADOS.CANCELADA]);

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

/**
 * Indica si la transición retrocede en el flujo, es decir, si corrige un
 * cambio anterior en vez de avanzar el ciclo de vida.
 *
 * @param {string} estadoActual - estado en el que está la carga.
 * @param {string} estadoNuevo - estado al que se la quiere llevar.
 * @returns {boolean} true si el destino está antes en el flujo.
 */
const esCorreccion = (estadoActual, estadoNuevo) => {
    const desde = FLUJO.indexOf(estadoActual);
    const hasta = FLUJO.indexOf(estadoNuevo);
    return desde !== -1 && hasta !== -1 && hasta < desde;
};

module.exports = {
    ESTADOS,
    ESTADOS_VALIDOS,
    ESTADOS_FINALES,
    FLUJO,
    TRANSICIONES,
    esEstadoValido,
    transicionesDesde,
    puedeTransicionar,
    esCorreccion,
};
