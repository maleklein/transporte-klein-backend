# Instrucciones para agentes: transporte-klein-backend

API de Transporte Klein, un sistema de gestión de cargas para la materia
Informática Aplicada (UAP). Node 22, Express y PostgreSQL. El frontend está en
`maleklein/transporte-klein-frontend`.

Todo se escribe en español rioplatense: código, mensajes de la API, commits,
PRs y documentación. Los mensajes que ve el usuario usan voseo ("No podés
postularte...").

## Documentación del proyecto

El proyecto tiene tres documentos que tienen que coincidir con el código:

| Documento | Dónde está |
|---|---|
| SRS (`SRS_Transporte_Klein.docx`) | [OneDrive de Milena](https://uapeduar-my.sharepoint.com/:w:/r/personal/milena_seri_uap_edu_ar/_layouts/15/Doc.aspx?sourcedoc=%7BCD7049A0-1983-4EBD-B312-0BD4A8DC5CB6%7D&file=SRS_Transporte_Klein.docx&action=default) |
| Manual de usuario (`Manual_de_Usuario_Transporte_Klein.docx`) | [Drive de Gianna](https://docs.google.com/document/d/1Bi-bGt3aQe49anbhF4TWqDN51H_GM5yM/edit) |
| Banco de pruebas (`Bancos_de_Prueba_Transporte_Klein.docx`) | [Drive de Gianna](https://docs.google.com/document/d/14ZyBpCDsu3TXOB1qMSUldf-dgRwJxVDW/edit) |

Los tres son archivos Word. Si no podés abrir los links, pedíselos a quien te
está usando.

### Al hacer un cambio en el código

1. **No edites los documentos en la misma sesión.** Se actualizan los tres
   juntos, cada tanto, a partir de los PRs. Así dos sesiones no editan el mismo
   archivo a la vez.
2. **Completá "Impacto en la documentación" en la descripción del PR**
   (la plantilla está en `.github/pull_request_template.md`). Para cada
   documento, escribí qué hay que cambiar y dónde:
   - SRS: sección, requisito (RF, RN), HU o tabla de tareas.
   - Manual: sección y, si cambia una pantalla, qué captura rehacer.
   - Banco de pruebas: HU y número de caso.
   Copiá el texto exacto de mensajes, estados, valores y códigos HTTP.
   Si el cambio no afecta ninguno, escribí "Ninguno".
3. **Si hay impacto, ponele al PR la etiqueta `documentacion-pendiente`.**

Afecta la documentación todo lo que cambia lo que el sistema hace o muestra:
reglas de negocio, validaciones, mensajes, códigos de respuesta, estados de una
carga, permisos por rol, pantallas, textos de la interfaz y modelo de datos.
Un refactor, un test nuevo o un cambio en el pipeline no la afectan.

### Al actualizar los documentos

Solo cuando te lo pidan. Partí de los PRs mergeados de los dos repos con la
etiqueta `documentacion-pendiente`:

```bash
gh pr list -R maleklein/transporte-klein-backend --state merged --label documentacion-pendiente
gh pr list -R maleklein/transporte-klein-frontend --state merged --label documentacion-pendiente
```

- Si un documento y el código no coinciden, manda el código: corregí el
  documento. Si parece un error del código, avisá en lugar de "arreglar" el
  documento.
- Editá sin control de cambios y guardá una copia del archivo anterior.
- En Drive, subí el archivo como versión nueva del mismo documento
  (Administrar versiones), no como archivo aparte: el link tiene que seguir
  siendo el mismo.
- Cuidá que los tres documentos digan lo mismo entre sí: un mensaje que cambia
  en el manual cambia también en el banco y, si corresponde, en el SRS.
- Al terminar, sacá la etiqueta de los PRs que pasaste:
  `gh pr edit <número> --remove-label documentacion-pendiente`.

Además de esos tres, `docs/` tiene el detalle técnico de cada funcionalidad
(una nota por HU, listada al final del README). Esa sí se actualiza en el mismo
PR que cambia el código.

## Comandos

```bash
npm install
npm start                # API en el puerto 3000, con el .env
npm test                 # tests sin base: se saltean los de integración
npm run test:cobertura   # lo mismo, con cobertura por archivo
```

Los tests de integración necesitan un PostgreSQL vacío (los datos del `.env`)
y estas variables:

```bash
MATCHING_DB_TEST=1 CALIFICACIONES_DB_TEST=1 ADMINISTRACION_DB_TEST=1 CARGAS_DB_TEST=1 POSTULACION_DB_TEST=1 npm test
```

Cada test arma sus propias tablas y las descarta. Ojo: el workflow de CI no
define `POSTULACION_DB_TEST`, así que ese test no corre en GitHub; correlo
local si tocás postulaciones.

## Cómo subir cambios

El detalle está en "Cómo subir cambios" del README. Lo esencial:

- Ramas dentro del repo (no forks), creadas desde `main`.
- **Rama `fix/...`** para cualquier cambio. El pipeline (tests y SonarQube)
  solo corre en `fix/` y `release/`: con otro nombre el PR no pasa el check
  obligatorio. No renombres una rama con PR abierto: GitHub cierra el PR.
- Commits con prefijo `feat:` o `fix:` (semantic-release saca de ahí la
  versión); `docs:`, `test:` o `refactor:` cuando no cambia el comportamiento.
- PR a `main`, mergeado con **Create a merge commit**, nunca squash.
- SonarQube exige en el código nuevo al menos 80 % de cobertura y como mucho
  3 % de líneas duplicadas. Agregá tests junto con el cambio.
- Al mergear a `main`, Railway despliega a producción.

## Estructura y convenciones

La estructura de carpetas está en el README. Además:

- **Base de datos:** un cambio de esquema va en dos lugares: una migración
  nueva y numerada en `migrations/` (para las bases que ya existen) y el
  esquema completo en `script_tablas.sql` (para armar una base de cero).
- **Estados de una carga:** las transiciones permitidas están solo en
  `src/domain/estadosCarga.js`. No las repitas en un controlador.
- **Permisos:** `verifyToken` y `requireRol` de `src/middlewares/auth.js`. El
  emisor de una acción sale siempre de la sesión, nunca del body.
- **Validación** de lo que llega por body en `src/validators/`.
- **Respuestas:** 400 datos inválidos, 401 sin sesión, 403 sin permiso, 404 no
  existe (o el usuario no la puede ver), 409 conflicto de estado o regla.
- Nunca subas el `.env` ni pongas credenciales en el código o en los docs.
