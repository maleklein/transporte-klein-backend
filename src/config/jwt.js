/**
 * Configuración del JWT, en un solo lugar.
 *
 * El secreto lo comparten quien firma el token (authControllers) y quien lo
 * verifica (el middleware de auth). Si cada uno tuviera el suyo, los tokens
 * firmados no validarían y el error sería difícil de rastrear.
 */

require('dotenv').config();

/**
 * Secreto con el que se firman y verifican los tokens.
 *
 * Se corta el arranque si no está definido, a propósito: un servidor corriendo
 * con un secreto por defecto es peor que uno que no arranca, porque cualquiera
 * que conozca ese valor puede fabricarse un token de administrador.
 */
const SECRETO = process.env.JWT_SECRET;

if (!SECRETO) {
    throw new Error(
        'Falta la variable de entorno JWT_SECRET.\n' +
        'Agregala a tu archivo .env, por ejemplo:\n' +
        '  JWT_SECRET=una_frase_larga_y_dificil_de_adivinar\n' +
        'Podés generar una con: openssl rand -base64 32'
    );
}

/** Cuánto dura la sesión antes de que haya que volver a loguearse. */
const EXPIRACION = '2h';

module.exports = { SECRETO, EXPIRACION };
