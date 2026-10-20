/**
 * Origen y destino de una carga, resueltos contra el catálogo geográfico.
 *
 * Son fragmentos de SQL y no una función porque van dentro de consultas más
 * grandes, siempre sobre CARGA con el alias `c`. Los usan las cargas, las
 * postulaciones y los avisos: definidos una sola vez, ninguna consulta se queda
 * sin la ruta ni la muestra con otro formato.
 */

/**
 * Columnas de origen y destino.
 *
 * Además de los ids y los nombres por separado —que es lo que necesitan los
 * selectores del formulario— arma un `origen` y un `destino` ya listos para
 * mostrar. Así las pantallas que sólo los muestran (el detalle, las tarjetas
 * del listado) siguen leyendo el mismo campo de siempre y no hubo que tocarlas.
 *
 * El CASE evita el "Santa Fe, Santa Fe" de las capitales que se llaman igual
 * que su provincia, y el caso extremo de CABA, que repetiría el nombre entero.
 *
 * Si una consulta que devuelve una carga se quedara sin estos campos, la
 * pantalla de detalle se quedaría sin la ruta después de esa operación.
 */
const COLUMNAS_UBICACION = `
                    c.id_localidad_origen  AS origen_id,
                    lo.nombre              AS origen_localidad,
                    po.id_provincia        AS origen_provincia_id,
                    po.nombre              AS origen_provincia,
                    CASE WHEN lo.nombre = po.nombre THEN lo.nombre
                         ELSE lo.nombre || ', ' || po.nombre END AS origen,
                    c.id_localidad_destino AS destino_id,
                    ld.nombre              AS destino_localidad,
                    pd.id_provincia        AS destino_provincia_id,
                    pd.nombre              AS destino_provincia,
                    CASE WHEN ld.nombre = pd.nombre THEN ld.nombre
                         ELSE ld.nombre || ', ' || pd.nombre END AS destino`;

/** Los JOIN que hacen falta para que `COLUMNAS_UBICACION` resuelva. */
const JOIN_UBICACION = `
             JOIN LOCALIDAD lo ON lo.id_localidad = c.id_localidad_origen
             JOIN PROVINCIA po ON po.id_provincia = lo.id_provincia
             JOIN LOCALIDAD ld ON ld.id_localidad = c.id_localidad_destino
             JOIN PROVINCIA pd ON pd.id_provincia = ld.id_provincia`;

module.exports = { COLUMNAS_UBICACION, JOIN_UBICACION };
