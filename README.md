# transporte-klein-backend

API del sistema de gestión de cargas. Node + Express + PostgreSQL.

---

## Actualizar la base con el catálogo geográfico

**Esto hay que correrlo una vez cuando traigas esta rama.** El origen y el
destino de una carga dejaron de ser texto libre y ahora apuntan a un catálogo de
provincias y localidades. Si no actualizás la base, el backend no arranca bien:
las consultas de cargas hacen JOIN contra tablas que todavía no existen.

Elegí el caso que te toque.

### Caso A — ya tenés la base armada y querés conservar tus datos

Tres comandos, en este orden:

```bash
psql -d transporte_klein_db -f migrations/001_catalogo_geografico.sql
node scripts/sembrar-localidades.js
psql -d transporte_klein_db -f migrations/002_migrar_cargas.sql
```

Qué hace cada uno:

1. **001** crea las tablas `PROVINCIA` y `LOCALIDAD`, y le agrega a `CARGA` las
   dos columnas nuevas (todavía vacías).
2. **La siembra** llena el catálogo: quedan 24 provincias y 4027 localidades.
3. **002** convierte las cargas que ya tenías: busca cada texto ("Parana",
   "Bariloche") en el catálogo y lo reemplaza por la localidad que corresponde.

El paso 3 es seguro: corre entero en una transacción y verifica antes de
confirmar. Si alguna carga quedara sin convertir, aborta y no toca nada.

Las columnas viejas no se borran: quedan como `origen_legacy` y
`destino_legacy` por si hay que volver atrás. Se borran más adelante, con
`migrations/003_borrar_legacy.sql`, cuando esté todo funcionando.

### Caso B — base nueva, o preferís rehacerla de cero

```bash
dropdb --if-exists transporte_klein_db
createdb transporte_klein_db
psql -d transporte_klein_db -f script_tablas.sql
node scripts/sembrar-localidades.js
node scripts/crear-admin.js <email> <contraseña>
```

`script_tablas.sql` ya crea el esquema nuevo, así que acá no hay que correr
ninguna migración.

**La siembra va antes de crear cargas**, en los dos casos: `CARGA` referencia a
`LOCALIDAD`, así que sin catálogo no se puede dar de alta nada.

### Si te da error

- **`relation "localidad" does not exist`** al listar cargas: falta correr 001 y
  la siembra.
- **`no se pudo sembrar el catálogo`**: el script intenta bajar los datos de la
  API georef del gobierno. Si no tenés internet o el servicio está caído, usalo
  con el respaldo que está commiteado en el repo:
  ```bash
  node scripts/sembrar-localidades.js --offline
  ```
- **La siembra se puede correr las veces que haga falta.** No duplica nada:
  actualiza lo que ya está.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env    # completar con los datos de tu PostgreSQL
npm start
```

El `.env` necesita `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`,
`PORT` y `JWT_SECRET`. Este último no tiene valor por defecto a propósito: el
servidor no arranca sin él. Para generar uno:

```bash
openssl rand -base64 32
```

---

## Estructura

```
index.js                     rutas
migrations/                  cambios de esquema sobre bases ya existentes
script_tablas.sql            esquema completo, para armar la base de cero
scripts/crear-admin.js       primer administrador (POST /usuarios pide ser admin)
scripts/sembrar-localidades.js   catálogo geográfico desde la API georef
scripts/localidades.json     respaldo del catálogo, para sembrar sin internet
src/controllers/             un archivo por módulo
src/domain/estadosCarga.js   máquina de estados de una carga
src/middlewares/auth.js      verifyToken y requireRol
src/services/                lógica compartida entre controladores
src/validators/              validación de los datos que llegan por body
```
