const { Pool } = require('pg'); //Herramienta nativa para conectar con PostgreSQL

//Configuramos los datos de nuestra base de datos
const poolDeConexion = new Pool({
    user: 'postgres',           
    host: 'localhost',          
    database: 'transporte_klein_db', 
    password: 'SQL4665',
    port: 5432                  
});

//Exportamos la conexión para usarla en el controlador
module.exports = poolDeConexion;