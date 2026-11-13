-- 008 — Nombres y apellidos con mayúscula inicial.
--
-- Desde esta versión, el alta y la edición los guardan así. Esta migración
-- acomoda los que ya estaban cargados, para que el listado no mezcle
-- "evans muv" con "Evans Muv". No agrega ni borra filas.
--
--   psql -d transporte_klein_db -f migrations/008_nombres_con_mayuscula.sql
--
-- Para una base nueva no hace falta: no hay usuarios que acomodar.

BEGIN;

-- initcap hace lo mismo que el backend: primera letra de cada palabra en
-- mayúscula y el resto en minúscula, separando por espacios, guiones y apóstrofes.
UPDATE USUARIO
SET nombre = initcap(nombre),
    apellido = initcap(apellido)
WHERE nombre <> initcap(nombre)
   OR apellido <> initcap(apellido);

COMMIT;
