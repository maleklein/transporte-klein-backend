-- Datos de prueba para el panel de métricas (HU 13).
--
-- SOLO PARA PRUEBAS LOCALES. No es parte del esquema ni de ninguna migración:
-- no lo corras en una base compartida ni en producción.
--
--   psql -d transporte_klein_db -f seeds/metricas_datos_prueba.sql
--
-- Qué hace: da de alta 8 cargas ficticias (todas con observaciones que
-- empiezan con 'PRUEBA HU13', para poder encontrarlas y borrarlas después) y
-- su historial completo en ESTADO_CARGA, insertado directo con marca_tiempo
-- explícita — no pasa por la API ni dispara notificaciones.
--
-- Para qué sirve cada carga:
--   - Las seis cubren los seis estados: disponible, pendiente, aceptada,
--     en_viaje, entregada y cancelada.
--   - Tres quedan 'entregada', con tiempos de asignación (2 h, 1 día, 6 h) y
--     de entrega (3 días, 5 días, 2 días) distintos entre sí, para que un
--     promedio no sea "siempre el mismo número".
--   - La carga 3 vuelve de 'aceptada' a 'pendiente' y de ahí otra vez a
--     'aceptada': prueba que el tiempo de asignación se calcule contra la
--     PRIMERA vez que llegó a 'aceptada', ignorando la repetición.
--   - Cinco quedan con id_camionero_asignado (un camionero real cada una),
--     para poder probar "camioneros con al menos un viaje" sin depender de
--     que la asignación de HU 6 ya escriba esa columna.
--   - Las fechas van de 2026-08-03 a 2026-09-28 (8 semanas), pero entre el
--     2026-08-17 y el 2026-09-13 (4 semanas, inclusive) no hay un solo
--     evento a propósito: sirve para probar el período "sin datos".
--
-- Usa un administrador y un camionero que ya tienen que existir en tu base
-- (ver las variables al principio del bloque). Si tu base no tiene ninguno
-- de los usuarios o localidades de abajo, el INSERT falla por la FK — cambiá
-- los ids por unos que sí existan.
--
-- Para borrar SOLO estos datos (no afecta nada más):
--
--   DELETE FROM CARGA WHERE observaciones LIKE 'PRUEBA HU13%';
--
-- Alcanza con ese DELETE: ESTADO_CARGA referencia a CARGA con
-- ON DELETE CASCADE, así que el historial se va solo.

BEGIN;

DO $$
DECLARE
    -- Admin activo y camioneros ya existentes en la base de desarrollo.
    v_admin      INTEGER := 8;   -- Marisa Benitez (administrador, activo)
    v_cam_luis   INTEGER := 5;   -- Luis Ferreyra
    v_cam_gianna INTEGER := 6;   -- Gianna Cavallo
    v_cam_ramon  INTEGER := 9;   -- Ramon Ortiz
    v_cam_lucia  INTEGER := 10;  -- Lucia Ferreyra
    v_cam_karen  INTEGER := 18;  -- Karen Habringer

    -- Localidades ya sembradas (catálogo georef).
    v_loc_chuchucaruana CHAR(8) := '10007010';
    v_loc_colpes        CHAR(8) := '10007020';
    v_loc_caba          CHAR(8) := '02000010';
    v_loc_12octubre     CHAR(8) := '06588030';
    v_loc_16julio       CHAR(8) := '06049050';
    v_loc_17agosto      CHAR(8) := '06651100';
    v_loc_25mayo        CHAR(8) := '06854100';
    v_loc_30agosto      CHAR(8) := '06826040';

    -- ids que van a tomar las 8 cargas, para encadenar su historial.
    v_c1 INTEGER; -- disponible
    v_c2 INTEGER; -- pendiente
    v_c3 INTEGER; -- aceptada, con una corrección (bounce)
    v_c4 INTEGER; -- en_viaje
    v_c5 INTEGER; -- entregada #1 — asignación 2h, entrega 3 días
    v_c6 INTEGER; -- entregada #2 — asignación 1 día, entrega 5 días
    v_c7 INTEGER; -- entregada #3 — asignación 6h, entrega 2 días
    v_c8 INTEGER; -- cancelada
BEGIN

    -- ===== C1: disponible (recién creada, sin más movimiento) =====
    INSERT INTO CARGA (id_localidad_origen, id_localidad_destino, tipo_carga, peso_kg, fecha,
                        observaciones, estado_actual, id_admin_creador, id_camionero_asignado,
                        creado_en, actualizado_en)
    VALUES (v_loc_chuchucaruana, v_loc_caba, 'Carga general', 800, '2026-08-03',
            'PRUEBA HU13 - disponible', 'disponible', v_admin, NULL,
            '2026-08-03 09:00', '2026-08-03 09:00')
    RETURNING id_carga INTO v_c1;

    INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor, marca_tiempo) VALUES
        (v_c1, NULL,        'disponible', v_admin, '2026-08-03 09:00');

    -- ===== C2: pendiente =====
    INSERT INTO CARGA (id_localidad_origen, id_localidad_destino, tipo_carga, peso_kg, fecha,
                        observaciones, estado_actual, id_admin_creador, id_camionero_asignado,
                        creado_en, actualizado_en)
    VALUES (v_loc_12octubre, v_loc_caba, 'Carga general', 1200, '2026-08-04',
            'PRUEBA HU13 - pendiente', 'pendiente', v_admin, NULL,
            '2026-08-04 10:00', '2026-08-04 15:00')
    RETURNING id_carga INTO v_c2;

    INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor, marca_tiempo) VALUES
        (v_c2, NULL,         'disponible', v_admin, '2026-08-04 10:00'),
        (v_c2, 'disponible', 'pendiente',  v_admin, '2026-08-04 15:00');

    -- ===== C3: aceptada, con una corrección aceptada -> pendiente -> aceptada =====
    -- El tiempo de asignación real es pendiente(08-05 12:00) -> aceptada(08-05 18:00) = 6 h;
    -- la segunda vez que llega a 'aceptada' (08-06 14:00) tiene que ignorarse.
    INSERT INTO CARGA (id_localidad_origen, id_localidad_destino, tipo_carga, peso_kg, fecha,
                        observaciones, estado_actual, id_admin_creador, id_camionero_asignado,
                        creado_en, actualizado_en)
    VALUES (v_loc_16julio, v_loc_colpes, 'Carga general', 950, '2026-08-05',
            'PRUEBA HU13 - aceptada con correccion', 'aceptada', v_admin, v_cam_luis,
            '2026-08-05 08:00', '2026-08-06 14:00')
    RETURNING id_carga INTO v_c3;

    INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor, marca_tiempo) VALUES
        (v_c3, NULL,        'disponible', v_admin, '2026-08-05 08:00'),
        (v_c3, 'disponible', 'pendiente', v_admin, '2026-08-05 12:00'),
        (v_c3, 'pendiente',  'aceptada',  v_admin, '2026-08-05 18:00'),
        (v_c3, 'aceptada',   'pendiente', v_admin, '2026-08-06 09:00'),
        (v_c3, 'pendiente',  'aceptada',  v_admin, '2026-08-06 14:00');

    -- ===== C4: en_viaje =====
    -- Asignación: pendiente(08-11 13:00) -> aceptada(08-12 09:00) = 20 h.
    INSERT INTO CARGA (id_localidad_origen, id_localidad_destino, tipo_carga, peso_kg, fecha,
                        observaciones, estado_actual, id_admin_creador, id_camionero_asignado,
                        creado_en, actualizado_en)
    VALUES (v_loc_17agosto, v_loc_caba, 'Carga general', 1500, '2026-08-11',
            'PRUEBA HU13 - en viaje', 'en_viaje', v_admin, v_cam_gianna,
            '2026-08-11 09:00', '2026-08-13 07:00')
    RETURNING id_carga INTO v_c4;

    INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor, marca_tiempo) VALUES
        (v_c4, NULL,        'disponible', v_admin, '2026-08-11 09:00'),
        (v_c4, 'disponible', 'pendiente', v_admin, '2026-08-11 13:00'),
        (v_c4, 'pendiente',  'aceptada',  v_admin, '2026-08-12 09:00'),
        (v_c4, 'aceptada',   'en_viaje',  v_admin, '2026-08-13 07:00');

    -- ===== C5: entregada #1 — asignación 2 h, entrega 3 días =====
    -- Asignación: pendiente(08-03 08:00) -> aceptada(08-03 10:00) = 2 h.
    -- Entrega: aceptada(08-03 10:00) -> entregada(08-06 10:00) = 3 días.
    INSERT INTO CARGA (id_localidad_origen, id_localidad_destino, tipo_carga, peso_kg, fecha,
                        observaciones, estado_actual, id_admin_creador, id_camionero_asignado,
                        creado_en, actualizado_en)
    VALUES (v_loc_25mayo, v_loc_chuchucaruana, 'Carga general', 600, '2026-08-03',
            'PRUEBA HU13 - entregada rapida', 'entregada', v_admin, v_cam_ramon,
            '2026-08-03 07:00', '2026-08-06 10:00')
    RETURNING id_carga INTO v_c5;

    INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor, marca_tiempo) VALUES
        (v_c5, NULL,        'disponible', v_admin, '2026-08-03 07:00'),
        (v_c5, 'disponible', 'pendiente', v_admin, '2026-08-03 08:00'),
        (v_c5, 'pendiente',  'aceptada',  v_admin, '2026-08-03 10:00'),
        (v_c5, 'aceptada',   'en_viaje',  v_admin, '2026-08-04 09:00'),
        (v_c5, 'en_viaje',   'entregada', v_admin, '2026-08-06 10:00');

    -- ========================================================
    -- Gap a propósito: nada pasa entre 2026-08-17 y 2026-09-13.
    -- Sirve para probar el período "sin datos" (por ejemplo,
    -- fecha_desde=2026-08-20&fecha_hasta=2026-09-10).
    -- ========================================================

    -- ===== C6: entregada #2 — asignación 1 día, entrega 5 días =====
    -- Asignación: pendiente(09-14 09:00) -> aceptada(09-15 09:00) = 1 día.
    -- Entrega: aceptada(09-15 09:00) -> entregada(09-20 09:00) = 5 días.
    INSERT INTO CARGA (id_localidad_origen, id_localidad_destino, tipo_carga, peso_kg, fecha,
                        observaciones, estado_actual, id_admin_creador, id_camionero_asignado,
                        creado_en, actualizado_en)
    VALUES (v_loc_30agosto, v_loc_caba, 'Carga general', 2000, '2026-09-14',
            'PRUEBA HU13 - entregada lenta', 'entregada', v_admin, v_cam_lucia,
            '2026-09-14 08:00', '2026-09-20 09:00')
    RETURNING id_carga INTO v_c6;

    INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor, marca_tiempo) VALUES
        (v_c6, NULL,        'disponible', v_admin, '2026-09-14 08:00'),
        (v_c6, 'disponible', 'pendiente', v_admin, '2026-09-14 09:00'),
        (v_c6, 'pendiente',  'aceptada',  v_admin, '2026-09-15 09:00'),
        (v_c6, 'aceptada',   'en_viaje',  v_admin, '2026-09-17 08:00'),
        (v_c6, 'en_viaje',   'entregada', v_admin, '2026-09-20 09:00');

    -- ===== C7: entregada #3 — asignación 6 h, entrega 2 días =====
    -- Asignación: pendiente(09-26 10:00) -> aceptada(09-26 16:00) = 6 h.
    -- Entrega: aceptada(09-26 16:00) -> entregada(09-28 16:00) = 2 días.
    -- Esta es la que cierra la ventana de 8 semanas (2026-08-03 a 2026-09-28).
    INSERT INTO CARGA (id_localidad_origen, id_localidad_destino, tipo_carga, peso_kg, fecha,
                        observaciones, estado_actual, id_admin_creador, id_camionero_asignado,
                        creado_en, actualizado_en)
    VALUES (v_loc_colpes, v_loc_12octubre, 'Carga general', 700, '2026-09-26',
            'PRUEBA HU13 - entregada media', 'entregada', v_admin, v_cam_karen,
            '2026-09-26 07:00', '2026-09-28 16:00')
    RETURNING id_carga INTO v_c7;

    INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor, marca_tiempo) VALUES
        (v_c7, NULL,        'disponible', v_admin, '2026-09-26 07:00'),
        (v_c7, 'disponible', 'pendiente', v_admin, '2026-09-26 10:00'),
        (v_c7, 'pendiente',  'aceptada',  v_admin, '2026-09-26 16:00'),
        (v_c7, 'aceptada',   'en_viaje',  v_admin, '2026-09-27 08:00'),
        (v_c7, 'en_viaje',   'entregada', v_admin, '2026-09-28 16:00');

    -- ===== C8: cancelada (sin camionero asignado) =====
    INSERT INTO CARGA (id_localidad_origen, id_localidad_destino, tipo_carga, peso_kg, fecha,
                        observaciones, estado_actual, id_admin_creador, id_camionero_asignado,
                        creado_en, actualizado_en)
    VALUES (v_loc_caba, v_loc_chuchucaruana, 'Carga general', 450, '2026-08-09',
            'PRUEBA HU13 - cancelada', 'cancelada', v_admin, NULL,
            '2026-08-09 09:00', '2026-08-09 17:00')
    RETURNING id_carga INTO v_c8;

    INSERT INTO ESTADO_CARGA (id_carga, estado_anterior, estado_nuevo, id_actor, marca_tiempo) VALUES
        (v_c8, NULL,        'disponible', v_admin, '2026-08-09 09:00'),
        (v_c8, 'disponible', 'pendiente', v_admin, '2026-08-09 11:00'),
        (v_c8, 'pendiente',  'cancelada', v_admin, '2026-08-09 17:00');

END $$;

COMMIT;

-- ============================================================
-- Para borrar SOLO estos datos de prueba (comentado a propósito,
-- descomentá y corré esto cuando quieras limpiarlos):
--
-- DELETE FROM CARGA WHERE observaciones LIKE 'PRUEBA HU13%';
-- ============================================================
