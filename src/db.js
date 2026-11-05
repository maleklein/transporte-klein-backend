require('dotenv').config();
const { Pool } = require('pg'); //Herramienta nativa para conectar con PostgreSQL

//Los datos de conexión salen del .env: nada de credenciales hardcodeadas en el repo.
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

//Si PostgreSQL corta una conexión que estaba libre (se reinició la base, por ejemplo), el pool emite 'error'.
//Sin este manejador ese evento tira abajo el proceso; con él, el pool descarta la conexión y abre otra en la próxima consulta.
pool.on('error', (error) => {
    console.error('PostgreSQL cortó una conexión libre:', error.code ?? error.name);
});

//Exportamos la conexión para usarla en los controladores y middlewares
module.exports = pool;
