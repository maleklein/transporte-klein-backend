-- 002 — Notificaciones (HU 12): tabla NOTIFICACION.
--
-- Para una base que YA existe. Si estás armando la base de cero no corras esto:
-- `script_tablas.sql` ya la crea.
--
--   psql -d transporte_klein_db -f migrations/002_notificaciones.sql
--
-- Sólo agrega una tabla: no toca ni borra nada de lo que ya tenés.

BEGIN;

CREATE TABLE NOTIFICACION (
    id_notificacion SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL REFERENCES USUARIO(id_usuario) ON DELETE CASCADE,
    tipo_evento VARCHAR(40) NOT NULL,
    -- Texto ya armado: cuenta lo que pasó en ese momento.
    contenido TEXT NOT NULL,
    -- Para ir al detalle de la carga desde el aviso.
    id_carga INTEGER REFERENCES CARGA(id_carga) ON DELETE CASCADE,
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notificacion_usuario_leida_fecha ON NOTIFICACION (id_usuario, leida, creado_en);

COMMIT;
