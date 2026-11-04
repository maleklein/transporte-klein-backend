/**
 * Crea el primer administrador de una base recien armada.
 *
 * Hace falta porque `POST /usuarios` exige token de administrador (GIA-39):
 * en una base vacia no hay a quien loguearse, asi que nadie podria crear la
 * primera cuenta. Este script inserta esa cuenta directo en la base, con la
 * contraseña hasheada con el mismo bcrypt que usa el alta normal.
 *
 * Uso:
 *   node scripts/crear-admin.js <email> <contraseña> [nombre] [apellido] [dni]
 *
 * Ejemplo:
 *   node scripts/crear-admin.js admin@klein.com miClave123 Milena Seri 40123456
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('../src/db');

const [email, contraseña, nombre = 'Admin', apellido = 'Inicial', dni = '00000000'] = process.argv.slice(2);

if (!email || !contraseña) {
    console.error('Faltan datos.\n');
    console.error('Uso: node scripts/crear-admin.js <email> <contraseña> [nombre] [apellido] [dni]');
    process.exit(1);
}

if (contraseña.length < 8) {
    console.error('La contraseña tiene que tener al menos 8 caracteres.');
    process.exit(1);
}

(async () => {
    try {
        const yaExiste = await pool.query('SELECT id_usuario FROM USUARIO WHERE email = $1 OR dni = $2', [email, dni]);
        if (yaExiste.rows.length > 0) {
            console.error(`Ya hay un usuario con ese email o DNI (id ${yaExiste.rows[0].id_usuario}).`);
            process.exit(1);
        }

        const hash = await bcrypt.hash(contraseña, 10);
        const resultado = await pool.query(
            `INSERT INTO USUARIO (nombre, apellido, dni, email, contraseña_hash, rol, estado)
             VALUES ($1, $2, $3, $4, $5, 'administrador', 'activo')
             RETURNING id_usuario, nombre, apellido, email, rol`,
            [nombre, apellido, dni, email, hash]
        );

        const usuario = resultado.rows[0];
        console.log('Administrador creado:');
        console.log(`  id     ${usuario.id_usuario}`);
        console.log(`  nombre ${usuario.nombre} ${usuario.apellido}`);
        console.log(`  email  ${usuario.email}`);
        console.log('\nYa podés iniciar sesión con ese email y la contraseña que pusiste.');
    } catch (error) {
        console.error('No se pudo crear el administrador:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
})();
