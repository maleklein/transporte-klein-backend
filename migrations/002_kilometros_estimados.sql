-- 002 — Kilómetros estimados entre origen y destino (HU 9).
--
-- Para una base que YA existe. Si estás armando la base de cero no corras esto:
-- `script_tablas.sql` ya trae estas columnas.
--
--   psql -d transporte_klein_db -f migrations/002_kilometros_estimados.sql
--
-- No borra nada: las cargas que ya existen quedan con el cálculo pendiente y se
-- pueden recalcular desde su detalle (POST /cargas/:id/recalcular-km).

BEGIN;

ALTER TABLE CARGA
    -- La columna ya existía sin uso y sin escala. Dos decimales alcanzan para
    -- una estimación y evitan guardar los 15 dígitos que devuelve la división.
    ALTER COLUMN kilometros_estimados TYPE NUMERIC(10, 2),
    -- Resultado del último intento de cálculo:
    --   ok        → kilometros_estimados tiene el valor.
    --   pendiente → el proveedor de mapas no respondió; se puede reintentar.
    --   error     → reservado para cuando el proveedor indique que no hay ruta
    --               posible (hoy el servicio de mapas no distingue ese caso).
    -- Nace 'pendiente' para que las cargas viejas, que no tienen kilómetros,
    -- queden marcadas como tales y no como un 'ok' sin valor.
    ADD COLUMN estado_calculo_km VARCHAR(10) NOT NULL DEFAULT 'pendiente'
        CHECK (estado_calculo_km IN ('ok', 'pendiente', 'error')),
    -- Resto del esquema viejo que ninguna HU usa. Ya no está en
    -- `script_tablas.sql`, pero sigue en las bases armadas antes del 2/9.
    DROP COLUMN IF EXISTS descripcion;

COMMIT;
