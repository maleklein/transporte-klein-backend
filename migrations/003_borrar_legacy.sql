-- 003 — Borra las columnas de texto libre que dejó 002 como respaldo.
--
-- Correr SOLO cuando backend y frontend ya estén funcionando con el catálogo y
-- se haya verificado que las cargas muestran bien origen y destino. Hasta
-- entonces, `origen_legacy` y `destino_legacy` son el rollback: tienen el texto
-- original tal como lo escribió el usuario.
--
-- Después de esto, el texto viejo no se recupera.

BEGIN;

ALTER TABLE CARGA
    DROP COLUMN origen_legacy,
    DROP COLUMN destino_legacy;

COMMIT;
