Resumen de la sesion

Hoy dejamos el repo bastante mas solido en cuatro frentes.

1. Secretos y configuracion

- Movimos el stack a `.env` + `.env.example`.
- Cambiamos defaults sensibles por placeholders tipo `change-me`.
- Agregamos `scripts/scan_secrets.sh`.
- Conectamos el scan de secretos al CI.
- Documentamos el flujo de validacion de secretos.
- Ajustamos el allowlist del escaner para que placeholders de tests como `test-secret`, `mock-secret` y `fake-secret` no rompan CI ni pre-commit.

2. Docker y runtime

- Al reconstruir el ecosistema aparecio un `ModuleNotFoundError: No module named 'rag_service'` en `rag-service`.
- Se corrigio actualizando `rag-service/Dockerfile` para copiar tambien `rag_service/` dentro de la imagen.
- Despues de eso el stack volvio a levantar correctamente.

3. Reorganizacion de AGENTS.md

- Reescribimos `AGENTS.md` para reflejar la implementacion real actual.
- Ya no describe `rag-service` como una app single-file.
- Ahora documenta el paquete `rag_service/`, el BFF real en NestJS, la superficie GraphQL/FastAPI actual y los patrones de implementacion del repo.
- Se dejo explicita la regla de usar `nestjs-expert` para cambios en `bff/`.
- Tambien se documento que las suites deben pasar antes de commit.

4. Testing y validacion automatica

- Añadimos una suite real para `bff` usando `node:test` sobre TypeScript compilado.
- Ampliamos la suite de `rag-service`.
- Conectamos `npm test` del BFF al CI.
- Ignoramos `bff/dist-test/`.

Estado de las suites cuando se validaron:

- `bff`: 21 tests passing
- `rag-service`: 13 tests passing

5. Pre-commit versionado

- Implementamos hooks versionados en `.githooks/`.
- Primero hubo una version shell-heavy.
- Luego la refactorizamos a un runner portable en Python.

Estructura final:

- wrapper minimo: `.githooks/pre-commit`
- logica real: `scripts/pre_commit_check.py`

El pre-commit ahora hace:

1. scan de secretos sobre staged files
2. tests de `bff`
3. tests de `rag-service`
4. aborta el commit si algo falla

Commits realizados

- `ffc46ba` `chore(security): add secret scanning guardrails`
- `7b0bf15` `fix(rag-service): include package in image build`
- `ade8a4c` `test(repo): add bff and rag-service test suites`
- `e10e817` `chore(repo): add portable pre-commit validation`
- `0595295` `chore(repo): make pre-commit checks OS-agnostic`
- `a7a6f0f` `fix(security): align placeholder secret allowlist`

Contexto importante para la proxima sesion

- `core.hooksPath` ya apunta a `.githooks`.
- El hook es portable en logica, pero en esta maquina Windows sigue apareciendo un error de MSYS `sh.exe` (`couldn't create signal pipe, Win32 error 5`) cuando Git invoca el wrapper.
- Los commits si se han completado, pero ese runtime local de Git Bash sigue siendo el ultimo punto debil del flujo.
- El repo quedo limpio al final de cada commit.
- Si retomamos, el siguiente paso natural seria endurecer del todo ese ultimo problema del wrapper/hook en Windows o seguir con features sobre una base ya cubierta por tests y guardrails.

## 2026-04-16

- Se inicio la implementacion de ingest de archivos reales en `rag-service`.
- `IngestRequest` ahora acepta `files` ademas de `documents`, usando contenido en base64.
- Se agrego soporte de parseo para `.txt`, `.md` y `.pdf`, normalizando todo al mismo flujo existente de deduplicacion, chunking y persistencia.
- Se agrego metadata util para archivos ingeridos, incluyendo `filename`, `file_extension` y `content_type`.
- Se agrego la dependencia `pypdf` a `rag-service/requirements.txt` para extraccion de texto de PDF.
- Se extendio la suite Python con pruebas nuevas para parseo de archivos validos e invalidos.
- La suite `rag-service` quedo passing con 19 tests.
- Tambien se amplió `scripts/smoke_test.py` para incluir un payload de ingest basado en archivo markdown, aunque ese smoke no se corrio aun en esta sesion.
- Se añadió el siguiente paso en `bff`: una mutacion GraphQL admin para encolar ingest de documentos y archivos contra `/admin/ingest/jobs`.
- La entrada GraphQL nueva acepta documentos inline y archivos con `content_base64`; el metadata cruza el boundary como `metadata_json` y el servicio Nest lo convierte a objeto antes de llamar al upstream Python.
- Se agregaron pruebas del BFF para el nuevo flujo de ingest admin y la suite `bff` quedo passing con 23 tests.
- Se actualizó `scripts/smoke_test.py` para ejercer el flujo nuevo a traves de la mutacion GraphQL `adminIngest` en lugar de encolar ingest directo solo contra `rag-service`.
- Se agregó a `README.md` un ejemplo de uso de `adminIngest` con documentos inline y archivos.
- Luego se levantó el stack con Docker, se reconstruyeron `rag-service` y `bff`, y se corrigió un problema de validacion GraphQL en `AskArgs`/`AdminChunksArgs` para inputs anidados bajo el `ValidationPipe`.
- El smoke end-to-end finalmente quedó passing, incluyendo el flujo nuevo de `graphql_admin_ingest`.
- Se añadió un portal de documentacion interactiva en el BFF:
  - Swagger REST en `/docs`
  - guia HTML para GraphQL en `/docs/graphql-guide`
- Se agregaron anotaciones Swagger para `POST /auth/token` y `GET /rag/stream`, incluyendo DTOs documentados y bearer auth en el stream.
- Se actualizó `README.md` para apuntar a las nuevas rutas de documentacion.
- Se instalaron dependencias Swagger en `bff`, la suite `npm.cmd test` siguió passing, y se verificó en el stack en vivo que `/docs`, `/docs/graphql-guide` y `POST /auth/token` responden correctamente.
## 2026-04-16

- El usuario pidio mover todo lo relacionado con RAG/backend bajo un folder `backend/` para preparar una separacion mas clara frente a una futura UI.
- Se movieron `bff/`, `rag-service/`, `scripts/` y `tests/` a `backend/`, quedando `backend/bff`, `backend/rag-service`, `backend/scripts` y `backend/tests`.
- Se actualizaron `docker-compose.yml`, `README.md`, `AGENTS.md`, `.gitignore` y `backend/scripts/scan_secrets.sh` para reflejar la nueva estructura.
- Validacion despues del move:
  - `backend/bff`: `npm.cmd test` -> 23 passing
  - `backend/rag-service`: `py -3 -m unittest discover -s backend/rag-service/tests -v` -> 19 passing
- 2026-04-16: El usuario pidio continuar con la implementacion de la UI despues del move a `backend/`.
- 2026-04-16: Se creo una nueva app `frontend/` con Next.js + TypeScript, manteniendo la separacion del repo entre `backend/` y `frontend/`.
- 2026-04-16: La UI incluye:
  - `/login` para emitir y guardar un JWT local via `POST /auth/token`
  - `/chat` para usar `ask(...)`, ver citas/historial y validar el stream SSE del BFF
  - `/admin/ingest` para subir `.txt`, `.md`, `.pdf`, disparar `adminIngest` y monitorear jobs
  - `/admin/overview` para ver metricas, chunks, cache e historial
- 2026-04-16: Se agrego en el BFF la query GraphQL `adminIngestJob(job_id)` para que la UI consulte el estado del ingest a traves del backend en lugar de llamar directo al servicio Python.
- 2026-04-16: Se actualizo `docker-compose.yml` para agregar el servicio `frontend` en el puerto `3001`, y se actualizaron `README.md`, `AGENTS.md`, `.env.example` y `.gitignore` para reflejar la nueva UI.
- 2026-04-16: Validacion de esta fase:
  - `backend/bff`: `npm.cmd test` -> 25 passing
  - `frontend`: `npm.cmd run typecheck` -> passing
  - `frontend`: `npm.cmd run build` -> passing
  - Docker: `bff_frontend` levantado y `next dev` listo en `http://localhost:3001`
- 2026-04-16: El usuario pidio refactorizar el `frontend/` siguiendo el skill `senior-frontend-execution`.
- 2026-04-16: Se refactorizo la UI con una direccion visual mas fuerte y menos repeticion:
  - nuevas primitivas reutilizables como `WorkspaceHero`, `LoginGate` y `StatusStack`
  - heroes mas expresivos y jerarquia mas clara en `/chat`, `/admin/ingest` y `/admin/overview`
  - sistema visual actualizado en `frontend/app/globals.css` con mejor contraste, ritmo y composicion
  - ajustes de copy y estructura para que el flujo principal sea mas evidente
- 2026-04-16: Validacion del refactor visual:
  - `frontend`: `npm.cmd run typecheck` -> passing
  - `frontend`: `npm.cmd run build` -> passing
