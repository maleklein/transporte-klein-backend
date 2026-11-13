-- 009 — Dirección de origen y destino de una carga (calle y número).
--
-- Para una base que YA existe. Si estás armando la base de cero no corras esto:
-- `script_tablas.sql` ya trae las dos columnas.
--
--   psql -d transporte_klein_db -f migrations/009_direccion_carga.sql
--
-- Son opcionales: a veces el origen o el destino es un campo o un
-- establecimiento rural, sin calle ni número, y alcanza con la localidad. Las
-- cargas que ya existen quedan con las dos en NULL.

BEGIN;

ALTER TABLE CARGA
    ADD COLUMN direccion_origen VARCHAR(150),
    ADD COLUMN direccion_destino VARCHAR(150);

COMMIT;
