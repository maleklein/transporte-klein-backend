-- HU 2.1 + 2.1.1 (GIA-34) — cambios sobre la tabla CARGA.
--
-- Solo hace falta si ya corriste script_tablas.sql antes de este cambio.
-- Si armas la base de cero, script_tablas.sql ya viene con todo esto y podes ignorar este archivo.
--
-- Ojo: id_admin_creador es NOT NULL. Si ya tenes filas cargadas en CARGA, el ALTER
-- va a fallar. Como todavia no hay endpoint que inserte cargas, lo normal es que
-- la tabla este vacia; si no lo esta, vaciala antes con: DELETE FROM CARGA;

BEGIN;

ALTER TABLE CARGA ADD COLUMN tipo_carga VARCHAR(100) NOT NULL;
ALTER TABLE CARGA ADD COLUMN fecha DATE NOT NULL;
ALTER TABLE CARGA ADD COLUMN observaciones TEXT NOT NULL;
ALTER TABLE CARGA ADD COLUMN estado_actual VARCHAR(30) NOT NULL DEFAULT 'disponible';
ALTER TABLE CARGA ADD COLUMN id_admin_creador INT NOT NULL REFERENCES USUARIO(id_usuario);
ALTER TABLE CARGA ADD COLUMN creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE CARGA ADD COLUMN actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- peso pasa a ser obligatorio (la HU lo pide como campo obligatorio del formulario).
ALTER TABLE CARGA ALTER COLUMN peso SET NOT NULL;

-- descripcion no figura entre los campos que pide la HU, asi que deja de ser obligatoria.
-- No la borramos por si alguien la estaba contando para otra cosa.
ALTER TABLE CARGA ALTER COLUMN descripcion DROP NOT NULL;

-- estado_actual reemplaza a la FK contra el catalogo ESTADO_CARGA.
ALTER TABLE CARGA DROP COLUMN id_estado;

CREATE TRIGGER trigger_carga_actualizado_en
BEFORE UPDATE ON CARGA
FOR EACH ROW
EXECUTE FUNCTION actualizar_timestamp();

COMMIT;
