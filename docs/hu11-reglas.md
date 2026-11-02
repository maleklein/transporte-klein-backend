# HU 11 Calificaciones posteriores al viaje

Reglas acordadas con Tomás el 2 de noviembre de 2026 para concretar RN-03.

- Solo una carga entregada permite calificar.
- Las partes son el administrador creador y el camionero asignado. Cada uno califica al otro; otro administrador no puede hacerlo en su nombre.
- Puntaje entero de 1 a 5. Comentario opcional de hasta 1000 caracteres, recortado en sus extremos. El comentario vacío se guarda como NULL.
- Una evaluación por emisor y viaje, sin edición ni eliminación. La base garantiza la unicidad de `(id_carga, id_emisor)` y prohíbe calificarse a uno mismo.
- La sesión determina el emisor; la carga determina el receptor. La API rechaza identificadores de emisor o receptor enviados por el cliente.
- Reputación: últimas 10 evaluaciones recibidas ordenadas por fecha descendente y, en empates, id descendente. Pesos 10, 9, ... 1. Si hay menos de diez, se usan los primeros pesos: dos evaluaciones usan 10 y 9.
- Fórmula: suma de `(puntaje × peso)` dividida por suma de pesos utilizados. Se redondea a dos decimales al mostrar. Sin evaluaciones se devuelve `null` y se muestra «Sin calificaciones».
- Ejemplo: última evaluación 5 y anterior 3 → `(5×10 + 3×9)/19 = 4,05`. La undécima más antigua no influye, pero se conserva en el historial.
- Los administradores pueden consultar perfiles de reputación. Un camionero puede consultar el suyo y el del administrador de sus viajes entregados. El perfil compartido muestra únicamente nombre, apellido, rol y calificaciones; no DNI, email ni credenciales.
- El historial se pagina de a 20. Su orden es el mismo usado por la reputación.

## API

- `POST /calificaciones`: `{ id_carga, puntaje, comentario? }`. Respuesta 201 con evaluación persistida.
- `GET /cargas/:id/calificacion`: contraparte, evaluación propia si existe, posibilidad y motivo para calificar.
- `GET /usuarios/:id/reputacion?pagina=1`: identidad mínima, promedio, cantidad utilizada, total e historial paginado.
- Sesión obligatoria: 401 sin sesión, 403 sin permiso; 400 por datos inválidos, 404 por entidad inexistente y 409 por carga no entregada o evaluación duplicada.

La inserción bloquea la fila de la carga en una transacción. La restricción UNIQUE protege también dos envíos simultáneos. No altera el estado, la asignación ni el historial de estados del viaje.

## Base existente

Aplicar `migrations/007_calificaciones.sql` una sola vez. El esquema completo `script_tablas.sql` ya incluye la tabla para instalaciones nuevas. Se requiere tener las migraciones anteriores al día. No ejecutar el esquema completo sobre una base existente.

HU 5 conserva su criterio de experiencia por entregas. La incorporación de reputación al ranking requerirá acordar cómo reemplazar o combinar ese criterio; HU 11 implementa la reputación del perfil.
