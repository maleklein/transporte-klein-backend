/**
 * Controlador del módulo de Cargas (HU 2.1 + 2.1.1).
 * Expone el alta de cargas contra la tabla CARGA.
 */

const pool = require('../db');

/**
 * Campos de texto del formulario, con el largo máximo que soporta su columna.
 * Validarlos acá evita que el INSERT falle en Postgres y termine en un 500
 * genérico, sin decirle al usuario qué campo se pasó.
 */
const CAMPOS_TEXTO = {
    origen: 150,
    destino: 150,
    tipo_carga: 100,
    observaciones: 1000,
};

/**
 * Campos que el formulario de alta debe mandar sí o sí.
 * Se recorren en orden para armar el mapa de errores por campo.
 */
const CAMPOS_OBLIGATORIOS = [...Object.keys(CAMPOS_TEXTO), 'peso', 'fecha'];

/**
 * Campos cuyo texto se normaliza con la primera letra en mayúscula, para que
 * "rosario" y "Rosario" no queden como dos destinos distintos en el listado.
 * `observaciones` queda afuera: es texto libre y no se usa para agrupar.
 */
const CAMPOS_A_NORMALIZAR = ['origen', 'destino', 'tipo_carga'];

/**
 * Estado con el que nace toda carga nueva, según la HU.
 * La transición a "publicada" es responsabilidad de HU 2.3.
 */
const ESTADO_INICIAL = 'disponible';

/** Rango razonable para la columna `peso_kg` (numeric). */
const PESO_MINIMO = 0.01;
const PESO_MAXIMO = 99999999.99;

/** Años aceptados. Fuera de este rango, Postgres rechaza el DATE con un 500. */
const ANIO_MINIMO = 1900;
const ANIO_MAXIMO = 2100;

/**
 * Saca los caracteres que no se ven pero rompen cosas: de control (saltos de
 * línea, tabulaciones, el byte nulo que Postgres rechaza) y los invisibles de
 * ancho cero o de dirección, que hacen que dos textos se vean iguales en
 * pantalla y no lo sean a la hora de filtrar.
 *
 * Se limpian en silencio en vez de rechazarlos: casi siempre llegan pegados
 * desde un Excel o un PDF y el usuario no tiene forma de saber que están.
 *
 * @param {string} valor - texto recibido en el body.
 * @returns {string} el texto sin caracteres invisibles y sin espacios sobrantes.
 */
const limpiarTexto = (valor) => valor
    // Caracteres de control C0 y C1, incluido el byte nulo que Postgres rechaza de plano.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    // Invisibles: ancho cero, marcas de direccion (bidi) y BOM.
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    // Los espacios que quedaron, mas los que ya venian de mas, se juntan en uno solo.
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Pone en mayúscula la primera letra y deja el resto como lo escribió el usuario.
 * No se toca el resto a propósito: pasar todo a minúscula rompería nombres como
 * "Buenos Aires" o "Km 45".
 *
 * @param {string} valor - texto ya limpio.
 * @returns {string} el texto con la primera letra en mayúscula.
 */
const normalizar = (valor) => (valor ? valor[0].toUpperCase() + valor.slice(1) : valor);

/**
 * Interpreta el peso, que puede llegar como número o como texto.
 * Acepta la coma decimal porque es como se escribe acá ("12,5"), y descarta
 * lo que la columna no puede guardar: valores no numéricos, infinitos, fuera
 * de rango, o tan chicos que al redondear a dos decimales quedarían en cero.
 *
 * @param {*} valor - lo que vino en `body.peso`.
 * @returns {{peso?: number, error?: string}} el peso normalizado, o el mensaje de error.
 */
const parsearPeso = (valor) => {
    if (typeof valor !== 'number' && typeof valor !== 'string') {
        return { error: "El campo 'peso' debe ser un número" };
    }

    const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.').trim());

    if (!Number.isFinite(numero)) {
        return { error: "El campo 'peso' debe ser un número" };
    }
    if (numero < PESO_MINIMO) {
        return { error: `El campo 'peso' debe ser al menos ${PESO_MINIMO} kg` };
    }
    if (numero > PESO_MAXIMO) {
        return { error: `El campo 'peso' no puede superar los ${PESO_MAXIMO} kg` };
    }

    return { peso: numero };
};

/**
 * Valida que la fecha tenga formato AAAA-MM-DD, que exista de verdad y que caiga
 * en un año razonable. El regex por sí solo deja pasar cosas como 2026-02-31,
 * por eso se reconstruye la fecha y se compara contra el texto original.
 *
 * @param {string} valor - fecha recibida en el body, ya recortada.
 * @returns {boolean} true si la fecha es válida y existe en el calendario.
 */
const esFechaValida = (valor) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

    const anio = Number(valor.slice(0, 4));
    if (anio < ANIO_MINIMO || anio > ANIO_MAXIMO) return false;

    const fecha = new Date(`${valor}T00:00:00Z`);
    if (Number.isNaN(fecha.getTime())) return false;
    return fecha.toISOString().slice(0, 10) === valor;
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
    // Se acumulan todos los errores en vez de cortar en el primero, para que
    // el formulario pueda marcar de una vez todos los campos con problema.
    const errores = {};
    const textos = {};

    for (const [campo, largoMaximo] of Object.entries(CAMPOS_TEXTO)) {
        const valor = req.body[campo];

        // Se exige texto de verdad: si viniera un objeto o un array, el String()
        // lo guardaría como "[object Object]" o "a,b" sin que nadie se entere.
        if (typeof valor !== 'string') {
            errores[campo] = valor === undefined || valor === null
                ? `El campo '${campo}' es obligatorio`
                : `El campo '${campo}' debe ser texto`;
            continue;
        }

        const limpio = limpiarTexto(valor);

        if (limpio === '') {
            errores[campo] = `El campo '${campo}' es obligatorio`;
        } else if (limpio.length > largoMaximo) {
            errores[campo] = `El campo '${campo}' no puede superar los ${largoMaximo} caracteres`;
        } else {
            textos[campo] = CAMPOS_A_NORMALIZAR.includes(campo) ? normalizar(limpio) : limpio;
        }
    }

    if (req.body.peso === undefined || req.body.peso === null || String(req.body.peso).trim() === '') {
        errores.peso = "El campo 'peso' es obligatorio";
    } else {
        const { peso: pesoValido, error } = parsearPeso(req.body.peso);
        if (error) {
            errores.peso = error;
        } else {
            textos.peso = pesoValido;
        }
    }

    const fecha = typeof req.body.fecha === 'string' ? req.body.fecha.trim() : '';

    if (fecha === '') {
        errores.fecha = "El campo 'fecha' es obligatorio";
    } else if (!esFechaValida(fecha)) {
        errores.fecha = "El campo 'fecha' debe tener formato AAAA-MM-DD";
    }

    if (Object.keys(errores).length > 0) {
        return res.status(400).json({
            message: 'Hay campos con errores',
            errores,
        });
    }

    try {
        const resultado = await pool.query(
            `INSERT INTO CARGA (origen, destino, tipo_carga, peso_kg, fecha, observaciones, estado_actual, id_admin_creador)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id_carga, origen, destino, tipo_carga, peso_kg AS peso,
                       -- Sin el TO_CHAR, el driver convierte el DATE a un Date de JS usando
                       -- la zona horaria local y el front termina recibiendo un timestamp.
                       TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
                       observaciones, estado_actual, id_admin_creador, creado_en, actualizado_en`,
            // Los textos ya vienen limpios y normalizados de la validación de arriba.
            [
                textos.origen,
                textos.destino,
                textos.tipo_carga,
                textos.peso,
                fecha,
                textos.observaciones,
                ESTADO_INICIAL,
                req.usuario.id,
            ]
        );

        return res.status(201).json(resultado.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
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

    const filtroEstado = estado ? String(estado).trim() : '';
    const filtroDestino = destino ? `%${String(destino).trim()}%` : '';

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

        return res.status(200).json(resultado.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { crearCarga, listarCargas, obtenerCarga };
