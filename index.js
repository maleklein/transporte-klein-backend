require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authControllers = require('./src/controllers/authControllers');
const usuarioControllers = require('./src/controllers/usuarioControllers');
const cargaControllers = require('./src/controllers/cargaControllers');
const geografiaControllers = require('./src/controllers/geografiaControllers');
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

// Catálogo geográfico: alimenta los selectores de provincia y localidad del
// alta, la edición y el filtro del listado. Sin `requireRol` porque el filtro
// lo usa cualquier usuario logueado, no sólo el administrador.
app.get('/provincias', verifyToken, geografiaControllers.listarProvincias);
app.get('/localidades', verifyToken, geografiaControllers.listarLocalidades);

// Rutas de cargas.
// Escribir (alta, edición, cambio de estado) es exclusivo del administrador.
// Consultar queda abierto a cualquier usuario logueado, pero lo que ve depende
// del rol: al camionero el controlador le devuelve sólo las cargas en
// "disponible" (HU 3), que son a las que se puede postular.
app.post('/cargas', verifyToken, requireRol('administrador'), cargaControllers.crearCarga);
app.get('/cargas', verifyToken, cargaControllers.listarCargas);
app.get('/cargas/:id', verifyToken, cargaControllers.obtenerCarga);
app.get('/cargas/:id/historial', verifyToken, cargaControllers.obtenerHistorialCarga);
app.put('/cargas/:id', verifyToken, requireRol('administrador'), cargaControllers.actualizarCarga);
app.patch('/cargas/:id/estado', verifyToken, requireRol('administrador'), cargaControllers.cambiarEstadoCarga);

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
