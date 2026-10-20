-- 003 — Postulaciones (HU 4): tabla POSTULACION.
--
-- Para una base que YA existe. Si estás armando la base de cero no corras esto:
-- `script_tablas.sql` ya la crea.
--
--   psql -d transporte_klein_db -f migrations/003_postulaciones.sql
--
-- Sólo agrega una tabla: no toca ni borra nada de lo que ya tenés.
--
-- Si en tu base ya habías creado POSTULACION a mano para probar la rama de
-- Tomás, borrala antes (DROP TABLE POSTULACION;): esta es la definitiva.

BEGIN;

CREATE TABLE POSTULACION (
    id_postulacion SERIAL PRIMARY KEY,
    id_carga INTEGER NOT NULL REFERENCES CARGA(id_carga) ON DELETE CASCADE,
    id_camionero INTEGER NOT NULL REFERENCES CAMIONERO(id_usuario) ON DELETE CASCADE,
    -- 'pendiente' hasta que se asigna la carga; ahí pasa a 'aceptada' la del
    -- camionero elegido y a 'rechazada' la de los demás.
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    fecha_postulacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id_carga, id_camionero)
);

CREATE INDEX idx_postulacion_camionero_fecha ON POSTULACION (id_camionero, fecha_postulacion);

COMMIT;
