const pool = require('../db');
const bcrypt = require('bcrypt');

const CAMPOS_OBLIGATORIOS = ['nombre', 'apellido', 'dni', 'email', 'contraseña', 'rol'];
const CAMPOS_CAMIONERO = ['ubicacion', 'tipo_vehiculo', 'capacidad_kg'];
const ROLES_VALIDOS = ['administrador', 'camionero'];

const CAMPOS_EDITABLES = ['nombre', 'apellido', 'email', 'estado'];
const CAMPOS_BLOQUEADOS = ['dni', 'rol', 'contraseña'];
const ESTADOS_VALIDOS = ['activo', 'inactivo'];

const crearUsuario = async (req, res) => {
    const { nombre, apellido, dni, email, contraseña, ubicacion, tipo_vehiculo, capacidad_kg } = req.body;

    for (const campo of CAMPOS_OBLIGATORIOS) {
        const valor = req.body[campo];
        if (valor === undefined || valor === null || String(valor).trim() === '') {
            return res.status(400).json({ message: `El campo '${campo}' es obligatorio` });
        }
    }

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
        const dniExistente = await pool.query('SELECT id_usuario FROM USUARIO WHERE dni = $1', [dni]);
        if (dniExistente.rows.length > 0) {
            return res.status(400).json({ message: 'El DNI ya está registrado' });
        }

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
        if (error.code === '23505') {
            const campo = error.constraint === 'usuario_dni_key' ? 'DNI' : 'email';
            return res.status(400).json({ message: `El ${campo} ya está registrado` });
        }
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

// PUT /usuarios/:id: edita datos de un usuario existente. No permite tocar dni, rol ni contraseña.
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

        const emailExistente = await pool.query(
            'SELECT id_usuario FROM USUARIO WHERE email = $1 AND id_usuario <> $2', // ignora la fila del propio usuario que se está editando
            [email, idUsuario]
        );
        if (emailExistente.rows.length > 0) {
            return res.status(400).json({ message: 'El email ya está registrado' });
        }

        // Conexión propia para poder usar una transacción: los dos UPDATE se guardan juntos o ninguno
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

// GET /usuarios: lista usuarios con filtros opcionales por nombre, dni, rol y estado (todos combinables entre sí)
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
