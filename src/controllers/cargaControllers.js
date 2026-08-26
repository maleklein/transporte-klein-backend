/**
 * Controlador del módulo de Cargas (HU 2.1 + 2.1.1).
 * Expone el alta de cargas contra la tabla CARGA.
 */

const pool = require('../db');

/**
 * Campos que el formulario de alta debe mandar sí o sí.
 * Se recorren en orden para armar el mapa de errores por campo.
 */
const CAMPOS_OBLIGATORIOS = ['origen', 'destino', 'tipo_carga', 'peso', 'fecha', 'observaciones'];

/**
 * Estado con el que nace toda carga nueva, según la HU.
 * La transición a "publicada" es responsabilidad de HU 2.3.
 */
const ESTADO_INICIAL = 'disponible';

/**
 * Valida que la fecha tenga formato AAAA-MM-DD y que además exista de verdad.
 * El regex por sí solo deja pasar cosas como 2026-02-31, por eso se reconstruye
 * la fecha y se compara contra el texto original.
 *
 * @param {string} valor - fecha recibida en el body, ya recortada.
 * @returns {boolean} true si la fecha es válida y existe en el calendario.
 */
const esFechaValida = (valor) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
    const fecha = new Date(`${valor}T00:00:00Z`);
    if (Number.isNaN(fecha.getTime())) return false;
    return fecha.toISOString().slice(0, 10) === valor;
};

/**
 * Resuelve qué administrador está creando la carga, y verifica que tenga
 * permiso para hacerlo: que exista, que su cuenta esté activa y que su rol
 * sea "administrador".
 *
 * TODO (GIA-39): mientras no exista el middleware de auth, el id del admin llega
 * por el header x-usuario-id. Cuando el middleware esté listo, esto se reemplaza
 * por req.usuario.id y toda esta función se puede borrar.
 *
 * @param {import('express').Request} req - request de Express.
 * @returns {Promise<{idAdmin?: number, error?: {status: number, message: string}}>}
 *   `idAdmin` si el usuario puede crear cargas; `error` con el status y el
 *   mensaje a devolver si no puede.
 */
const obtenerAdminCreador = async (req) => {
    const idUsuario = Number(req.header('x-usuario-id'));
    if (!Number.isInteger(idUsuario) || idUsuario <= 0) {
        return { error: { status: 401, message: 'Falta identificar al usuario que crea la carga' } };
    }

    const resultado = await pool.query('SELECT id_usuario, rol, estado FROM USUARIO WHERE id_usuario = $1', [idUsuario]);
    if (resultado.rows.length === 0) {
        return { error: { status: 401, message: 'El usuario indicado no existe' } };
    }

    const usuario = resultado.rows[0];
    if (usuario.estado !== 'activo') {
        return { error: { status: 403, message: 'La cuenta no esta activa' } };
    }
    if (usuario.rol !== 'administrador') {
        return { error: { status: 403, message: 'Solo un administrador puede dar de alta cargas' } };
    }

    return { idAdmin: usuario.id_usuario };
};

/**
 * POST /cargas: da de alta una carga y la deja en estado "disponible".
 *
 * Valida primero todos los campos y recién después consulta la base, así una
 * sola respuesta junta todos los errores. Los devuelve agrupados por campo
 * (`{ message, errores: { campo: mensaje } }`) para que el formulario pueda
 * mostrar cada mensaje debajo del input que corresponde.
 *
 * Respuestas: 201 con la carga creada · 400 si hay campos inválidos ·
 * 401 si no se identifica al usuario · 403 si no es un administrador activo ·
 * 500 ante un error inesperado.
 *
 * @param {import('express').Request} req - request de Express, con los datos en el body.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const crearCarga = async (req, res) => {
    // Se acumulan todos los errores en vez de cortar en el primero, para que
    // el formulario pueda marcar de una vez todos los campos con problema.
    const errores = {};

    for (const campo of CAMPOS_OBLIGATORIOS) {
        const valor = req.body[campo];
        if (valor === undefined || valor === null || String(valor).trim() === '') {
            errores[campo] = `El campo '${campo}' es obligatorio`;
        }
    }

    const { origen, destino, tipo_carga, observaciones } = req.body;
    const peso = Number(req.body.peso);
    const fecha = String(req.body.fecha ?? '').trim();

    // El "if (!errores.X)" evita pisar el mensaje de "campo obligatorio" con uno
    // de formato: si el campo vino vacío, ese es el error que hay que mostrar.
    if (!errores.peso) {
        if (Number.isNaN(peso)) {
            errores.peso = "El campo 'peso' debe ser numerico";
        } else if (peso <= 0) {
            errores.peso = "El campo 'peso' debe ser mayor a 0";
        }
    }

    if (!errores.fecha && !esFechaValida(fecha)) {
        errores.fecha = "El campo 'fecha' debe tener formato AAAA-MM-DD";
    }

    if (Object.keys(errores).length > 0) {
        return res.status(400).json({
            message: 'Hay campos con errores',
            errores,
        });
    }

    try {
        const { idAdmin, error } = await obtenerAdminCreador(req);
        if (error) {
            return res.status(error.status).json({ message: error.message });
        }

        const resultado = await pool.query(
            `INSERT INTO CARGA (origen, destino, tipo_carga, peso, fecha, observaciones, estado_actual, id_admin_creador)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id_carga, origen, destino, tipo_carga, peso,
                       -- Sin el TO_CHAR, el driver convierte el DATE a un Date de JS usando
                       -- la zona horaria local y el front termina recibiendo un timestamp.
                       TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
                       observaciones, estado_actual, id_admin_creador, creado_en, actualizado_en`,
            [
                String(origen).trim(),
                String(destino).trim(),
                String(tipo_carga).trim(),
                peso,
                fecha,
                String(observaciones).trim(),
                ESTADO_INICIAL,
                idAdmin,
            ]
        );

        return res.status(201).json(resultado.rows[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { crearCarga };
