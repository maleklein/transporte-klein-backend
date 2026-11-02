-- 006 — Costo y ganancia estimados del viaje (HU 10).
--
-- Para una base que YA existe. Si estás armando la base de cero no corras esto:
-- `script_tablas.sql` ya trae la tabla y las columnas.
--
--   psql -d transporte_klein_db -f migrations/006_costos_estimados.sql
--
-- Necesita la 005 (kilómetros estimados). No borra nada: crea la tabla de
-- parámetros, les da escala a las dos columnas económicas de CARGA (que ya
-- existían sin uso) y calcula la estimación de las cargas que ya tienen
-- kilómetros, con los parámetros iniciales.

BEGIN;

-- Parámetros de la fórmula de costos. Van en la base y no en el código porque
-- el SRS pide que el administrador los pueda cambiar sin tocar el código.
CREATE TABLE PARAMETRO_OPERATIVO (
    clave VARCHAR(40) PRIMARY KEY,
    valor NUMERIC(12, 4) NOT NULL CHECK (valor > 0),
    descripcion VARCHAR(200),
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Valores de ejemplo, en pesos por kilómetro. Se cambian desde la pantalla de
-- parámetros operativos.
INSERT INTO PARAMETRO_OPERATIVO (clave, valor, descripcion) VALUES
    ('costo_por_km', 1800, 'Costo operativo por kilómetro: combustible, desgaste y chofer'),
    ('peaje_por_km', 150, 'Peajes promedio por kilómetro recorrido'),
    ('tarifa_por_km', 2600, 'Lo que se le cobra al cliente por kilómetro');

ALTER TABLE CARGA
    -- Ya existían sin uso y sin escala. Dos decimales: son montos en pesos.
    ALTER COLUMN costo_estimado TYPE NUMERIC(12, 2),
    ALTER COLUMN ganancia_estimada TYPE NUMERIC(12, 2),
    -- Los parámetros con los que se calcularon, como foto: si después cambian,
    -- la carga conserva la cuenta que se hizo en su momento.
    ADD COLUMN parametros_costo JSONB;

-- Las cargas que ya tenían kilómetros se estiman con los parámetros iniciales,
-- con la misma fórmula que `src/services/costos.js`. Las que tienen el cálculo
-- pendiente quedan en NULL hasta que se recalcule la distancia.
WITH p AS (
    SELECT MAX(valor) FILTER (WHERE clave = 'costo_por_km')  AS costo,
           MAX(valor) FILTER (WHERE clave = 'peaje_por_km')  AS peaje,
           MAX(valor) FILTER (WHERE clave = 'tarifa_por_km') AS tarifa
    FROM PARAMETRO_OPERATIVO
)
UPDATE CARGA c
SET costo_estimado = ROUND(c.kilometros_estimados * (p.costo + p.peaje), 2),
    ganancia_estimada = ROUND(c.kilometros_estimados * p.tarifa, 2)
                      - ROUND(c.kilometros_estimados * (p.costo + p.peaje), 2),
    parametros_costo = jsonb_build_object(
        'costo_por_km', p.costo, 'peaje_por_km', p.peaje, 'tarifa_por_km', p.tarifa)
FROM p
WHERE c.estado_calculo_km = 'ok' AND c.kilometros_estimados IS NOT NULL;

COMMIT;
