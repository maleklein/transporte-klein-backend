# Métricas (HU 13)

`GET /metricas` (sólo administrador) devuelve los indicadores del panel para
un período. Esta sección documenta las definiciones con las que se calcula
cada número, para que el código y el README no diverjan.

## Parámetros

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

## Respuesta

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
