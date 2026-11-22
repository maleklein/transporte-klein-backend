# Listado de cargas (HU 2.5 y HU 3)

`GET /cargas` devuelve las cargas que ve quien hace el pedido, con filtros
opcionales y combinables. El detalle de cada filtro y de qué ve cada rol está en
el comentario de `listarCargas` (`src/controllers/cargaControllers.js`).

## Filtros

| Parámetro | Qué hace |
|---|---|
| `estado` | Estado exacto. Solo el administrador: al camionero se le muestran siempre las disponibles y las pendientes. |
| `fecha` | Fecha de retiro exacta (AAAA-MM-DD). |
| `destino_provincia` | Id de la provincia de destino (2 dígitos). |
| `destino_localidad` | Id de la localidad de destino (8 dígitos). |
| `creada_desde`, `creada_hasta` | Período de creación (AAAA-MM-DD), los dos días incluidos. Mismo criterio que las métricas. |

## Paginación

Con `pagina` (un entero desde 1), el listado viene de a 20 cargas:

```json
{ "cargas": [ ... ], "total": 86, "pagina": 2, "por_pagina": 20 }
```

- `total` es cuántas cargas pasan los filtros, sumando todas las páginas.
- Si `pagina` pasa de la última, `cargas` viene vacío y `total` igual dice
  cuántas hay, para que el front vuelva a la última página.
- `pagina` que no sea un entero mayor que 0: 400, con el mensaje
  `'pagina' debe ser un número entero mayor que 0`.
- Sin `pagina`, la respuesta es la de antes: el array con todas las cargas. La
  siguen usando los paneles de inicio del administrador y del camionero, que
  solo cuentan.

Se pagina por número de página, y no por posición como las notificaciones: en
el listado se va y se vuelve del detalle de una carga, y la página tiene que
poder quedar en la URL (`/cargas?pagina=3`).

### Por qué 20

Es el mismo tamaño que usa el front para las notificaciones. En la computadora
son una o dos pantallas de tabla; en el celular, unas tres o cuatro de lista. Es
el mismo número en los dos, porque la página va en la URL: con tamaños distintos,
un link a la página 3 mostraría cargas distintas en cada dispositivo.

### Orden

Por fecha de retiro (las que no tienen van al final) y por id, así una carga no
cambia de página entre un pedido y otro. Al camionero se le muestran primero las
que puede llevar: las que superan la capacidad de su vehículo (o todas, si no la
tiene cargada) quedan al final, donde el front las muestra aparte (HU 4).
