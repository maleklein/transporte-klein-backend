const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const login = async (req, res) => {
    const { email, contraseña } = req.body;

    try {
        // 1. Buscar si el usuario existe en la base de datos
        const result = await pool.query('SELECT * FROM USUARIO WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Usuario no encontrado' });
        }

        const user = result.rows[0];

        // 2. Verificar la contraseña encriptada
        const validPassword = await bcrypt.compare(contraseña, user.contraseña_hash);
        if (!validPassword) {
             return res.status(401).json({ message: 'Contraseña incorrecta' });
        }

        // 3. Generar el token de sesión
        const token = jwt.sign(
            { id: user.id_usuario, rol: user.rol }, 
            'secreto_super_seguro', 
            { expiresIn: '2h' }
        );

        res.json({ 
            token, 
            user: { id: user.id_usuario, email: user.email, rol: user.rol } 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = { login };