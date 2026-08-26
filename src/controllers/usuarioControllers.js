const pool = require('../db');
const bcrypt = require('bcrypt');

// Campos obligatorios para cualquier usuario, sin importar su rol.
const CAMPOS_OBLIGATORIOS = ['nombre', 'apellido', 'dni', 'email', 'contraseña', 'rol'];

// Campos que solo se piden cuando el rol es 'camionero'.
const CAMPOS_CAMIONERO = ['ubicacion', 'tipo_vehiculo', 'capacidad_kg'];
const ROLES_VALIDOS = ['administrador', 'camionero'];

// Usadas por actualizarUsuario (HU 1.2, no incluida en este fragmento).const CAMPOS_EDITABLES = ['nombre', 'apellido', 'email', 'estado'];
const CAMPOS_BLOQUEADOS = ['dni', 'rol', 'contraseña'];
const ESTADOS_VALIDOS = ['activo', 'inactivo'];

/**
 * Controlador de POST /usuarios: da de alta un usuario (administrador o camionero).
 * Si el rol es 'camionero', crea además el registro asociado en CAMIONERO.
 *
 * @param {import('express').Request} req - Body: { nombre, apellido, dni, email, contraseña, rol, ubicacion?, tipo_vehiculo?, capacidad_kg? }.
 * @param {import('express').Response} res
 * @returns {Promise<import('express').Response>} 201 con el usuario creado, 400 por validación o duplicados, 500 ante error inesperado.
 */
const crearUsuario = async (req, res) => {
    const { nombre, apellido, dni, email, contraseña, ubicacion, tipo_vehiculo, capacidad_kg } = req.body;

    for (const campo of CAMPOS_OBLIGATORIOS) {
        const valor = req.body[campo];
        if (valor === undefined || valor === null || String(valor).trim() === '') {
            return res.status(400).json({ message: `El campo '${campo}' es obligatorio` });
        }
    }

    // Se normaliza para que "Administrador " o "CAMIONERO" también sean válidos.
    const rol = String(req.body.rol).trim().toLowerCase();
    if (!ROLES_VALIDOS.includes(rol)) {
        return res.status(400).json({ message: "El campo 'rol' debe ser 'administrador' o 'camionero'" });
    }

    if (rol === 'camionero') {
        for (const campo of CAMPOS_CAMIONERO) {
            const valor = req.body[campo];
            if (valor === undefined || valor === null || String(valor).trim() === '') {
                return res.status(400).json({ message: `El campo '${campo}' es obligatorio para el rol camionero` });
            }
        }
        if (isNaN(Number(capacidad_kg))) {
            return res.status(400).json({ message: `El campo 'capacidad_kg' debe ser numérico` });
        }
    }

    try {
        // Se valida duplicados antes del INSERT para devolver un mensaje específico por campo;
        // el catch de más abajo (error 23505) queda como red de seguridad ante condiciones de carrera.
        const dniExistente = await pool.query('SELECT id_usuario FROM USUARIO WHERE dni = $1', [dni]);
        if (dniExistente.rows.length > 0) {
            return res.status(400).json({ message: 'El DNI ya está registrado' });
        }

        // Se usa una transacción porque el alta de CAMIONERO depende del id_usuario recién
        // creado: si el insert de camionero falla, el usuario tampoco debe quedar persistido.
        const emailExistente = await pool.query('SELECT id_usuario FROM USUARIO WHERE email = $1', [email]);
        if (emailExistente.rows.length > 0) {
            return res.status(400).json({ message: 'El email ya está registrado' });
        }

        const contraseñaHash = await bcrypt.hash(contraseña, 10);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const resultUsuario = await client.query(
                `INSERT INTO USUARIO (nombre, apellido, dni, email, contraseña_hash, rol, estado)
                 VALUES ($1, $2, $3, $4, $5, $6, 'activo')
                 RETURNING id_usuario, nombre, apellido, dni, email, rol, estado, creado_en`,
                [nombre, apellido, dni, email, contraseñaHash, rol]
            );
            const nuevoUsuario = resultUsuario.rows[0];

            let camionero = null;
            if (rol === 'camionero') {
                const resultCamionero = await client.query(
                    `INSERT INTO CAMIONERO (id_usuario, ubicacion, tipo_vehiculo, capacidad_kg)
                     VALUES ($1, $2, $3, $4)
                     RETURNING ubicacion, disponibilidad, tipo_vehiculo, capacidad_kg`,
                    [nuevoUsuario.id_usuario, ubicacion, tipo_vehiculo, capacidad_kg]
                );
                camionero = resultCamionero.rows[0];
            }

            await client.query('COMMIT');

            // "camionero" solo se agrega a la respuesta si el usuario creado es un camionero.
            return res.status(201).json({
                ...nuevoUsuario,
                ...(camionero && { camionero }),
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        // Safety net: cubre el caso en que dos requests pasan la validación de duplicados
        // casi al mismo tiempo y ambos llegan al INSERT, que la constraint UNIQUE frena.
        if (error.code === '23505') {
            const campo = error.constraint === 'usuario_dni_key' ? 'DNI' : 'email';
            return res.status(400).json({ message: `El ${campo} ya está registrado` });
        }
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * Controlador de PUT /usuarios/:id: edita datos de un usuario existente.
 * No permite modificar dni, rol ni contraseña desde este endpoint.
 * Si el usuario es camionero, actualiza también sus datos en CAMIONERO.
 *
 * @param {import('express').Request} req - Params: id. Body: { nombre, apellido, email, estado, ubicacion?, tipo_vehiculo?, capacidad_kg? }.
 * @param {import('express').Response} res
 * @returns {Promise<import('express').Response>} 200 con el usuario actualizado, 400 por validación o email duplicado, 404 si no existe, 500 ante error inesperado.
 */
const actualizarUsuario = async (req, res) => {
    // req.params siempre llega como texto, por eso se convierte a número
    const idUsuario = Number(req.params.id);
    if (!Number.isInteger(idUsuario)) {
        return res.status(400).json({ message: "El parámetro 'id' debe ser numérico" });
    }

    // Rechaza el pedido si intentan tocar un campo protegido (el DNI, entre otros)
    for (const campo of CAMPOS_BLOQUEADOS) {
        if (req.body[campo] !== undefined) {
            return res.status(400).json({ message: `El campo '${campo}' no se puede modificar desde este endpoint` });
        }
    }

    for (const campo of CAMPOS_EDITABLES) {
        const valor = req.body[campo];
        if (valor === undefined || valor === null || String(valor).trim() === '') {
            return res.status(400).json({ message: `El campo '${campo}' es obligatorio` });
        }
    }

    const { nombre, apellido, email, ubicacion, tipo_vehiculo, capacidad_kg } = req.body;
    const estado = String(req.body.estado).trim().toLowerCase();
    if (!ESTADOS_VALIDOS.includes(estado)) {
        return res.status(400).json({ message: `El campo 'estado' debe ser 'activo' o 'inactivo'` });
    }

    try {
        // Se busca el usuario primero para confirmar que existe y para saber su rol
        // (el rol no viene en el body porque es un campo bloqueado, pero hace falta
        // para decidir si también hay que actualizar CAMIONERO).
        const usuarioExistente = await pool.query('SELECT id_usuario, rol FROM USUARIO WHERE id_usuario = $1', [idUsuario]);
        if (usuarioExistente.rows.length === 0) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }
        const rol = usuarioExistente.rows[0].rol;

        if (rol === 'camionero') {
            for (const campo of CAMPOS_CAMIONERO) {
                const valor = req.body[campo];
                if (valor === undefined || valor === null || String(valor).trim() === '') {
                    return res.status(400).json({ message: `El campo '${campo}' es obligatorio para el rol camionero` });
                }
            }
            if (isNaN(Number(capacidad_kg))) {
                return res.status(400).json({ message: `El campo 'capacidad_kg' debe ser numérico` });
            }
        }

        // Se valida el email duplicado excluyendo al propio usuario que se está editando,
        // para no rechazar el guardado si no cambió su email.
        const emailExistente = await pool.query(
            'SELECT id_usuario FROM USUARIO WHERE email = $1 AND id_usuario <> $2', // ignora la fila del propio usuario que se está editando
            [email, idUsuario]
        );
        if (emailExistente.rows.length > 0) {
            return res.status(400).json({ message: 'El email ya está registrado' });
        }

        // Transacción: si el usuario es camionero, los dos UPDATE (USUARIO y CAMIONERO)
        // se guardan juntos o ninguno, igual que en crearUsuario.        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const resultUsuario = await client.query(
                `UPDATE USUARIO SET nombre = $1, apellido = $2, email = $3, estado = $4
                 WHERE id_usuario = $5
                 RETURNING id_usuario, nombre, apellido, dni, email, rol, estado, creado_en, actualizado_en`,
                [nombre, apellido, email, estado, idUsuario]
            );
            const usuarioActualizado = resultUsuario.rows[0];

            let camionero = null;
            if (rol === 'camionero') {
                const resultCamionero = await client.query(
                    `UPDATE CAMIONERO SET ubicacion = $1, tipo_vehiculo = $2, capacidad_kg = $3
                     WHERE id_usuario = $4
                     RETURNING ubicacion, disponibilidad, tipo_vehiculo, capacidad_kg`,
                    [ubicacion, tipo_vehiculo, capacidad_kg, idUsuario]
                );
                camionero = resultCamionero.rows[0];
            }

            await client.query('COMMIT');

            return res.status(200).json({
                ...usuarioActualizado,
                ...(camionero && { camionero }),
            });
        } catch (error) {
            await client.query('ROLLBACK'); // deshace ambos UPDATE si alguno falló
            throw error;
        } finally {
            client.release(); // devuelve la conexión al pool, se ejecute bien o mal
        }
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ message: 'El email ya está registrado' });
        }
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

/**
 * Controlador de GET /usuarios: lista usuarios, con filtros opcionales y
 * combinables por nombre, dni, rol y estado (todos vía query string).
 *
 * @param {import('express').Request} req - Query params opcionales: nombre, dni, rol, estado.
 * @param {import('express').Response} res
 * @returns {Promise<import('express').Response>} 200 con el listado de usuarios, 400 si algún filtro es inválido, 500 ante error inesperado.
 */
const listarUsuarios = async (req, res) => {
    const { nombre, dni, rol, estado } = req.query;

    if (rol !== undefined && !ROLES_VALIDOS.includes(String(rol).trim().toLowerCase())) {
        return res.status(400).json({ message: "El filtro 'rol' debe ser 'administrador' o 'camionero'" });
    }
    if (estado !== undefined && !ESTADOS_VALIDOS.includes(String(estado).trim().toLowerCase())) {
        return res.status(400).json({ message: "El filtro 'estado' debe ser 'activo' o 'inactivo'" });
    }

    // Si un filtro no vino, uso '' (vacío). Abajo, "$1 = ''" hace que esa condición
    // sea siempre verdadera cuando no hay filtro, así no descarta a nadie.
    const filtroNombre = nombre ? `%${nombre}%` : '';
    const filtroDni = dni ? `%${dni}%` : '';
    const filtroRol = rol ? String(rol).trim().toLowerCase() : '';
    const filtroEstado = estado ? String(estado).trim().toLowerCase() : '';

    try {
        // LEFT JOIN con CAMIONERO: si el usuario es administrador, esas columnas vienen todas en null
        const resultado = await pool.query(
            `SELECT u.id_usuario, u.nombre, u.apellido, u.dni, u.email, u.rol, u.estado, u.creado_en, u.actualizado_en,
                    c.ubicacion, c.disponibilidad, c.tipo_vehiculo, c.capacidad_kg
             FROM USUARIO u
             LEFT JOIN CAMIONERO c ON c.id_usuario = u.id_usuario
             WHERE ($1 = '' OR u.nombre ILIKE $1)
               AND ($2 = '' OR u.dni ILIKE $2)
               AND ($3 = '' OR u.rol = $3)
               AND ($4 = '' OR u.estado = $4)
             ORDER BY u.nombre, u.apellido`,
            [filtroNombre, filtroDni, filtroRol, filtroEstado]
        );

        const usuarios = resultado.rows.map(fila => {
            const { ubicacion, disponibilidad, tipo_vehiculo, capacidad_kg, ...usuario } = fila;
            const camionero = usuario.rol === 'camionero' ? { ubicacion, disponibilidad, tipo_vehiculo, capacidad_kg } : null;
            return { ...usuario, ...(camionero && { camionero }) };
        });

        return res.status(200).json(usuarios);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { crearUsuario, actualizarUsuario, listarUsuarios };
