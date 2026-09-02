const express = require('express');
const cors = require('cors');
const pool = require('./src/db');
const authControllers = require('./src/controllers/authControllers');
const usuarioControllers = require('./src/controllers/usuarioControllers');
const cargaControllers = require('./src/controllers/cargaControllers');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Prueba de conexión a la base de datos
pool.connect()
    .then(() => console.log('¡Conectado exitosamente a la base de datos!'))
    .catch(err => console.error('Error de conexión a la base de datos', err.stack));

// Rutas
app.post('/auth/login', authControllers.login);
app.get('/usuarios', usuarioControllers.listarUsuarios);
app.post('/usuarios', usuarioControllers.crearUsuario);
app.put('/usuarios/:id', usuarioControllers.actualizarUsuario);
app.post('/cargas', cargaControllers.crearCarga);
app.get('/cargas', cargaControllers.listarCargas);
app.get('/cargas/:id', cargaControllers.obtenerCarga);

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});