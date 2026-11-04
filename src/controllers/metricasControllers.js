/**
 * Controlador del panel de métricas (HU 13).
 *
 * Un solo endpoint, `GET /metricas`, que agrega toda la bitácora `ESTADO_CARGA`
 * (y `CARGA` para "cargas por estado") dentro de un período. Las definiciones
 * de cada indicador están documentadas en el README, sección "Métricas (HU 13)":
 * este archivo las repite junto a cada consulta para que el código y el
 * README no diverjan, pero si hay alguna diferencia el README es la fuente
 * de verdad.
 *
 * Todo se calcula con SQL agregado y parametrizado — nada de traer las cargas
 * o la bitácora a JavaScript para recorrerlas, porque la bitácora crece sin
 * límite y este endpoint se usa para un panel que puede pedirse seguido.
 */

const pool = require('../db');
const { esFechaValida } = require('../validators/carga');

/** Los seis estados del ciclo de vida, en el orden que espera el panel. */
const ESTADOS_RESPUESTA = ['disponible', 'pendiente', 'aceptada', 'en_viaje', 'entregada', 'cancelada'];

/** Cuántos días hacia atrás mirar cuando no llega ningún filtro de fecha. */
const DIAS_PERIODO_POR_DEFECTO = 30;

/**
 * Suma (o resta, con un número negativo) días a una fecha AAAA-MM-DD.
 *
 * Se calcula en UTC a propósito: la fecha es un valor de calendario, no un
 * instante, y nada de esto toca las columnas `timestamp without time zone`
 * de la base (esas se comparan tal cual llegan, sin conversión de zona).
 * Usar UTC acá sólo evita que un corrimiento de horario local mueva el día.
 *
 * @param {string} fechaIso - fecha en formato AAAA-MM-DD.
 * @param {number} dias - días a sumar; negativo para restar.
 * @returns {string} la fecha resultante, también en AAAA-MM-DD.
 */
const sumarDias = (fechaIso, dias) => {
    const [anio, mes, dia] = fechaIso.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    fecha.setUTCDate(fecha.getUTCDate() + dias);
    return fecha.toISOString().slice(0, 10);
};

/** Fecha de hoy en formato AAAA-MM-DD (UTC, por el mismo motivo que `sumarDias`). */
const hoyIso = () => new Date().toISOString().slice(0, 10);

/**
 * Redondea a dos decimales sin arrastrar el error de punto flotante típico
 * de `Math.round(x * 100) / 100` sobre números ya "redondos" (p. ej. 11.6).
 *
 * @param {number|null} numero
 * @returns {number|null} el número redondeado, o null si el valor de entrada era null.
 */
const redondear = (numero) => {
    if (numero === null || numero === undefined) return null;
    return Math.round((Number(numero) + Number.EPSILON) * 100) / 100;
};

/**
 * Resuelve y valida `fecha_desde`/`fecha_hasta` a partir del query string.
 *
 * Si faltan los dos, usa los últimos `DIAS_PERIODO_POR_DEFECTO` días (hasta
 * hoy, inclusive). Si falta sólo uno, se completa en relación al otro con el
 * mismo criterio. El formato de los que sí llegan se valida con el
 * `esFechaValida` compartido con el resto de la API (mismo validador que usa
 * el alta y la edición de una carga).
 *
 * @param {Record<string, unknown>} query - `req.query` de Express.
 * @returns {{ error: string } | { fechaDesde: string, fechaHasta: string }}
 */
const resolverPeriodo = (query) => {
    const desdeQuery = typeof query.fecha_desde === 'string' ? query.fecha_desde.trim() : '';
    const hastaQuery = typeof query.fecha_hasta === 'string' ? query.fecha_hasta.trim() : '';

    if (desdeQuery !== '' && !esFechaValida(desdeQuery)) {
        return { error: "El parámetro 'fecha_desde' debe tener formato AAAA-MM-DD" };
    }
    if (hastaQuery !== '' && !esFechaValida(hastaQuery)) {
        return { error: "El parámetro 'fecha_hasta' debe tener formato AAAA-MM-DD" };
    }

    let fechaDesde = desdeQuery;
    let fechaHasta = hastaQuery;

    if (fechaDesde === '' && fechaHasta === '') {
        fechaHasta = hoyIso();
        fechaDesde = sumarDias(fechaHasta, -DIAS_PERIODO_POR_DEFECTO);
    } else if (fechaHasta === '') {
        fechaHasta = hoyIso();
    } else if (fechaDesde === '') {
        fechaDesde = sumarDias(fechaHasta, -DIAS_PERIODO_POR_DEFECTO);
    }

    if (fechaDesde > fechaHasta) {
        return { error: "'fecha_desde' no puede ser posterior a 'fecha_hasta'" };
    }

    return { fechaDesde, fechaHasta };
};

/**
 * GET /metricas (HU 13): indicadores agregados del panel de métricas, sólo
 * para administradores.
 *
 * Query params opcionales: `fecha_desde` y `fecha_hasta` (AAAA-MM-DD). Si
 * faltan los dos, el período son los últimos 30 días. `fecha_hasta` es
 * inclusiva: cubre el día entero, por eso todas las consultas comparan contra
 * el día siguiente con `<` en vez de usar `<=` contra la fecha misma (que
 * dejaría afuera cualquier hora después de las 00:00). Ningún campo de fecha
 * se convierte de zona horaria: `ESTADO_CARGA.marca_tiempo` y `CARGA.creado_en`
 * son `timestamp without time zone`, así que se comparan tal cual están
 * guardadas.
 *
 * Cada indicador replica la definición de la sección "Métricas (HU 13)" del
 * README:
 *
 * - `cargas_por_estado` / `total_cargas`: cargas cuyo `creado_en` cae en el
 *   período, agrupadas por `estado_actual` DE HOY (no por el estado que
 *   tenían durante el período). Los seis estados siempre están presentes,
 *   en 0 si no hubo ninguna.
 * - `tiempo_promedio_asignacion_horas`: promedio, en horas, del tramo desde
 *   la primera vez que cada carga pasó a `pendiente` hasta la primera vez
 *   *posterior* que pasó a `aceptada` (una corrección — volver a `pendiente`
 *   o a `aceptada` después — no genera un segundo tramo). Sólo entran los
 *   tramos cuyo evento final (`aceptada`) cae en el período. `null` si ningún
 *   tramo entra.
 * - `tiempo_promedio_entrega_horas`: promedio, en horas, del tramo desde la
 *   primera vez que cada carga pasó a `aceptada` hasta que pasó a `entregada`
 *   (una sola vez por carga, porque `entregada` es un estado terminal). Sólo
 *   entran los tramos cuyo evento final (`entregada`) cae en el período.
 *   `null` si ninguno entra.
 * - `tasa_cumplimiento`: `entregadas / (entregadas + canceladas)`, contando
 *   las transiciones a esos estados que caen en el período. `null` —no
 *   `0`— si no hubo ninguna de las dos: significa "sin datos", no "0% de
 *   cumplimiento".
 * - `camioneros_con_viaje`: cantidad de camioneros distintos entre las cargas
 *   con `id_camionero_asignado`, cuya primera transición a `aceptada` cae en
 *   el período. Hoy casi siempre da 0 porque ningún endpoint llena esa
 *   columna todavía (depende de la asignación de HU 6).
 * - `entregadas_por_semana`: una fila por cada semana (lunes a lunes) del
 *   período, incluidas las que tuvieron 0 entregas, con la cantidad de
 *   transiciones a `entregada` que cayeron en esa semana y en el período.
 * - `hay_datos`: `false` únicamente cuando no hubo ninguna carga creada en el
 *   período NI ninguna transición registrada en el período. En ese caso los
 *   promedios y la tasa son `null`, los conteos son 0, pero la respuesta
 *   sigue siendo 200 con esta misma forma (nunca un error ni un cuerpo vacío).
 *
 * Respuestas: 200 con el resumen · 400 si el formato de fecha es inválido o
 * `fecha_desde` es posterior a `fecha_hasta` · 401/403
 * los resuelve el middleware (`verifyToken`/`requireRol`) · 500 ante un error
 * inesperado.
 *
 * @param {import('express').Request} req - request de Express. Query params opcionales: fecha_desde, fecha_hasta.
 * @param {import('express').Response} res - response de Express.
 * @returns {Promise<void>}
 */
const obtenerMetricas = async (req, res) => {
    const periodo = resolverPeriodo(req.query);
    if (periodo.error) {
        return res.status(400).json({ message: periodo.error });
    }

    const { fechaDesde, fechaHasta } = periodo;
    // Límite superior exclusivo: el día siguiente a `fecha_hasta`, para que
    // "hasta inclusive" cubra cualquier hora de ese día sin tener que armar
    // un `<=` contra la hora 23:59:59.999 a mano.
    const fechaHastaExclusiva = sumarDias(fechaHasta, 1);

    try {
        const [
            porEstadoResultado,
            asignacionResultado,
            entregaResultado,
            cumplimientoResultado,
            camionerosResultado,
            porSemanaResultado,
            hayTransicionResultado,
        ] = await Promise.all([
            // Cargas por estado y total: filtra por fecha de alta, agrupa por el
            // estado actual (no el histórico).
            pool.query(
                `SELECT estado_actual, COUNT(*)::int AS cantidad
                 FROM CARGA
                 WHERE creado_en >= $1::date AND creado_en < $2::date
                 GROUP BY estado_actual`,
                [fechaDesde, fechaHastaExclusiva]
            ),

            // Tiempo de asignación: primera 'pendiente' de cada carga, primera
            // 'aceptada' posterior a esa. Sólo cuentan los tramos cuya 'aceptada'
            // cae en el período.
            pool.query(
                `WITH primera_pendiente AS (
                     SELECT id_carga, MIN(marca_tiempo) AS t_pendiente
                     FROM ESTADO_CARGA
                     WHERE estado_nuevo = 'pendiente'
                     GROUP BY id_carga
                 ),
                 primera_aceptada_tras_pendiente AS (
                     SELECT pp.id_carga, MIN(ec.marca_tiempo) AS t_aceptada
                     FROM primera_pendiente pp
                     JOIN ESTADO_CARGA ec
                       ON ec.id_carga = pp.id_carga
                      AND ec.estado_nuevo = 'aceptada'
                      AND ec.marca_tiempo > pp.t_pendiente
                     GROUP BY pp.id_carga
                 )
                 SELECT AVG(EXTRACT(EPOCH FROM (pa.t_aceptada - pp.t_pendiente)) / 3600.0) AS horas
                 FROM primera_pendiente pp
                 JOIN primera_aceptada_tras_pendiente pa ON pa.id_carga = pp.id_carga
                 WHERE pa.t_aceptada >= $1::date AND pa.t_aceptada < $2::date`,
                [fechaDesde, fechaHastaExclusiva]
            ),

            // Tiempo de entrega: primera 'aceptada' de cada carga hasta su
            // 'entregada' (una sola, porque es un estado terminal). Sólo cuentan
            // los tramos cuya 'entregada' cae en el período.
            pool.query(
                `WITH primera_aceptada AS (
                     SELECT id_carga, MIN(marca_tiempo) AS t_aceptada
                     FROM ESTADO_CARGA
                     WHERE estado_nuevo = 'aceptada'
                     GROUP BY id_carga
                 ),
                 entrega AS (
                     SELECT id_carga, MIN(marca_tiempo) AS t_entregada
                     FROM ESTADO_CARGA
                     WHERE estado_nuevo = 'entregada'
                     GROUP BY id_carga
                 )
                 SELECT AVG(EXTRACT(EPOCH FROM (e.t_entregada - pa.t_aceptada)) / 3600.0) AS horas
                 FROM primera_aceptada pa
                 JOIN entrega e ON e.id_carga = pa.id_carga
                 WHERE e.t_entregada >= $1::date AND e.t_entregada < $2::date`,
                [fechaDesde, fechaHastaExclusiva]
            ),

            // Entregadas y canceladas del período, para la tasa de cumplimiento.
            // Los dos estados son terminales, así que cada carga aporta a lo
            // sumo una fila: no hace falta de-duplicar por carga.
            pool.query(
                `SELECT estado_nuevo, COUNT(*)::int AS cantidad
                 FROM ESTADO_CARGA
                 WHERE estado_nuevo IN ('entregada', 'cancelada')
                   AND marca_tiempo >= $1::date AND marca_tiempo < $2::date
                 GROUP BY estado_nuevo`,
                [fechaDesde, fechaHastaExclusiva]
            ),

            // Camioneros con al menos un viaje: cargas con camionero asignado
            // cuya primera 'aceptada' cae en el período.
            pool.query(
                `WITH primera_aceptada AS (
                     SELECT id_carga, MIN(marca_tiempo) AS t_aceptada
                     FROM ESTADO_CARGA
                     WHERE estado_nuevo = 'aceptada'
                     GROUP BY id_carga
                 )
                 SELECT COUNT(DISTINCT c.id_camionero_asignado)::int AS cantidad
                 FROM CARGA c
                 JOIN primera_aceptada pa ON pa.id_carga = c.id_carga
                 WHERE c.id_camionero_asignado IS NOT NULL
                   AND pa.t_aceptada >= $1::date AND pa.t_aceptada < $2::date`,
                [fechaDesde, fechaHastaExclusiva]
            ),

            // Entregas por semana (lunes a lunes), con las semanas vacías
            // incluidas vía generate_series: el gráfico necesita el eje
            // completo, no sólo las semanas con datos.
            pool.query(
                `WITH semanas AS (
                     SELECT generate_series(
                         date_trunc('week', $1::date),
                         date_trunc('week', $2::date - interval '1 day'),
                         interval '1 week'
                     ) AS semana_inicio
                 ),
                 entregas AS (
                     SELECT date_trunc('week', marca_tiempo) AS semana_inicio, COUNT(*)::int AS cantidad
                     FROM ESTADO_CARGA
                     WHERE estado_nuevo = 'entregada'
                       AND marca_tiempo >= $1::date AND marca_tiempo < $2::date
                     GROUP BY date_trunc('week', marca_tiempo)
                 )
                 SELECT TO_CHAR(s.semana_inicio, 'YYYY-MM-DD') AS semana_inicio,
                        COALESCE(e.cantidad, 0) AS cantidad
                 FROM semanas s
                 LEFT JOIN entregas e ON e.semana_inicio = s.semana_inicio
                 ORDER BY s.semana_inicio`,
                [fechaDesde, fechaHastaExclusiva]
            ),

            // Existe al menos una transición en el período, para `hay_datos`.
            pool.query(
                `SELECT EXISTS (
                     SELECT 1 FROM ESTADO_CARGA
                     WHERE marca_tiempo >= $1::date AND marca_tiempo < $2::date
                 ) AS existe`,
                [fechaDesde, fechaHastaExclusiva]
            ),
        ]);

        const cargasPorEstado = Object.fromEntries(ESTADOS_RESPUESTA.map((estado) => [estado, 0]));
        let totalCargas = 0;
        for (const fila of porEstadoResultado.rows) {
            cargasPorEstado[fila.estado_actual] = fila.cantidad;
            totalCargas += fila.cantidad;
        }

        let entregadas = 0;
        let canceladas = 0;
        for (const fila of cumplimientoResultado.rows) {
            if (fila.estado_nuevo === 'entregada') entregadas = fila.cantidad;
            if (fila.estado_nuevo === 'cancelada') canceladas = fila.cantidad;
        }
        const totalParaTasa = entregadas + canceladas;
        const tasaCumplimiento = totalParaTasa > 0 ? redondear(entregadas / totalParaTasa) : null;

        const hayDatos = totalCargas > 0 || hayTransicionResultado.rows[0].existe;

        return res.status(200).json({
            periodo: { fecha_desde: fechaDesde, fecha_hasta: fechaHasta },
            cargas_por_estado: cargasPorEstado,
            total_cargas: totalCargas,
            tiempo_promedio_asignacion_horas: redondear(asignacionResultado.rows[0].horas),
            tiempo_promedio_entrega_horas: redondear(entregaResultado.rows[0].horas),
            tasa_cumplimiento: tasaCumplimiento,
            entregadas,
            canceladas,
            camioneros_con_viaje: camionerosResultado.rows[0].cantidad,
            entregadas_por_semana: porSemanaResultado.rows.map((fila) => ({
                semana_inicio: fila.semana_inicio,
                cantidad: fila.cantidad,
            })),
            hay_datos: hayDatos,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

module.exports = {
    obtenerMetricas,
};
