-- 010 — Postulaciones de cargas canceladas.
--
-- Desde esta versión, al cancelar una carga sus postulaciones en espera pasan
-- a 'rechazada' (ver src/services/registrarCambioEstado.js). Esta migración
-- acomoda las cargas que ya estaban canceladas, cuyas postulaciones quedaron
-- 'pendiente' para siempre. No agrega ni borra filas, y no manda avisos: a
-- esos camioneros ya les había llegado el de la cancelación.
--
--   psql -d transporte_klein_db -f migrations/010_postulaciones_de_cargas_canceladas.sql
--
-- Para una base nueva no hace falta: no hay postulaciones que acomodar.

BEGIN;

UPDATE POSTULACION p
SET estado = 'rechazada'
FROM CARGA c
WHERE c.id_carga = p.id_carga
  AND c.estado_actual = 'cancelada'
  AND p.estado = 'pendiente';

COMMIT;
