# Postulaciones y asignación (HU 4 y HU 6)

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
| `POST /cargas/:id/postulaciones` | camionero | Se postula a la carga. 409 si ya se postuló, si la carga ya no recibe postulaciones, si su fecha de retiro ya pasó o si supera la capacidad de su vehículo. |
| `GET /cargas/:id/postulaciones` | administrador | Los postulados, con vehículo, capacidad, ubicación y disponibilidad. |
| `GET /postulaciones/mis-postulaciones` | camionero | Las suyas, la más nueva primero, con el estado de la carga. |
| `POST /cargas/:id/asignar` | administrador | Asigna la carga a un postulado: `{ "id_camionero": 7 }`. |

**Retiro vencido.** Una carga disponible o pendiente cuya fecha de retiro ya
pasó (en la hora de Argentina) deja de aparecer en el listado del camionero y no
acepta postulaciones ("La fecha de retiro de esta carga ya pasó: no recibe más
postulaciones."). El administrador la sigue viendo para cambiarle la fecha o
cancelarla. El alta y la edición rechazan una fecha anterior a hoy ("La fecha de
retiro no puede ser anterior a hoy"); la edición sólo si la fecha cambió.

**Capacidad.** `GET /cargas` y `GET /cargas/:id` le agregan al camionero
`capacidad_camionero_kg` (null si no la tiene cargada), para que la pantalla no
le ofrezca postularse a una carga que pesa más de lo que lleva su vehículo. La
regla la sigue aplicando `POST /cargas/:id/postulaciones`.
