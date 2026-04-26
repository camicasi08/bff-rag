# AGENTS.md - Intelligent BFF with Contextual RAG

This file tells coding agents how to work in this repository. Keep it aligned with the code that exists now, not an older design.

## Project overview

This repo is a local full-stack RAG workspace:

- `backend/bff/`: NestJS GraphQL gateway with JWT auth, role checks, rate limiting, and an SSE passthrough endpoint.
- `backend/rag-service/`: FastAPI service that handles ingest, retrieval, reranking, prompt construction, answer generation, cacheing, metrics, and conversation persistence.
- `frontend/`: Next.js UI for local login, chat, ingest, and admin overview flows against the BFF.

Local infrastructure is defined in `docker-compose.yml`:

| Service | Port | Role |
|---|---:|---|
| `postgres` | `5432` | pgvector document store, conversations, users, audit data |
| `redis` | `6379` | semantic cache and operational counters |
| `ollama` | `11434` | local embedding and chat model runtime |
| `rag-service` | `8000` | Python RAG API |
| `bff` | `3000` | NestJS GraphQL + streaming gateway |
| `frontend` | `3001` | Next.js browser UI |
| `prometheus` | `9090` | Metrics collection for RAG pipeline observability |
| `grafana` | `3002` | Pre-provisioned dashboards for RAG observability |

## Current repository structure

```text
bff-rag/
|-- AGENTS.md
|-- README.md
|-- docker-compose.yml
|-- monitoring/
|   |-- prometheus.yml
|   `-- grafana/
|       |-- dashboards/
|       `-- provisioning/
|-- .env.example
|-- backend/
|   |-- scripts/
|   |   |-- init.sql
|   |   |-- scan_secrets.sh
|   |   |-- seed.py
|   |   |-- smoke_test.py
|   |   `-- evaluate.py
|   |-- rag-service/
|   |   |-- Dockerfile
|   |   |-- requirements.txt
|   |   |-- main.py
|   |   |-- rag_service/
|   |   |   |-- app.py
|   |   |   |-- config.py
|   |   |   |-- ingest.py
|   |   |   |-- metrics.py
|   |   |   |-- models.py
|   |   |   |-- rag.py
|   |   |   |-- state.py
|   |   |   `-- utils.py
|   |   `-- tests/
|   |-- bff/
|   |   |-- Dockerfile
|   |   |-- package.json
|   |   `-- src/
|   |       |-- app.module.ts
|   |       |-- main.ts
|   |       |-- auth/
|   |       |-- common/
|   |       `-- rag/
|   `-- tests/
|-- frontend/
|   |-- Dockerfile
|   |-- package.json
|   |-- app/
|   `-- src/
`-- postman/
```

Important implementation detail:

- `backend/rag-service/main.py` is now a compatibility/export entrypoint.
- The FastAPI app and most backend behavior live under `backend/rag-service/rag_service/`.
- The RAG Docker image must copy both `main.py` and `rag_service/`.

## How the system works today

### BFF

The BFF exposes:

- GraphQL queries in `backend/bff/src/rag/graphql/resolvers/rag.resolver.ts`
- streaming REST passthrough at `GET /rag/stream` in `backend/bff/src/rag/controllers/rag.controller.ts`
- token issuance at `POST /auth/token` in `backend/bff/src/auth/controllers/auth.controller.ts`

The main GraphQL surface currently includes:

- `cacheStats`
- `metricsSummary`
- `conversationHistory`
- `adminOverview`
- `adminChunks`
- `ask`

All calls to the Python service must go through `RagService` and `RagUpstreamService`. Do not call the RAG service directly from a resolver or controller.

### RAG service

The FastAPI app in `backend/rag-service/rag_service/app.py` exposes:

- `GET /health`
- `GET /cache/stats`
- `GET /metrics/summary`
- `GET /history`
- `GET /admin/overview`
- `GET /admin/chunks`
- `POST /admin/ingest`
- `POST /admin/ingest/jobs`
- `GET /admin/ingest/jobs/{job_id}`
- `POST /query`

Startup behavior in `lifespan()` currently:

- creates the async SQLAlchemy engine/session factory
- connects Redis
- creates one shared `httpx.AsyncClient`
- initializes in-memory metrics and ingest job state
- loads the cross-encoder reranker once when available
- starts the background ingest worker task

## RAG request flow

For `POST /query`, preserve this order unless there is a deliberate architecture change:

1. `embed(query)`
2. `cache_lookup(...)`
3. `retrieve(...)`
4. `rerank(...)`
5. `get_history(...)`
6. `build_prompt(...)`
7. `llm_stream(...)` or `llm_complete(...)`
8. `cache_store(...)`
9. `save_turn(...)` for user and assistant messages

Current request features worth preserving:

- optional metadata filters: `source`, `category`, `title_contains`
- semantic cache hit/miss accounting
- citations in responses
- SSE token streaming
- tenant-aware retrieval and history
- request logging with request IDs
- Prometheus metrics exposed at `GET /metrics` for HTTP latency, query stage timings, pipeline totals, cache events, prompt size, and retrieval/rerank counts

## Database and tenant rules

The schema is defined in `backend/scripts/init.sql`. If you change the schema, update both the SQL and the Python code that queries it.

Important tables:

- `document_chunks`: vectorized content chunks with metadata and tenant filtering
- `conversations`: append-only chat history
- `users`: seeded user profiles
- `audit_log`: append-only audit records

Rules to preserve:

- `document_chunks` and `conversations` depend on tenant-scoped access
- set `app.tenant_id` before tenant-protected queries
- keep pgvector dimensions consistent with `EMBED_DIMS`
- use the existing pgvector literal format:

```python
vec_str = "[" + ",".join(f"{v:.6f}" for v in emb.tolist()) + "]"
```

## Environment and secrets

The stack loads runtime values from `.env`, with fallback defaults in `docker-compose.yml`.

Rules:

- never commit real credentials, tokens, or private keys
- keep `.env.example` placeholder-only
- add new env vars to `docker-compose.yml`
- add new RAG env vars to `backend/rag-service/rag_service/config.py`
- add new BFF env vars through Nest config usage
- run `backend/scripts/scan_secrets.sh --staged` before commit when secret-related files changed

Current important variables:

### RAG service

- `DATABASE_URL`
- `REDIS_URL`
- `OLLAMA_URL`
- `EMBED_MODEL`
- `LLM_MODEL`
- `EMBED_DIMS`
- `LLM_TIMEOUT_SECONDS`
- `LLM_NUM_PREDICT`
- `LLM_TEMPERATURE`
- `LLM_KEEP_ALIVE`
- `CACHE_THRESHOLD`
- `CACHE_TTL`
- `TOP_K_RETRIEVE`
- `TOP_K_RERANK`
- `INGEST_JOB_TTL`

### BFF

- `RAG_SERVICE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `NODE_ENV`
- `QUERY_RATE_LIMIT_MAX`
- `QUERY_RATE_LIMIT_WINDOW_MS`
- `STREAM_RATE_LIMIT_MAX`
- `STREAM_RATE_LIMIT_WINDOW_MS`
- `HISTORY_RATE_LIMIT_MAX`
- `HISTORY_RATE_LIMIT_WINDOW_MS`
- `ADMIN_RATE_LIMIT_MAX`
- `ADMIN_RATE_LIMIT_WINDOW_MS`

### Frontend

- `NEXT_PUBLIC_BFF_URL`

## Coding rules

When a task touches the NestJS BFF in `backend/bff/`, use the `nestjs-expert` skill as the primary framework-specific guide, while still preserving the repository-specific implementation patterns documented in this file.

When a task touches the Next.js UI in `frontend/`, use the `senior-frontend-execution` skill as the primary frontend-quality guide while preserving the repo-specific API contracts documented here.

## Implementation patterns extracted from the codebase

These are not abstract preferences. They are patterns already used by the project and should be preserved unless there is a clear reason to refactor them.

### BFF patterns

- Keep `AppModule` composition minimal: global config, GraphQL module, then feature modules.
- Use global `ValidationPipe` in `backend/bff/src/main.ts` with:
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
  - `transform: true`
  - `enableImplicitConversion: true`
- Apply request logging as middleware, not ad hoc per controller. The current pattern emits one JSON log line on response finish and always sets `x-request-id`.
- Keep controllers and resolvers thin. They should delegate business behavior to services, not perform transport-independent orchestration inline.
- Keep GraphQL read operations in `rag.resolver.ts` and REST streaming transport in `rag.controller.ts`.
- For auth and roles, keep guards transport-agnostic: the current guards support both HTTP and GraphQL by extracting the request differently based on execution context.
- Preserve the local-development auth fallback in `JwtGuard`: no bearer token in development maps to the demo user.
- Use decorators for user and role access instead of hand-reading request state in resolvers.
- Keep GraphQL models as explicit classes with `@ObjectType()` and `@Field()` on every exposed property. Naming is currently snake_case to match upstream payloads.
- Keep rate limiting as an app-layer concern in the BFF before calling upstream services.

### BFF service-layer patterns

- `RagService` is the orchestration layer for BFF-to-RAG operations.
- `RagUpstreamService` is the transport adapter. It owns:
  - URL building
  - `fetch(...)` calls
  - response parsing
  - upstream error translation
  - structured success/failure logging
- `RagConfigService` is the single place for env-backed defaults like upstream URL and rate-limit policies.
- `RagRateLimitService` keeps per-user and per-tenant buckets keyed by operation.
- Upstream failures are translated to `HttpException` with stable error payloads rather than leaking raw fetch errors.
- Streaming requests are handled separately from JSON requests because they need `Accept: text/event-stream` and body passthrough behavior.

### Python service patterns

- Keep application wiring in `rag_service/app.py` and reusable logic in package modules such as `ingest.py`, `metrics.py`, `rag.py`, and `utils.py`.
- Use `lifespan()` for shared resource setup and teardown.
- Keep shared runtime state on the `state` object:
  - DB session factory
  - Redis client
  - shared `httpx.AsyncClient`
  - reranker singleton
  - ingest queue and ingest job maps
  - in-memory metrics
- Prefer pure helper functions in `utils.py` for stateless formatting and transformation logic.
- Prefer structured JSON log events via `log_event(...)` instead of free-form logging strings.
- Always attach or preserve `x-request-id` on API responses and include it in logged request/error events.
- Keep request handlers focused on flow coordination; place reusable domain behavior in helper modules.
- Use Pydantic models for all externally visible request and response shapes.

### Ingest and persistence patterns

- Ingest runs as a background queue-driven job, not inline-only request work.
- `create_ingest_job(...)` registers queued job state first, then enqueues the job ID.
- `ingest_worker()` is responsible for status transitions: `queued` -> `running` -> `completed` or `failed`.
- Expiration of finished ingest jobs is TTL-based and handled separately by `expire_finished_ingest_jobs(...)`.
- Duplicate detection is content-hash based using source + title + content.
- Tenant scoping is set explicitly with `set_config('app.tenant_id', ...)` before protected queries.
- Raw SQL via `sqlalchemy.text(...)` is the current persistence pattern; preserve consistency if you modify related queries.

### Response and error patterns

- Success and error logging is structured as JSON with an `event` field.
- Upstream HTTP failures should be normalized into stable API-facing errors such as:
  - `rag_fetch_failed`
  - `rag_upstream_error`
  - `rag_stream_unavailable`
  - `rate_limit_exceeded`
- FastAPI exception handlers return structured `ErrorResponse` payloads with a `request_id`.
- BFF upstream parsing attempts JSON first and logs the upstream request ID when available.

### Python

- Use async I/O throughout.
- Use `state.session()` as the async DB session factory.
- Do not create ad hoc `httpx.AsyncClient` instances per request.
- Keep request/response schemas in Pydantic models.
- Keep startup wiring in `rag_service/app.py`; keep domain logic in the package modules.
- Do not reload the reranker per request.
- Raise `HTTPException` for expected API failures.
- Keep `backend/rag-service/main.py` as the import/export entrypoint unless intentionally restructuring startup.

### TypeScript / NestJS

- Keep auth behavior inside `backend/bff/src/auth/`.
- Keep RAG transport/orchestration inside `backend/bff/src/rag/`.
- Use `JwtGuard` for authenticated endpoints.
- Keep the development fallback user behavior intact unless explicitly changing local-dev ergonomics.
- Admin GraphQL operations must keep role enforcement with `RolesGuard` and `@Roles('admin')`.
- GraphQL schema is code-first. Add decorators to every exposed field.
- Route upstream calls through `RagService` and `RagUpstreamService`.

### General

- Match the current module layout instead of reintroducing single-file assumptions.
- Do not hardcode secrets in source.
- If you add an endpoint, also update at least one verification path:
  - `backend/scripts/seed.py`
  - `backend/scripts/smoke_test.py`
  - a dedicated automated test
- If you add an Ollama model, update the `ollama-setup` service in `docker-compose.yml`.

## Feature change guide

### Add or change a GraphQL operation

1. Update or add models in `backend/bff/src/rag/graphql/models/`.
2. Add args or inputs in `backend/bff/src/rag/graphql/args/` or `inputs/` if needed.
3. Add the resolver method in `backend/bff/src/rag/graphql/resolvers/rag.resolver.ts`.
4. Add or update the method in `backend/bff/src/rag/services/rag.service.ts`.
5. Add or update the corresponding FastAPI endpoint in `backend/rag-service/rag_service/app.py`.
6. Extend `backend/scripts/seed.py` or `backend/scripts/smoke_test.py`, or add a focused test.

### Add or change BFF streaming behavior

1. Update `backend/bff/src/rag/controllers/rag.controller.ts`.
2. Keep auth and rate limiting consistent with existing stream behavior.
3. Preserve SSE headers and error event handling.
4. Validate with the smoke test or a manual `curl -N` check.

### Add or change a RAG pipeline step

1. Implement the logic in the appropriate module under `backend/rag-service/rag_service/`.
2. Wire it into `backend/rag-service/rag_service/app.py` or `rag.py` at the correct point.
3. Update this file if the canonical pipeline order changes.
4. Add config in `backend/rag-service/rag_service/config.py` if the step is tunable.
5. Extend smoke, evaluation, or unit coverage.

### Add or change ingest behavior

1. Update `backend/rag-service/rag_service/ingest.py`.
2. Preserve background job queue semantics and status polling.
3. Keep duplicate detection behavior intact unless intentionally changing it.
4. Re-check `backend/scripts/seed.py` and `backend/scripts/smoke_test.py`.

### Add a database table or change schema

1. Update `backend/scripts/init.sql`.
2. Add indexes and RLS if the data is tenant-scoped.
3. Update Python queries and models as needed.
4. Rebuild or recreate the relevant containers.

## Verification checklist

Run the smallest meaningful set for the change, and use the full flow after major backend changes:

```bash
# 1. Secret scan
bash backend/scripts/scan_secrets.sh --all

# 2. Stack status
docker compose ps

# 3. RAG health
curl -sf http://localhost:8000/health | python -m json.tool

# 4. Seed flow
python backend/scripts/seed.py

# 5. End-to-end smoke flow
python backend/scripts/smoke_test.py

# 6. Python unit tests
python -m unittest discover -s backend/rag-service/tests -v
```

Useful targeted checks:

```bash
# GraphQL cache stats
curl -s http://localhost:3000/graphql \
  -X POST -H "Content-Type: application/json" \
  -d '{"query":"{ cacheStats { cached_entries } }"}'

# RAG direct query
curl -s -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","tenant_id":"default","query":"payment terms","stream":false}'

# Tenant isolation
curl -s -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","tenant_id":"other-tenant","query":"payment terms","stream":false}'
```

Expected tenant-isolation result:

- `chunks_used` should be `[]`

Before any commit, both test suites must pass:

```bash
(cd backend/bff && npm test)
py -m unittest discover -s backend/rag-service/tests -v
```


Agent rule: keep `session-summary.md` updated during the conversation with concise dated notes capturing each meaningful user request, decision, and completed repo change. Prefix each new entry with an explicit date mark in `YYYY-MM-DD` format so the next session can continue with clear chronological context.

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `rag-service` exits with `ModuleNotFoundError: No module named 'rag_service'` | Image did not copy the package directory | Ensure `backend/rag-service/Dockerfile` copies `rag_service/` |
| `rag-service` is unhealthy on startup | Ollama, Redis, or Postgres is not ready yet | Check `docker compose ps` and `docker compose logs rag-service` |
| `ollama-setup` takes a long time | First model download is still in progress | Wait for `Models ready` |
| first ANN query fails | pgvector index has no data yet | Run `python backend/scripts/seed.py` |
| GraphQL field returns null unexpectedly | missing GraphQL field decorator or upstream shape mismatch | check GraphQL model decorators and BFF mapping |
| cache never hits | threshold too strict, TTL expired, or query meaning drifted | check cache settings and repeat the same semantic query |
| wrong-tenant query returns content | tenant scoping or session setup regressed | inspect tenant filtering and `SET app.tenant_id` usage |

## Out of scope for this local repo

Do not add these here unless the project direction changes explicitly:

- Terraform or cloud infra provisioning
- distributed tracing rollout
- pub/sub spike buffering
- BM25 + dense hybrid search
- HyDE query expansion
- GPU-specific serving changes
- CDN edge caching
- per-tenant LoRA loading
