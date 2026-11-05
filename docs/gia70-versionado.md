# Versionado automatico del backend (GIA-70)

## Que hace

Semantic-release lee los commits desde el ultimo tag y calcula una version
`MAYOR.MENOR.PARCHE`. Crea un tag `vX.Y.Z` y una GitHub Release con las notas.
No publica el backend en npm ni cambia `package.json` o `package-lock.json`.
La version publicada se consulta en los tags y Releases de GitHub.

| Commit | Cambio, si la ultima version fuera 1.2.3 |
|---|---|
| `fix: corregir validacion de carga` | 1.2.4 |
| `feat: agregar filtro de cargas` | 1.3.0 |
| `feat: cambiar contrato` con un parrafo `BREAKING CHANGE: explicar la incompatibilidad` | 2.0.0 |
| `docs: actualizar manual` o `chore: ordenar archivos` | No generan version por si solos |

Se toma el cambio de mayor impacto de todos los commits. Sin un tag anterior,
el primer lanzamiento es 1.0.0 si hay cambios publicables: el numero existente
en `package.json` no establece la version inicial para esta configuracion.

Esta entrega sigue GIA-70: publica ANTES del merge de un PR `release/*` hacia
`main`, despues de Sonar. Un tag identifica el commit de esa rama, no el merge
posterior. Cerrar el PR sin mergear no elimina el tag. Revisar la rama antes de
abrir el PR, y usar Create a merge commit para conservar el historial.

## Archivos y dependencia con Milena

- `.releaserc.json`: ramas y plugins. No incluye el plugin de npm.
- `.github/workflows/release-version.yml`: workflow reutilizable con
  `create-release-version`. Usa la accion v4 pedida en la tarea y fija
  semantic-release 21.1.1, la version por defecto documentada de esa accion.
- `.github/workflows/ci-cd.yml` de GIA-61 ya lo llama despues de
  `sonar-validation`, integrado mediante PR #37.

El llamado esta integrado. No hay disparadores paralelos que permitan publicar
sin pasar Sonar. La prueba real de publicacion se registra en la guia de deploy.

### Integracion en `.github/workflows/ci-cd.yml`

El workflow principal contiene este job debajo de `jobs`, al mismo nivel
que `sonar-validation` (no dentro de sus steps):

```yaml
  create-release-version:
    if: >-
      github.event_name == 'pull_request' &&
      github.base_ref == 'main' &&
      startsWith(github.head_ref, 'release/') &&
      github.event.pull_request.head.repo.full_name == github.repository
    needs: sonar-validation
    permissions:
      contents: write
    uses: ./.github/workflows/release-version.yml
```

El job espera el resultado exitoso de Sonar mediante `needs`. No usar
`always()` ni `pull_request_target`. El workflow reutilizable recibe el contexto
del evento original y dispone del `GITHUB_TOKEN` automatico de GitHub.
No necesita el token de Sonar, la clave de mapas ni credenciales de Railway.
No envia comentarios ni modifica etiquetas de issues/PRs.

Ademas de `ci: false`, la accion usa `unset_gha_env: true`. En la version fijada,
el detector de GitHub interpreta `refs/pull/.../merge` como la rama del PR;
desactivar esa deteccion permite leer la rama real descargada por checkout.
La simulacion local del evento PR comprueba ambos comportamientos. Esta opcion
no modifica el token ni los permisos; el filtro de eventos sigue en el job.

El checkout descarga todo el historial y comprueba que HEAD coincida con el
commit del evento evaluado. Si alguien subio otro commit mientras corria Sonar,
se cancela esa publicacion; debe pasar la ejecucion correspondiente al nuevo
commit. Las publicaciones se serializan para evitar competencia por los tags.

## Requisitos del repositorio

1. En Settings > Actions > General, verificar Workflow permissions de acuerdo
   con GIA-71. Este job pide `contents: write` para crear el tag y la Release.
   No cambiar las protecciones de `main` ni usar un token personal como atajo.
2. Ramas dentro de `maleklein/transporte-klein-backend`, no forks.
3. Mantener una sola rama `release/*` activa para esta entrega. El patron se
   expande a las ramas remotas existentes; semantic-release admite hasta tres
   ramas de lanzamiento y varias ramas viejas pueden alterar su orden/canal.
   Revisar las ramas antiguas con el equipo antes de preparar otra version.
4. Commits convencionales y merges que conserven su historial.

## Validacion local del 05/11/2026

Se ejecuto semantic-release 21.1.1 en modo dry-run sobre repositorios Git
descartables, con remotos locales y sin el plugin de GitHub ni tokens.
No se creo ningun tag en el repositorio del proyecto.

| Escenario | Resultado comprobado |
|---|---|
| Sin tag anterior y con `feat:` | 1.0.0 |
| Desde v1.2.3, commit `fix:` | 1.2.4 |
| Desde v1.2.3, commit `feat:` | 1.3.0 |
| Desde v1.2.3, `BREAKING CHANGE:` | 2.0.0 |
| Desde v1.2.3, solamente `docs:` | Sin version nueva |
| Contexto PR simulado y opciones de la accion | Calcula 1.2.4; `ci: false` solo no alcanza |

Tambien se validaron JSON, YAML sin claves duplicadas, el filtro del job
(release hacia main, mismo repo), su rechazo de fix/push/fork/otro destino y
el `needs: sonar-validation` del ejemplo de integracion.
Estas pruebas no verifican los permisos reales del token, el Quality Gate de
Sonar, la publicacion de GitHub ni el deploy; esas comprobaciones siguen
pendientes en el entorno real.

## Prueba final en GitHub

La comprobacion real crea un tag y una Release; no es una simulacion.

1. Integrar el workflow de GIA-61 y el llamado anterior mediante PR revisado.
2. Con autorizacion del equipo, crear una rama `release/...` desde `main`
   actualizado e incluir un cambio real con commit `fix:` o `feat:`.
3. Subir esa rama y abrir PR hacia `main`.
4. Verificar que `sonar-validation` pase y que luego corra
   `create-release-version`. Anotar el enlace a la ejecucion.
5. Comprobar el tag y la Release; verificar que el commit del tag coincida con
   el HEAD del PR. No crear tags manuales para aparentar que paso la prueba.
6. Reejecutar sin nuevos cambios publicables: no debe duplicar el lanzamiento.
7. Comprobar que un PR `fix/*`, un push a `main` y un Sonar fallido no publiquen
   versiones mediante este job. Un commit solo `docs:` tampoco obliga a publicar.
8. Mergear el PR aprobado con Create a merge commit; verificar despues el
   despliegue de Railway en GIA-56. Crear una Release no es desplegar.

No ejecutar semantic-release contra el repositorio real desde la PC para probar:
`ci: false` permite publicar fuera de CI. Las pruebas locales deben usar un
repositorio descartable y excluir el plugin de GitHub. Incluso `dry-run`
comprueba permisos de push: no equivale a una prueba sin acceso remoto.

## Fuentes

- [GIA-70](https://linear.app/giannacavallo/issue/GIA-70)
- [Accion semantic-release v4](https://github.com/cycjimmy/semantic-release-action/tree/v4)
- [Configuracion de semantic-release](https://semantic-release.org/usage/configuration/)
- [Workflows reutilizables de GitHub](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
