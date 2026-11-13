# transporte-klein-backend

API del sistema de gestión de cargas. Node + Express + PostgreSQL.

Cada cambio entra a `main` por un PR que pasa por GitHub Actions (tests y
SonarQube); las ramas `release/` además generan una versión. El detalle de cada
funcionalidad está en [`docs/`](#documentación-de-cada-funcionalidad).

---

## Producción — etapa 2

Backend publicado: **https://transporte-klein-backend-production.up.railway.app**.

Comprobación pública: [GET /health](https://transporte-klein-backend-production.up.railway.app/health).
Devuelve `200 {"estado":"ok"}` cuando PostgreSQL responde. La API no sirve el
frontend; abrir la raíz del backend no muestra la aplicación React.

El frontend se ejecuta en local apuntando a esa API. Desde su carpeta, en PowerShell:

```powershell
$env:VITE_API_URL='https://transporte-klein-backend-production.up.railway.app'
npm run dev
```

La base de Railway es independiente de la base local. El administrador de
producción y su contraseña se acordaron por separado; no están en este repo.

Variables privadas, preparación de la base, comprobaciones y guía de demo:
[docs/deploy-produccion.md](docs/deploy-produccion.md).

Explicación paso a paso y preguntas para la presentación:
[guía de exposición de Tomás](docs/etapa2-exposicion-tomas.md).

---

## Puesta en marcha

```bash
npm install
cp .env.example .env    # completar con los datos de tu PostgreSQL
```

El `.env` necesita `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`,
`PORT` y `JWT_SECRET`. Este último no tiene valor por defecto a propósito: el
servidor no arranca sin él. Para generar uno:

```bash
openssl rand -base64 32
```

`ORS_API_KEY` es opcional: sin ella las cargas se guardan con los kilómetros
pendientes. Cómo conseguirla, en [docs/hu9-kilometros.md](docs/hu9-kilometros.md).

### Armar la base de cero

```bash
createdb transporte_klein_db
psql -d transporte_klein_db -f script_tablas.sql
node scripts/sembrar-localidades.js
node scripts/crear-admin.js <email> <contraseña>
npm start
```

`script_tablas.sql` trae el esquema completo. La siembra del catálogo de
provincias y localidades va antes de crear cargas, porque cada carga apunta a
dos localidades. Si no tenés internet, `sembrar-localidades.js --offline` usa el
respaldo que está en el repo.

Si tenés una base local armada antes de algún cambio de esquema, aplicá en orden
los archivos de `migrations/` que te falten; cada uno explica al principio qué
hace. Ojo con `001_catalogo_geografico.sql`: borra las cargas que tengas.

---

## Tests

```bash
npm test                 # todos los tests
npm run test:cobertura   # lo mismo, con la cobertura de cada archivo de la app
```

Sin base de datos corren los tests unitarios y los de HTTP con la base simulada,
y se saltean los de integración (cinco). Para correr también esos, hace falta
el PostgreSQL del `.env` y estas variables:

```bash
MATCHING_DB_TEST=1 CALIFICACIONES_DB_TEST=1 ADMINISTRACION_DB_TEST=1 CARGAS_DB_TEST=1 npm test
```

En PowerShell:

```powershell
$env:MATCHING_DB_TEST='1'; $env:CALIFICACIONES_DB_TEST='1'; $env:ADMINISTRACION_DB_TEST='1'; $env:CARGAS_DB_TEST='1'; npm test
```

Ninguno toca los datos que ya hay en esa base: cada test de integración arma
sus propias tablas (en un esquema con nombre aleatorio, como tablas temporales o
dentro de una transacción que se deshace) y las descarta al terminar.
El workflow de GitHub Actions los corre siempre, con un PostgreSQL 16 vacío.

---

## Cómo subir cambios

`main` es la única rama de trabajo: de ahí salen las ramas nuevas y ahí vuelven
por PR. `develop` ya no se usa.

1. **Ramas dentro de este repo, no forks.** GitHub no les pasa los secrets a
   los PRs que vienen de un fork, y sin el token el análisis de SonarQube falla.
   Todos los del grupo tienen permiso de escritura, así que alcanza con
   `git switch -c fix/lo-que-sea main`.
2. **El nombre de la rama dice qué pasa al mergear:**
   - `fix/...` para correcciones y cambios chicos. Al mergear a `main`, Railway
     lo despliega.
   - `release/...` para cerrar una versión. Antes de mergear, semantic-release
     crea el tag con el número de versión.
   - No usar otros nombres: el pipeline (tests y SonarQube) corre solo en esas dos.
3. **Commits con prefijo:** `feat:` para algo nuevo y `fix:` para una
   corrección (por ejemplo, `fix: el login no acepta emails con mayúsculas`).
   De ahí saca semantic-release el número de versión: `feat` sube la versión
   menor y `fix` la de parche.
4. **PR hacia `main`**, con SonarQube en verde, y se mergea con
   **Create a merge commit**, no con squash: el squash junta todo en un solo
   commit y semantic-release pierde los prefijos.

---

## Versionado automático

Cuando un PR desde una rama `release/...` hacia `main` pasa los tests y
SonarQube, semantic-release crea un tag `vX.Y.Z` y una Release en GitHub, antes
del merge. El número sale de los prefijos de los commits (`feat:`, `fix:`). No
publica en npm ni cambia `package.json`. Reglas, ejemplos y pruebas en
[docs/gia70-versionado.md](docs/gia70-versionado.md).

---

## Estructura

```
index.js                     rutas
Dockerfile                   imagen del backend para Railway
.github/workflows/           pipeline: tests y SonarQube (ci-cd.yml) y versionado (release-version.yml)
docs/                        detalle de cada funcionalidad
migrations/                  cambios de esquema sobre bases ya existentes
script_tablas.sql            esquema completo, para armar la base de cero
scripts/crear-admin.js       primer administrador (POST /usuarios pide ser admin)
scripts/sembrar-localidades.js   catálogo geográfico desde la API georef
scripts/localidades.json     respaldo del catálogo, para sembrar sin internet
src/controllers/             un archivo por módulo
src/domain/estadosCarga.js   máquina de estados de una carga y qué estados reciben postulaciones
src/middlewares/auth.js      verifyToken y requireRol
src/services/                lógica compartida entre controladores
src/services/costos.js       fórmula de costo y ganancia (HU 10), función pura
src/validators/              validación de los datos que llegan por body
tests/                       tests unitarios, de HTTP y de integración
```

---

## Documentación de cada funcionalidad

| Tema | Documento |
|---|---|
| Postulaciones y asignación (HU 4 y HU 6) | [docs/hu4-hu6-postulaciones.md](docs/hu4-hu6-postulaciones.md) |
| Matching de camioneros (HU 5) | [docs/hu5-matching.md](docs/hu5-matching.md) y la verificación con mapas en [docs/hu5-validacion-mapas.md](docs/hu5-validacion-mapas.md) |
| Kilómetros estimados (HU 9) | [docs/hu9-kilometros.md](docs/hu9-kilometros.md) |
| Costos y ganancia estimados (HU 10) | [docs/hu10-costos.md](docs/hu10-costos.md) |
| Calificaciones (HU 11) | [docs/hu11-reglas.md](docs/hu11-reglas.md) |
| Notificaciones (HU 12) | [docs/hu12-notificaciones.md](docs/hu12-notificaciones.md) |
| Métricas (HU 13) | [docs/hu13-metricas.md](docs/hu13-metricas.md) |
| Versionado automático (GIA-70) | [docs/gia70-versionado.md](docs/gia70-versionado.md) |
| Deploy en Railway y guía de la demo | [docs/deploy-produccion.md](docs/deploy-produccion.md) |
