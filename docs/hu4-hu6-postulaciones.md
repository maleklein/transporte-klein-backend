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
| `POST /cargas/:id/postulaciones` | camionero | Se postula a la carga. 409 si ya se postuló o si la carga ya no recibe postulaciones. |
| `GET /cargas/:id/postulaciones` | administrador | Los postulados, con vehículo, capacidad, ubicación y disponibilidad. |
| `GET /postulaciones/mis-postulaciones` | camionero | Las suyas, la más nueva primero, con el estado de la carga. |
| `POST /cargas/:id/asignar` | administrador | Asigna la carga a un postulado: `{ "id_camionero": 7 }`. |
