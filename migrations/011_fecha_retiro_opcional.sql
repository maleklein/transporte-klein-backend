-- 011 — La fecha de retiro de una carga pasa a ser opcional.
--
-- Para una base que YA existe. Si estás armando la base de cero no corras esto:
-- `script_tablas.sql` ya trae la columna sin NOT NULL.
--
--   psql -d transporte_klein_db -f migrations/011_fecha_retiro_opcional.sql
--
-- A veces el día del retiro se acuerda después de cargar el viaje. Sin fecha
-- (NULL), la carga muestra "a coordinar" y no vence. Las cargas que ya existen
-- conservan su fecha. Se puede correr antes de desplegar el código nuevo: el
-- código anterior siempre manda una fecha, así que no le afecta.

BEGIN;

ALTER TABLE CARGA ALTER COLUMN fecha DROP NOT NULL;

COMMIT;
