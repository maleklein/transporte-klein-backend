-- 004 — Índices de la bitácora para métricas (HU 13).
--
-- Para una base que YA existe. Si estás armando la base de cero no corras esto:
-- `script_tablas.sql` ya trae los dos índices.
--
--   psql -d transporte_klein_db -f migrations/004_indices_metricas.sql
--
-- Sólo agrega índices: no toca ni borra ningún dato.
--
-- `idx_estado_carga_carga_tiempo` ya estaba declarado en `script_tablas.sql`
-- desde la HU 8 (bitácora por carga), pero ninguna migración lo había puesto
-- al día en las bases que ya existían: si armaste la tuya antes de esa línea,
-- no lo tenés. `idx_estado_carga_tiempo` es nuevo: las consultas de HU 13
-- recorren la bitácora completa filtrando sólo por `marca_tiempo`, sin pasar
-- por una carga puntual, y sin este índice sería un recorrido secuencial de
-- toda la tabla.
--
-- IF NOT EXISTS porque no hay forma de saber desde la migración si tu base
-- ya tiene el primero o no.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_estado_carga_carga_tiempo ON ESTADO_CARGA (id_carga, marca_tiempo);
CREATE INDEX IF NOT EXISTS idx_estado_carga_tiempo ON ESTADO_CARGA (marca_tiempo);

COMMIT;
