# Notificaciones (HU 12)

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
| `PUT /notificaciones/leidas` | Marca como leídas todas las del usuario que faltaban leer. Responde `{ marcadas }`. |

**El contador de no leídas se actualiza consultando `GET /notificaciones` cada
30 segundos**, no porque el servidor lo empuje. Es una decisión, no una
omisión: para el alcance del proyecto alcanza, y evita sumar websockets.
