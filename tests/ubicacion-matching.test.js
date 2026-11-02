const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crearResolutorUbicacion, coordenadasValidas } = require('../src/services/ubicacionMatching');

const localidades = [
    { id_localidad: '30084160', nombre: 'Paraná', provincia: 'Entre Ríos', departamento: 'Paraná', latitud: '-31.740148', longitud: '-60.527466' },
    { id_localidad: '82063170', nombre: 'Santa Fe', provincia: 'Santa Fe', departamento: 'La Capital', latitud: '-31.646557', longitud: '-60.709996' },
    { id_localidad: '00000001', nombre: 'San José', provincia: 'Entre Ríos', departamento: 'Colón', latitud: '-32', longitud: '-58' },
    { id_localidad: '00000002', nombre: 'San José', provincia: 'Buenos Aires', departamento: 'A', latitud: '-33', longitud: '-59' },
    { id_localidad: '00000003', nombre: 'San José', provincia: 'Buenos Aires', departamento: 'B', latitud: '-34', longitud: '-60' },
];
const resolver = crearResolutorUbicacion(localidades);

test('resuelve mayúsculas, tildes y espacios usando coordenadas reales del catálogo', () => {
    const resultado = resolver('  PARANA ,  entre   rios ');
    assert.deepEqual(resultado.coordenadas, { lat: -31.740148, lon: -60.527466 });
    assert.equal(resultado.localidad.id_localidad, '30084160');
});

test('admite un nombre sin provincia solo cuando es único en el catálogo', () => {
    assert.equal(resolver('Paraná').localidad.id_localidad, '30084160');
    assert.match(resolver('San José').advertencia, /ambigua/);
});

test('provincia y departamento desambiguan sin elegir la primera coincidencia', () => {
    assert.equal(resolver('San Jose, Entre Rios').localidad.id_localidad, '00000001');
    assert.match(resolver('San José, Buenos Aires').advertencia, /ambigua/);
    assert.equal(resolver('San José, B, Buenos Aires').localidad.id_localidad, '00000003');
});

test('no inventa una localidad para un error de escritura, otra provincia o una dirección', () => {
    for (const texto of ['Paran', 'Paraná, Buenos Aires', 'Calle de prueba 123', 'Paraná,,Entre Ríos', 'a,b,c,d']) {
        const resultado = resolver(texto);
        assert.equal(resultado.coordenadas, undefined);
        assert.equal(typeof resultado.advertencia, 'string');
    }
});

test('ubicación y coordenadas ausentes o fuera de rango quedan pendientes', () => {
    for (const texto of [null, undefined, '', ' ']) assert.match(resolver(texto).advertencia, /informada/);
    for (const [lat, lon] of [[null, null], ['', ''], [91, -60], [-31, -181], [NaN, 0], [false, true]]) {
        assert.equal(coordenadasValidas(lat, lon), null);
    }
    const incompleto = crearResolutorUbicacion([{ ...localidades[0], latitud: null }]);
    assert.match(incompleto('Paraná').advertencia, /coordenadas/);
});
