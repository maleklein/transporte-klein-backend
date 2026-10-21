# transporte-klein-backend

API del sistema de gestión de cargas. Node + Express + PostgreSQL.

---

## Actualizar la base con las postulaciones (HU 4 y HU 6)

**Una vez, cuando traigas esta rama.** Sin la tabla nueva, postularse, ver los
postulados y asignar fallan con `relation "postulacion" does not exist`.

```bash
psql -d transporte_klein_db -f migrations/003_postulaciones.sql
```

Sólo agrega la tabla `POSTULACION`: no toca ni borra nada de lo que ya tenés.
Necesita las dos migraciones anteriores (notificaciones y catálogo, las
secciones que siguen): si te falta alguna, corré esas primero. Si para probar la
rama de Tomás habías creado `POSTULACION` a mano, borrala antes
(`DROP TABLE POSTULACION;`). Si armás la base de cero, `script_tablas.sql` ya
trae la tabla.

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

El de asignación lo dispara `POST /cargas/:id/asignar`, con
`notificarAsignacion(idCarga, idCamionero, idAdmin, idsRechazados, client)`.

| Endpoint | Qué hace |
|---|---|
| `GET /notificaciones` | Las del usuario del token, la más nueva primero (100 como máximo). Con `?solo_no_leidas=true`, sólo las que faltan leer. |
| `PUT /notificaciones/:id/leida` | Marca una como leída. Si es de otro usuario responde 404, igual que si no existiera. |

**El contador de no leídas se actualiza consultando `GET /notificaciones` cada
30 segundos**, no porque el servidor lo empuje. Es una decisión, no una
omisión: para el alcance del proyecto alcanza, y evita sumar websockets.

---

## Métricas (HU 13)

`GET /metricas` (sólo administrador) devuelve los indicadores del panel para
un período. Esta sección documenta las definiciones con las que se calcula
cada número, para que el código y el README no diverjan.

### Parámetros

Query params opcionales, los dos en formato `AAAA-MM-DD`:

| Parámetro | Significado |
|---|---|
| `fecha_desde` | Inicio del período, inclusive. |
| `fecha_hasta` | Fin del período, **inclusive** (cubre el día entero, no sólo las 00:00). |

Si faltan los dos, el período son los últimos 30 días (hasta hoy). Si falta
sólo uno, el que falta se completa con el mismo criterio en relación al otro:
sin `fecha_hasta` se usa hoy, y sin `fecha_desde` se usan 30 días antes de
`fecha_hasta`. Responde 400 si el formato de alguno es inválido o si
`fecha_desde` es posterior a `fecha_hasta`.

Ninguna fecha se convierte de zona horaria: `ESTADO_CARGA.marca_tiempo` y
`CARGA.creado_en` son `timestamp without time zone`, se comparan tal cual
están guardadas.

### Respuesta

```jsonc
{
  "periodo": { "fecha_desde": "2026-08-01", "fecha_hasta": "2026-08-31" },
  "cargas_por_estado": {
    "disponible": 1, "pendiente": 1, "aceptada": 1,
    "en_viaje": 1, "entregada": 3, "cancelada": 1
  },           // los seis estados siempre presentes, 0 si no hubo ninguna
  "total_cargas": 8,
  "tiempo_promedio_asignacion_horas": 11.6,  // número o null si no hay tramos en el período
  "tiempo_promedio_entrega_horas": 80,       // número o null
  "tasa_cumplimiento": 0.75,                 // entre 0 y 1, o null si no hubo entregadas ni canceladas
  "entregadas": 3,
  "canceladas": 1,
  "camioneros_con_viaje": 5,                 // 0 si no hay (ver nota más abajo)
  "entregadas_por_semana": [
    { "semana_inicio": "2026-07-27", "cantidad": 0 },
    { "semana_inicio": "2026-08-03", "cantidad": 1 }
  ],           // una fila por cada semana (lunes) del período, incluidas las de 0
  "hay_datos": true   // false sólo si no hubo ninguna carga creada ni ninguna transición en el período
}
```

Cuando `hay_datos` es `false`, los promedios y la tasa son `null`, los
conteos quedan en 0, y `entregadas_por_semana` igual trae todas las semanas
del período (en 0): el endpoint responde 200 siempre, nunca un error ni un
cuerpo vacío.

Las definiciones reemplazan la propuesta original del documento de requisitos
porque esa propuesta habla de un estado `publicada` que no existe: no está en
la máquina de estados (`src/domain/estadosCarga.js`), no está en la base, y
una carga nace en `disponible`. Todo se calcula a partir de la bitácora
`ESTADO_CARGA`, no de `estado_actual`, salvo donde se aclara lo contrario.

| Métrica | Definición |
|---|---|
| Tiempo de asignación (por carga) | Desde la primera vez que la carga pasó a `pendiente` hasta la primera vez *posterior* que pasó a `aceptada`. Si después vuelve a `pendiente` o a `aceptada` (una corrección), esas repeticiones no cuentan. |
| Tiempo de entrega (por carga) | Desde la primera vez que pasó a `aceptada` hasta que pasó a `entregada`. `entregada` es un estado terminal (RN-01), así que ocurre una sola vez por carga. |
| Período de un tramo | Un tramo (de asignación o de entrega) se cuenta dentro de `[fecha_desde, fecha_hasta]` si su evento *final* (`aceptada` o `entregada`, según el tramo) cae en ese rango. El evento de arranque puede ser anterior al período. |
| Tasa de cumplimiento | `entregadas / (entregadas + canceladas)`, contando las transiciones a esos estados que caen dentro del período. Si ninguna de las dos ocurrió, el resultado es `null`, no `0`: cero no es lo mismo que "sin datos". |
| Cargas por estado | Cargas cuyo `creado_en` cae en el período, agrupadas por su `estado_actual` **de hoy**, no por el estado que tenían durante el período. Una carga creada en el período y cancelada después aparece como `cancelada`. |
| Camioneros con al menos un viaje | `COUNT(DISTINCT id_camionero_asignado)` de las cargas con camionero asignado cuya primera transición a `aceptada` cae en el período. `POST /cargas/:id/asignar` (HU 6) es quien hoy escribe `CARGA.id_camionero_asignado`, en la misma operación en la que registra la transición `pendiente` → `aceptada` que usa el tiempo de asignación (ver fila de arriba): no son dos hechos independientes, son la misma asignación. |

Los índices que necesitan estas consultas (`idx_estado_carga_carga_tiempo` e
`idx_estado_carga_tiempo`, los dos sobre `ESTADO_CARGA`) están en
`script_tablas.sql`; si tu base ya existía antes de esta HU, corré
`migrations/004_indices_metricas.sql`.

---

## Postulaciones y asignación (HU 4 y HU 6)

Una carga recibe postulaciones mientras está **disponible** o **pendiente**, y
eso es lo que ve el camionero en el listado:

1. **Disponible**: publicada, todavía sin postulados.
2. **Pendiente**: la primera postulación la pasa a este estado, con el camionero
   como actor en la bitácora. Las que llegan después no la mueven.
3. **Aceptada**: el administrador la asigna a uno de los postulados. La
   postulación elegida pasa a `aceptada` y las demás a `rechazada`.

De pendiente a aceptada no se pasa con `PATCH /cargas/:id/estado`: se llega
asignando, porque si no quedaría un viaje confirmado sin camionero. Volver de
aceptada a pendiente sí se puede, y deshace la asignación: la carga se queda sin
camionero y todas sus postulaciones vuelven a `pendiente`.

| Endpoint | Rol | Qué hace |
|---|---|---|
| `POST /cargas/:id/postulaciones` | camionero | Se postula a la carga. 409 si ya se postuló o si la carga ya no recibe postulaciones. |
| `GET /cargas/:id/postulaciones` | administrador | Los postulados, con vehículo, capacidad, ubicación y disponibilidad. |
| `GET /postulaciones/mis-postulaciones` | camionero | Las suyas, la más nueva primero, con el estado de la carga. |
| `POST /cargas/:id/asignar` | administrador | Asigna la carga a un postulado: `{ "id_camionero": 7 }`. |

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
src/domain/estadosCarga.js   máquina de estados de una carga y qué estados reciben postulaciones
src/middlewares/auth.js      verifyToken y requireRol
src/services/                lógica compartida entre controladores
src/validators/              validación de los datos que llegan por body
```
