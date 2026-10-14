# transporte-klein-backend

API del sistema de gestión de cargas. Node + Express + PostgreSQL.

---

## Actualizar la base con las notificaciones (HU 12)

**Una vez, cuando traigas esta rama.** Sin la tabla nueva, dar de alta una
carga o cambiarle el estado falla con `relation "notificacion" does not exist`:
los dos guardan un aviso en la misma transacción.

```bash
psql -d transporte_klein_db -f migrations/002_notificaciones.sql
```

Sólo agrega la tabla `NOTIFICACION`: no toca ni borra nada de lo que ya tenés.
Si todavía no corriste la migración del catálogo geográfico, corré esa primero
(la sección que sigue). Si armás la base de cero, `script_tablas.sql` ya trae
la tabla y no hace falta ninguna migración.

---

## Actualizar la base con el catálogo geográfico

**Esto hay que correrlo una vez cuando traigas esta rama.** El origen y el
destino de una carga dejaron de ser texto libre y ahora apuntan a un catálogo de
provincias y localidades. Si no actualizás la base, el listado de cargas falla
con `relation "localidad" does not exist`: las consultas hacen JOIN contra
tablas que todavía no existen.

### Si ya tenés la base armada

```bash
psql -d transporte_klein_db -f migrations/001_catalogo_geografico.sql
node scripts/sembrar-localidades.js
```

La migración crea las tablas del catálogo, cambia las columnas de `CARGA` y
**borra las cargas que tengas**. Los usuarios quedan: no hace falta volver a
correr `crear-admin.js` ni loguearse de nuevo.

Las cargas se borran a propósito. Eran de prueba, con el origen y el destino
escritos a mano ("Parana", "Bariloche"), y convertirlas al catálogo obligaba a
decidir a mano cosas como si "Buenos Aires" era la ciudad o la provincia. Se
vuelven a cargar desde la pantalla de alta, que además es la forma de comprobar
que el circuito nuevo anda.

### Si preferís armar la base de cero

```bash
dropdb --if-exists transporte_klein_db
createdb transporte_klein_db
psql -d transporte_klein_db -f script_tablas.sql
node scripts/sembrar-localidades.js
node scripts/crear-admin.js <email> <contraseña>
```

`script_tablas.sql` ya trae el esquema nuevo: acá no va ninguna migración.

**En los dos casos la siembra va antes de crear cargas**: `CARGA` referencia a
`LOCALIDAD`, así que sin catálogo no se puede dar de alta nada.

### Si algo falla

- **`no se pudo sembrar el catálogo`**: el script baja los datos de la API
  georef del gobierno. Si no tenés internet o el servicio está caído, usá el
  respaldo que está commiteado en el repo:
  ```bash
  node scripts/sembrar-localidades.js --offline
  ```
- **La siembra se puede repetir las veces que haga falta.** No duplica nada:
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

## Notificaciones (HU 12)

El sistema deja un aviso en la tabla `NOTIFICACION` ante tres eventos:

| Evento | Quién lo recibe |
|---|---|
| Alta de una carga | Los camioneros con disponibilidad y la cuenta activa |
| Cambio de estado | El administrador que creó la carga y el camionero asignado, salvo quien hizo el cambio |
| Asignación (HU 6) | El camionero elegido, el administrador que asignó y los postulados que quedaron afuera |

Los avisos los arma `src/services/notificaciones.js`, dentro de la misma
transacción que el hecho que los origina. El de cambio de estado se dispara
desde `registrarCambioEstado`, así que cualquier endpoint que registre una
transición en la bitácora avisa solo.

La asignación todavía no está en `develop`. Cuando entre, su endpoint tiene que
llamar a `notificarAsignacion(idCarga, idCamionero, idAdmin, idsRechazados, client)`
con el `client` de su transacción.

| Endpoint | Qué hace |
|---|---|
| `GET /notificaciones` | Las del usuario del token, la más nueva primero (100 como máximo). Con `?solo_no_leidas=true`, sólo las que faltan leer. |
| `PUT /notificaciones/:id/leida` | Marca una como leída. Si es de otro usuario responde 404, igual que si no existiera. |

**El contador de no leídas se actualiza consultando `GET /notificaciones` cada
30 segundos**, no porque el servidor lo empuje. Es una decisión, no una
omisión: para el alcance del proyecto alcanza, y evita sumar websockets.

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
