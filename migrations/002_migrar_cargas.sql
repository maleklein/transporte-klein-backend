-- 002 — Pasa origen y destino de las cargas existentes al catálogo.
--
-- Requiere que 001 haya corrido y que el catálogo esté sembrado
-- (`node scripts/sembrar-localidades.js`): el mapeo resuelve los nombres
-- contra LOCALIDAD, no contra ids escritos a mano.
--
-- Va entero en una transacción y verifica antes de confirmar: si quedara una
-- sola carga sin mapear, no se commitea nada. Es la única red de seguridad que
-- hay, porque el proyecto todavía no tiene tests.
--
-- Las columnas viejas NO se borran acá: se renombran a `*_legacy` y quedan
-- como respaldo. Se borran en 003, recién cuando backend y frontend estén
-- funcionando con el esquema nuevo.

BEGIN;

ALTER TABLE CARGA RENAME COLUMN origen  TO origen_legacy;
ALTER TABLE CARGA RENAME COLUMN destino TO destino_legacy;

-- Sin esto, el próximo INSERT (que ya no manda estas columnas) fallaría.
ALTER TABLE CARGA ALTER COLUMN origen_legacy  DROP NOT NULL;
ALTER TABLE CARGA ALTER COLUMN destino_legacy DROP NOT NULL;


-- ------------------------------------------------------------------
-- Mapeo de los textos que hay hoy en la base.
--
-- Se escribe a mano y no con búsqueda difusa: son doce filas, y un matcher
-- automático sería más código, más riesgo y dejaría las decisiones ocultas.
--
-- Tres son decisiones de negocio, no técnicas: "Santa Fe", "Córdoba" y
-- "Buenos Aires" pueden ser la ciudad o la provincia. Se mapean a la CIUDAD
-- (y "Buenos Aires" a CABA) porque en un flete el destino es una ciudad, no
-- una provincia entera. Si el equipo decide otra cosa, se cambia acá.
-- ------------------------------------------------------------------
CREATE TEMP TABLE mapeo_ubicacion (
    texto     VARCHAR(150) PRIMARY KEY,
    localidad VARCHAR(100) NOT NULL,
    provincia VARCHAR(100) NOT NULL
) ON COMMIT DROP;

INSERT INTO mapeo_ubicacion (texto, localidad, provincia) VALUES
    -- Escritos con la provincia pegada
    ('Paraná, Entre Ríos',    'Paraná',    'Entre Ríos'),
    ('Concordia, Entre Ríos', 'Concordia', 'Entre Ríos'),
    ('Rosario, Santa Fe',     'Rosario',   'Santa Fe'),
    -- Mismos lugares, escritos sin acento
    ('Parana',  'Paraná',  'Entre Ríos'),
    ('Rosario', 'Rosario', 'Santa Fe'),
    ('Cordoba', 'Córdoba', 'Córdoba'),
    ('Neuquen', 'Neuquén', 'Neuquén'),
    -- Nombres coloquiales: el oficial es otro
    ('Bariloche', 'San Carlos de Bariloche', 'Río Negro'),
    ('Jujuy',     'San Salvador de Jujuy',   'Jujuy'),
    ('Tucuman',   'San Miguel de Tucumán',   'Tucumán'),
    -- Ambiguos ciudad/provincia: se resuelven como ciudad
    ('Santa Fe',     'Santa Fe',                        'Santa Fe'),
    ('Córdoba',      'Córdoba',                         'Córdoba'),
    ('Buenos Aires', 'Ciudad Autónoma de Buenos Aires', 'Ciudad Autónoma de Buenos Aires'),
    -- Directos
    ('Posadas',      'Posadas',      'Misiones'),
    ('Bahía Blanca', 'Bahía Blanca', 'Buenos Aires'),
    ('Mendoza',      'Mendoza',      'Mendoza'),
    ('Salta',        'Salta',        'Salta'),
    ('Formosa',      'Formosa',      'Formosa'),
    ('Neuquén',      'Neuquén',      'Neuquén');


-- Los ids salen del catálogo ya sembrado, no escritos a mano: el nombre
-- oficial puede no ser el que uno espera, y así el error salta acá y no
-- después, con una carga apuntando a la localidad equivocada.
CREATE TEMP TABLE mapeo_resuelto ON COMMIT DROP AS
SELECT m.texto, l.id_localidad
FROM mapeo_ubicacion m
JOIN PROVINCIA p ON p.nombre = m.provincia
JOIN LOCALIDAD l ON l.id_provincia = p.id_provincia AND l.nombre = m.localidad;


-- Verificación 1: cada texto tiene que haber resuelto a exactamente una
-- localidad. Si un nombre no existe, o si matcheó dos veces (hay 68 pares
-- provincia+nombre repetidos en el país), se corta acá.
DO $$
DECLARE
    sin_resolver TEXT;
BEGIN
    SELECT string_agg(m.texto || ' -> ' || m.localidad || ' (' || m.provincia || ')', E'\n  ')
    INTO sin_resolver
    FROM mapeo_ubicacion m
    WHERE (SELECT COUNT(*) FROM mapeo_resuelto r WHERE r.texto = m.texto) <> 1;

    IF sin_resolver IS NOT NULL THEN
        RAISE EXCEPTION E'Estos mapeos no resolvieron a una única localidad:\n  %', sin_resolver;
    END IF;
END $$;


UPDATE CARGA c
SET id_localidad_origen = r.id_localidad
FROM mapeo_resuelto r
WHERE r.texto = c.origen_legacy;

UPDATE CARGA c
SET id_localidad_destino = r.id_localidad
FROM mapeo_resuelto r
WHERE r.texto = c.destino_legacy;


-- Verificación 2: ninguna carga puede quedar sin origen o sin destino. Si el
-- mapeo no cubre algún texto que había en la base, esto lo nombra y aborta.
DO $$
DECLARE
    faltantes TEXT;
BEGIN
    SELECT string_agg(DISTINCT texto, ', ')
    INTO faltantes
    FROM (
        SELECT origen_legacy AS texto FROM CARGA WHERE id_localidad_origen IS NULL
        UNION
        SELECT destino_legacy       FROM CARGA WHERE id_localidad_destino IS NULL
    ) AS sin_mapear;

    IF faltantes IS NOT NULL THEN
        RAISE EXCEPTION 'Faltan mapear estos textos: %', faltantes;
    END IF;
END $$;


ALTER TABLE CARGA
    ALTER COLUMN id_localidad_origen  SET NOT NULL,
    ALTER COLUMN id_localidad_destino SET NOT NULL;

-- El trigram existía sólo para el ILIKE '%texto%' sobre destino, que ya no se
-- usa: ahora el filtro compara ids. La extensión pg_trgm queda instalada, no
-- cuesta nada y puede servir para buscar localidades por texto más adelante.
DROP INDEX IF EXISTS idx_carga_destino_trgm;
CREATE INDEX idx_carga_destino_localidad ON CARGA (id_localidad_destino);

COMMIT;
