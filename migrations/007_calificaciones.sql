-- HU 11. Ejecutar una vez sobre una base existente; no elimina datos.
BEGIN;
CREATE TABLE CALIFICACION (
    id_calificacion SERIAL PRIMARY KEY,
    id_emisor INTEGER NOT NULL REFERENCES USUARIO(id_usuario),
    id_receptor INTEGER NOT NULL REFERENCES USUARIO(id_usuario),
    id_carga INTEGER NOT NULL REFERENCES CARGA(id_carga),
    puntaje SMALLINT NOT NULL CHECK (puntaje BETWEEN 1 AND 5),
    comentario VARCHAR(1000),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT calificacion_por_emisor_viaje UNIQUE (id_carga, id_emisor),
    CONSTRAINT calificacion_contraparte CHECK (id_emisor <> id_receptor)
);
CREATE INDEX idx_calificacion_receptor_fecha
    ON CALIFICACION (id_receptor, creado_en DESC, id_calificacion DESC);
COMMIT;
