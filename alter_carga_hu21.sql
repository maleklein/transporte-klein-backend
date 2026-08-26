-- HU 2.1 + 2.1.1 (GIA-34) — cambios sobre la tabla CARGA.
--
-- Sólo hace falta si ya corriste script_tablas.sql antes de este cambio.
-- Si armás la base de cero, script_tablas.sql ya viene con todo esto y podés ignorar este archivo.
--
-- Ojo: id_admin_creador es NOT NULL. Si ya tenés filas cargadas en CARGA, el ALTER
-- va a fallar. Como todavía no hay endpoint que inserte cargas, lo normal es que
-- la tabla esté vacía; si no lo está, vaciala antes con: DELETE FROM CARGA;

-- Todo dentro de una transacción: si un ALTER falla, no queda la tabla a medio migrar.
BEGIN;

-- Los cuatro campos que pide la HU y no existían, más la trazabilidad del alta.
ALTER TABLE CARGA ADD COLUMN tipo_carga VARCHAR(100) NOT NULL;
ALTER TABLE CARGA ADD COLUMN fecha DATE NOT NULL;
ALTER TABLE CARGA ADD COLUMN observaciones TEXT NOT NULL;
ALTER TABLE CARGA ADD COLUMN estado_actual VARCHAR(30) NOT NULL DEFAULT 'disponible';
ALTER TABLE CARGA ADD COLUMN id_admin_creador INT NOT NULL REFERENCES USUARIO(id_usuario);
ALTER TABLE CARGA ADD COLUMN creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE CARGA ADD COLUMN actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- peso pasa a ser obligatorio (la HU lo pide como campo obligatorio del formulario).
ALTER TABLE CARGA ALTER COLUMN peso SET NOT NULL;

-- descripcion no figura entre los campos que pide la HU, así que deja de ser obligatoria.
-- No la borramos por si alguien la estaba contando para otra cosa.
ALTER TABLE CARGA ALTER COLUMN descripcion DROP NOT NULL;

-- estado_actual reemplaza a la FK contra el catálogo ESTADO_CARGA.
ALTER TABLE CARGA DROP COLUMN id_estado;

-- Postgres no actualiza ninguna columna solo: sin este trigger, actualizado_en
-- se queda con la fecha del alta para siempre. Es el mismo que ya tiene USUARIO.
CREATE TRIGGER trigger_carga_actualizado_en
BEFORE UPDATE ON CARGA
FOR EACH ROW
EXECUTE FUNCTION actualizar_timestamp();

COMMIT;
