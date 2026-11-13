const pool = require('../db');
const { calcularReputacion, MAX_COMENTARIO } = require('../domain/reputacion');

class ErrorCalificacion extends Error {
    constructor(estado, message) { super(message); this.estado = estado; }
}
function validarId(valor) {
    if (!['string', 'number'].includes(typeof valor) || !/^[1-9]\d*$/.test(String(valor)) || !Number.isSafeInteger(Number(valor)) || Number(valor) > 2147483647) {
        throw new ErrorCalificacion(400, 'El identificador debe ser un entero positivo válido.');
    }
    return Number(valor);
}
function contraparte(carga, usuario) {
    if (usuario.rol === 'administrador' && carga.id_admin_creador === usuario.id) return carga.id_camionero_asignado;
    if (usuario.rol === 'camionero' && carga.id_camionero_asignado === usuario.id) return carga.id_admin_creador;
    return null;
}
async function leerCarga(db, id, bloquear = false) {
    const { rows } = await db.query(`SELECT id_carga, estado_actual, id_admin_creador, id_camionero_asignado
        FROM CARGA WHERE id_carga = $1${bloquear ? ' FOR UPDATE' : ''}`, [id]);
    if (!rows.length) throw new ErrorCalificacion(404, 'No encontramos la carga.');
    return rows[0];
}

async function emitirCalificacion(datos, usuario, db = pool) {
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new ErrorCalificacion(400, 'Los datos de la calificación no son válidos.');
    // Emisor y receptor se derivan de sesión y carga. No se confía en ids del cliente.
    if (Object.keys(datos).some((clave) => !['id_carga', 'puntaje', 'comentario'].includes(clave))) {
        throw new ErrorCalificacion(400, 'Solo se admiten id_carga, puntaje y comentario.');
    }
    const idCarga = validarId(datos.id_carga);
    if (!Number.isInteger(datos.puntaje) || datos.puntaje < 1 || datos.puntaje > 5) {
        throw new ErrorCalificacion(400, 'Elegí un puntaje entero entre 1 y 5.');
    }
    if (datos.comentario != null && (typeof datos.comentario !== 'string' || [...datos.comentario].length > MAX_COMENTARIO)) {
        throw new ErrorCalificacion(400, `El comentario debe ser texto de hasta ${MAX_COMENTARIO} caracteres.`);
    }
    const comentario = datos.comentario?.trim() || null;
    // Los camioneros no califican: solo el administrador califica, y
    // siempre al camionero asignado, nunca a otro administrador.
    if (usuario.rol === 'camionero') {
        throw new ErrorCalificacion(403, 'Los camioneros no pueden calificar viajes. Solo el administrador que creó la carga puede calificar al camionero asignado.');
    }
    const cliente = await db.connect();
    try {
        await cliente.query('BEGIN');
        const carga = await leerCarga(cliente, idCarga, true);
        const receptor = contraparte(carga, usuario);
        if (!receptor) throw new ErrorCalificacion(403, 'Solo el administrador que creó esta carga puede calificar al camionero asignado.');
        // Guarda explícita, además de la que ya impone el esquema (la FK de
        // id_camionero_asignado sólo admite camioneros): la calificación
        // nunca puede terminar apuntando a un administrador.
        const { rows: filasReceptor } = await cliente.query('SELECT rol FROM USUARIO WHERE id_usuario = $1', [receptor]);
        if (filasReceptor[0]?.rol !== 'camionero') throw new ErrorCalificacion(403, 'No se puede calificar a un administrador.');
        if (carga.estado_actual !== 'entregada') throw new ErrorCalificacion(409, 'La carga debe estar entregada para calificar.');
        const { rows } = await cliente.query(`INSERT INTO CALIFICACION (id_emisor, id_receptor, id_carga, puntaje, comentario)
            VALUES ($1, $2, $3, $4, $5) RETURNING *`, [usuario.id, receptor, idCarga, datos.puntaje, comentario]);
        await cliente.query('COMMIT');
        return rows[0];
    } catch (error) {
        await cliente.query('ROLLBACK');
        if (error.code === '23505') throw new ErrorCalificacion(409, 'Ya calificaste este viaje. La calificación no se puede modificar.');
        throw error;
    } finally { cliente.release(); }
}

async function consultarViaje(id, usuario, db = pool) {
    const carga = await leerCarga(db, validarId(id));
    const receptor = contraparte(carga, usuario);
    if (!receptor) throw new ErrorCalificacion(403, 'No participás de este viaje o todavía no tiene camionero asignado.');
    const { rows } = await db.query(`SELECT u.id_usuario, u.nombre, u.apellido, u.rol,
        (SELECT row_to_json(q) FROM CALIFICACION q WHERE q.id_carga = $2 AND q.id_emisor = $3) AS emitida
        FROM USUARIO u WHERE u.id_usuario = $1`, [receptor, carga.id_carga, usuario.id]);
    const { emitida, ...perfil } = rows[0];
    return { contraparte: perfil, emitida, puede_calificar: carga.estado_actual === 'entregada' && !emitida,
        motivo: emitida ? 'Ya calificaste este viaje.' : carga.estado_actual !== 'entregada' ? 'Podrás calificar cuando la carga esté entregada.' : null };
}

// Calificaciones por página del historial del perfil. Con 20 la pantalla quedaba
// demasiado larga.
const POR_PAGINA = 5;

// Cantidad de calificaciones por puntaje, de 1 a 5, cuando no hay ninguna.
const SIN_CALIFICACIONES = Object.freeze({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

async function consultarPerfil(id, pagina, usuario, db = pool) {
    const idUsuario = validarId(id);
    const numeroPagina = pagina === undefined ? 1 : validarId(pagina);
    if (usuario.rol !== 'administrador' && usuario.id !== idUsuario) {
        const permiso = await db.query(`SELECT 1 FROM CARGA WHERE id_admin_creador = $1
            AND id_camionero_asignado = $2 AND estado_actual = 'entregada' LIMIT 1`, [idUsuario, usuario.id]);
        if (!permiso.rows.length) throw new ErrorCalificacion(403, 'Solo podés consultar tu perfil y el de la contraparte de tus viajes entregados.');
    }
    // Email, DNI y alta solo para el perfil propio: el de la contraparte de un
    // viaje muestra nada más que nombre y rol.
    const propio = usuario.id === idUsuario;
    const perfil = await db.query(`SELECT id_usuario, nombre, apellido, rol
        ${propio ? ', email, dni, creado_en' : ''} FROM USUARIO WHERE id_usuario = $1`, [idUsuario]);
    if (!perfil.rows.length) throw new ErrorCalificacion(404, 'No encontramos el usuario.');
    // Un administrador no recibe calificaciones: nunca es la contraparte
    // calificada, así que ni la reputación ni el historial las muestran.
    if (perfil.rows[0].rol === 'administrador') {
        return { usuario: perfil.rows[0], reputacion: { ...calcularReputacion([]), total: 0, distribucion: SIN_CALIFICACIONES },
            historial: [], pagina: numeroPagina, por_pagina: POR_PAGINA, hay_mas: false };
    }
    // Una sola lectura para que promedio, total e historial correspondan al mismo estado.
    const { rows } = await db.query(`WITH evaluaciones AS (
        SELECT c.*, u.nombre AS nombre_emisor, u.apellido AS apellido_emisor,
            ROW_NUMBER() OVER (ORDER BY c.creado_en DESC, c.id_calificacion DESC) AS posicion
        FROM CALIFICACION c JOIN USUARIO u ON u.id_usuario = c.id_emisor WHERE c.id_receptor = $1
    ) SELECT COUNT(*)::integer AS total,
        -- Cuántas hay de cada puntaje, de todas y no solo de la página: son las barras del perfil.
        json_build_object('1', COUNT(*) FILTER (WHERE puntaje = 1), '2', COUNT(*) FILTER (WHERE puntaje = 2),
            '3', COUNT(*) FILTER (WHERE puntaje = 3), '4', COUNT(*) FILTER (WHERE puntaje = 4),
            '5', COUNT(*) FILTER (WHERE puntaje = 5)) AS distribucion,
        COALESCE(json_agg(e ORDER BY posicion) FILTER (WHERE posicion <= 10), '[]') AS recientes,
        COALESCE(json_agg(e ORDER BY posicion) FILTER (WHERE posicion > $2 AND posicion <= $2 + $3), '[]') AS historial
        FROM evaluaciones e`, [idUsuario, (numeroPagina - 1) * POR_PAGINA, POR_PAGINA]);
    const { recientes, total, distribucion, historial } = rows[0];
    return { usuario: perfil.rows[0], reputacion: { ...calcularReputacion(recientes), total, distribucion },
        historial, pagina: numeroPagina, por_pagina: POR_PAGINA, hay_mas: numeroPagina * POR_PAGINA < total };
}

module.exports = { emitirCalificacion, consultarViaje, consultarPerfil, ErrorCalificacion, validarId };
