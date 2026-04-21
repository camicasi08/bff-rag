# Intelligent BFF with Contextual RAG

Production-style local stack for a Backend for Frontend (BFF) that injects user and tenant context into LLM responses through a Retrieval-Augmented Generation (RAG) pipeline.

The repository runs as two backend app services, one frontend app, plus local infrastructure:

- `backend/bff/`: NestJS GraphQL gateway with JWT auth, rate limiting, and SSE passthrough
- `backend/rag-service/`: FastAPI service for embeddings, retrieval, reranking, prompting, and LLM calls
- `frontend/`: Next.js admin + chat workspace for local browser-based testing
- `postgres`: pgvector-backed store for document chunks and conversation history
- `redis`: semantic cache and rate-limiting backend
- `ollama`: local runtime for embeddings and chat models

All backend and RAG-related source now lives under `backend/`, while the UI lives under `frontend/` to keep a clean backend/frontend split inside the same repo.

## Architecture

| Service | Port | Responsibility |
|---|---:|---|
| `bff` | `3000` | GraphQL API, auth, admin queries, and streaming bridge |
| `rag-service` | `8000` | Embedding, cache lookup, retrieval, reranking, prompt building, answer generation |
| `frontend` | `3001` | Browser UI for login, chat, ingest, and admin overview |
| `postgres` | `5432` | Users, document chunks, conversations, audit data |
| `redis` | `6379` | Semantic cache and operational counters |
| `ollama` | `11434` | Local embedding and chat models |

### Request flow

1. A client calls the `bff` GraphQL API.
2. The `bff` resolves auth and forwards the request to `rag-service`.
3. The `rag-service` runs the RAG pipeline:
   - embed the query
   - check the semantic cache
   - retrieve candidate chunks from pgvector
   - rerank the results
   - fetch recent conversation history
   - build the prompt
   - call Ollama
   - persist the conversation and cache the response

## Repository layout

```text
bff-rag/
|-- README.md
|-- AGENTS.md
|-- docker-compose.yml
|-- backend/
|   |-- scripts/
|   |   |-- init.sql
|   |   |-- seed.py
|   |   |-- smoke_test.py
|   |   `-- evaluate.py
|   |-- rag-service/
|   |   |-- Dockerfile
|   |   |-- requirements.txt
|   |   |-- main.py
|   |   |-- rag_service/
|   |   `-- tests/
|   |-- bff/
|   |   |-- Dockerfile
|   |   |-- package.json
|   |   `-- src/
|   `-- tests/
|-- frontend/
|   |-- Dockerfile
|   |-- package.json
|   |-- app/
|   `-- src/
`-- postman/
```

## Prerequisites

- Docker with Compose support available as `docker compose`
- At least 10 GB of free disk space
- Internet access for the first startup to download images and Ollama models
- Python 3.12+ if you want to run the local scripts outside containers

The first run can take several minutes because it downloads:

- `nomic-embed-text`
- `llama3.1:8b`

## Quick start

### 1. Start the full stack

From the repository root:

```bash
cp .env.example .env
docker compose up --build
```

To run in the background:

```bash
cp .env.example .env
docker compose up --build -d
```

### 2. Wait for the services to become healthy

```bash
docker compose ps
```

Expected container names:

- `bff_gateway`
- `bff_rag_service`
- `bff_frontend`
- `bff_postgres`
- `bff_redis`
- `bff_ollama`

The one-off `ollama-setup` container should exit successfully after printing `Models ready`.

### 3. Verify the stack

RAG service:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok","model":"llama3.1:8b"}
```

GraphQL:

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ cacheStats { cached_entries } }"}'
```

Interactive docs:

```bash
http://localhost:3000/docs
http://localhost:3000/docs/graphql-guide
http://localhost:3001/login
```

If your shell does not support line continuations in that form, run the same command on one line.

## Local scripts

If `python` points to Python 3 on your machine, use `python`. On Windows, `py -3` is also fine.

Install the only local script dependency:

```bash
python -m pip install httpx
```

### Seed sample data

```bash
python backend/scripts/seed.py
```

This script:

1. Queues a background ingest job
2. Waits for ingest completion
3. Runs a direct query against `rag-service`
4. Repeats the query to confirm cache behavior
5. Calls the GraphQL API

### Run the automated smoke test

```bash
python backend/scripts/smoke_test.py
```

This verifies:

1. RAG health
2. document ingest
3. direct query cache miss followed by cache hit
4. duplicate ingest skipping
5. metadata-filtered retrieval
6. GraphQL cache and metrics queries
7. admin visibility queries
8. BFF `ask(...)`
9. tenant isolation
10. SSE streaming passthrough

### Run the evaluation script

```bash
python backend/scripts/evaluate.py
```

This ingests an isolated evaluation dataset and checks answer grounding, citations, source isolation, and cache behavior.

## Tests

### Unit tests

```bash
python -m unittest discover -s backend/rag-service/tests -v
```

### BFF tests

```bash
cd backend/bff
npm test
```

### Frontend typecheck

```bash
cd frontend
npm run typecheck
```

### Live integration wrapper

This requires the Docker stack to already be running.

macOS/Linux:

```bash
RUN_LIVE_STACK_TESTS=1 python -m unittest discover -s backend/tests -p "test_smoke_integration.py" -v
```

Windows PowerShell:

```powershell
$env:RUN_LIVE_STACK_TESTS="1"
python -m unittest discover -s backend/tests -p "test_smoke_integration.py" -v
```

Windows Command Prompt:

```cmd
set RUN_LIVE_STACK_TESTS=1
python -m unittest discover -s backend/tests -p "test_smoke_integration.py" -v
```

## Environment variables

The stack is configured in `docker-compose.yml` and loaded from `.env`.

Before your first local run:

```bash
cp .env.example .env
```

Keep real secrets only in `.env` or a secret manager. The checked-in `.env.example` must stay placeholder-only.

### `rag-service`

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://admin:change-me-local-postgres-password@postgres:5432/bff_rag` | Async PostgreSQL connection |
| `REDIS_URL` | `redis://redis:6379` | Redis connection |
| `OLLAMA_URL` | `http://ollama:11434` | Ollama base URL |
| `EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `LLM_MODEL` | `llama3.1:8b` | Chat model |
| `EMBED_DIMS` | `768` | Embedding dimensions |
| `CACHE_THRESHOLD` | `0.92` | Semantic cache similarity threshold |
| `CACHE_TTL` | `3600` | Cache TTL in seconds |
| `TOP_K_RETRIEVE` | `20` | ANN candidates from pgvector |
| `TOP_K_RERANK` | `5` | Final reranked chunks |
| `INGEST_JOB_TTL` | `3600` | Retention for finished ingest jobs |

### `bff`

| Variable | Default | Description |
|---|---|---|
| `RAG_SERVICE_URL` | `http://rag-service:8000` | Internal RAG service URL |
| `REDIS_URL` | `redis://redis:6379` | Redis connection |
| `JWT_SECRET` | `change-me-local-dev-jwt-secret` | JWT signing key |
| `NODE_ENV` | `development` | Runtime mode |
| `HTTP_BODY_LIMIT` | `10mb` | Max JSON/form body accepted by the BFF, including GraphQL file-ingest payloads |
| `FRONTEND_ORIGIN` | `http://localhost:3001` | Allowed browser origin for BFF CORS responses |
| `QUERY_RATE_LIMIT_MAX` | `30` | Query limit per window |
| `QUERY_RATE_LIMIT_WINDOW_MS` | `60000` | Query window duration |
| `STREAM_RATE_LIMIT_MAX` | `10` | Streaming limit per window |
| `STREAM_RATE_LIMIT_WINDOW_MS` | `60000` | Streaming window duration |
| `HISTORY_RATE_LIMIT_MAX` | `30` | History limit per window |
| `HISTORY_RATE_LIMIT_WINDOW_MS` | `60000` | History window duration |
| `ADMIN_RATE_LIMIT_MAX` | `20` | Admin limit per window |
| `ADMIN_RATE_LIMIT_WINDOW_MS` | `60000` | Admin window duration |

### `frontend`

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_BFF_URL` | `http://localhost:3000` | Browser-visible BFF base URL used by the Next.js UI |

## UI flow

Open the local browser workspace at:

```text
http://localhost:3001/login
```

Recommended happy path:

1. Mint a local admin token.
2. Go to `/admin/ingest` and upload a `.txt`, `.md`, or `.pdf`.
3. Wait for the GraphQL job monitor to reach `completed`.
4. Go to `/chat` and run `ask(...)` for citations.
5. Use `Stream answer` to validate the SSE bridge.
6. Open `/admin/overview` to inspect metrics, chunks, and recent history.

## Authentication and local development behavior

`/auth/token` accepts optional roles:

```json
{
  "user_id": "00000000-0000-0000-0000-000000000001",
  "tenant_id": "default",
  "roles": ["user", "admin"]
}
```

In `development`, the local fallback user is enabled when no token is provided.

Demo user:

- `user_id`: `00000000-0000-0000-0000-000000000001`
- `tenant_id`: `default`
- `roles`: `user`, `admin`

Admin GraphQL operations require the `admin` role in non-fallback scenarios.

## Useful API checks

### Query the RAG service directly

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","tenant_id":"default","query":"payment terms","stream":false}'
```

### Query with metadata filters

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","tenant_id":"default","query":"payment terms","stream":false,"source":"seed","title_contains":"Payment Terms"}'
```

### Cache stats

```bash
curl http://localhost:8000/cache/stats
```

### Metrics summary

```bash
curl http://localhost:8000/metrics/summary
```

### Admin overview

```bash
curl "http://localhost:8000/admin/overview?user_id=00000000-0000-0000-0000-000000000001&tenant_id=default"
```

### Stored chunks

```bash
curl "http://localhost:8000/admin/chunks?user_id=00000000-0000-0000-0000-000000000001&tenant_id=default&limit=5&source=seed&title_contains=Payment%20Terms"
```

### Issue a local JWT token

```bash
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","tenant_id":"default"}'
```

### Query GraphQL

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ cacheStats { cached_entries } metricsSummary { total_queries cache_hits cache_misses } }"}'
```

### Queue admin ingest through GraphQL

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation AdminIngest($input: AdminIngestInput!) { adminIngest(input: $input) { job_id status } }","variables":{"input":{"source":"manual-upload","documents":[{"title":"Payment Terms","content":"Invoices are due within 30 days.","category":"billing","metadata_json":"{\"region\":\"global\"}"}],"files":[{"filename":"policy.md","title":"Policy","category":"billing","content_base64":"IyBQb2xpY3kKSW52b2ljZXMgYXJlIGR1ZSB3aXRoaW4gMzAgZGF5cy4=","content_type":"text/markdown","metadata_json":"{\"origin\":\"upload\"}"}]}}}'
```

The GraphQL boundary uses `metadata_json` strings. The BFF parses them into JSON objects before forwarding the request to `rag-service`.

### Stream through the BFF

```bash
curl -N "http://localhost:3000/rag/stream?query=payment%20terms&source=seed&title_contains=Payment%20Terms"
```

## Logs

All services:

```bash
docker compose logs -f
```

Specific services:

```bash
docker compose logs -f rag-service
docker compose logs -f bff
docker compose logs ollama-setup
```

Look for:

```text
Models ready
```

## Rebuild a single service

RAG service:

```bash
docker compose up --build rag-service
```

BFF:

```bash
docker compose up --build bff
```

## Stop or reset the environment

Stop containers:

```bash
docker compose down
```

Remove containers and volumes:

```bash
docker compose down -v
```

This deletes local PostgreSQL data, Redis state, and persisted Ollama model data.

## Recommended verification flow

After significant changes:

1. `docker compose ps`
2. `bash backend/scripts/scan_secrets.sh --all`
3. `curl http://localhost:8000/health`
4. `python backend/scripts/seed.py`
5. `python backend/scripts/smoke_test.py`
6. `python -m unittest discover -s backend/rag-service/tests -v`
7. `(cd backend/bff && npm test)`

Before commit, scan staged changes only:

```bash
bash backend/scripts/scan_secrets.sh --staged
```

Before commit, validate these checks manually:

- `backend/scripts/scan_secrets.sh --staged`
- `bff` test suite
- `rag-service` test suite

Use the Python command that is valid on your machine, such as `python`, `python3`, or Windows `py -3`.

If you want to validate tenant isolation manually:

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","tenant_id":"other-tenant","query":"payment terms","stream":false}'
```

The response should come back with an empty `chunks_used` list.

## Common issues

### `rag-service` is unhealthy

Possible causes:

- Ollama is still downloading models
- PostgreSQL is not ready
- Redis is not ready

Check:

```bash
docker compose ps
docker compose logs rag-service
docker compose logs ollama-setup
```

### First startup is very slow

This is expected. The stack downloads images and models on the first run.

### GraphQL is not responding

```bash
docker compose logs bff
```

### Cache never hits

Check:

- the first query finished successfully
- the second query is semantically similar enough
- Redis is healthy
- `CACHE_THRESHOLD` is not too strict

### Answers are missing context

Check:

- `python backend/scripts/seed.py` has been run
- the request uses `tenant_id=default`
- the request uses the demo user or an equivalent seeded user

## Key files

- [docker-compose.yml](./docker-compose.yml)
- [backend/scripts/init.sql](./backend/scripts/init.sql)
- [backend/scripts/seed.py](./backend/scripts/seed.py)
- [backend/scripts/smoke_test.py](./backend/scripts/smoke_test.py)
- [backend/scripts/evaluate.py](./backend/scripts/evaluate.py)
- [backend/rag-service/main.py](./backend/rag-service/main.py)
- [backend/rag-service/rag_service/app.py](./backend/rag-service/rag_service/app.py)
- [backend/bff/src/app.module.ts](./backend/bff/src/app.module.ts)
- [backend/bff/src/auth/auth.module.ts](./backend/bff/src/auth/auth.module.ts)
- [backend/bff/src/rag/rag.module.ts](./backend/bff/src/rag/rag.module.ts)
