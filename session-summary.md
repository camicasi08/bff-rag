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
