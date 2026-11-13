# Notificaciones (HU 12)

El sistema deja un aviso en la tabla `NOTIFICACION` ante cuatro eventos:

| Evento | Quién lo recibe |
|---|---|
| Alta de una carga | Los camioneros con disponibilidad, la cuenta activa y capacidad para el peso de la carga (los que no tienen capacidad cargada no lo reciben: tampoco se pueden postular) |
| Cambio de estado | El administrador que creó la carga y el camionero asignado, salvo quien hizo el cambio |
| Asignación (HU 6) | El camionero elegido, el administrador que asignó y los postulados que quedaron afuera |
| Cancelación (HU 2.4) | Los camioneros que se habían postulado (`carga_cancelada`: "Se canceló la carga … a la que te habías postulado.") |

Al cancelar una carga, además, se borra el aviso de carga nueva a los camioneros
que no se habían postulado: era una oferta que ya no existe, y no tiene sentido
sumarles otro aviso por una carga que no les interesó. Lo hace
`notificarCancelacion`, que se llama desde `notificarCambioEstado` cuando el
estado nuevo es `cancelada`, así que cancela por cualquier endpoint.

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
