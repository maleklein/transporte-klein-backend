const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'transporte_klein_db',
    password: 'SQL4665', 
    port: 5432,
});

module.exports = pool;