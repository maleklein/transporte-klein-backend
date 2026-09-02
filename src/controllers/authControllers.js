//Importo las herramientas necesarias
const pool = require('../db'); // La conexión a la base de datos
const bcrypt = require('bcrypt'); //Herramienta de encriptación
const jwt = require('jsonwebtoken'); //Herramienta para el token
const { SECRETO, EXPIRACION } = require('../config/jwt'); //Config del JWT en un solo lugar

/**
 * POST /auth/login — valida las credenciales y devuelve un token de sesión.
 *
 * @param {import('express').Request} req - Body: { email, contraseña }.
 * @param {import('express').Response} res
 * @returns {Promise<import('express').Response>} 200 con { token, user }; 400 si
 *   faltan datos; 401 si las credenciales no coinciden; 403 si la cuenta está
 *   inactiva; 500 ante un error inesperado.
 */
const login = async (req, res) => {
    const { email, contraseña } = req.body;

    try {
        //Compruebo que no falte el email o la contraseña
        if (!email || !contraseña) {
            return res.status(400).json({ message: 'Por favor, ingresá el email y la contraseña.' });
        }

        // 1. Buscar si el usuario existe en la base de datos
        const result = await pool.query('SELECT * FROM USUARIO WHERE email = $1', [email]);

        // Mismo mensaje para "no existe" y "contraseña incorrecta": no revelamos
        // si el email está registrado.
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Credenciales incorrectas.' });
        }

        const user = result.rows[0];

        // 2. Verificar la contraseña encriptada
        const validPassword = await bcrypt.compare(contraseña, user.contraseña_hash);
        if (!validPassword) {
            return res.status(401).json({ message: 'Credenciales incorrectas.' });
        }

        // 3. Verificar que la cuenta siga habilitada. La HU 1.4 lo pide:
        // sin esto, un usuario dado de baja se seguía llevando un token válido.
        if (user.estado !== 'activo') {
            return res.status(403).json({ message: 'La cuenta no está activa.' });
        }

        // 4. Generar el token de sesión.
        // El payload es { id, rol } para que coincida con lo que espera el
        // middleware verifyToken (usa payload.id).
        const token = jwt.sign(
            { id: user.id_usuario, rol: user.rol },
            SECRETO,
            { expiresIn: EXPIRACION }
        );

        return res.status(200).json({
            token,
            user: { id: user.id_usuario, email: user.email, rol: user.rol }
        });

    } catch (errorServidor) {
        console.error('Error en el inicio de sesión:', errorServidor);
        return res.status(500).json({ message: 'Error interno del servidor.' });
    }
};

//Exporto la función para que pueda ser utilizada en otros archivos
module.exports = { login };
