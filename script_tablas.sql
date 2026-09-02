-- Esquema de la base transporte_klein_db.
--
-- Para armar la base de cero:
--   createdb transporte_klein_db
--   psql -d transporte_klein_db -f script_tablas.sql
--   node scripts/crear-admin.js <email> <contraseña>   (primer administrador)


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
-- CARGA — objeto central del negocio: cada solicitud de transporte.
-- Los seis primeros campos son los que pide el formulario de alta
-- (HU 2.1.1); el resto es estimación económica y trazabilidad.
-- ============================================================
CREATE TABLE CARGA (
    id_carga SERIAL PRIMARY KEY,
    origen VARCHAR(150) NOT NULL,
    destino VARCHAR(150) NOT NULL,
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
    -- Usuario responsable del cambio.
    id_actor INTEGER NOT NULL REFERENCES USUARIO(id_usuario),
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
