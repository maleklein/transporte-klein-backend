// RN-03 acordada: últimas diez evaluaciones, pesos 10, 9, ... 1.
const LIMITE_EVALUACIONES = 10;
const MAX_COMENTARIO = 1000;

function calcularReputacion(evaluaciones) {
    const recientes = [...evaluaciones].sort((a, b) =>
        new Date(b.creado_en) - new Date(a.creado_en) || b.id_calificacion - a.id_calificacion
    ).slice(0, LIMITE_EVALUACIONES);
    if (!recientes.length) return { promedio: null, evaluaciones_utilizadas: 0 };
    let suma = 0;
    let pesos = 0;
    recientes.forEach((evaluacion, indice) => {
        const peso = LIMITE_EVALUACIONES - indice;
        suma += evaluacion.puntaje * peso;
        pesos += peso;
    });
    return { promedio: Math.round(suma / pesos * 100) / 100, evaluaciones_utilizadas: recientes.length };
}

module.exports = { calcularReputacion, LIMITE_EVALUACIONES, MAX_COMENTARIO };
