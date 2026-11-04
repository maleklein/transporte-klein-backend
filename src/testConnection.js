const pool = require('./db');

pool.query('SELECT NOW()')
    .then(result => {
        console.log('Conexión exitosa. Hora del servidor:', result.rows[0].now);
        return pool.end();
    })
    .catch(err => {
        console.error('Error al conectar a la base de datos:', err.message);
        process.exit(1);
    });
