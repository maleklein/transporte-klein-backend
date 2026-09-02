//Importo las herramientas necesarias
const conexionBd = require('../db'); // La conexión a la base de datos
const bcrypt = require('bcrypt'); //Herramienta de encriptación
const jwt = require('jsonwebtoken'); //Herramienta para el token

const iniciarSesion = async (peticion, respuesta) => {
    //Recibo los datos que envía el frontend
    const { correo, clave } = peticion.body;

    try {
        //Compruebo que no falte el correo o la clave
        if (!correo || !clave) {
            return respuesta.status(400).json({ error: 'Por favor, ingresa el correo y la clave.' });
        }

        //Busco al usuario en la base de datos
        //En la tabla la columna se llama 'email', por eso la consulta SQL usa esa palabra
        const consulta = 'SELECT * FROM usuario WHERE email = $1';
        
        //Ejecuto la consulta y extraigo las 'rows' nativas y las renombro como 'filas'
        const { rows: filas } = await conexionBd.query(consulta, [correo]);

        //Si no hay filas, el correo no existe en la base de datos
        if (filas.length === 0) {
            return respuesta.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        //Guardo los datos del primer usuario encontrado
        const usuarioEncontrado = filas[0];

        //Verificar el campo 'estado'
        if (usuarioEncontrado.estado !== 'activo') {
            return respuesta.status(403).json({ error: 'Este usuario está inactivo o suspendido.' });
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { SECRETO, EXPIRACION } = require('../config/jwt');

const login = async (req, res) => {
    const { email, contraseña } = req.body;

    try {
        // 1. Buscar si el usuario existe en la base de datos
        const result = await pool.query('SELECT * FROM USUARIO WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Usuario no encontrado' });
        }

        //Comparo la clave ingresada con la contraseña_hash de la base de datos
        const claveValida = await bcrypt.compare(clave, usuarioEncontrado.contraseña_hash);

        if (!claveValida) {
            return respuesta.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        //Genero el Token de sesión
        const tokenSesion = jwt.sign(
            {
                id_usuario: usuarioEncontrado.id_usuario,
                rol: usuarioEncontrado.rol,
                nombre: usuarioEncontrado.nombre
            },
            'SECRETO_SUPER_SEGURO', 
            { expiresIn: '2h' }
        );

        //Envío la respuesta exitosa al frontend
        respuesta.status(200).json({
            mensaje: 'Inicio de sesión exitoso',
            token: tokenSesion,
            usuario: {
                id_usuario: usuarioEncontrado.id_usuario,
                nombre: usuarioEncontrado.nombre,
                apellido: usuarioEncontrado.apellido,
                rol: usuarioEncontrado.rol
            }
        // 2. Verificar la contraseña encriptada
        const validPassword = await bcrypt.compare(contraseña, user.contraseña_hash);
        if (!validPassword) {
             return res.status(401).json({ message: 'Contraseña incorrecta' });
        }

        // 3. Verificar que la cuenta siga habilitada. La HU 1.4 lo pide y faltaba:
        // sin esto, un usuario dado de baja se seguía llevando un token válido.
        if (user.estado !== 'activo') {
            return res.status(403).json({ message: 'La cuenta no está activa.' });
        }

        // 4. Generar el token de sesión
        const token = jwt.sign(
            { id: user.id_usuario, rol: user.rol },
            SECRETO,
            { expiresIn: EXPIRACION }
        );

        res.json({
            token,
            user: { id: user.id_usuario, email: user.email, rol: user.rol }
        });

    } catch (errorServidor) {
        //Agarro cualquier fallo del sistema
        console.error('Error en el inicio de sesión:', errorServidor);
        respuesta.status(500).json({ error: 'Error interno del servidor.' });
    }
};

//Exporto la función para que pueda ser utilizada en otros archivos
module.exports = {
    iniciarSesion
};
module.exports = { login };
