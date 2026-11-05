# Deploy de producción y demo — Transporte Klein

Responsable: Tomás Caussa. Verificaciones del 05/11/2026.

## Arquitectura de la entrega

```text
Frontend React en la computadora
  -> HTTPS: backend Express en Railway
     -> red privada: PostgreSQL en el mismo proyecto Railway
     -> HTTPS: OpenRouteService para distancias

GitHub: PR hacia main -> tests y Sonar -> merge -> CI en main -> Railway
                     -> si sale de release/*: tag y GitHub Release
```

- API: https://transporte-klein-backend-production.up.railway.app
- Healthcheck: https://transporte-klein-backend-production.up.railway.app/health
- Repo: https://github.com/maleklein/transporte-klein-backend
- Railway: proyecto `sincere-spirit`, entorno `production`.
- Servicios: `transporte-klein-backend` y `Postgres`.
- Imagen: Dockerfile del repositorio, `node:22-slim`, usuario `node`.
- No se publica el frontend en esta entrega ni se necesita Android para ejecutar
  este circuito web. La aplicación Android es otra parte de la consigna.

## Variables del servicio del backend

Configurar en Railway, nunca en Git ni en capturas de valores:

| Variable | Valor o procedencia |
|---|---|
| `DB_HOST` | `${{Postgres.PGHOST}}` |
| `DB_PORT` | `${{Postgres.PGPORT}}` |
| `DB_USER` | `${{Postgres.PGUSER}}` |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` |
| `DB_NAME` | `${{Postgres.PGDATABASE}}` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Secreto aleatorio nuevo exclusivo de producción |
| `ORS_API_KEY` | Clave autorizada de OpenRouteService, guardada como variable privada |
| `PORT` | Lo asigna Railway; no se fijó manualmente |

El `.env` de desarrollo sigue apuntando a PostgreSQL local. No se reemplazó por
credenciales de Railway. Los tests de CI usan otro PostgreSQL, exclusivo de CI.

## Base de producción — GIA-67

La base ya se inicializó; **no repetir el esquema ni ejecutar migraciones de una
base vieja sobre ella**. El arranque del contenedor no crea tablas ni usuarios.

Se aplicó `script_tablas.sql` a la base vacía dentro de una transacción, con una
comprobación previa que cancela si ya hay tablas. Se cargó el catálogo JSON del
repositorio por SQL en otra transacción, con las mismas columnas y política
`ON CONFLICT DO UPDATE` del script de siembra. El acceso se realizó mediante un
túnel SSH de Railway y `psql`, sin exponer PostgreSQL a Internet.

Resultados de la inicialización: 10 tablas, 24 provincias, 4.027 localidades con
coordenadas, 3 parámetros operativos y un administrador activo. Su contraseña se
ingresó privadamente y se guardó como hash bcrypt con costo 10. No se cargó
`seeds/metricas_datos_prueba.sql` ni se copiaron usuarios de la base de desarrollo.

## Configuración de despliegue — GIA-56

Configurado en el servicio:

- Fuente: `maleklein/transporte-klein-backend`, rama `main`.
- Dockerfile: `Dockerfile`, sin comando alternativo de arranque.
- Healthcheck: `/health`, espera máxima 120 segundos.
- Suspensión por inactividad (`sleepApplication`): desactivada.
- Dominio HTTPS público generado por Railway.
- PostgreSQL permanece privado.

La configuración sin suspensión no promete disponibilidad ininterrumpida: hay
que mantener el proyecto, el plan y los créditos de Railway y revisar incidentes.

### Auto-deploy y Wait for CI

El primer despliegue desde GitHub pudo descargar el repo público y quedó
`SUCCESS`, pero Railway no permitió crear el trigger automático:

`Cannot create deployment trigger ... because no one in the project has access to it`.

No significa que falten permisos Git en la PC. Railway necesita que al menos un
miembro del proyecto conecte su cuenta GitHub con acceso de colaborador al repo,
y que la GitHub App de Railway esté autorizada para ese repositorio.

El acceso se resolvió después de que Malena actualizó la autorización de
GitHub. Se comprobó el trigger `21fde65a-d762-4fc4-a5fa-4c4c90104b91`, conectado
a `main` y al repositorio correcto. Se activó Wait for CI y se verificó
`checkSuites: true` mediante la API de Railway.

Si el mismo problema vuelve a ocurrir, revisar con la cuenta autorizada:

1. Conectar GitHub en los ajustes de la cuenta de Railway.
2. Revisar en GitHub la instalación de Railway y su acceso a este repo. No
   autorizar repositorios adicionales si no hacen falta.
3. Volver al servicio y habilitar los despliegues automáticos desde `main`.
4. Activar **Wait for CI**. El workflow ya corre en push a `main`.
5. Hacer un merge aprobado y comprobar un despliegue nuevo asociado a ese SHA,
   posterior a los checks de GitHub. Registrar el enlace/ID del despliegue.

La configuración automática está activa y fue comprobada con el merge aprobado
del PR #41. El commit `356d8d5da5c2a7062a8227a9f2a2f8c983dc97da` disparó
[CI en main](https://github.com/maleklein/transporte-klein-backend/actions/runs/42073071145).
Railway creó automáticamente el despliegue `93bcdfb7-2987-481a-9c3d-a3f769cc056a`
para el mismo SHA: se observó `WAITING` durante CI y luego `SUCCESS`.
Después del deploy, `/health` volvió a responder 200 y `/cargas` sin token 401.
No se ejecutó un redeploy manual para esta prueba.

[Requisitos oficiales de auto-deploy y Wait for CI](https://docs.railway.com/deployments/github-autodeploys).

## Frontend local contra producción

Desde la carpeta del frontend, instalar dependencias si hace falta con `npm ci`.
En PowerShell, para una sesión de la terminal:

```powershell
$env:VITE_API_URL='https://transporte-klein-backend-production.up.railway.app'
npm run dev
```

Para usar un puerto separado de la sesión local habitual:

```powershell
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Abrir la dirección que muestre Vite. Iniciar sesión con el administrador de
producción; las cuentas de la base local no existen allí automáticamente.
Si cambiás `VITE_API_URL`, reiniciá Vite. Para volver al backend local:

```powershell
Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
npm run dev
```

No es necesario cambiar archivos del frontend. El navegador se comunica con
Railway mediante HTTPS y el backend tiene CORS habilitado.

## Tests y controles de calidad

Ver la sección Tests del README para ejecutarlos con y sin base. Los flags de
integración son `MATCHING_DB_TEST`, `CALIFICACIONES_DB_TEST` y
`ADMINISTRACION_DB_TEST`. No apuntar los tests a producción.

En el pipeline de main del commit `50b7142`, los logs confirmaron:

- 98 tests aprobados, 0 fallidos.
- 86,45 % de líneas, 84,23 % de ramas y 93,33 % de funciones.
- Análisis de Sonar ejecutado correctamente.

[Ejecución de referencia](https://github.com/maleklein/transporte-klein-backend/actions/runs/42059533723).

El ruleset de `main` exige PR y el check `sonar-validation`, sin bypass para la
cuenta actual. En los PR el workflow espera el Quality Gate; el análisis del
push a main no espera ese resultado asincrónico. Wait for CI espera las
conclusiones de los workflows de GitHub, no los checks de otras apps.

## Versionado — GIA-70

El PR #37 conectó el workflow reutilizable de Tomás después de Sonar.
Ver [reglas y condiciones](gia70-versionado.md).

La prueba real se ejecutó en el [PR #39](https://github.com/maleklein/transporte-klein-backend/pull/39),
desde `release/etapa2-produccion` hacia `main`:

- [Ejecución del pipeline](https://github.com/maleklein/transporte-klein-backend/actions/runs/42064863562):
  `sonar-validation` y `create-release-version / create-release-version` en success.
- [Release v1.0.0](https://github.com/maleklein/transporte-klein-backend/releases/tag/v1.0.0),
  publicada automáticamente por semantic-release.
- El tag v1.0.0 apunta a `a74d0c6de92bfc3411712d63ccdbf736980d1cd9`, el HEAD
  evaluado del PR. Se comprobó por la API de referencias de GitHub.
- No se creó ningún tag manual ni se publicó el backend en npm.

Un tag o Release no equivale a un deploy ni hace el merge del PR. GIA-70 se
completó y el auto-deploy por merge de GIA-56 también quedó verificado.
En el PR #41, el job se ejecutó otra vez con commits solo `docs:` y finalizó
correctamente sin crear una versión nueva. Se conserva una única Release v1.0.0.

## Evidencia de deploy y demo — GIA-68

| Comprobación | Resultado verificado del 05/11/2026 |
|---|---|
| Primer deploy y arranque | `SUCCESS`, servidor en el puerto asignado 8080 |
| HTTPS `/health` | 200, `{"estado":"ok"}`; PostgreSQL responde |
| `/cargas` sin token | 401 |
| `/auth/login` con contraseña incorrecta | 401 |
| CORS desde `http://localhost:5173` | Respuesta permite el origen (`*`) |
| Login correcto desde el frontend | Administrador y dos camioneros ingresaron correctamente contra producción; cierre de sesión verificado |
| Frontend de la demo | Copia local actualizada a `origin/main` (`faf49a5`), sin cambios de código; contiene el panel de administrador completo |
| Mapas desde Railway | Script real `probar-mapas.js`: Santa Fe → Paraná, 29,62 km; consulta privada a PostgreSQL y proveedor real |
| Redeploy para aplicar variables | `f840a1bc-91f4-4511-bfa6-ad8510c95b34`, SUCCESS; `/health` nuevamente 200 |
| Auto-deploy y Wait for CI | Trigger de main activo, checkSuites true; PR #41 produjo WAITING → SUCCESS en Railway para el mismo SHA de main |
| Tag y Release reales | v1.0.0 publicada automáticamente; SHA del tag verificado |
| Flujo completo de demo | Carga Demo etapa 2 publicada, dos postulaciones, ranking, asignación, avisos, entrega y calificaciones mutuas verificados |

### Ensayo funcional realizado en una computadora

Se crearon dos camioneros de demostración a pedido de Tomás. No se copiaron
usuarios, contraseñas ni viajes de la base local. Los datos de acceso se
mantienen fuera de esta documentación.

Para conservar sesiones independientes se usó `http://localhost:5174` para el
administrador y `http://127.0.0.1:5174` para el camionero, ambos con el mismo
frontend local conectado a Railway. Son orígenes distintos para el navegador.

| Paso observado | Resultado |
|---|---|
| Formulario vacío de carga | Errores debajo de los campos; no se creó un registro incompleto |
| Publicación | Viaje #1, tipo Demo etapa 2, Santa Fe → Paraná, 1.000 kg, retiro 06/11/2026; disponible para los camioneros |
| Distancia de la carga | Proveedor real: 29,62 km; la pantalla redondea a 30 km |
| Postulaciones | Ambos camioneros se postularon; la primera postulación pasó la carga a pendiente |
| Sugerencias | Primero: 61/100, capacidad 2.500 kg y ubicación Santa Fe. Segundo: 50,51/100, capacidad 5.000 kg y ubicación Paraná |
| Desglose del segundo | Capacidad 8/40, cercanía 22,51/25, disponibilidad 20/20, experiencia 0/15; ruta Paraná → Santa Fe de 29,89 km |
| Asignación | Se eligió al primero; su postulación quedó elegida y la otra no elegida |
| Avisos | El segundo recibió el aviso de postulación no elegida; también se verificó el aviso de carga nueva |
| Estados e historial | Disponible → pendiente → aceptada → en viaje → entregada; cinco registros de historial |
| Calificaciones | Creador y camionero asignado se calificaron con 5/5 y comentarios identificados como demo |
| Reputación | Ambos perfiles muestran 5,00/5, una calificación recibida y una utilizada; el formulario enviado se reemplaza por la evaluación registrada |
| Métricas | Una carga, una entrega, cumplimiento 100 % y un camionero con viaje |
| Consola del navegador | Sin errores capturados en las dos sesiones al finalizar el circuito |

Los 29,62 km corresponden al viaje de la carga; los 29,89 km del ranking son
el acercamiento del segundo camionero al origen en el sentido contrario. No
son la misma consulta de ruta. El caso de demo se entregó durante el ensayo,
antes de su fecha programada; representa una simulación, no un transporte real.

Los dos camioneros y el viaje se conservaron en producción con autorización de
Tomás. No se ejecutaron los bancos automatizados contra esta base. Este ensayo
comprueba el circuito descrito; no reemplaza la suite de tests ni demuestra
ausencia de fallos en todos los escenarios.

Guion para una computadora:

1. Mostrar Actions con tests y Sonar aprobados, y el check requerido del PR.
2. Mostrar el tag y la Release, el SHA asociado y los commits convencionales.
3. Mostrar Railway: backend y PostgreSQL activos; `/health` devuelve 200.
4. Abrir el frontend local contra producción e iniciar sesión como administrador.
5. Mostrar catálogo y cargas; para un circuito con postulaciones, matching y
   calificaciones, usar datos de demo identificados y acordados con el equipo.
6. Usar otra sesión independiente para el camionero.
7. Mostrar el auto-deploy después de un merge aprobado y repetir `/health`.

Las tareas se contrastaron con GIA-56, GIA-67, GIA-68 y GIA-70 de Linear,
`tareas-linear-etapa2_md.pdf` y la foto del pizarrón aportados por Tomás.
Tomás confirmó que esas son todas las referencias de consigna disponibles.

| Requisito del reparto de Tomás | Evidencia |
|---|---|
| GIA-67: tablas, localidades y primer administrador | Base inicializada y cantidades verificadas; contraseña bcrypt |
| GIA-56: deploy del backend | HTTPS, healthcheck, variables privadas, login confirmado y auto-deploy probado |
| GIA-70: tag automático en ramas release/ | v1.0.0 y ejecución posterior sin duplicado por cambios docs |
| GIA-68: documentación y demo | Esta guía, README, guion de exposición y ensayo funcional registrado en la sección anterior |

La foto también menciona Android Studio, una app Android, RabbitMQ, Kafka y
serverless. El reparto disponible no asigna esas implementaciones a estas cuatro
tareas del backend; no se presentan como realizadas en este cierre.

Para preparar la explicación oral, ver [la guía de exposición de Tomás](etapa2-exposicion-tomas.md).
