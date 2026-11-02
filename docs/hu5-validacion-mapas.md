# HU 5 y HU 9: verificación de mapas

Fecha: 02/11/2026. Rama: `feature/hu5-integracion-mapas`.

## Consulta real

Se ejecutó `calcularRanking(1, {db})` con los datos sintéticos de
`tests/fixtures/matching.sql`, dentro de una transacción con tablas temporales.
Se utilizó el módulo de mapas real y la clave configurada en el `.env` local.
No se registró ni se versionó la clave.

| Comprobación | Resultado obtenido |
|---|---|
| Proveedor | `api.heigit.org/openrouteservice/v2/directions/driving-car` |
| Dirección | Santa Fe (camionero) → Paraná (origen de la carga) |
| Respuesta HTTP | 200 |
| Distancia por ruta | 29,62 km |
| Candidatos aptos | 2 |
| Aporte de cercanía del primer candidato | 22,53 / 25 |
| Puntaje total del primer candidato | 82,03 / 100 |
| Advertencias | Ninguna |

La fórmula fue `25 * max(0, 1 - 29.62 / 300)`, redondeada solo para mostrar.
Las coordenadas salieron de los centroides del catálogo, no de GPS en tiempo
real. La transacción terminó con ROLLBACK; las tablas públicas no se modificaron.

## Comprobación del resto del circuito

`MATCHING_DB_TEST=1 npm test` (en PowerShell se configura la variable con
`$env:MATCHING_DB_TEST='1'`) aprobó 54 comprobaciones después del cambio de URL.
El circuito HTTP con login, carga, postulación, ranking, asignación, historial y
notificaciones utiliza PostgreSQL real con tablas temporales. En ese banco se
simula únicamente la respuesta del proveedor para mantener resultados estables
y no consumir cuota en cada ejecución.

Esta evidencia verifica la consulta real de distancia y su aporte al matching.
No representa una nueva prueba visual en navegador ni una certificación de
todos los módulos del sistema. Las distancias y tiempos de respuesta del
proveedor pueden cambiar; la clave y su cuota pertenecen al entorno donde se
ejecuta el backend.
