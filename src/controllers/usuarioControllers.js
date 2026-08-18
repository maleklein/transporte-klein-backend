const pool = require('../db');
const bcrypt = require('bcrypt');

const CAMPOS_OBLIGATORIOS = ['nombre', 'apellido', 'dni', 'email', 'contraseña', 'rol'];
const CAMPOS_CAMIONERO = ['ubicacion', 'tipo_vehiculo', 'capacidad_kg'];
const ROLES_VALIDOS = ['administrador', 'camionero'];

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

module.exports = { crearUsuario };
