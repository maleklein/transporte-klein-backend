const pool = require('../db');
const bcrypt = require('bcrypt');

// Campos obligatorios para cualquier usuario, sin importar su rol.
const CAMPOS_OBLIGATORIOS = ['nombre', 'apellido', 'dni', 'email', 'contraseña', 'rol'];

// Campos que solo se piden cuando el rol es 'camionero'.
const CAMPOS_CAMIONERO = ['ubicacion', 'tipo_vehiculo', 'capacidad_kg'];
const ROLES_VALIDOS = ['administrador', 'camionero'];

// Usadas por actualizarUsuario (HU 1.2).
const CAMPOS_EDITABLES = ['nombre', 'apellido', 'email', 'estado'];
const CAMPOS_BLOQUEADOS = ['dni', 'rol', 'contraseña'];
const ESTADOS_VALIDOS = ['activo', 'inactivo'];

// HU 1.1 y 1.2: mismas reglas para nombre y apellido, en el alta y la edición.
// \p{L} (con flag "u") son las letras Unicode, así que cubre tildes y la ñ sin
// tener que listarlas a mano. Tiene que empezar con una letra para que algo
// como "-" o "'" solos no pasen como nombre.
const PATRON_NOMBRE_APELLIDO = /^[\p{L}][\p{L} '-]*$/u;
const LARGO_MAXIMO_NOMBRE_APELLIDO = 50;

/**
 * Valida y recorta nombre o apellido (HU 1.1 y 1.2).
 *
 * Se llama después de confirmar que el campo vino (ver el loop de
 * CAMPOS_OBLIGATORIOS/CAMPOS_EDITABLES en cada controlador), así que acá ya
 * se sabe que `valor` no es vacío ni sólo espacios. El largo máximo se
 * chequea antes de tocar la base a propósito: la columna es VARCHAR(50), y
 * sin este chequeo un valor más largo rompería el INSERT/UPDATE con un 500
 * en vez de un 400 con un mensaje claro.
 *
 * No hay largo mínimo: un nombre o apellido de una sola letra es válido.
 *
 * @param {*} valor - lo que llegó en el body.
 * @param {string} etiqueta - 'nombre' o 'apellido', para armar el mensaje de error.
 * @returns {{ error: string } | { valor: string }} el error, o el valor ya recortado.
 */
const validarNombreApellido = (valor, etiqueta) => {
    const texto = String(valor).trim();

    if (texto.length > LARGO_MAXIMO_NOMBRE_APELLIDO) {
        return { error: `El ${etiqueta} no puede superar los ${LARGO_MAXIMO_NOMBRE_APELLIDO} caracteres.` };
    }
    if (!PATRON_NOMBRE_APELLIDO.test(texto)) {
        return { error: `El ${etiqueta} solo puede contener letras, espacios, guiones y apóstrofes.` };
    }

    return { valor: texto };
};

// HU 1.1: el DNI son 7 u 8 dígitos exactos, sin puntos ni espacios.
const PATRON_DNI = /^\d{7,8}$/;

// HU 1.1: nombre@dominio.ext, sin espacios ni una segunda arroba, con una
// extensión de al menos dos letras.
const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LARGO_MAXIMO_EMAIL = 100;

// HU 1.1: bcrypt trunca en silencio lo que pasa de 72 bytes, así que una
// contraseña más larga no suma seguridad real: dos contraseñas distintas que
// compartan los primeros 72 caracteres terminarían hasheando igual.
const LARGO_MINIMO_CONTRASEÑA = 8;
const LARGO_MAXIMO_CONTRASEÑA = 72;

// HU 1.1: largo máximo de los datos del camionero. Mismo motivo que el largo
// de nombre/apellido: sin este chequeo, un valor más largo rompe el
// INSERT/UPDATE contra el VARCHAR de la columna con un 500 en vez de un 400.
const LARGO_MAXIMO_UBICACION = 150;
const LARGO_MAXIMO_TIPO_VEHICULO = 100;

/**
 * Valida y recorta el DNI (HU 1.1): exactamente 7 u 8 dígitos, sin puntos,
 * espacios ni letras. Se guarda como string, no como número, para no perder
 * un cero inicial como el de "01234567".
 *
 * @param {*} valor - lo que llegó en el body.
 * @returns {{ error: string } | { valor: string }} el error, o el valor ya recortado.
 */
const validarDni = (valor) => {
    const texto = String(valor).trim();

    if (!PATRON_DNI.test(texto)) {
        return { error: 'El DNI debe tener 7 u 8 números, sin puntos ni espacios.' };
    }

    return { valor: texto };
};

/**
 * Valida y recorta el email (HU 1.1): formato nombre@dominio.ext (sin
 * espacios ni doble arroba, con una extensión de al menos dos letras) y
 * hasta 100 caracteres. Se guarda tal como se ingresó, sólo recortado: la
 * comparación sin distinguir mayúsculas para el duplicado la hace la
 * consulta a la base (con LOWER()), no esta función.
 *
 * @param {*} valor - lo que llegó en el body.
 * @returns {{ error: string } | { valor: string }} el error, o el valor ya recortado.
 */
const validarEmail = (valor) => {
    const texto = String(valor).trim();

    if (texto.length > LARGO_MAXIMO_EMAIL) {
        return { error: `El email no puede superar los ${LARGO_MAXIMO_EMAIL} caracteres.` };
    }
    if (!PATRON_EMAIL.test(texto)) {
        return { error: 'El email no tiene un formato válido.' };
    }

    return { valor: texto };
};

/**
 * Valida el largo de la contraseña (HU 1.1): entre 8 y 72 caracteres. No se
 * recorta -como sí pasa con nombre, apellido, dni y email- porque los
 * espacios de una contraseña son parte de la contraseña, no relleno.
 *
 * @param {*} valor - lo que llegó en el body. Ya se sabe que no es vacío ni
 *   sólo espacios (ver CAMPOS_OBLIGATORIOS, que sí usa trim() para esa
 *   comprobación sin alterar el valor real).
 * @returns {{ error: string } | { valor: string }} el error, o la contraseña tal cual llegó.
 */
const validarContraseña = (valor) => {
    const contraseña = String(valor);

    if (contraseña.length < LARGO_MINIMO_CONTRASEÑA) {
        return { error: `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASEÑA} caracteres.` };
    }
    if (contraseña.length > LARGO_MAXIMO_CONTRASEÑA) {
        return { error: `La contraseña no puede superar los ${LARGO_MAXIMO_CONTRASEÑA} caracteres.` };
    }

    return { valor: contraseña };
};

/**
 * Valida y recorta ubicación o tipo de vehículo (HU 1.1): sólo el largo
 * máximo, sin restricción de caracteres. A propósito no hay patrón acá:
 * "Camión 3/4" o una dirección con "#", "°" o paréntesis tienen que seguir
 * aceptándose.
 *
 * @param {*} valor - lo que llegó en el body.
 * @param {string} campo - 'ubicacion' o 'tipo_vehiculo', para armar el mensaje de error.
 * @param {number} largoMaximo - 150 para ubicación, 100 para tipo de vehículo.
 * @returns {{ error: string } | { valor: string }} el error, o el valor ya recortado.
 */
const validarLargoCamionero = (valor, campo, largoMaximo) => {
    const texto = String(valor).trim();

    if (texto.length > largoMaximo) {
        return { error: `El campo '${campo}' no puede superar los ${largoMaximo} caracteres.` };
    }

    return { valor: texto };
};

/**
 * Controlador de POST /usuarios: da de alta un usuario (administrador o camionero).
 * Si el rol es 'camionero', crea además el registro asociado en CAMIONERO.
 *
 * @param {import('express').Request} req - Body: { nombre, apellido, dni, email, contraseña, rol, ubicacion?, tipo_vehiculo?, capacidad_kg? }.
 * @param {import('express').Response} res
 * @returns {Promise<import('express').Response>} 201 con el usuario creado, 400 por validación o duplicados, 500 ante error inesperado.
 */
const crearUsuario = async (req, res) => {
    const { capacidad_kg } = req.body;

    for (const campo of CAMPOS_OBLIGATORIOS) {
        const valor = req.body[campo];
        if (valor === undefined || valor === null || String(valor).trim() === '') {
            return res.status(400).json({ message: `El campo '${campo}' es obligatorio` });
        }
    }

    const nombreValidado = validarNombreApellido(req.body.nombre, 'nombre');
    if (nombreValidado.error) {
        return res.status(400).json({ message: nombreValidado.error });
    }
    const apellidoValidado = validarNombreApellido(req.body.apellido, 'apellido');
    if (apellidoValidado.error) {
        return res.status(400).json({ message: apellidoValidado.error });
    }
    const dniValidado = validarDni(req.body.dni);
    if (dniValidado.error) {
        return res.status(400).json({ message: dniValidado.error });
    }
    const emailValidado = validarEmail(req.body.email);
    if (emailValidado.error) {
        return res.status(400).json({ message: emailValidado.error });
    }
    const contraseñaValidada = validarContraseña(req.body.contraseña);
    if (contraseñaValidada.error) {
        return res.status(400).json({ message: contraseñaValidada.error });
    }
    const nombre = nombreValidado.valor;
    const apellido = apellidoValidado.valor;
    const dni = dniValidado.valor;
    const email = emailValidado.valor;
    const contraseña = contraseñaValidada.valor;

    // Se normaliza para que "Administrador " o "CAMIONERO" también sean válidos.
    const rol = String(req.body.rol).trim().toLowerCase();
    if (!ROLES_VALIDOS.includes(rol)) {
        return res.status(400).json({ message: "El campo 'rol' debe ser 'administrador' o 'camionero'" });
    }

    let ubicacion = null;
    let tipo_vehiculo = null;
    if (rol === 'camionero') {
        for (const campo of CAMPOS_CAMIONERO) {
            const valor = req.body[campo];
            if (valor === undefined || valor === null || String(valor).trim() === '') {
                return res.status(400).json({ message: `El campo '${campo}' es obligatorio para el rol camionero` });
            }
        }

        const ubicacionValidada = validarLargoCamionero(req.body.ubicacion, 'ubicacion', LARGO_MAXIMO_UBICACION);
        if (ubicacionValidada.error) {
            return res.status(400).json({ message: ubicacionValidada.error });
        }
        const tipoVehiculoValidado = validarLargoCamionero(req.body.tipo_vehiculo, 'tipo_vehiculo', LARGO_MAXIMO_TIPO_VEHICULO);
        if (tipoVehiculoValidado.error) {
            return res.status(400).json({ message: tipoVehiculoValidado.error });
        }
        ubicacion = ubicacionValidada.valor;
        tipo_vehiculo = tipoVehiculoValidado.valor;

        if (isNaN(Number(capacidad_kg))) {
            return res.status(400).json({ message: `El campo 'capacidad_kg' debe ser numérico` });
        }
        if (Number(capacidad_kg) <= 0) {
            return res.status(400).json({ message: 'La capacidad debe ser un número mayor a cero.' });
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
        // LOWER() de los dos lados: "ana@mail.com" y "ANA@mail.com" son el mismo email.
        const emailExistente = await pool.query('SELECT id_usuario FROM USUARIO WHERE LOWER(email) = LOWER($1)', [email]);
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
 * No permite modificar dni, rol ni contraseña desde este endpoint, ni que un
 * administrador se dé de baja a sí mismo.
 * Si el usuario es camionero, actualiza también sus datos en CAMIONERO.
 *
 * @param {import('express').Request} req - Params: id. Body: { nombre, apellido, email, estado, ubicacion?, tipo_vehiculo?, capacidad_kg? }.
 * @param {import('express').Response} res
 * @returns {Promise<import('express').Response>} 200 con el usuario actualizado, 400 por validación o email duplicado,
 *   404 si no existe, 409 si intenta darse de baja a sí mismo, 500 ante error inesperado.
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

    const nombreValidado = validarNombreApellido(req.body.nombre, 'nombre');
    if (nombreValidado.error) {
        return res.status(400).json({ message: nombreValidado.error });
    }
    const apellidoValidado = validarNombreApellido(req.body.apellido, 'apellido');
    if (apellidoValidado.error) {
        return res.status(400).json({ message: apellidoValidado.error });
    }
    const emailValidado = validarEmail(req.body.email);
    if (emailValidado.error) {
        return res.status(400).json({ message: emailValidado.error });
    }

    const { capacidad_kg } = req.body;
    const nombre = nombreValidado.valor;
    const apellido = apellidoValidado.valor;
    const email = emailValidado.valor;
    const estado = String(req.body.estado).trim().toLowerCase();
    if (!ESTADOS_VALIDOS.includes(estado)) {
        return res.status(400).json({ message: `El campo 'estado' debe ser 'activo' o 'inactivo'` });
    }

    // Un administrador no puede darse de baja a sí mismo: `verifyToken` rechaza
    // toda petición de una cuenta inactiva, así que quedaría sin poder volver a
    // activarse ni crear otro administrador. Darlo de baja es tarea de otro.
    if (idUsuario === req.usuario.id && estado === 'inactivo') {
        return res.status(409).json({ message: 'No podés dar de baja tu propia cuenta.' });
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

        let ubicacion = null;
        let tipo_vehiculo = null;
        if (rol === 'camionero') {
            for (const campo of CAMPOS_CAMIONERO) {
                const valor = req.body[campo];
                if (valor === undefined || valor === null || String(valor).trim() === '') {
                    return res.status(400).json({ message: `El campo '${campo}' es obligatorio para el rol camionero` });
                }
            }

            const ubicacionValidada = validarLargoCamionero(req.body.ubicacion, 'ubicacion', LARGO_MAXIMO_UBICACION);
            if (ubicacionValidada.error) {
                return res.status(400).json({ message: ubicacionValidada.error });
            }
            const tipoVehiculoValidado = validarLargoCamionero(req.body.tipo_vehiculo, 'tipo_vehiculo', LARGO_MAXIMO_TIPO_VEHICULO);
            if (tipoVehiculoValidado.error) {
                return res.status(400).json({ message: tipoVehiculoValidado.error });
            }
            ubicacion = ubicacionValidada.valor;
            tipo_vehiculo = tipoVehiculoValidado.valor;

            if (isNaN(Number(capacidad_kg))) {
                return res.status(400).json({ message: `El campo 'capacidad_kg' debe ser numérico` });
            }
            if (Number(capacidad_kg) <= 0) {
                return res.status(400).json({ message: 'La capacidad debe ser un número mayor a cero.' });
            }
        }

        // Se valida el email duplicado excluyendo al propio usuario que se está editando,
        // para no rechazar el guardado si no cambió su email. LOWER() de los dos lados:
        // "ana@mail.com" y "ANA@mail.com" son el mismo email.
        const emailExistente = await pool.query(
            'SELECT id_usuario FROM USUARIO WHERE LOWER(email) = LOWER($1) AND id_usuario <> $2', // ignora la fila del propio usuario que se está editando
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
