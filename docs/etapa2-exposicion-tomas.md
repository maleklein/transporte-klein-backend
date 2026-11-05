# Etapa 2: guía de exposición de Tomás

## La idea principal, en un minuto

Antes ejecutábamos el backend y PostgreSQL en nuestras computadoras. En esta
etapa publicamos el backend en Railway y creamos allí una base de producción
independiente. El frontend sigue corriendo en la computadora y se conecta a la
API mediante HTTPS.

También automatizamos el recorrido de los cambios: se propone un PR, se
ejecutan tests y Sonar, se revisa y fusiona a main, y Railway espera los controles
de GitHub antes de desplegar. Para las ramas release, semantic-release además
crea un tag y una GitHub Release a partir de los mensajes de commit.

Mi responsabilidad fue preparar la base, desplegar el backend, integrar y probar
el versionado automático, y documentar y ensayar el circuito.

## Qué hace cada parte

| Parte | Responsabilidad |
|---|---|
| React/Vite local | Muestra las pantallas y envía solicitudes HTTP |
| Express en Railway | Valida sesiones, permisos y datos; ejecuta las reglas del negocio |
| PostgreSQL en Railway | Guarda usuarios, cargas, postulaciones, calificaciones y demás datos |
| OpenRouteService | Devuelve las distancias por ruta usadas en las estimaciones |
| GitHub | Guarda el código, los PR, los tags y las Releases |
| GitHub Actions | Ejecuta automáticamente los controles y el versionado |
| SonarQube Cloud | Analiza el código y aplica el Quality Gate configurado |
| Docker | Empaqueta el backend y sus dependencias para ejecutarlo en Railway |

Por ejemplo, al iniciar sesión, React llama a `POST /auth/login`. Express busca
el usuario en PostgreSQL, compara la contraseña con bcrypt y devuelve un JWT
si las credenciales y el estado de la cuenta son válidos. Las siguientes
solicitudes llevan ese token; el backend comprueba la sesión y el rol.

## Qué hizo el equipo y qué hice yo

Malena preparó el repositorio para esta etapa, la organización/proyecto de
Sonar y el proyecto de Railway con PostgreSQL. También resolvió el acceso de
Railway al repositorio de GitHub.

Milena implementó el pipeline de tests y Sonar, el Dockerfile y pruebas de
integración adicionales. Conectó el workflow de versionado que yo había
preparado, usando la dependencia `needs: sonar-validation`.

Mi trabajo se dividió en cuatro tareas:

1. **GIA-67:** inicializar y verificar la base de producción.
2. **GIA-56:** desplegar el backend y comprobar el auto-deploy.
3. **GIA-70:** configurar y probar tags y Releases automáticos.
4. **GIA-68:** documentar el recorrido y ensayar la presentación.

## Paso 1: trabajar desde el código actualizado

Comprobamos el estado de Git y actualizamos main. Trabajamos en ramas propias
y llevamos los cambios mediante PR; no hicimos push directo a main.

En esta etapa el flujo del backend usa main como base. Develop había sido la
rama de integración de la etapa anterior. Son dos repositorios independientes:
un cambio de rama o un commit del backend no actualiza el frontend.

Esto explica un problema que apareció en la demo: el frontend estaba en una
rama vieja que mostraba “Panel en construcción”. Actualizarlo al main del
frontend permitió usar el panel implementado por Malena, sin reprogramarlo.

## Paso 2: preparar PostgreSQL de producción — GIA-67

Primero consultamos la base para confirmar que estuviera vacía. No ejecutamos
el esquema a ciegas porque `script_tablas.sql` crea tablas y repetirlo sobre una
base existente genera errores.

Luego creamos la estructura dentro de una transacción: si fallaba una parte,
se cancelaba la operación completa. Cargamos el catálogo geográfico del repo
y creamos el primer administrador con una contraseña ingresada privadamente.

Se verificaron 10 tablas, 24 provincias, 4.027 localidades con coordenadas y
3 parámetros operativos. El administrador quedó activo y su contraseña se
guardó como hash bcrypt, no como texto legible.

No copiamos toda la base de desarrollo ni cargamos el seed de métricas.
Producción y desarrollo conservan datos y credenciales separados.

La conexión de mantenimiento se hizo mediante un túnel SSH de Railway. La
base no necesitó un puerto público: el backend se conecta por la red privada
de Railway. `DATABASE_URL` privada no es una dirección utilizable directamente
desde cualquier computadora fuera de esa red.

## Paso 3: preparar el servicio del backend — GIA-56

Creamos el servicio `transporte-klein-backend` dentro de `sincere-spirit`, en el
entorno production, conectado al repositorio y a la rama main.

Railway construye la imagen usando el Dockerfile: Node 22 sobre Debian slim,
dependencias de producción y ejecución como usuario node. El contenedor no
copia el archivo .env ni crea tablas al arrancar. Bcrypt y las demás
dependencias se instalan dentro de la imagen.

Las variables `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME` se
configuraron como referencias al servicio Postgres. Generamos un `JWT_SECRET`
nuevo y configuramos `ORS_API_KEY` con autorización de su titular. Los valores
secretos no están en el código ni deben mostrarse durante la exposición.

Railway asigna el puerto mediante `PORT`; la aplicación ya lo lee. Configuramos
`/health` como healthcheck y desactivamos la suspensión por inactividad.

La URL pública es:

https://transporte-klein-backend-production.up.railway.app

Esa dirección sirve una API; no muestra por sí sola las pantallas de React.

## Paso 4: entender los controles — CI y Sonar

CI significa integración continua: cada cambio propuesto dispara controles
automáticos. El workflow instala las dependencias con npm ci y ejecuta los
tests con un PostgreSQL exclusivo de CI. No usa la base de producción.

Los tests prueban comportamientos concretos; por ejemplo, permisos, reglas de
matching y calificaciones. La cobertura indica qué partes del código se
ejecutaron durante esas pruebas. Una cobertura alta no demuestra por sí sola
que todos los comportamientos sean correctos.

Sonar analiza el código y recibe el informe LCOV de cobertura. El Quality Gate
es el conjunto de condiciones de calidad configurado para aceptar el cambio.
En los PR, el workflow espera su resultado. Main está protegido y requiere
`sonar-validation` para integrar el cambio.

Hay una precisión importante: el análisis del push a main no espera el Quality
Gate asincrónico. Wait for CI espera el resultado de los workflows de GitHub;
no interpreta por sí mismo todos los checks de otras aplicaciones. El control
previo al merge se aplica mediante el PR y su check obligatorio.

## Paso 5: versionar automáticamente — GIA-70

Preparé `.releaserc.json` y el workflow reutilizable
`.github/workflows/release-version.yml`. Milena conectó ese workflow desde
ci-cd.yml, después del job de Sonar.

Se ejecuta en PR del mismo repositorio, desde release/* hacia main. Lee los
commits desde el último tag y decide el incremento:

| Mensaje | Ejemplo si la versión anterior fuera 1.2.3 |
|---|---|
| `fix: corregir validación` | 1.2.4 |
| `feat: agregar funcionalidad` | 1.3.0 |
| Commit con `BREAKING CHANGE:` | 2.0.0 |
| Solamente `docs:` | No crea una versión nueva |

Se configuraron los plugins de análisis de commits, notas y GitHub. No se
incluyó el plugin de npm porque este backend no se distribuye como un paquete.

Detectamos un detalle al simular un PR: `ci: false` solo no alcanzaba con la
versión fijada. Agregamos `unset_gha_env: true` para que la herramienta use la
rama descargada y no la referencia temporal del PR. Las pruebas locales se
hicieron con repositorios descartables y sin publicar nada.

Después hicimos la prueba real: el PR #39 pasó Sonar y creó automáticamente
el tag y la Release v1.0.0, sobre el commit a74d0c6. El PR #41, con cambios
solamente de documentación, terminó correctamente sin duplicar esa Release.

En esta consigna el tag se crea ANTES del merge. La Release identifica una
instantánea del código; no hace el merge ni despliega el backend. Un deploy
posterior de main puede contener commits más nuevos que ese tag.

## Paso 6: comprobar el auto-deploy y Wait for CI

Primero Railway podía descargar el repo público, pero no crear el trigger de
auto-deploy. El acceso al workspace de Railway no era suficiente: se necesitaba
una cuenta GitHub conectada con acceso al repo y la autorización de la GitHub
App de Railway. Malena resolvió esos permisos.

Verificamos el trigger conectado a main y activamos Wait for CI. Después del
merge autorizado del PR #41 observamos el circuito real:

1. GitHub creó el commit de merge 356d8d5.
2. Se inició el workflow de main.
3. Railway creó automáticamente un despliegue para ese mismo commit.
4. El despliegue quedó WAITING mientras corrían los controles.
5. Actions terminó success y Railway pasó a SUCCESS.
6. Volvimos a consultar `/health`: respondió 200 y confirmó la conexión a la base.

No hicimos un redeploy manual para demostrar esa secuencia. Esa diferencia es
la evidencia de que la automatización funciona.

## Qué mostrar al profesor

1. [Actions de la prueba de auto-deploy](https://github.com/maleklein/transporte-klein-backend/actions/runs/42073071145).
2. [Release v1.0.0](https://github.com/maleklein/transporte-klein-backend/releases/tag/v1.0.0).
3. [PR #41 fusionado](https://github.com/maleklein/transporte-klein-backend/pull/41).
4. Railway: ambos servicios activos, rama main, Wait for CI y healthcheck.
5. [Health público](https://transporte-klein-backend-production.up.railway.app/health).
6. Frontend local conectado a la API de producción, con una sesión de demo.

Desde la carpeta del frontend, en PowerShell:

```powershell
$env:VITE_API_URL='https://transporte-klein-backend-production.up.railway.app'
npm run dev
```

Al configurar otro valor, reiniciar Vite. El backend sigue publicado aunque se
apague nuestra computadora; el frontend local necesita su servidor Vite activo.

## Qué verificamos en el ensayo de producción

El 05/11/2026 usamos una computadora, el frontend main y la API publicada en
Railway. Ingresamos con el administrador y con dos camioneros de demostración
creados expresamente por pedido de Tomás. No migramos las cuentas locales.

Publicamos el viaje #1, **Demo etapa 2**, de Santa Fe a Paraná, con 1.000 kg y
fecha de retiro 06/11/2026. OpenRouteService devolvió 29,62 km: la interfaz lo
redondea a 30 km. Como es una simulación, completamos la entrega durante el
ensayo, antes de esa fecha programada.

Los dos camioneros se postularon. El primero tenía 2.500 kg de capacidad y
estaba en Santa Fe; obtuvo **61/100**. El segundo tenía 5.000 kg y estaba en
Paraná; obtuvo **50,51/100**. Su desglose fue 8 puntos de capacidad, 22,51 de
cercanía, 20 de disponibilidad y 0 de experiencia. El proveedor calculó
29,89 km de acercamiento Paraná → Santa Fe; es otra ruta y otro sentido que
el trayecto de la carga.

Elegimos al primero, comprobamos el aviso al postulante no elegido y avanzamos
el viaje hasta entregada. El historial conservó los cinco estados. Después,
administrador creador y camionero asignado se calificaron mutuamente con 5/5,
con comentarios que identifican la demostración. Ambos perfiles mostraron
5,00/5 y una evaluación recibida. La evaluación enviada quedó registrada y el
formulario ya no permitió enviarla otra vez desde esa pantalla.

El panel de métricas mostró una carga, una entrega y 100 % de cumplimiento.
También verificamos el cierre de sesión y no quedaron errores capturados en
la consola del navegador de las dos sesiones. Los datos se conservaron para
la demostración; no se publican sus contraseñas en esta guía.

Para mostrar sesiones independientes podés usar `localhost:5174` para el
administrador y `127.0.0.1:5174` para el camionero: aunque apuntan al mismo
Vite, el navegador los trata como orígenes distintos. Otra opción es usar una
ventana normal y otra de incógnito.

El viaje ya está entregado. Podés mostrar sus resultados, historial y perfiles;
para repetir desde la publicación se necesita otra carga de demostración.

## Preguntas que pueden hacerte

**¿Para qué sirve /health?** Comprueba que el servidor puede consultar
PostgreSQL. Responde 200 si la consulta funciona y 503 si falla. No demuestra
por sí solo que funcionen todas las pantallas o reglas.

**¿Docker es lo mismo que Railway?** No. Docker define cómo se empaqueta y
arranca la aplicación; Railway es la plataforma que construye y ejecuta esa
imagen y ofrece red, variables, dominio y despliegues.

**¿Un tag es lo mismo que un deploy?** No. El tag identifica un commit; la
Release agrega información del lanzamiento; el deploy ejecuta una imagen del
código en un entorno.

**¿Qué diferencia hay entre merge, push y PR?** Push sube commits a una rama
remota; un PR propone revisarlos e integrarlos; el merge une la rama al destino.
En este flujo los merges a main disparan CI y el auto-deploy.

**¿Por qué no pusimos la contraseña de PostgreSQL en el código?** Porque las
credenciales son configuración privada de cada entorno. El código lee variables
y Railway conserva sus valores fuera de Git.

**¿La clave de mapas es pública?** El servicio es accesible, pero la clave
identifica nuestra cuenta y consume su cuota. Debe mantenerse privada.

**¿Está garantizado que nunca falla?** No. Se verificaron escenarios concretos,
tests, controles y el deploy. Siguen existiendo dependencias externas, cuotas,
créditos del plan y posibles fallos futuros. La suspensión está desactivada;
eso no equivale a una garantía ilimitada de disponibilidad.

## Cierre oral sugerido

“Mi parte dejó una base de producción independiente, el backend publicado,
el versionado automático probado y el despliegue conectado a los controles de
GitHub. Lo comprobamos viendo el mismo commit pasar por CI, quedar esperando
en Railway y desplegarse solo; después verificamos la respuesta del servidor
y la conexión con PostgreSQL. La evidencia está en Actions, Releases, Railway
y la documentación del repositorio.”
