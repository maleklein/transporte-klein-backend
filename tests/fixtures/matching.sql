-- Datos sintéticos en tablas TEMPORALES de la conexión de prueba.
-- Ocultan las tablas públicas para estas consultas; no modifican la base real.
CREATE TEMP TABLE USUARIO (
    id_usuario INTEGER PRIMARY KEY, nombre TEXT, apellido TEXT, estado TEXT, rol TEXT
) ON COMMIT DROP;
CREATE TEMP TABLE CAMIONERO (
    id_usuario INTEGER PRIMARY KEY, tipo_vehiculo TEXT, capacidad_kg NUMERIC,
    ubicacion TEXT, disponibilidad BOOLEAN
) ON COMMIT DROP;
CREATE TEMP TABLE PROVINCIA (id_provincia TEXT PRIMARY KEY, nombre TEXT) ON COMMIT DROP;
CREATE TEMP TABLE LOCALIDAD (
    id_localidad TEXT PRIMARY KEY, id_provincia TEXT, nombre TEXT
) ON COMMIT DROP;
CREATE TEMP TABLE CARGA (
    id_carga INTEGER PRIMARY KEY, peso_kg NUMERIC, estado_actual TEXT,
    id_camionero_asignado INTEGER, id_localidad_origen TEXT
) ON COMMIT DROP;
CREATE TEMP TABLE POSTULACION (
    id_postulacion INTEGER PRIMARY KEY, id_carga INTEGER, id_camionero INTEGER, estado TEXT
) ON COMMIT DROP;

INSERT INTO PROVINCIA VALUES ('30', 'Entre Ríos');
INSERT INTO LOCALIDAD VALUES ('30000001', '30', 'Paraná');
INSERT INTO USUARIO VALUES
    (1, 'Ana', 'Prueba', 'activo', 'camionero'),
    (2, 'Bruno', 'Prueba', 'activo', 'camionero'),
    (3, 'Carla', 'Prueba', 'activo', 'camionero'),
    (4, 'Diego', 'Prueba', 'activo', 'camionero'),
    (5, 'Eva', 'Prueba', 'inactivo', 'camionero'),
    (6, 'Fabio', 'Prueba', 'activo', 'camionero');
INSERT INTO CAMIONERO VALUES
    (1, 'Camión', 10000, 'Santa Fe, Santa Fe', TRUE),
    (2, 'Camión', 16000, 'Santa Fe, Santa Fe', TRUE),
    (3, 'Camión', 7000, 'Santa Fe, Santa Fe', TRUE),
    (4, 'Camión', 10000, 'Santa Fe, Santa Fe', FALSE),
    (5, 'Camión', 10000, 'Santa Fe, Santa Fe', TRUE),
    (6, 'Camión', 10000, 'Santa Fe, Santa Fe', TRUE);
INSERT INTO CARGA VALUES
    (1, 8000, 'pendiente', NULL, '30000001'),
    (2, 1000, 'entregada', 1, '30000001'),
    (3, 1000, 'entregada', 1, '30000001'),
    (4, 1000, 'entregada', 1, '30000001'),
    (5, 1000, 'entregada', 1, '30000001'),
    (6, 1000, 'entregada', 1, '30000001'),
    (7, 1000, 'aceptada', 1, '30000001');
INSERT INTO POSTULACION VALUES
    (1, 1, 1, 'pendiente'), (2, 1, 2, 'pendiente'), (3, 1, 3, 'pendiente'),
    (4, 1, 4, 'pendiente'), (5, 1, 5, 'pendiente'), (6, 1, 6, 'rechazada');
