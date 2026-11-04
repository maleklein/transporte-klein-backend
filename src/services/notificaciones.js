/**
 * Servicio de notificaciones (HU 12).
 *
 * Arma y guarda los avisos que el sistema le deja a cada usuario ante los
 * eventos clave del negocio: una carga nueva, una asignación y cada cambio de
 * estado. Consultarlos y marcarlos como leídos es tarea de
 * `notificacionControllers.js`.
 *
 * Todas las funciones siguen el patrón de `registrarCambioEstado` (HU 8): no
 * abren transacción propia, reciben el `client` de la que abrió quien las
 * llama. Así el aviso y el hecho que lo origina se guardan juntos: si el alta
 * de una carga falla, nadie recibe el aviso de una carga que no existe.
 *
 * El texto se guarda ya armado y no se recalcula al mostrarlo, porque cuenta
 * lo que pasó en ese momento: si después la carga se edita, el aviso sigue
 * diciendo lo que decía cuando se mandó.
 */

const { ESTADOS, esCorreccion } = require('../domain/estadosCarga');
const { COLUMNAS_UBICACION, JOIN_UBICACION } = require('./ubicacionCarga');

/** Tipos de evento, tal como quedan en `NOTIFICACION.tipo_evento`. */
const TIPOS_NOTIFICACION = Object.freeze({
    CARGA_NUEVA: 'carga_nueva',
    CAMBIO_ESTADO: 'cambio_estado',
    CARGA_ASIGNADA: 'carga_asignada',
    ASIGNACION_CONFIRMADA: 'asignacion_confirmada',
    POSTULACION_RECHAZADA: 'postulacion_rechazada',
});

/**
 * Nombre de cada estado para usarlo dentro de un texto. Es el mismo que
 * muestran las pantallas (`utils/estadosCarga.js` del frontend); hay que
 * repetirlo acá porque el aviso se guarda ya redactado.
 */
const ETIQUETAS_ESTADO = Object.freeze({
    [ESTADOS.DISPONIBLE]: 'Disponible',
    [ESTADOS.PENDIENTE]: 'Pendiente',
    [ESTADOS.ACEPTADA]: 'Aceptada',
    [ESTADOS.EN_VIAJE]: 'En viaje',
    [ESTADOS.ENTREGADA]: 'Entregada',
    [ESTADOS.CANCELADA]: 'Cancelada',
});

/**
 * @param {string} estado - valor de `estado_actual`.
 * @returns {string} el nombre para mostrar; el valor tal cual si no se conoce.
 */
const etiquetaEstado = (estado) => ETIQUETAS_ESTADO[estado] ?? estado;

/**
 * Lee de una carga lo que hace falta para armar sus avisos: quiénes son sus
 * partes y los datos que se nombran en el texto.
 *
 * Origen y destino salen con el mismo formato que en las pantallas
 * (`COLUMNAS_UBICACION`): "Rosario, Santa Fe", pero "Córdoba" a secas cuando
 * la localidad se llama igual que su provincia.
 *
 * @param {number} idCarga - id de la carga.
 * @param {import('pg').PoolClient} client - client de la transacción en curso.
 * @returns {Promise<object>} la carga, con la fecha ya en formato DD/MM/AAAA.
 */
const leerCarga = async (idCarga, client) => {
    const resultado = await client.query(
        `SELECT c.id_admin_creador, c.id_camionero_asignado,
                c.tipo_carga, c.peso_kg,
                TO_CHAR(c.fecha, 'DD/MM/YYYY') AS fecha,${COLUMNAS_UBICACION}
         FROM CARGA c${JOIN_UBICACION}
         WHERE c.id_carga = $1`,
        [idCarga]
    );

    return resultado.rows[0];
};

/**
 * @param {object} carga - fila de `leerCarga`.
 * @returns {string} "Rosario, Santa Fe → Córdoba".
 */
const ruta = (carga) => `${carga.origen} → ${carga.destino}`;

/**
 * @param {object} carga - fila de `leerCarga`.
 * @returns {string} "Cereales, 12.500 kg, con retiro el 15/10/2026".
 */
const datosDelViaje = (carga) =>
    `${carga.tipo_carga}, ${Number(carga.peso_kg).toLocaleString('es-AR')} kg, con retiro el ${carga.fecha}`;

/**
 * Guarda un aviso para un usuario.
 *
 * Es la pieza base para los avisos de un solo destinatario. Cuando los
 * destinatarios pueden ser muchos (todos los camioneros), las funciones de
 * abajo usan un INSERT ... SELECT propio para guardarlos en una sola consulta.
 *
 * @param {number} idUsuario - destinatario.
 * @param {string} tipoEvento - uno de `TIPOS_NOTIFICACION`.
 * @param {string} contenido - texto del aviso, ya redactado.
 * @param {number|null} idCarga - carga a la que se refiere, o null si no es de una carga.
 * @param {import('pg').PoolClient} client - client de la transacción abierta por quien llama.
 * @returns {Promise<object>} la fila insertada en NOTIFICACION.
 */
const notificar = async (idUsuario, tipoEvento, contenido, idCarga, client) => {
    const resultado = await client.query(
        `INSERT INTO NOTIFICACION (id_usuario, tipo_evento, contenido, id_carga)
         VALUES ($1, $2, $3, $4)
         RETURNING id_notificacion, id_usuario, tipo_evento, contenido, id_carga, leida, creado_en`,
        [idUsuario, tipoEvento, contenido, idCarga]
    );

    return resultado.rows[0];
};

/**
 * Avisa a los camioneros que se publicó una carga que pueden tomar.
 *
 * Le llega a todo camionero con disponibilidad y con la cuenta activa. El
 * primer filtro es el que pide la HU 12; el segundo, el de su criterio de
 * aceptación ("los camioneros activos"): sin él, un camionero dado de baja
 * que había quedado como disponible seguiría recibiendo avisos.
 *
 * Va en un único INSERT ... SELECT y no en un bucle con una consulta por
 * camionero: con 200 camioneros serían 200 idas a la base dentro del alta, y
 * eso rompe el tiempo de respuesta de la RNF-001.
 *
 * @param {number} idCarga - la carga recién creada.
 * @param {import('pg').PoolClient} client - client de la transacción del alta.
 * @returns {Promise<number>} cuántos camioneros recibieron el aviso.
 */
const notificarCargaNueva = async (idCarga, client) => {
    const carga = await leerCarga(idCarga, client);
    const contenido = `Nueva carga disponible: ${ruta(carga)}. ${datosDelViaje(carga)}.`;

    const resultado = await client.query(
        `INSERT INTO NOTIFICACION (id_usuario, tipo_evento, contenido, id_carga)
         SELECT ca.id_usuario, $1, $2, $3
         FROM CAMIONERO ca
         JOIN USUARIO u ON u.id_usuario = ca.id_usuario
         WHERE ca.disponibilidad AND u.estado = 'activo'`,
        [TIPOS_NOTIFICACION.CARGA_NUEVA, contenido, idCarga]
    );

    return resultado.rowCount;
};

/**
 * Avisa de un cambio de estado a las partes de la carga.
 *
 * La llama `registrarCambioEstado` y no cada endpoint: como toda transición
 * queda asentada en la bitácora, todo endpoint que cambie un estado —los de
 * hoy y los que vengan— avisa solo, sin que haya que acordarse de agregarlo.
 *
 * Las partes son el administrador que creó la carga y el camionero asignado,
 * si ya tiene uno. A quien hizo el cambio no se le avisa: lo acaba de hacer y
 * la pantalla ya se lo confirmó. Si lo hizo el sistema (`idActor` null), les
 * llega a los dos.
 *
 * El alta no cuenta como cambio de estado, porque no hay estado anterior: su
 * aviso es `notificarCargaNueva`, que además va a otros destinatarios.
 *
 * @param {number} idCarga - id de la carga.
 * @param {string|null} estadoAnterior - estado antes del cambio, o null si es el alta.
 * @param {string} estadoNuevo - estado luego del cambio.
 * @param {number|null} idActor - quién hizo el cambio, o null si fue el sistema.
 * @param {import('pg').PoolClient} client - client de la transacción del cambio.
 * @returns {Promise<object[]>} los avisos guardados; vacío si no había a quién avisar.
 */
const notificarCambioEstado = async (idCarga, estadoAnterior, estadoNuevo, idActor, client) => {
    if (estadoAnterior === null) return [];

    const carga = await leerCarga(idCarga, client);

    // Un Set porque el creador y el camionero podrían ser la misma persona
    // en una base de prueba, y no tiene sentido mandarle el mismo aviso dos veces.
    const destinatarios = new Set(
        [carga.id_admin_creador, carga.id_camionero_asignado].filter(
            (idUsuario) => idUsuario !== null && idUsuario !== idActor
        )
    );

    // "Volvió" en vez de "pasó" cuando es una corrección (HU 7), para que no
    // se lea como si la carga hubiera avanzado.
    const verbo = esCorreccion(estadoAnterior, estadoNuevo) ? 'volvió' : 'pasó';
    const contenido =
        `La carga ${ruta(carga)} ${verbo} de ${etiquetaEstado(estadoAnterior)} a ${etiquetaEstado(estadoNuevo)}.`;

    // Acá sí va un bucle: son dos destinatarios como mucho.
    const avisos = [];
    for (const idUsuario of destinatarios) {
        avisos.push(await notificar(idUsuario, TIPOS_NOTIFICACION.CAMBIO_ESTADO, contenido, idCarga, client));
    }

    return avisos;
};

/**
 * Avisa de una asignación. La llama `POST /cargas/:id/asignar` (HU 6).
 *
 * Al camionero elegido le llegan los datos del viaje; al administrador que
 * asignó, la confirmación; y a los que se habían postulado y quedaron afuera,
 * que la carga ya tiene camionero. Los rechazados los pasa quien llama porque
 * es quien actualiza las postulaciones: así este servicio no depende de cómo
 * esté armada la tabla POSTULACION.
 *
 * Corre dentro de la transacción de la asignación, con su `client`.
 *
 * El paso de "pendiente" a "aceptada" que implica la asignación avisa aparte,
 * desde `registrarCambioEstado`, al resto de las partes. El endpoint lo
 * registra antes de asignar el camionero para que a él no le lleguen dos
 * avisos: el suyo es este, que trae los datos del viaje.
 *
 * @param {number} idCarga - la carga asignada.
 * @param {number} idCamionero - el camionero elegido.
 * @param {number} idAdmin - el administrador que hizo la asignación.
 * @param {number[]} idsRechazados - camioneros cuya postulación quedó rechazada.
 * @param {import('pg').PoolClient} client - client de la transacción de la asignación.
 * @returns {Promise<void>}
 */
const notificarAsignacion = async (idCarga, idCamionero, idAdmin, idsRechazados, client) => {
    const carga = await leerCarga(idCarga, client);
    const camionero = await client.query(
        'SELECT nombre, apellido FROM USUARIO WHERE id_usuario = $1',
        [idCamionero]
    );
    const { nombre, apellido } = camionero.rows[0];

    await notificar(
        idCamionero,
        TIPOS_NOTIFICACION.CARGA_ASIGNADA,
        `Te asignaron la carga ${ruta(carga)}. ${datosDelViaje(carga)}.`,
        idCarga,
        client
    );

    await notificar(
        idAdmin,
        TIPOS_NOTIFICACION.ASIGNACION_CONFIRMADA,
        `Asignaste la carga ${ruta(carga)} a ${nombre} ${apellido}.`,
        idCarga,
        client
    );

    if (idsRechazados?.length) {
        // Puede haber muchos postulados: una sola consulta para todos, por el
        // mismo motivo que en notificarCargaNueva.
        await client.query(
            `INSERT INTO NOTIFICACION (id_usuario, tipo_evento, contenido, id_carga)
             SELECT id_usuario, $2, $3, $4
             FROM unnest($1::int[]) AS id_usuario`,
            [
                idsRechazados,
                TIPOS_NOTIFICACION.POSTULACION_RECHAZADA,
                `La carga ${ruta(carga)} se asignó a otro camionero.`,
                idCarga,
            ]
        );
    }
};

module.exports = {
    TIPOS_NOTIFICACION,
    notificar,
    notificarCargaNueva,
    notificarCambioEstado,
    notificarAsignacion,
};
