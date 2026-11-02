/** Resuelve texto del perfil contra el catálogo local, sin geocodificación externa. */
function normalizar(valor) {
    return typeof valor === 'string'
        ? valor.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ')
        : '';
}

function coordenadasValidas(latitud, longitud) {
    const convertir = (valor) => {
        if (!['number', 'string'].includes(typeof valor) || String(valor).trim() === '') return null;
        const numero = Number(valor);
        return Number.isFinite(numero) ? numero : null;
    };
    const lat = convertir(latitud);
    const lon = convertir(longitud);
    return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** Índice por nombre: se construye una vez por consulta de ranking. */
function crearResolutorUbicacion(localidades) {
    const porNombre = new Map();
    for (const localidad of localidades) {
        const nombre = normalizar(localidad.nombre);
        if (!porNombre.has(nombre)) porNombre.set(nombre, []);
        porNombre.get(nombre).push(localidad);
    }
    return (texto) => {
        const partes = typeof texto === 'string' ? texto.split(',').map(normalizar) : [];
        if (!partes.length || !partes[0]) {
            return { advertencia: 'La ubicación del camionero no está informada.' };
        }
        if (partes.length > 3 || partes.some((parte) => !parte)) {
            return { advertencia: 'La ubicación debe indicar localidad, provincia; si se repite, agregá el departamento.' };
        }
        let coincidencias = porNombre.get(partes[0]) ?? [];
        if (partes.length >= 2) {
            coincidencias = coincidencias.filter((l) => normalizar(l.provincia) === partes.at(-1));
        }
        if (partes.length === 3) {
            coincidencias = coincidencias.filter((l) => normalizar(l.departamento) === partes[1]);
        }
        if (coincidencias.length === 0) {
            return { advertencia: 'La ubicación no se encontró en el catálogo. Revisá localidad y provincia del camionero.' };
        }
        if (coincidencias.length > 1) {
            return { advertencia: 'La ubicación es ambigua. Agregá provincia y, si hace falta, departamento al perfil del camionero.' };
        }
        const localidad = coincidencias[0];
        const coordenadas = coordenadasValidas(localidad.latitud, localidad.longitud);
        if (!coordenadas) return { advertencia: 'La localidad del camionero no tiene coordenadas válidas.' };
        return {
            coordenadas,
            localidad: {
                id_localidad: localidad.id_localidad.trim(), nombre: localidad.nombre,
                departamento: localidad.departamento, provincia: localidad.provincia,
            },
        };
    };
}

module.exports = { crearResolutorUbicacion, coordenadasValidas };
