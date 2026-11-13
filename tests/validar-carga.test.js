const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validarCampos, hoyEnArgentina, validarFechaNoPasada } = require('../src/validators/carga');

/** Una carga válida completa; cada test cambia sólo lo que prueba. */
const cargaValida = (cambios = {}) => ({
    origen_id: '82084270',
    destino_id: '14014010',
    tipo_carga: 'granos',
    peso: '12500',
    fecha: '2099-11-20',
    observaciones: 'Requiere lona',
    direccion_origen: 'Av. Pellegrini 1200',
    direccion_destino: 'Ruta 9 km 45',
    ...cambios,
});

test('observaciones y direcciones son opcionales: vacías o ausentes quedan en null', () => {
    for (const vacio of [undefined, null, '', '   ']) {
        const { errores, valores } = validarCampos(cargaValida({
            observaciones: vacio, direccion_origen: vacio, direccion_destino: vacio,
        }));
        assert.deepEqual(errores, {});
        assert.equal(valores.observaciones, null);
        assert.equal(valores.direccion_origen, null);
        assert.equal(valores.direccion_destino, null);
    }
});

test('las direcciones se limpian y respetan el largo máximo', () => {
    const { errores, valores } = validarCampos(cargaValida({ direccion_origen: '  Av.\tPellegrini   1200 ' }));
    assert.deepEqual(errores, {});
    assert.equal(valores.direccion_origen, 'Av. Pellegrini 1200');

    const largo = validarCampos(cargaValida({ direccion_destino: 'x'.repeat(151) }));
    assert.equal(largo.errores.direccion_destino, "El campo 'direccion_destino' no puede superar los 150 caracteres");
});

test('un campo opcional que no es texto sigue siendo un error', () => {
    const { errores } = validarCampos(cargaValida({ observaciones: { texto: 'hola' } }));
    assert.equal(errores.observaciones, "El campo 'observaciones' debe ser texto");
});

test('tipo de carga sigue siendo obligatorio', () => {
    const { errores } = validarCampos(cargaValida({ tipo_carga: '  ' }));
    assert.equal(errores.tipo_carga, "El campo 'tipo_carga' es obligatorio");
});

test('hoy es el día en Argentina, no en UTC', () => {
    // 13/11 a las 23:30 en Buenos Aires ya es 14/11 en UTC.
    assert.equal(hoyEnArgentina(new Date('2026-11-14T02:30:00Z')), '2026-11-13');
    assert.equal(hoyEnArgentina(new Date('2026-11-14T03:00:00Z')), '2026-11-14');
});

test('la fecha de retiro puede ser hoy o después, nunca antes', () => {
    assert.equal(validarFechaNoPasada('2026-11-12', '2026-11-13'), 'La fecha de retiro no puede ser anterior a hoy');
    assert.equal(validarFechaNoPasada('2026-11-13', '2026-11-13'), null);
    assert.equal(validarFechaNoPasada('2027-01-01', '2026-11-13'), null);
    // Sin "hoy" explícito usa el de Argentina.
    assert.equal(validarFechaNoPasada('2000-01-01'), 'La fecha de retiro no puede ser anterior a hoy');
});
