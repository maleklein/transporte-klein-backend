-- 001 — Catálogo geográfico: PROVINCIA y LOCALIDAD.
--
-- Para una base que YA existe y tiene datos. Si estás armando la base de cero,
-- no corras esto: `script_tablas.sql` ya la crea con el esquema nuevo.
--
-- Secuencia completa sobre una base existente:
--   psql -d transporte_klein_db -f migrations/001_catalogo_geografico.sql
--   node scripts/sembrar-localidades.js
--   psql -d transporte_klein_db -f migrations/002_migrar_cargas.sql
--
-- El orden importa: 002 necesita el catálogo ya sembrado para resolver los
-- nombres, y 001 tiene que correr antes de la siembra para que existan las
-- tablas donde sembrar.

BEGIN;

CREATE TABLE PROVINCIA (
    -- Texto y no entero: CABA es '02' y un INTEGER se come el cero.
    id_provincia CHAR(2) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE LOCALIDAD (
    id_localidad CHAR(8) PRIMARY KEY,
    id_provincia CHAR(2) NOT NULL REFERENCES PROVINCIA(id_provincia),
    nombre VARCHAR(100) NOT NULL,
    -- Desambigua los 68 pares (provincia, nombre) repetidos en todo el país.
    departamento VARCHAR(100),
    -- Centroide: todavía sin usar, habilita el cálculo de kilómetros (HU 9).
    latitud NUMERIC(9, 6) NOT NULL,
    longitud NUMERIC(9, 6) NOT NULL
);

CREATE INDEX idx_localidad_provincia_nombre ON LOCALIDAD (id_provincia, nombre);

-- Nacen nullable a propósito: las cargas que ya existen todavía no tienen
-- localidad asignada. 002 las completa y recién ahí pasan a NOT NULL.
ALTER TABLE CARGA
    ADD COLUMN id_localidad_origen  CHAR(8) REFERENCES LOCALIDAD(id_localidad),
    ADD COLUMN id_localidad_destino CHAR(8) REFERENCES LOCALIDAD(id_localidad);

COMMIT;
