CREATE TABLE USUARIO (
    id_usuario SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100) NOT NULL,
    dni VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    contraseña_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(50) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'activo',
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Postgres no actualiza ninguna columna solo, hay que decirle explicitamente
-- que en cada UPDATE sobre USUARIO pise actualizado_en con la hora actual.
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

CREATE TABLE CAMIONERO (
    id_camionero SERIAL PRIMARY KEY,
    id_usuario INT REFERENCES USUARIO(id_usuario),
    licencia VARCHAR(50),
    telefono VARCHAR(20),
    ubicacion VARCHAR(255),
    disponibilidad BOOLEAN NOT NULL DEFAULT true,
    tipo_vehiculo VARCHAR(50),
    capacidad_kg DECIMAL(10, 2)
);

CREATE TABLE ESTADO_CARGA (
    id_estado SERIAL PRIMARY KEY,
    descripcion VARCHAR(50) NOT NULL
);

CREATE TABLE CARGA (
    id_carga SERIAL PRIMARY KEY,
    descripcion TEXT NOT NULL,
    peso DECIMAL(10, 2),
    origen VARCHAR(255) NOT NULL,
    destino VARCHAR(255) NOT NULL,
    id_camionero INT REFERENCES CAMIONERO(id_camionero),
    id_estado INT REFERENCES ESTADO_CARGA(id_estado)
);