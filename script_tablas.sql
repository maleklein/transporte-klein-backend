-- Esquema de la base transporte_klein_db.
--
-- Para armar la base de cero:
--   createdb transporte_klein_db
--   psql -d transporte_klein_db -f script_tablas.sql
--   node scripts/sembrar-localidades.js                (catálogo geográfico)
--   node scripts/crear-admin.js <email> <contraseña>   (primer administrador)
--
-- La siembra va antes de crear cargas: CARGA referencia a LOCALIDAD.


-- ============================================================
-- USUARIO — entidad base de todos los actores del sistema.
-- Centraliza identidad y acceso; los datos propios de cada rol
-- viven en su tabla (ver CAMIONERO).
-- ============================================================
CREATE TABLE USUARIO (
    id_usuario SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    apellido VARCHAR(50) NOT NULL,
    -- UNIQUE en dni y email: la HU 1.1 pide que no se puedan repetir.
    dni VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    -- Guarda el hash de bcrypt, nunca la contraseña en texto plano.
    contraseña_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL,
    -- 'activo' o 'inactivo'. Una cuenta inactiva no puede iniciar sesión.
    estado VARCHAR(20) NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- CAMIONERO — datos operativos propios del rol camionero.
-- Hereda de USUARIO compartiendo la clave primaria: un camionero
-- es un usuario, y su id es el mismo en las dos tablas.
-- ============================================================
CREATE TABLE CAMIONERO (
    -- PK y FK a la vez: es lo que implementa la herencia.
    id_usuario INTEGER PRIMARY KEY REFERENCES USUARIO(id_usuario) ON DELETE CASCADE,
    ubicacion VARCHAR(150),
    disponibilidad BOOLEAN DEFAULT TRUE,
    tipo_vehiculo VARCHAR(100),
    capacidad_kg NUMERIC
);


-- ============================================================
-- PROVINCIA y LOCALIDAD — catálogo geográfico oficial.
-- Se siembran una sola vez desde la API georef del gobierno
-- (https://apis.datos.gob.ar/georef/api) con
-- `node scripts/sembrar-localidades.js`.
--
-- Existen para que el origen y el destino de una carga dejen de ser
-- texto libre: antes convivían en la misma base "Paraná, Entre Ríos",
-- "Parana" y "parana" como tres destinos distintos, y el filtro del
-- listado no encontraba lo que tenía que encontrar.
--
-- De georef se usa la entidad `localidades-censales` y no `localidades`
-- ni `municipios`, por dos motivos medidos:
--   * CABA da un único registro ("Ciudad Autónoma de Buenos Aires"),
--     mientras que `localidades` la parte en 49 barrios. Para un flete,
--     el destino es la ciudad entera.
--   * Dentro de una misma provincia hay muchos menos nombres repetidos
--     (4 en Buenos Aires contra 54 en `localidades`).
-- ============================================================
CREATE TABLE PROVINCIA (
    -- El id es el de georef y se guarda como texto, NO como entero:
    -- CABA es '02' y un INTEGER se comería el cero de la izquierda.
    id_provincia CHAR(2) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE LOCALIDAD (
    -- Mismo criterio que arriba: id de georef, 8 dígitos, como texto.
    -- Usarlo de PK en vez de un SERIAL propio evita una tabla de
    -- correspondencias y deja que re-sembrar sea un ON CONFLICT.
    id_localidad CHAR(8) PRIMARY KEY,
    id_provincia CHAR(2) NOT NULL REFERENCES PROVINCIA(id_provincia),
    nombre VARCHAR(100) NOT NULL,
    -- Desambigua los 68 pares (provincia, nombre) que están repetidos en
    -- todo el país: sin el departamento, el selector mostraría dos
    -- opciones idénticas y no habría forma de saber cuál es cuál.
    departamento VARCHAR(100),
    -- Centroide de la localidad. Todavía sin usar: es lo que va a
    -- permitir calcular kilometros_estimados (HU 9).
    latitud NUMERIC(9, 6) NOT NULL,
    longitud NUMERIC(9, 6) NOT NULL
);


-- ============================================================
-- CARGA — objeto central del negocio: cada solicitud de transporte.
-- Los seis primeros campos son los que pide el formulario de alta
-- (HU 2.1.1); el resto es estimación económica y trazabilidad.
-- ============================================================
CREATE TABLE CARGA (
    id_carga SERIAL PRIMARY KEY,
    -- Origen y destino apuntan al catálogo: la base ya no acepta texto
    -- libre, así que no puede haber una carga con un destino inventado.
    id_localidad_origen CHAR(8) NOT NULL REFERENCES LOCALIDAD(id_localidad),
    id_localidad_destino CHAR(8) NOT NULL REFERENCES LOCALIDAD(id_localidad),
    tipo_carga VARCHAR(100) NOT NULL,
    peso_kg NUMERIC NOT NULL,
    fecha DATE NOT NULL,
    observaciones TEXT,
    -- Estimaciones: todavía sin usar, quedan para cuando se calcule
    -- la distancia entre origen y destino.
    kilometros_estimados NUMERIC,
    costo_estimado NUMERIC,
    ganancia_estimada NUMERIC,
    -- Estado vigente. Nace 'disponible' y HU 2.3 lo pasa a 'publicada'.
    -- El historial completo de transiciones va en ESTADO_CARGA.
    estado_actual VARCHAR(30) NOT NULL DEFAULT 'disponible',
    -- Administrador responsable del alta. NOT NULL a propósito: toda
    -- carga tiene que poder rastrearse hasta quién la creó.
    id_admin_creador INTEGER NOT NULL REFERENCES USUARIO(id_usuario),
    -- Camionero asignado. Queda en NULL hasta que la carga se asigne.
    id_camionero_asignado INTEGER REFERENCES CAMIONERO(id_usuario),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- ESTADO_CARGA — historial del ciclo de vida de cada carga.
-- Una fila por cada cambio de estado, con quién lo hizo y cuándo,
-- que es lo que pide HU 2.3 para dejar el proceso trazable.
-- ============================================================
CREATE TABLE ESTADO_CARGA (
    id_estado_carga SERIAL PRIMARY KEY,
    id_carga INTEGER NOT NULL REFERENCES CARGA(id_carga) ON DELETE CASCADE,
    -- Queda en NULL en el primer registro: antes del alta no había estado.
    estado_anterior VARCHAR(30),
    estado_nuevo VARCHAR(30) NOT NULL,
    -- Usuario responsable del cambio. NULL cuando el cambio lo hace el
    -- sistema (proceso automático) y no una persona.
    id_actor INTEGER REFERENCES USUARIO(id_usuario),
    marca_tiempo TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- Triggers de actualizado_en.
-- Postgres no actualiza ninguna columna solo: sin esto, actualizado_en
-- se queda para siempre con la fecha del alta. HU 1.2 pide explícitamente
-- que se actualice al modificar un usuario.
-- ============================================================
CREATE OR REPLACE FUNCTION actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_usuario_actualizado_en
BEFORE UPDATE ON USUARIO
FOR EACH ROW
EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trigger_carga_actualizado_en
BEFORE UPDATE ON CARGA
FOR EACH ROW
EXECUTE FUNCTION actualizar_timestamp();


-- ============================================================
-- Índices para las consultas filtradas del listado de cargas (HU 3).
-- El listado filtra por estado, fecha y destino, y ordena por fecha.
-- Sin índices Postgres recorre la tabla entera en cada búsqueda.
-- ============================================================

-- El camionero siempre consulta por estado 'disponible', y el administrador
-- filtra por estado y ordena por fecha: este índice cubre los dos casos.
CREATE INDEX idx_carga_estado_fecha ON CARGA (estado_actual, fecha);

-- El filtro por destino compara ids exactos contra el catálogo, así que
-- alcanza con un índice común. Antes era un ILIKE '%texto%' sobre una
-- columna de texto libre y hacía falta un índice trigram (pg_trgm).
CREATE INDEX idx_carga_destino_localidad ON CARGA (id_localidad_destino);

-- El selector de localidades siempre pide "las de esta provincia, ordenadas".
CREATE INDEX idx_localidad_provincia_nombre ON LOCALIDAD (id_provincia, nombre);

-- La bitácora siempre se pide por carga y ordenada por fecha (HU 8).
CREATE INDEX idx_estado_carga_carga_tiempo ON ESTADO_CARGA (id_carga, marca_tiempo);
