require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authControllers = require('./src/controllers/authControllers');
const usuarioControllers = require('./src/controllers/usuarioControllers');
const cargaControllers = require('./src/controllers/cargaControllers');
const { verifyToken, requireRol } = require('./src/middlewares/auth');

const app = express();

//Middlewares (Configuraciones base)
app.use(cors()); //Permite que el Frontend se comunique sin bloqueos
app.use(express.json()); //Permite que el servidor lea el body en formato JSON

// -- Rutas del sistema --

// Rutas publicas
app.post('/auth/login', authControllers.login);

// Rutas de usuarios: administrar cuentas es tarea del administrador (HU 1.1, 1.2, 1.3).
app.get('/usuarios', verifyToken, requireRol('administrador'), usuarioControllers.listarUsuarios);
app.post('/usuarios', verifyToken, requireRol('administrador'), usuarioControllers.crearUsuario);
app.put('/usuarios/:id', verifyToken, requireRol('administrador'), usuarioControllers.actualizarUsuario);

// Rutas de cargas.
// Dar de alta es exclusivo del administrador (HU 2.1). Consultar queda abierto a
// cualquier usuario logueado, porque HU 2.3 pide que las cargas publicadas sean
// visibles para los camioneros; si el equipo prefiere restringirlo, alcanza con
// agregarle requireRol('administrador') a las dos rutas de abajo.
app.post('/cargas', verifyToken, requireRol('administrador'), cargaControllers.crearCarga);
app.get('/cargas', verifyToken, cargaControllers.listarCargas);
app.get('/cargas/:id', verifyToken, cargaControllers.obtenerCarga);

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
