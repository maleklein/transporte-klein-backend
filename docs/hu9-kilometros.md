# Cálculo de kilómetros estimados (HU 9)

El proveedor elegido para calcular la distancia entre origen y destino es
**OpenRouteService**: da 2.000 consultas diarias gratis sin pedir tarjeta
(la alternativa evaluada, Google Distance Matrix, sí la pide aunque se use
el nivel gratuito).

Para que el cálculo funcione hace falta una key propia:

1. Registrarse gratis en https://openrouteservice.org/dev/#/signup
2. Generar una API key (plan estándar/gratuito).
3. Completar `ORS_API_KEY` en tu `.env`.

Sin esa key, `src/services/mapas.js` no rompe nada: devuelve `null` y la
carga queda con el cálculo pendiente (RN-04). Para probar el módulo de forma
aislada, sin pasar por ningún endpoint:

```bash
node scripts/probar-mapas.js <id_localidad_origen> <id_localidad_destino>
```
