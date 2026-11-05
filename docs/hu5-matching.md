# Matching de camioneros (HU 5)

Reglas acordadas con Tomás para esta primera versión: el ranking considera
solamente **postulados pendientes aptos**. Recomendar no crea postulaciones ni
asigna cargas; se conserva `POST /cargas/:id/asignar` de la HU 6.

## Requisitos mínimos

- Carga disponible o pendiente, sin camionero asignado y con peso positivo.
- Usuario activo, con rol camionero y postulación pendiente para esa carga.
- Capacidad positiva y mayor o igual al peso. Capacidad desconocida o inválida
  excluye al candidato; no se compensa con otros puntos.
- Disponibilidad explícitamente `true`; `false` o `NULL` excluyen al candidato.

El booleano indica disponibilidad declarada. No se impone una nueva restricción
por otros viajes: no hay agenda ni duración prevista para comprobar solapamientos.
La asignación actual tampoco verifica capacidad ni disponibilidad. El ranking es
una recomendación calculada al consultar, no una reserva ni una garantía de que
los datos no cambiarán antes de confirmar.

## Puntaje reproducible, de 0 a 100

Los pesos acordados son 40/25/20/15. Se usan estas escalas iniciales, explícitas
para poder contrastarlas con datos controlados y ajustarlas con el equipo:

| Criterio | Puntos | Motivo |
|---|---|---|
| Capacidad | `40 * peso_kg / capacidad_kg` | Entre vehículos suficientes, favorece el que mejor ajusta su capacidad al peso. |
| Cercanía | `25 * max(0, 1 - distancia_km / 300)` | El máximo corresponde a estar en el origen; desde 300 km aporta cero, sin excluir. |
| Disponibilidad | `20` | Todos los aptos cumplen el requisito; este aporte es constante. |
| Historial | `15 * min(viajes_entregados / 10, 1)` | Experiencia registrada: máximo desde diez entregas, sin excluir a los nuevos. |

El historial cuenta cargas distintas entregadas cuyo `id_camionero_asignado`
corresponda al candidato; no cuenta transiciones repetidas ni usa `id_actor`
como conductor. Todavía no equivale a reputación ni a una calificación de HU 11.

Se ordena por total sin redondear y, si empatan, por `id_camionero` ascendente.
Los puntajes se redondean a dos decimales solamente en la respuesta. Las
explicaciones incluyen los valores usados y los puntos de cada criterio.

## Dependencia de HU 9

La cercanía necesita la distancia **ubicación del camionero → origen**, no los
kilómetros origen → destino de la carga. Se reutiliza `src/services/mapas.js`
de HU 9: `obtenerDistanciaKm({lat, lon}, {lat, lon})` recibe **coordenadas**,
no nombres. No se agrega otro proveedor ni se cambia la integración de HU 9.
El módulo usa la dirección vigente del proveedor:
`https://api.heigit.org/openrouteservice/v2/directions/driving-car`.
La dirección anterior `api.openrouteservice.org` está retirada de servicio
según el [aviso oficial de migración](https://ask.openrouteservice.org/t/reducing-the-quota-of-deprecated-api-api-openrouteservice-org/8013).

`src/services/ubicacionMatching.js` convierte el texto de `CAMIONERO.ubicacion`
a una localidad del catálogo local. Se ignoran diferencias de mayúsculas,
tildes y espacios, pero no se adivinan nombres ni se aceptan direcciones:

- Formato recomendado: `Paraná, Entre Ríos`.
- Si el nombre se repite dentro de la provincia: `Localidad, Departamento, Provincia`.
- Un nombre sin provincia se acepta solo si es único en todo el catálogo.
- Una ubicación ausente, desconocida o ambigua conserva al apto en el ranking,
  con cercanía cero y una advertencia que permite corregir su perfil.

El origen sale de la FK de CARGA y sus coordenadas en LOCALIDAD. Las coordenadas
del camionero también son el centroide de su localidad declarada: **no es GPS
en tiempo real**. La respuesta incluye `ubicacion_resuelta` para mostrar qué
localidad se usó. Dentro de la misma localidad, la distancia entre centroides es
cero; en ese caso no se consulta la API. Para distintas localidades se calcula
la ruta mediante el módulo existente de HU 9.

Si falta `ORS_API_KEY`, la ubicación no se puede resolver o mapas falla, cercanía
aporta cero y el candidato incluye una advertencia. No se redistribuyen pesos.
La clave se configura solo en el `.env` local del backend; no se comparte en
capturas ni se versiona. Sin clave se puede probar el resto del ranking, pero
no certificar una consulta real al proveedor.

## Endpoint y comprobación

`GET /matching/:idCarga` requiere token y rol administrador. Responde con
`id_carga`, `alcance: "postulados_pendientes"`, `calculado_en`, `pesos`,
`parametros`, `sugeridos` (posición, total, desglose, advertencias y datos
operativos) y `descartados` (id y motivos). Nunca incluye credenciales.
Una lista vacía es 200; id inválido es 400, carga inexistente 404 y una carga
cerrada, asignada o con peso inválido es 409. La respuesta no se guarda en caché.

El cálculo relee los datos en cada consulta. Para evitar una instantánea
inconsistente entre carga e historial, esos datos se obtienen con una sola
consulta SQL. Si hay aptos con origen válido, una segunda consulta lee el
catálogo geográfico, sin una consulta por cada camionero.
Las llamadas a mapas tienen un límite de espera de cinco segundos; el módulo de
HU 9 debe gestionar también el timeout de su propia conexión y la cuota del
proveedor. Se comparte una petición por localidad dentro del mismo ranking,
incluso si sus nombres se escribieron de formas diferentes. No se mantiene una
caché de distancias entre consultas.

`npm test` ejecuta las pruebas con distancias controladas. Para habilitar también
el SQL y el circuito real, en PowerShell: `$env:MATCHING_DB_TEST='1'; npm test`.
Se usa PostgreSQL con tablas temporales, sin modificar las tablas públicas ni
sembrar la base de uso:

- `matching-db.test.js` carga `tests/fixtures/matching.sql` en una transacción
  y termina con ROLLBACK. Ese archivo de datos no es una migración.
- `matching-integracion.test.js` crea las ocho tablas temporales con el esquema
  real y limita la búsqueda de tablas a `pg_temp, pg_catalog`. Ejecuta login,
  alta de carga, postulaciones, ranking, asignación, historial y notificaciones
  por HTTP. Los controladores confirman sus transacciones sobre esas tablas
  temporales; cerrar la conexión las elimina. Solo se simula OpenRouteService.
- `matching-mapas.test.js` utiliza el módulo real de HU 9 con respuestas HTTP
  controladas, comprobando orden de coordenadas, conversión metros/km y puntaje.

Con `MATCHING_DB_TEST=1`, la verificación inicial de esta integración pasó las
54 comprobaciones. Además, el 02/11/2026 se verificó una consulta real usando
la clave del `.env` local: Santa Fe → Paraná devolvió HTTP 200 y 29,62 km.
El matching aplicado a candidatos sintéticos en tablas temporales otorgó 22,53
de 25 puntos de cercanía, sin advertencias. Se deshizo la transacción al terminar;
no quedaron usuarios, cargas ni postulaciones de prueba en las tablas públicas.
El registro detallado está en `docs/hu5-validacion-mapas.md`.
