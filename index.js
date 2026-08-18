const express = require('express');
const cors = require('cors');
const pool = require('./src/db');
const authControllers = require('./src/Controllers/authControllers');

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

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});