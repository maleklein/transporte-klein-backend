/**
 * Validaciones de campo de CARGA, compartidas entre el alta (POST /cargas,
 * HU 2.1) y la edición (PUT /cargas/:id, HU 2.2). Mismas reglas y mismos
 * mensajes de error para que un campo inválido dé la misma respuesta sin
 * importar por qué endpoint entró.
 */

/**
 * Campos de texto del formulario, con el largo máximo que soporta su columna.
 * Validarlos acá evita que el INSERT/UPDATE falle en Postgres y termine en un
 * 500 genérico, sin decirle al usuario qué campo se pasó.
 */
const CAMPOS_TEXTO = {
    origen: 150,
    destino: 150,
    tipo_carga: 100,
    observaciones: 1000,
};

/**
 * Campos cuyo texto se normaliza con la primera letra en mayúscula, para que
 * "rosario" y "Rosario" no queden como dos destinos distintos en el listado.
 * `observaciones` queda afuera: es texto libre y no se usa para agrupar.
 */
const CAMPOS_A_NORMALIZAR = ['origen', 'destino', 'tipo_carga'];

/** Rango razonable para la columna `peso_kg` (numeric). */
const PESO_MINIMO = 0.01;
const PESO_MAXIMO = 99999999.99;

/** Años aceptados. Fuera de este rango, Postgres rechaza el DATE con un 500. */
const ANIO_MINIMO = 1900;
const ANIO_MAXIMO = 2100;

/**
 * Saca los caracteres que no se ven pero rompen cosas: de control (saltos de
 * línea, tabulaciones, el byte nulo que Postgres rechaza) y los invisibles de
 * ancho cero o de dirección, que hacen que dos textos se vean iguales en
 * pantalla y no lo sean a la hora de filtrar.
 *
 * Se limpian en silencio en vez de rechazarlos: casi siempre llegan pegados
 * desde un Excel o un PDF y el usuario no tiene forma de saber que están.
 *
 * @param {string} valor - texto recibido en el body.
 * @returns {string} el texto sin caracteres invisibles y sin espacios sobrantes.
 */
const limpiarTexto = (valor) => valor
    // Caracteres de control C0 y C1, incluido el byte nulo que Postgres rechaza de plano.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    // Invisibles: ancho cero, marcas de direccion (bidi) y BOM.
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    // Los espacios que quedaron, mas los que ya venian de mas, se juntan en uno solo.
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Pone en mayúscula la primera letra y deja el resto como lo escribió el usuario.
 * No se toca el resto a propósito: pasar todo a minúscula rompería nombres como
 * "Buenos Aires" o "Km 45".
 *
 * @param {string} valor - texto ya limpio.
 * @returns {string} el texto con la primera letra en mayúscula.
 */
const normalizar = (valor) => (valor ? valor[0].toUpperCase() + valor.slice(1) : valor);

/**
 * Interpreta el peso, que puede llegar como número o como texto.
 * Acepta la coma decimal porque es como se escribe acá ("12,5"), y descarta
 * lo que la columna no puede guardar: valores no numéricos, infinitos, fuera
 * de rango, o tan chicos que al redondear a dos decimales quedarían en cero.
 *
 * @param {*} valor - lo que vino en `body.peso`.
 * @returns {{peso?: number, error?: string}} el peso normalizado, o el mensaje de error.
 */
const parsearPeso = (valor) => {
    if (typeof valor !== 'number' && typeof valor !== 'string') {
        return { error: "El campo 'peso' debe ser un número" };
    }

    const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.').trim());

    if (!Number.isFinite(numero)) {
        return { error: "El campo 'peso' debe ser un número" };
    }
    if (numero < PESO_MINIMO) {
        return { error: `El campo 'peso' debe ser al menos ${PESO_MINIMO} kg` };
    }
    if (numero > PESO_MAXIMO) {
        return { error: `El campo 'peso' no puede superar los ${PESO_MAXIMO} kg` };
    }

    return { peso: numero };
};

/**
 * Valida que la fecha tenga formato AAAA-MM-DD, que exista de verdad y que caiga
 * en un año razonable. El regex por sí solo deja pasar cosas como 2026-02-31,
 * por eso se reconstruye la fecha y se compara contra el texto original.
 *
 * @param {string} valor - fecha recibida en el body, ya recortada.
 * @returns {boolean} true si la fecha es válida y existe en el calendario.
 */
const esFechaValida = (valor) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

    const anio = Number(valor.slice(0, 4));
    if (anio < ANIO_MINIMO || anio > ANIO_MAXIMO) return false;

    const fecha = new Date(`${valor}T00:00:00Z`);
    if (Number.isNaN(fecha.getTime())) return false;
    return fecha.toISOString().slice(0, 10) === valor;
};

/**
 * Valida los seis campos de una carga (origen, destino, tipo_carga, peso,
 * fecha, observaciones) contra un body de Express. Todos son obligatorios:
 * la usan tanto el alta como la edición, y ninguna de las dos admite carga
 * parcial.
 *
 * Acumula todos los errores en vez de cortar en el primero, para que el
 * formulario pueda marcar de una vez todos los campos con problema.
 *
 * @param {Record<string, unknown>} body - req.body de Express.
 * @returns {{
 *   errores: Record<string, string>,
 *   valores: {origen?: string, destino?: string, tipo_carga?: string, observaciones?: string, peso?: number, fecha?: string}
 * }} errores agrupados por campo, y los valores ya limpios/normalizados de los campos que pasaron.
 */
const validarCampos = (body) => {
    const errores = {};
    const valores = {};

    for (const [campo, largoMaximo] of Object.entries(CAMPOS_TEXTO)) {
        const valor = body[campo];

        // Se exige texto de verdad: si viniera un objeto o un array, el String()
        // lo guardaría como "[object Object]" o "a,b" sin que nadie se entere.
        if (typeof valor !== 'string') {
            errores[campo] = valor === undefined || valor === null
                ? `El campo '${campo}' es obligatorio`
                : `El campo '${campo}' debe ser texto`;
            continue;
        }

        const limpio = limpiarTexto(valor);

        if (limpio === '') {
            errores[campo] = `El campo '${campo}' es obligatorio`;
        } else if (limpio.length > largoMaximo) {
            errores[campo] = `El campo '${campo}' no puede superar los ${largoMaximo} caracteres`;
        } else {
            valores[campo] = CAMPOS_A_NORMALIZAR.includes(campo) ? normalizar(limpio) : limpio;
        }
    }

    if (body.peso === undefined || body.peso === null || String(body.peso).trim() === '') {
        errores.peso = "El campo 'peso' es obligatorio";
    } else {
        const { peso: pesoValido, error } = parsearPeso(body.peso);
        if (error) {
            errores.peso = error;
        } else {
            valores.peso = pesoValido;
        }
    }

    const fecha = typeof body.fecha === 'string' ? body.fecha.trim() : '';

    if (fecha === '') {
        errores.fecha = "El campo 'fecha' es obligatorio";
    } else if (!esFechaValida(fecha)) {
        errores.fecha = "El campo 'fecha' debe tener formato AAAA-MM-DD";
    } else {
        valores.fecha = fecha;
    }

    return { errores, valores };
};

module.exports = {
    validarCampos,
    esFechaValida,
    CAMPOS_TEXTO,
    PESO_MINIMO,
    PESO_MAXIMO,
    ANIO_MINIMO,
    ANIO_MAXIMO,
};
