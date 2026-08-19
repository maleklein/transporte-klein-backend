const pool = require('../db');

const CAMPOS_OBLIGATORIOS = ['origen', 'destino', 'tipo_carga', 'peso', 'fecha', 'observaciones'];
const ESTADO_INICIAL = 'disponible';

// Valida formato YYYY-MM-DD y ademas que la fecha exista de verdad:
// el regex solo por si mismo deja pasar cosas como 2026-02-31.
const esFechaValida = (valor) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
    const fecha = new Date(`${valor}T00:00:00Z`);
    if (Number.isNaN(fecha.getTime())) return false;
    return fecha.toISOString().slice(0, 10) === valor;
};

// TODO (GIA-39): mientras no exista el middleware de auth, el id del admin llega
// por el header x-usuario-id. Cuando el middleware este listo, esto se reemplaza
// por req.usuario.id y toda esta funcion se puede borrar.
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

// POST /cargas: da de alta una carga y la deja en estado "disponible".
// Devuelve los errores agrupados por campo para que el formulario pueda
// mostrar cada mensaje debajo del input que corresponde.
const crearCarga = async (req, res) => {
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
