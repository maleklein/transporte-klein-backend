-- 001 — Catálogo geográfico: PROVINCIA y LOCALIDAD.
--
-- Para una base que YA existe. Si estás armando la base de cero no corras esto:
-- `script_tablas.sql` ya la crea con el esquema nuevo.
--
--   psql -d transporte_klein_db -f migrations/001_catalogo_geografico.sql
--   node scripts/sembrar-localidades.js
--
-- Sirve para no perder los usuarios: si en vez de esto recrearas la base,
-- tendrías que volver a correr `crear-admin.js` y a loguearte en todos lados.
--
-- Las cargas que había SÍ se borran. Eran datos de prueba con el origen y el
-- destino escritos a mano ("Parana", "Bariloche"), y convertirlas al catálogo
-- pedía decidir a mano cosas como si "Buenos Aires" era la ciudad o la
-- provincia. No vale la pena: se vuelven a cargar desde la pantalla de alta,
-- que además es la forma de probar que el circuito nuevo anda.

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

-- ESTADO_CARGA referencia a CARGA con ON DELETE CASCADE, así que la bitácora
-- de estas cargas se va junto con ellas.
DELETE FROM CARGA;

ALTER TABLE CARGA
    DROP COLUMN origen,
    DROP COLUMN destino,
    ADD COLUMN id_localidad_origen  CHAR(8) NOT NULL REFERENCES LOCALIDAD(id_localidad),
    ADD COLUMN id_localidad_destino CHAR(8) NOT NULL REFERENCES LOCALIDAD(id_localidad);

-- El trigram existía sólo para el ILIKE '%texto%' sobre destino, que ya no se
-- usa: ahora el filtro compara ids. La extensión pg_trgm queda instalada, no
-- cuesta nada y puede servir para buscar localidades por texto más adelante.
DROP INDEX IF EXISTS idx_carga_destino_trgm;
CREATE INDEX idx_carga_destino_localidad ON CARGA (id_localidad_destino);

COMMIT;
