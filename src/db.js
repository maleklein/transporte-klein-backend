const { Pool } = require('pg'); //Herramienta nativa para conectar con PostgreSQL

//Configuramos los datos de nuestra base de datos
const poolDeConexion = new Pool({
    user: 'postgres',           
    host: 'localhost',          
    database: 'transporte_klein_db', 
    password: 'SQL4665',
    port: 5432                  
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

//Exportamos la conexión para usarla en el controlador
module.exports = poolDeConexion;