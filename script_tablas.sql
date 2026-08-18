CREATE TABLE USUARIO (
    id_usuario SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    rol VARCHAR(50) NOT NULL
);

CREATE TABLE CAMIONERO (
    id_camionero SERIAL PRIMARY KEY,
    id_usuario INT REFERENCES USUARIO(id_usuario),
    licencia VARCHAR(50) NOT NULL,
    telefono VARCHAR(20)
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