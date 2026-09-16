/**
 * Controlador del módulo de Cargas (HU 2.1 + 2.1.1 + 2.2 + 3 + 7 + 8).
 * Expone el alta, la edición, la consulta y el cambio de estado de las cargas.
 */

const pool = require('../db');
const { validarCampos, esFechaValida } = require('../validators/carga');
const { registrarCambioEstado } = require('../services/registrarCambioEstado');
const {
    ESTADOS,
    ESTADOS_VALIDOS,
    esEstadoValido,
    transicionesDesde,
    puedeTransicionar,
} = require('../domain/estadosCarga');

/** Estado con el que nace toda carga nueva (HU 2.1.1). */
const ESTADO_INICIAL = ESTADOS.DISPONIBLE;

/**
 * Estados desde los que ya no se puede editar una carga (HU 2.2): una vez que
 * está en viaje o fue entregada, sus datos pasan a ser el registro de lo que
 * efectivamente pasó, no un borrador que se pueda seguir corrigiendo.
 */
const ESTADOS_BLOQUEADOS_EDICION = ['en_viaje', 'entregada'];

/**
 * POST /cargas: da de alta una carga y la deja en estado "disponible".
 *
 * Valida primero todos los campos y recién después consulta la base, así una
 * sola respuesta junta todos los errores. Los devuelve agrupados por campo
 * (`{ message, errores: { campo: mensaje } }`) para que el formulario pueda
 * mostrar cada mensaje debajo del input que corresponde.
 *
 * El administrador que queda como creador sale de `req.usuario`, que deja el
 * middleware `verifyToken`. La ruta ya exige rol de administrador, así que acá
 * no hace falta volver a chequearlo.
 *
 * Respuestas: 201 con la carga creada · 400 si hay campos inválidos ·
 * 500 ante un error inesperado. El 401 (sin token) y el 403 (rol o cuenta
 * inactiva) los resuelven los middlewares antes de llegar acá.
 *
 * @param {import('express').Request} req - request de Express, con los datos en el body.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const crearCarga = async (req, res) => {
    const { errores, valores } = validarCampos(req.body);

    if (Object.keys(errores).length > 0) {
        return res.status(400).json({
            message: 'Hay campos con errores',
            errores,
        });
    }

    // Transacción porque el alta son dos escrituras: la carga y su primer
    // registro en la bitácora. Si la segunda fallara, la carga no puede quedar
    // sin el asiento que dice quién la creó y cuándo.
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const resultado = await client.query(
            `INSERT INTO CARGA (origen, destino, tipo_carga, peso_kg, fecha, observaciones, estado_actual, id_admin_creador)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id_carga, origen, destino, tipo_carga, peso_kg AS peso,
                       -- Sin el TO_CHAR, el driver convierte el DATE a un Date de JS usando
                       -- la zona horaria local y el front termina recibiendo un timestamp.
                       TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
                       observaciones, estado_actual, id_admin_creador, creado_en, actualizado_en`,
            // Los valores ya vienen limpios y normalizados de validarCampos.
            [
                valores.origen,
                valores.destino,
                valores.tipo_carga,
                valores.peso,
                valores.fecha,
                valores.observaciones,
                ESTADO_INICIAL,
                req.usuario.id,
            ]
        );

        const cargaCreada = resultado.rows[0];

        // Primer asiento de la bitácora (HU 8): el estado anterior es null
        // porque antes del alta la carga no existía.
        await registrarCambioEstado(
            cargaCreada.id_carga,
            null,
            ESTADO_INICIAL,
            req.usuario.id,
            client
        );

        await client.query('COMMIT');

        return res.status(201).json(cargaCreada);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

/**
 * GET /cargas (HU 2.5 - GIANNA): lista las cargas registradas, con filtros opcionales y
 * combinables entre sí vía query string.
 *
 * Filtros:
 * - `estado`: comparación exacta contra `estado_actual`.
 * - `fecha`: comparación exacta contra la columna DATE (formato AAAA-MM-DD).
 * - `destino`: coincidencia parcial e insensible a mayúsculas (ILIKE).
 *
 * Mismo patrón que `listarUsuarios`: el filtro que no vino se pasa como '' y la
 * condición `$n = '' OR ...` queda siempre verdadera, así no descarta filas.
 *
 * Devuelve los datos que usa el front: los que muestra cada fila del listado más
 * `observaciones`, que la pantalla de detalle enseña como "Descripción" (HU 2.5
 * no tiene endpoint propio de detalle: reusa lo que ya trajo el listado). Si
 * ningún registro matchea, responde 200 con `[]`: el "sin resultados" lo arma el front.
 *
 * Respuestas: 200 con el array de cargas · 400 si `fecha` tiene formato inválido ·
 * 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express. Query params opcionales: estado, fecha, destino.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const listarCargas = async (req, res) => {
    const { estado, fecha, destino } = req.query;

    const filtroFecha = fecha ? String(fecha).trim() : '';
    if (filtroFecha !== '' && !esFechaValida(filtroFecha)) {
        return res.status(400).json({ message: "El filtro 'fecha' debe tener formato AAAA-MM-DD" });
    }

    let filtroEstado = estado ? String(estado).trim() : '';
    const filtroDestino = destino ? `%${String(destino).trim()}%` : '';

    // HU 3: al camionero sólo se le muestran las cargas en "disponible", que son
    // a las que se puede postular. El filtro de estado que mande se ignora a
    // propósito — no es un capricho de la interfaz, es la regla del negocio, y
    // si dependiera del query param alcanzaría con editar la URL para ver todo.
    const esCamionero = req.usuario?.rol === 'camionero';
    if (esCamionero) {
        filtroEstado = ESTADOS.DISPONIBLE;
    }

    try {
        const resultado = await pool.query(
            `SELECT id_carga, origen, destino, tipo_carga, peso_kg,
                    -- Mismo criterio que en el alta: sin TO_CHAR el driver devuelve
                    -- un Date de JS corrido por la zona horaria local.
                    TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
                    observaciones,
                    estado_actual
             FROM CARGA
             WHERE ($1 = '' OR estado_actual = $1)
               AND ($2 = '' OR fecha = $2::date)
               AND ($3 = '' OR destino ILIKE $3)
             ORDER BY fecha, id_carga`,
            [filtroEstado, filtroFecha, filtroDestino]
        );

        return res.status(200).json(resultado.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * GET /cargas/:id (HU 2.5 - deuda técnica): devuelve una carga puntual con los
 * mismos campos que trae el listado, para que la pantalla de detalle se pueda
 * abrir por URL directa y sobrevivir a un F5 sin depender del router state.
 *
 * Respuestas: 200 con la carga · 400 si `id` no es numérico ·
 * 404 si no existe una carga con ese id · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express. Params: id.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const obtenerCarga = async (req, res) => {
    // req.params siempre llega como texto, por eso se convierte a número.
    const idCarga = Number(req.params.id);
    if (!Number.isInteger(idCarga) || idCarga <= 0) {
        return res.status(400).json({ message: "El parámetro 'id' debe ser numérico" });
    }

    try {
        const resultado = await pool.query(
            `SELECT id_carga, origen, destino, tipo_carga, peso_kg,
                    -- Mismo criterio que en el listado: sin TO_CHAR el driver devuelve
                    -- un Date de JS corrido por la zona horaria local.
                    TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
                    observaciones,
                    estado_actual
             FROM CARGA
             WHERE id_carga = $1`,
            [idCarga]
        );

        if (resultado.rows.length === 0) {
            return res.status(404).json({ message: `No existe una carga con id ${idCarga}` });
        }

        const carga = resultado.rows[0];

        // Misma regla que en el listado (HU 3): si al camionero no se le muestra
        // una carga que no está disponible, tampoco puede abrirla escribiendo la
        // URL a mano. Se responde 404 y no 403 para no confirmarle que existe.
        if (req.usuario?.rol === 'camionero' && carga.estado_actual !== ESTADOS.DISPONIBLE) {
            return res.status(404).json({ message: `No existe una carga con id ${idCarga}` });
        }

        return res.status(200).json(carga);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * GET /cargas/:id/historial (HU 8): devuelve la bitácora de cambios de estado
 * de una carga, ordenada del más antiguo al más reciente.
 *
 * Trae nombre y apellido del actor con un JOIN a USUARIO. Cuando `id_actor`
 * es NULL (cambio hecho por el sistema, no por una persona) se devuelve el
 * texto "Sistema" en vez de nombre/apellido.
 *
 * Respuestas: 200 con el array de la bitácora (puede ser vacío si la carga no
 * existe, igual que `listarCargas`) · 400 si `id` no es numérico ·
 * 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express. Params: id.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const obtenerHistorialCarga = async (req, res) => {
    const idCarga = Number(req.params.id);
    if (!Number.isInteger(idCarga) || idCarga <= 0) {
        return res.status(400).json({ message: "El parámetro 'id' debe ser numérico" });
    }

    try {
        const resultado = await pool.query(
            `SELECT ec.id_estado_carga, ec.id_carga, ec.estado_anterior, ec.estado_nuevo,
                    ec.id_actor,
                    CASE
                        WHEN ec.id_actor IS NULL THEN 'Sistema'
                        ELSE u.nombre || ' ' || u.apellido
                    END AS actor,
                    ec.marca_tiempo
             FROM ESTADO_CARGA ec
             LEFT JOIN USUARIO u ON u.id_usuario = ec.id_actor
             WHERE ec.id_carga = $1
             ORDER BY ec.marca_tiempo ASC`,
            [idCarga]
        );

        return res.status(200).json(resultado.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * PUT /cargas/:id (HU 2.2): edita los seis campos de una carga existente
 * (origen, destino, tipo_carga, peso, fecha, observaciones).
 *
 * Usa las mismas validaciones que el alta (`validarCampos`), así que un campo
 * inválido da exactamente el mismo error que en `crearCarga`. No admite carga
 * parcial: hay que volver a mandar los seis campos, igual que en
 * `actualizarUsuario`.
 *
 * Bloquea la edición si la carga ya está 'en_viaje' o 'entregada': a partir
 * de ahí sus datos son el registro de lo que pasó, no un borrador. No toca
 * `estado_actual` ni recalcula kilómetros al cambiar origen/destino (HU 9).
 *
 * Respuestas: 200 con la carga actualizada · 400 si `id` no es numérico o hay
 * campos inválidos · 404 si no existe una carga con ese id · 409 si la carga
 * está en un estado que ya no admite edición · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express. Params: id. Body: los seis campos de la carga.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const actualizarCarga = async (req, res) => {
    const idCarga = Number(req.params.id);
    if (!Number.isInteger(idCarga) || idCarga <= 0) {
        return res.status(400).json({ message: "El parámetro 'id' debe ser numérico" });
    }

    const { errores, valores } = validarCampos(req.body);
    if (Object.keys(errores).length > 0) {
        return res.status(400).json({
            message: 'Hay campos con errores',
            errores,
        });
    }

    try {
        // Se busca la carga primero para poder distinguir el 404 (no existe) del
        // 409 (existe pero su estado ya no admite edición).
        const cargaExistente = await pool.query(
            'SELECT id_carga, estado_actual FROM CARGA WHERE id_carga = $1',
            [idCarga]
        );

        if (cargaExistente.rows.length === 0) {
            return res.status(404).json({ message: `No existe una carga con id ${idCarga}` });
        }

        const estadoActual = cargaExistente.rows[0].estado_actual;
        if (ESTADOS_BLOQUEADOS_EDICION.includes(estadoActual)) {
            return res.status(409).json({
                message: `No se puede editar una carga en estado '${estadoActual}': una vez en viaje o entregada, sus datos quedan como registro de lo que pasó.`,
            });
        }

        const resultado = await pool.query(
            `UPDATE CARGA
             SET origen = $1, destino = $2, tipo_carga = $3, peso_kg = $4, fecha = $5, observaciones = $6
             WHERE id_carga = $7
             RETURNING id_carga, origen, destino, tipo_carga, peso_kg AS peso,
                       -- Mismo criterio que en el alta: sin TO_CHAR el driver devuelve
                       -- un Date de JS corrido por la zona horaria local.
                       TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
                       observaciones, estado_actual, id_admin_creador, creado_en, actualizado_en`,
            [
                valores.origen,
                valores.destino,
                valores.tipo_carga,
                valores.peso,
                valores.fecha,
                valores.observaciones,
                idCarga,
            ]
        );

        return res.status(200).json(resultado.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * PATCH /cargas/:id/estado (HU 7): mueve una carga a otro estado.
 *
 * Valida que la transición esté permitida por la máquina de estados antes de
 * tocar nada, y deja el cambio asentado en la bitácora de ESTADO_CARGA (HU 8)
 * con el administrador responsable y la marca de tiempo.
 *
 * El UPDATE de la carga y el INSERT en la bitácora van en una transacción: si
 * fallara el segundo, no puede quedar una carga que cambió de estado sin el
 * registro de quién la cambió, que es justamente lo que la bitácora garantiza.
 *
 * Respuestas: 200 con la carga actualizada · 400 si el id o el estado pedido
 * no son válidos · 404 si no existe la carga · 409 si la transición no está
 * permitida · 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express. Body: `{ estado }`.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const cambiarEstadoCarga = async (req, res) => {
    const idCarga = Number(req.params.id);
    if (!Number.isInteger(idCarga) || idCarga <= 0) {
        return res.status(400).json({ message: "El parámetro 'id' debe ser numérico" });
    }

    const estadoNuevo = typeof req.body?.estado === 'string' ? req.body.estado.trim() : '';

    if (!estadoNuevo) {
        return res.status(400).json({ message: "El campo 'estado' es obligatorio" });
    }
    if (!esEstadoValido(estadoNuevo)) {
        return res.status(400).json({
            message: `'${estadoNuevo}' no es un estado válido. Los estados posibles son: ${ESTADOS_VALIDOS.join(', ')}.`,
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // FOR UPDATE bloquea la fila hasta el commit: si dos administradores
        // cambian el estado a la vez, el segundo lee el estado ya actualizado
        // y su transición se valida contra el valor real, no contra uno viejo.
        const cargaExistente = await client.query(
            'SELECT id_carga, estado_actual FROM CARGA WHERE id_carga = $1 FOR UPDATE',
            [idCarga]
        );

        if (cargaExistente.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: `No existe una carga con id ${idCarga}` });
        }

        const estadoActual = cargaExistente.rows[0].estado_actual;

        if (estadoActual === estadoNuevo) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                message: `La carga ya está en estado '${estadoActual}'.`,
            });
        }

        if (!puedeTransicionar(estadoActual, estadoNuevo)) {
            await client.query('ROLLBACK');

            const posibles = transicionesDesde(estadoActual);
            const detalle = posibles.length > 0
                ? `Desde '${estadoActual}' sólo se puede pasar a: ${posibles.join(', ')}.`
                : `'${estadoActual}' es un estado final: la carga ya no puede cambiar de estado.`;

            return res.status(409).json({
                message: `No se puede pasar de '${estadoActual}' a '${estadoNuevo}'. ${detalle}`,
            });
        }

        const resultado = await client.query(
            // Devuelve `peso_kg` sin renombrar, igual que GET /cargas/:id: la
            // pantalla de detalle consume los dos y con el alias 'peso' que usan
            // el alta y la edición se quedaba sin el dato tras cambiar de estado.
            `UPDATE CARGA
             SET estado_actual = $1
             WHERE id_carga = $2
             RETURNING id_carga, origen, destino, tipo_carga, peso_kg,
                       TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
                       observaciones, estado_actual, id_admin_creador, creado_en, actualizado_en`,
            [estadoNuevo, idCarga]
        );

        await registrarCambioEstado(idCarga, estadoActual, estadoNuevo, req.usuario.id, client);

        await client.query('COMMIT');

        return res.status(200).json(resultado.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    } finally {
        client.release();
    }
};

module.exports = {
    crearCarga,
    listarCargas,
    obtenerCarga,
    obtenerHistorialCarga,
    actualizarCarga,
    cambiarEstadoCarga,
};
