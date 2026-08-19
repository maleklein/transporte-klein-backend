const express = require('express');
const cors = require('cors');

//Importo a la función desde el controlador
const { iniciarSesion } = require('./src/controllers/authControllers');

const servidor = express();
const puerto = 3000;

//Middlewares (Configuraciones base)
servidor.use(cors()); //Permite que el Frontend se comunique sin bloqueos
servidor.use(express.json()); // MUY IMPORTANTE: Permite que el servidor lea datos en formato JSON (el correo y la clave)

// -- Rutas del sistema --
// Tradujo la ruta al español. El frontend deberá apuntar aquí.!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
servidor.post('/autenticacion/iniciar-sesion', iniciarSesion);

// Iniciar el servidor 
servidor.listen(puerto, () => {
    console.log(`Servidor de Transporte Klein corriendo perfectamente en el puerto ${puerto}`);
});