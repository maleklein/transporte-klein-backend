const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    ESTADOS,
    ESTADOS_FINALES,
    puedeTransicionar,
    transicionesDesde,
    esCorreccion,
} = require('../src/domain/estadosCarga');

test('una entrega marcada por error se puede deshacer', () => {
    assert.equal(puedeTransicionar(ESTADOS.ENTREGADA, ESTADOS.EN_VIAJE), true);
    // Deshacerla es volver atrás, no avanzar: el frontend lo muestra como corrección.
    assert.equal(esCorreccion(ESTADOS.ENTREGADA, ESTADOS.EN_VIAJE), true);
    // Y es el único destino: no se salta a aceptada ni se cancela lo ya entregado.
    assert.deepEqual(transicionesDesde(ESTADOS.ENTREGADA), [ESTADOS.EN_VIAJE]);
    for (const destino of [ESTADOS.ACEPTADA, ESTADOS.PENDIENTE, ESTADOS.DISPONIBLE, ESTADOS.CANCELADA]) {
        assert.equal(puedeTransicionar(ESTADOS.ENTREGADA, destino), false, destino);
    }
});

test('cancelada sigue siendo la única salida sin retorno', () => {
    assert.deepEqual(ESTADOS_FINALES, [ESTADOS.CANCELADA]);
    assert.deepEqual(transicionesDesde(ESTADOS.CANCELADA), []);
    for (const destino of Object.values(ESTADOS)) {
        assert.equal(puedeTransicionar(ESTADOS.CANCELADA, destino), false, destino);
    }
});

test('el resto del ciclo de vida no cambió', () => {
    assert.deepEqual(transicionesDesde(ESTADOS.DISPONIBLE), [ESTADOS.PENDIENTE, ESTADOS.CANCELADA]);
    assert.deepEqual(transicionesDesde(ESTADOS.PENDIENTE), [ESTADOS.ACEPTADA, ESTADOS.DISPONIBLE, ESTADOS.CANCELADA]);
    assert.deepEqual(transicionesDesde(ESTADOS.ACEPTADA), [ESTADOS.EN_VIAJE, ESTADOS.PENDIENTE]);
    assert.deepEqual(transicionesDesde(ESTADOS.EN_VIAJE), [ESTADOS.ENTREGADA, ESTADOS.ACEPTADA]);
});
