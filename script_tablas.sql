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
    -- Centroide de la localidad: es lo que se le pasa al servicio de
    -- mapas para calcular kilometros_estimados (HU 9).
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
    -- Distancia por ruta entre origen y destino, calculada con el
    -- servicio de mapas al dar de alta la carga (HU 9).
    kilometros_estimados NUMERIC(10, 2),
    -- Resultado del último intento de cálculo: 'ok' (hay valor),
    -- 'pendiente' (el proveedor no respondió, se puede reintentar) o
    -- 'error' (reservado para cuando no haya ruta posible).
    estado_calculo_km VARCHAR(10) NOT NULL DEFAULT 'pendiente'
        CHECK (estado_calculo_km IN ('ok', 'pendiente', 'error')),
    -- Estimación económica del viaje (HU 10), calculada junto con los
    -- kilómetros. NULL mientras no haya distancia: no se estima sobre cero.
    costo_estimado NUMERIC(12, 2),
    ganancia_estimada NUMERIC(12, 2),
    -- Los parámetros con los que se calculó, como foto: si después cambian,
    -- la carga conserva la cuenta que se hizo en su momento.
    parametros_costo JSONB,
    -- Estado vigente. Nace 'disponible' (ESTADO_INICIAL en estadosCarga.js).
    -- "publicada" no es un estado real: no está en la máquina de estados ni
    -- en la base, sólo en un criterio de aceptación del SRS que no se siguió
    -- (ver la nota en src/domain/estadosCarga.js). El historial completo de
    -- transiciones va en ESTADO_CARGA.
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
-- POSTULACION — un camionero que pide llevar una carga (HU 4).
-- Relación muchos a muchos entre CAMIONERO y CARGA: el
-- administrador elige entre los postulados al asignar (HU 6).
-- ============================================================
CREATE TABLE POSTULACION (
    id_postulacion SERIAL PRIMARY KEY,
    id_carga INTEGER NOT NULL REFERENCES CARGA(id_carga) ON DELETE CASCADE,
    id_camionero INTEGER NOT NULL REFERENCES CAMIONERO(id_usuario) ON DELETE CASCADE,
    -- 'pendiente' hasta que se asigna la carga; ahí pasa a 'aceptada' la
    -- del camionero elegido y a 'rechazada' la de los demás.
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    fecha_postulacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Un camionero se postula una sola vez a cada carga.
    UNIQUE (id_carga, id_camionero)
);


-- ============================================================
-- NOTIFICACION — avisos del sistema a cada usuario (HU 12):
-- carga nueva, asignación y cambios de estado.
-- Leerla no la borra: `leida` sólo cambia su estado, así queda
-- constancia de qué se le avisó a quién y cuándo.
-- ============================================================
CREATE TABLE NOTIFICACION (
    id_notificacion SERIAL PRIMARY KEY,
    -- Destinatario. ON DELETE CASCADE por el mismo motivo que la
    -- bitácora: un aviso sin destinatario no tiene a quién mostrarse.
    id_usuario INTEGER NOT NULL REFERENCES USUARIO(id_usuario) ON DELETE CASCADE,
    -- 'carga_nueva', 'cambio_estado', 'carga_asignada', ... La lista
    -- completa está en src/services/notificaciones.js.
    tipo_evento VARCHAR(40) NOT NULL,
    -- El texto se guarda ya armado: cuenta lo que pasó en ese momento,
    -- aunque después la carga se edite.
    contenido TEXT NOT NULL,
    -- Carga a la que se refiere, para ir al detalle desde el aviso.
    -- NULL queda para avisos que no sean de una carga puntual.
    id_carga INTEGER REFERENCES CARGA(id_carga) ON DELETE CASCADE,
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- PARAMETRO_OPERATIVO — valores de la fórmula de costos (HU 10).
-- Van en la base y no en el código porque el SRS pide que el
-- administrador los pueda cambiar sin tocar el código. Cambiarlos
-- no recalcula las cargas que ya tienen su estimación.
-- ============================================================
CREATE TABLE PARAMETRO_OPERATIVO (
    clave VARCHAR(40) PRIMARY KEY,
    valor NUMERIC(12, 4) NOT NULL CHECK (valor > 0),
    descripcion VARCHAR(200),
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Valores de ejemplo, en pesos por kilómetro. Se cambian desde la pantalla
-- de parámetros operativos.
INSERT INTO PARAMETRO_OPERATIVO (clave, valor, descripcion) VALUES
    ('costo_por_km', 1800, 'Costo operativo por kilómetro: combustible, desgaste y chofer'),
    ('peaje_por_km', 150, 'Peajes promedio por kilómetro recorrido'),
    ('tarifa_por_km', 2600, 'Lo que se le cobra al cliente por kilómetro');


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

-- El panel de métricas (HU 13) recorre la bitácora completa filtrando sólo
-- por fecha, sin pasar por una carga puntual.
CREATE INDEX idx_estado_carga_tiempo ON ESTADO_CARGA (marca_tiempo);

-- "Mis viajes" pide las postulaciones de un camionero, la más nueva primero.
-- Las de una carga (lo que mira el administrador al asignar) ya las cubre el
-- índice que arma el UNIQUE (id_carga, id_camionero).
CREATE INDEX idx_postulacion_camionero_fecha ON POSTULACION (id_camionero, fecha_postulacion);

-- Las notificaciones siempre se piden por usuario, a veces sólo las no
-- leídas, y de la más nueva a la más vieja (HU 12). El contador de la barra
-- superior hace esa consulta cada medio minuto por cada usuario conectado.
CREATE INDEX idx_notificacion_usuario_leida_fecha ON NOTIFICACION (id_usuario, leida, creado_en);
