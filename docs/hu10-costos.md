# Costos y ganancia estimados (HU 10)

Cada carga con kilómetros tiene una estimación de cuánto cuesta el viaje y
cuánto deja. Se calcula sola, junto con los kilómetros.

## Fórmula

Con `km` = `kilometros_estimados` de la carga y los tres parámetros operativos:

```
costo    = km × (costo_por_km + peaje_por_km)
ingreso  = km × tarifa_por_km
ganancia = ingreso − costo
```

- Costo e ingreso se redondean a centavos (dos decimales, la mitad hacia
  arriba) **antes** de restar. Así la ganancia es exactamente la resta de los
  dos montos que se muestran, y coincide con la cuenta hecha a mano.
- La ganancia puede ser negativa si la tarifa no cubre el costo: es un dato,
  no un error.
- Ejemplo: 100 km con 1800 / 150 / 2600 → costo $195.000, ingreso $260.000,
  ganancia $65.000.

La cuenta vive en `src/services/costos.js` (`calcularCostos(km, parametros)`),
una función pura: mismos datos de entrada, mismo resultado. `npm test` la
verifica contra casos calculados a mano (`tests/costos.test.js`).

## Cuándo se calcula

En los mismos tres lugares donde la HU 9 resuelve los kilómetros, y en ningún
otro:

| Momento | Qué pasa con la estimación |
|---|---|
| `POST /cargas` | Se calcula con los parámetros vigentes. |
| `PUT /cargas/:id` | Se recalcula **sólo si cambió la ruta**, como los kilómetros. Si no, queda la que tenía. |
| `POST /cargas/:id/recalcular-km` | Se calcula con los kilómetros nuevos y los parámetros vigentes. |

**Sin kilómetros no hay estimación.** Si la distancia quedó pendiente, costo y
ganancia quedan en `NULL`, no en cero. Tampoco un problema con los parámetros
frena el alta (mismo criterio que la RN-04 con el servicio de mapas): la carga
se guarda sin estimación.

## Es una foto: cambiar un parámetro no recalcula las cargas

Lo que se guarda en `CARGA` es la cuenta del momento en que se hizo, junto con
los parámetros que se usaron (`parametros_costo`). Si en noviembre sube el
combustible, una carga entregada en octubre no cambia de ganancia: su ganancia
fue la de octubre. Los valores nuevos se usan desde el próximo cálculo.

Por eso el detalle muestra los parámetros **usados en esa carga**, que pueden
no ser los vigentes.

## Lo que devuelve la API

Las respuestas de carga del administrador traen `costo_estimado`,
`ingreso_estimado`, `ganancia_estimada`, `parametros_costo` y
`estimacion_economica`, que explica por qué falta la cuenta en vez de dejar un
`null` para interpretar:

| `estimacion_economica` | Significa |
|---|---|
| `ok` | Hay costo y ganancia. |
| `sin_distancia` | Los kilómetros están pendientes: no se puede estimar hasta tenerlos. |
| `sin_calcular` | Hay kilómetros pero no se pudo estimar (por ejemplo, faltaba un parámetro). Se arregla con `recalcular-km`. |

Al camionero no se le devuelve ninguno de estos campos: tarifa, costo y margen
son datos del negocio.

## Parámetros operativos

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /parametros-operativos` | administrador | Los tres valores vigentes, con descripción y fecha de última modificación. |
| `PUT /parametros-operativos` | administrador | Reemplaza los tres: `{ "costo_por_km": 1800, "peaje_por_km": 150, "tarifa_por_km": 2600 }`. |

Los tres son obligatorios, numéricos, mayores a cero y con hasta 4 decimales.
Si hay errores responde 400 con `errores` por campo, como el alta de cargas.
La fecha de modificación sólo cambia en los parámetros cuyo valor cambió.

Los valores iniciales son de ejemplo, en pesos por kilómetro.
