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
 * Columnas de origen y destino, resueltas contra el catálogo geográfico.
 *
 * Además de los ids y los nombres por separado —que es lo que necesitan los
 * selectores del formulario— arma un `origen` y un `destino` ya listos para
 * mostrar. Así las pantallas que sólo los muestran (el detalle, las tarjetas
 * del listado) siguen leyendo el mismo campo de siempre y no hubo que tocarlas.
 *
 * El CASE evita el "Santa Fe, Santa Fe" de las capitales que se llaman igual
 * que su provincia, y el caso extremo de CABA, que repetiría el nombre entero.
 *
 * Se define una sola vez porque lo usan las cinco consultas del módulo: si
 * alguna se quedara sin estos campos, la pantalla de detalle se quedaría sin
 * la ruta después de esa operación.
 */
const COLUMNAS_UBICACION = `
                    c.id_localidad_origen  AS origen_id,
                    lo.nombre              AS origen_localidad,
                    po.id_provincia        AS origen_provincia_id,
                    po.nombre              AS origen_provincia,
                    CASE WHEN lo.nombre = po.nombre THEN lo.nombre
                         ELSE lo.nombre || ', ' || po.nombre END AS origen,
                    c.id_localidad_destino AS destino_id,
                    ld.nombre              AS destino_localidad,
                    pd.id_provincia        AS destino_provincia_id,
                    pd.nombre              AS destino_provincia,
                    CASE WHEN ld.nombre = pd.nombre THEN ld.nombre
                         ELSE ld.nombre || ', ' || pd.nombre END AS destino`;

/** Los JOIN que hacen falta para que `COLUMNAS_UBICACION` resuelva. */
const JOIN_UBICACION = `
             JOIN LOCALIDAD lo ON lo.id_localidad = c.id_localidad_origen
             JOIN PROVINCIA po ON po.id_provincia = lo.id_provincia
             JOIN LOCALIDAD ld ON ld.id_localidad = c.id_localidad_destino
             JOIN PROVINCIA pd ON pd.id_provincia = ld.id_provincia`;

/**
 * Verifica que las dos localidades del body existan en el catálogo.
 *
 * El validador sólo chequea que el id tenga la forma correcta, porque es
 * síncrono y no toca la base. La existencia se comprueba acá, con una sola
 * consulta para las dos. Sin esto, un id inventado terminaría en un error de
 * clave foránea de Postgres y en un 500 genérico, cuando en realidad es un
 * problema del dato que mandó el cliente.
 *
 * @param {object} ejecutor - pool o cliente de una transacción en curso.
 * @param {{origen_id: string, destino_id: string}} valores - ids ya validados en su forma.
 * @returns {Promise<Record<string, string>>} errores por campo; vacío si las dos existen.
 */
const verificarLocalidades = async (ejecutor, valores) => {
    const resultado = await ejecutor.query(
        'SELECT id_localidad FROM LOCALIDAD WHERE id_localidad = ANY($1::char(8)[])',
        [[valores.origen_id, valores.destino_id]],
    );

    const existentes = new Set(resultado.rows.map((fila) => fila.id_localidad.trim()));
    const errores = {};

    if (!existentes.has(valores.origen_id)) {
        errores.origen_id = 'Elegí un origen de la lista';
    }
    if (!existentes.has(valores.destino_id)) {
        errores.destino_id = 'Elegí un destino de la lista';
    }

    return errores;
};

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

        // Las localidades se verifican dentro de la transacción, no antes: así
        // no pueden borrarse del catálogo entre el chequeo y el INSERT.
        const erroresLocalidad = await verificarLocalidades(client, valores);
        if (Object.keys(erroresLocalidad).length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'Hay campos con errores',
                errores: erroresLocalidad,
            });
        }

        // El INSERT no puede hacer JOIN en su RETURNING, así que se envuelve en
        // un CTE: se inserta y se vuelve a leer la fila ya resuelta contra el
        // catálogo, todo en una sola ida a la base.
        const resultado = await client.query(
            `WITH nueva AS (
                 INSERT INTO CARGA (id_localidad_origen, id_localidad_destino, tipo_carga, peso_kg, fecha, observaciones, estado_actual, id_admin_creador)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING *
             )
             SELECT c.id_carga,${COLUMNAS_UBICACION},
                    c.tipo_carga, c.peso_kg,
                    -- Sin el TO_CHAR, el driver convierte el DATE a un Date de JS usando
                    -- la zona horaria local y el front termina recibiendo un timestamp.
                    TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
                    c.observaciones, c.estado_actual, c.id_admin_creador, c.creado_en, c.actualizado_en
             FROM nueva c${JOIN_UBICACION}`,
            // Los valores ya vienen limpios y normalizados de validarCampos.
            [
                valores.origen_id,
                valores.destino_id,
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
 * - `destino_provincia`: id de provincia (2 dígitos), comparación exacta.
 * - `destino_localidad`: id de localidad (8 dígitos), comparación exacta.
 *
 * Los dos filtros de destino reemplazan al viejo `destino`, que era una
 * coincidencia parcial sobre texto libre (ILIKE). Además de no encontrar lo
 * mismo escrito de otra forma, ese filtro no escapaba los comodines: un
 * `destino=50%` matcheaba cualquier cosa.
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
 * @param {import('express').Request} req - request de Express. Query params opcionales: estado, fecha, destino_provincia, destino_localidad.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const listarCargas = async (req, res) => {
    const { estado, fecha, destino_provincia: destinoProvincia, destino_localidad: destinoLocalidad } = req.query;

    const filtroFecha = fecha ? String(fecha).trim() : '';
    if (filtroFecha !== '' && !esFechaValida(filtroFecha)) {
        return res.status(400).json({ message: "El filtro 'fecha' debe tener formato AAAA-MM-DD" });
    }

    const filtroProvincia = destinoProvincia ? String(destinoProvincia).trim() : '';
    if (filtroProvincia !== '' && !/^\d{2}$/.test(filtroProvincia)) {
        return res.status(400).json({ message: "El filtro 'destino_provincia' debe ser un id de provincia válido" });
    }

    const filtroLocalidad = destinoLocalidad ? String(destinoLocalidad).trim() : '';
    if (filtroLocalidad !== '' && !/^\d{8}$/.test(filtroLocalidad)) {
        return res.status(400).json({ message: "El filtro 'destino_localidad' debe ser un id de localidad válido" });
    }

    let filtroEstado = estado ? String(estado).trim() : '';

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
            `SELECT c.id_carga,${COLUMNAS_UBICACION},
                    c.tipo_carga, c.peso_kg,
                    -- Mismo criterio que en el alta: sin TO_CHAR el driver devuelve
                    -- un Date de JS corrido por la zona horaria local.
                    TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
                    c.observaciones,
                    c.estado_actual
             FROM CARGA c${JOIN_UBICACION}
             WHERE ($1 = '' OR c.estado_actual = $1)
               AND ($2 = '' OR c.fecha = $2::date)
               AND ($3 = '' OR pd.id_provincia = $3)
               AND ($4 = '' OR c.id_localidad_destino = $4)
             ORDER BY c.fecha, c.id_carga`,
            [filtroEstado, filtroFecha, filtroProvincia, filtroLocalidad]
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
            `SELECT c.id_carga,${COLUMNAS_UBICACION},
                    c.tipo_carga, c.peso_kg,
                    -- Mismo criterio que en el listado: sin TO_CHAR el driver devuelve
                    -- un Date de JS corrido por la zona horaria local.
                    TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
                    c.observaciones,
                    c.estado_actual
             FROM CARGA c${JOIN_UBICACION}
             WHERE c.id_carga = $1`,
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
 * Bloquea la edición si la carga está 'en_viaje' o 'entregada', pero por
 * motivos distintos: en viaje es un bloqueo mientras dure ese estado, y si
 * hace falta corregir algo se la puede volver a 'aceptada' (HU 7); entregada
 * es definitivo, porque es un estado final del que ya no se vuelve (RN-01).
 * No toca `estado_actual` ni recalcula kilómetros al cambiar origen/destino
 * (HU 9).
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
            // Los dos casos no son lo mismo: el de "en viaje" se puede
            // destrabar volviendo la carga a "aceptada", y conviene decírselo
            // a quien intentó editarla en vez de dejarlo en un callejón.
            const motivo = estadoActual === ESTADOS.EN_VIAJE
                ? "Mientras está en viaje no se pueden modificar sus datos. Si necesitás corregir algo, volvé a pasarla a 'aceptada' primero."
                : 'La carga ya fue entregada: sus datos quedan como registro de lo que pasó.';

            return res.status(409).json({
                message: `No se puede editar una carga en estado '${estadoActual}'. ${motivo}`,
            });
        }

        const erroresLocalidad = await verificarLocalidades(pool, valores);
        if (Object.keys(erroresLocalidad).length > 0) {
            return res.status(400).json({
                message: 'Hay campos con errores',
                errores: erroresLocalidad,
            });
        }

        // Mismo CTE que en el alta: el UPDATE no puede hacer JOIN en su
        // RETURNING, así que se vuelve a leer la fila ya resuelta.
        const resultado = await pool.query(
            `WITH modificada AS (
                 UPDATE CARGA
                 SET id_localidad_origen = $1, id_localidad_destino = $2, tipo_carga = $3, peso_kg = $4, fecha = $5, observaciones = $6
                 WHERE id_carga = $7
                 RETURNING *
             )
             SELECT c.id_carga,${COLUMNAS_UBICACION},
                    c.tipo_carga, c.peso_kg,
                    -- Mismo criterio que en el alta: sin TO_CHAR el driver devuelve
                    -- un Date de JS corrido por la zona horaria local.
                    TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
                    c.observaciones, c.estado_actual, c.id_admin_creador, c.creado_en, c.actualizado_en
             FROM modificada c${JOIN_UBICACION}`,
            [
                valores.origen_id,
                valores.destino_id,
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

        // El CTE no es opcional acá: la pantalla de detalle se redibuja con lo
        // que devuelve este endpoint, así que si le faltaran los JOIN al
        // catálogo se quedaría sin la ruta después de cada cambio de estado.
        // Es el mismo problema que ya hubo con `peso_kg` y su alias.
        const resultado = await client.query(
            `WITH modificada AS (
                 UPDATE CARGA
                 SET estado_actual = $1
                 WHERE id_carga = $2
                 RETURNING *
             )
             SELECT c.id_carga,${COLUMNAS_UBICACION},
                    c.tipo_carga, c.peso_kg,
                    TO_CHAR(c.fecha, 'YYYY-MM-DD') AS fecha,
                    c.observaciones, c.estado_actual, c.id_admin_creador, c.creado_en, c.actualizado_en
             FROM modificada c${JOIN_UBICACION}`,
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
