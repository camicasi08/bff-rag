# Intelligent BFF with Contextual RAG

This repository contains a local two-service stack for answering user questions with contextual RAG:

- `bff/`: GraphQL gateway built with NestJS
- `rag-service/`: RAG pipeline built with FastAPI
- `postgres`: conversation history and vector store via `pgvector`
- `redis`: semantic cache
- `ollama`: local embedding and generation runtime

The project is intended to run end-to-end with Docker Compose.

## Architecture

### Services

| Service | Port | Responsibility |
|---|---:|---|
| `bff` | `3000` | GraphQL API, JWT auth, and bridge to the RAG service |
| `rag-service` | `8000` | embeddings, retrieval, reranking, prompt building, and answer generation |
| `postgres` | `5432` | users, history, and vectorized document chunks |
| `redis` | `6379` | semantic cache |
| `ollama` | `11434` | local models for embeddings and chat |

### High-level flow

1. The client sends a GraphQL request to the `bff`.
2. The `bff` resolves authentication and calls the `rag-service`.
3. The `rag-service`:
   - embeds the query
   - checks the semantic cache in Redis
   - retrieves chunks from PostgreSQL/pgvector
   - reranks the results
   - builds a prompt with recent history
   - calls Ollama
   - persists the conversation and updates the cache

## Requirements

Before starting the project, make sure you have:

- Docker Desktop installed and running
- Docker Compose available as `docker compose`
- At least `10 GB` of free disk space
- A stable network connection for the first startup

### Important first-run note

The first run downloads container images and Ollama models. That can take several minutes and several GB.

Models used:

- `nomic-embed-text`
- `llama3.1:8b`

## Repository structure

```text
bff-rag/
├── README.md
├── AGENTS.md
├── docker-compose.yml
├── scripts/
│   ├── init.sql
│   └── seed.py
├── rag-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py
└── bff/
    ├── Dockerfile
    ├── package.json
    ├── nest-cli.json
    ├── tsconfig.json
    └── src/
        ├── main.ts
        ├── app.module.ts
        ├── auth/
        │   └── auth.module.ts
        └── rag/
            └── rag.module.ts
```

## Environment variables

This project uses environment variables defined directly in `docker-compose.yml`.

### `rag-service`

| Variable | Default value |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://admin:secret@postgres:5432/bff_rag` |
| `REDIS_URL` | `redis://redis:6379` |
| `OLLAMA_URL` | `http://ollama:11434` |
| `EMBED_MODEL` | `nomic-embed-text` |
| `LLM_MODEL` | `llama3.1:8b` |
| `EMBED_DIMS` | `768` |
| `CACHE_THRESHOLD` | `0.92` |
| `CACHE_TTL` | `3600` |
| `TOP_K_RETRIEVE` | `20` |
| `TOP_K_RERANK` | `5` |
| `INGEST_JOB_TTL` | `3600` |

### `bff`

| Variable | Default value |
|---|---|
| `RAG_SERVICE_URL` | `http://rag-service:8000` |
| `REDIS_URL` | `redis://redis:6379` |
| `JWT_SECRET` | `local-dev-secret-change-in-prod` |
| `NODE_ENV` | `development` |
| `QUERY_RATE_LIMIT_MAX` | `30` |
| `QUERY_RATE_LIMIT_WINDOW_MS` | `60000` |
| `STREAM_RATE_LIMIT_MAX` | `10` |
| `STREAM_RATE_LIMIT_WINDOW_MS` | `60000` |
| `HISTORY_RATE_LIMIT_MAX` | `30` |
| `HISTORY_RATE_LIMIT_WINDOW_MS` | `60000` |
| `ADMIN_RATE_LIMIT_MAX` | `20` |
| `ADMIN_RATE_LIMIT_WINDOW_MS` | `60000` |

## How to start the project

### 1. Start the full platform

From the repository root:

```powershell
docker compose up --build
```

If you want to keep it running in the background:

```powershell
docker compose up --build -d
```

### 2. Wait for services to become healthy

Check container status:

```powershell
docker compose ps
```

You should see at least these services running:

- `bff_gateway`
- `bff_rag_service`
- `bff_postgres`
- `bff_redis`
- `bff_ollama`

The `ollama-setup` container should exit successfully. Its job is to download models and stop.

### 3. Confirm basic health

#### RAG service

```powershell
curl.exe -s http://localhost:8000/health
```

Expected response:

```json
{"status":"ok","model":"llama3.1:8b"}
```

#### GraphQL

```powershell
curl.exe -s http://localhost:3000/graphql `
  -X POST `
  -H "Content-Type: application/json" `
  -d "{\"query\":\"{ cacheStats { cached_entries } }\"}"
```

Expected response:

```json
{
  "data": {
    "cacheStats": {
      "cached_entries": 0
    }
  }
}
```

## Seeding sample data

The project includes a script that ingests sample documents and then tests query + cache behavior.

### 1. Install `httpx` locally if you want to run the script outside Docker

```powershell
py -3 -m pip install httpx
```

### 2. Run the seed script

```powershell
py -3 scripts/seed.py
```

That script does the following:

1. Queues sample documents via `POST /admin/ingest/jobs`
2. Polls the background ingest job until it completes
3. Executes a query against the `rag-service`
4. Executes the same query a second time to validate cache behavior
5. Queries the `bff` GraphQL endpoint

## Auth and admin controls

`/auth/token` now accepts optional `roles`, for example:

```json
{
  "user_id": "00000000-0000-0000-0000-000000000001",
  "tenant_id": "default",
  "roles": ["user", "admin"]
}
```

Admin GraphQL operations such as `adminOverview` and `adminChunks` require the `admin` role. In `development`, the local fallback user still includes `admin` so the default smoke flow keeps working.

## Automated smoke test

For a repeatable validation run with assertions, use the dedicated smoke test script:

```powershell
py -3 scripts/smoke_test.py
```

This script verifies:

1. RAG health
2. document ingest
3. first direct query is a cache miss
4. second direct query is a cache hit
5. duplicate ingest is skipped
6. metadata-filtered retrieval works
7. GraphQL `cacheStats`
8. GraphQL `metricsSummary`
9. GraphQL admin visibility queries
10. GraphQL `ask(...)` through the BFF
11. tenant isolation with a wrong-tenant query
12. BFF SSE streaming passthrough

## Test suite

The repository now includes:

- unit tests for `rag-service` helpers
- an integration-style test wrapper around the live smoke test
- a lightweight GitHub Actions CI workflow
- a live evaluation script for grounding and cache checks

### Run unit tests

```powershell
py -3 -m unittest discover -s rag-service/tests -v
```

### Run the live integration smoke test

This requires the Docker stack to already be running:

```powershell
$env:RUN_LIVE_STACK_TESTS="1"
py -3 -m unittest tests.test_smoke_integration -v
```

If you only want the direct smoke script:

```powershell
py -3 scripts/smoke_test.py
```

### Run the evaluation script

This requires the Docker stack to already be running:

```powershell
py -3 scripts/evaluate.py
```

The evaluation script:

1. ingests a small isolated evaluation dataset through the background ingest job API
2. runs repeated grounded queries against the live RAG service
3. verifies citations, source isolation, answer keywords, and cache-hit behavior

## CI

The repository now includes a GitHub Actions workflow at `.github/workflows/ci.yml`.

It runs:

1. `rag-service` unit tests
2. `bff` build validation
3. `docker compose config` validation

That keeps CI fast while the heavier live-stack smoke and evaluation scripts remain available for local verification.

## Useful manual checks

### Query the RAG service directly

```powershell
curl.exe -s http://localhost:8000/query `
  -X POST `
  -H "Content-Type: application/json" `
  -d "{\"user_id\":\"00000000-0000-0000-0000-000000000001\",\"tenant_id\":\"default\",\"query\":\"payment terms\",\"stream\":false}"
```

### Query the RAG service with metadata filters

```powershell
curl.exe -s http://localhost:8000/query `
  -X POST `
  -H "Content-Type: application/json" `
  -d "{\"user_id\":\"00000000-0000-0000-0000-000000000001\",\"tenant_id\":\"default\",\"query\":\"payment terms\",\"stream\":false,\"source\":\"seed\",\"category\":\"billing\",\"title_contains\":\"Payment Terms\"}"
```

### Check cache stats

```powershell
curl.exe -s http://localhost:8000/cache/stats
```

### Check RAG metrics summary

```powershell
curl.exe -s http://localhost:8000/metrics/summary
```

### Inspect admin overview directly

```powershell
curl.exe -s "http://localhost:8000/admin/overview?user_id=00000000-0000-0000-0000-000000000001&tenant_id=default"
```

### Inspect stored chunks directly

```powershell
curl.exe -s "http://localhost:8000/admin/chunks?user_id=00000000-0000-0000-0000-000000000001&tenant_id=default&limit=5&source=seed&category=billing&title_contains=Payment%20Terms"
```

### Issue a local JWT token

```powershell
curl.exe -s http://localhost:3000/auth/token `
  -X POST `
  -H "Content-Type: application/json" `
  -d "{\"user_id\":\"00000000-0000-0000-0000-000000000001\",\"tenant_id\":\"default\"}"
```

### Query GraphQL with authentication

First generate a token, then run:

```powershell
curl.exe -s http://localhost:3000/graphql `
  -X POST `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_TOKEN" `
  -d "{\"query\":\"{ ask(query: \\\"payment terms\\\", filters: { source: \\\"seed\\\", category: \\\"billing\\\", title_contains: \\\"Payment Terms\\\" }) { answer cache_hit chunks_used history_used citations { title source excerpt } } }\"}"
```

### Stream a response through the BFF

```powershell
curl.exe -N "http://localhost:3000/rag/stream?query=payment%20terms&source=seed&category=billing&title_contains=Payment%20Terms"
```

That endpoint relays Server-Sent Events from the `rag-service` through the BFF. You should see `data:` token events followed by `event: done`.

### Query metrics and admin visibility through GraphQL

```powershell
curl.exe -s http://localhost:3000/graphql `
  -X POST `
  -H "Content-Type: application/json" `
  -d "{\"query\":\"{ metricsSummary { total_queries cache_hits cache_misses cache_hit_rate total_ingest_requests total_chunks_ingested skipped_duplicates } adminOverview { cached_entries total_chunks total_conversations } adminChunks(limit: 5, filters: { source: \\\"seed\\\", category: \\\"billing\\\", title_contains: \\\"Payment Terms\\\" }) { source title category excerpt } }\"}"
```

### Development mode behavior

In `development`, the `JwtGuard` allows the demo user to be used even when no token is provided.

Demo user:

- `user_id`: `00000000-0000-0000-0000-000000000001`
- `tenant_id`: `default`
- `roles`: `user`, `admin`

## Viewing logs

### All services

```powershell
docker compose logs -f
```

### Only `rag-service`

```powershell
docker compose logs -f rag-service
```

### Only `bff`

```powershell
docker compose logs -f bff
```

### Only `ollama-setup`

```powershell
docker compose logs ollama-setup
```

Look for this line:

```text
Models ready
```

## Rebuild a single service

### Python changes

```powershell
docker compose up --build rag-service
```

### NestJS changes

```powershell
docker compose up --build bff
```

## Stop or clean the environment

### Stop containers

```powershell
docker compose down
```

### Stop and remove volumes

This removes local database data, cache contents, and persisted model volumes:

```powershell
docker compose down -v
```

## Validation checklist

After significant changes, use this sequence:

### 1. Container status

```powershell
docker compose ps
```

### 2. RAG health

```powershell
curl.exe -s http://localhost:8000/health
```

### 3. Seed sample data

```powershell
py -3 scripts/seed.py
```

### 4. Run the automated smoke test

```powershell
py -3 scripts/smoke_test.py
```

### 5. Confirm semantic cache behavior manually if needed

```powershell
curl.exe -s http://localhost:8000/query `
  -X POST `
  -H "Content-Type: application/json" `
  -d "{\"user_id\":\"00000000-0000-0000-0000-000000000001\",\"tenant_id\":\"default\",\"query\":\"payment terms\",\"stream\":false}"
```

On the second execution, `cache_hit` should be `true`.

### 6. Confirm GraphQL

```powershell
curl.exe -s http://localhost:3000/graphql `
  -X POST `
  -H "Content-Type: application/json" `
  -d "{\"query\":\"{ cacheStats { cached_entries } }\"}"
```

### 7. Confirm tenant RLS behavior

```powershell
curl.exe -s http://localhost:8000/query `
  -X POST `
  -H "Content-Type: application/json" `
  -d "{\"user_id\":\"00000000-0000-0000-0000-000000000001\",\"tenant_id\":\"other-tenant\",\"query\":\"payment terms\",\"stream\":false}"
```

`chunks_used` should come back empty.

## Common issues

### `rag-service` does not start

Possible causes:

- Ollama has not finished downloading models yet
- PostgreSQL is not healthy
- Redis is not available

What to check:

```powershell
docker compose ps
docker compose logs rag-service
docker compose logs ollama-setup
```

### `ollama-setup` takes a long time

This is normal on the first run. It is downloading large models.

### GraphQL does not respond

Check:

```powershell
docker compose logs bff
```

### Cache never hits

Check:

- that the first query completed successfully
- that Redis is healthy
- that the second query is equivalent
- the `CACHE_THRESHOLD` value

### Results do not include context

Check:

- that you ran `scripts/seed.py`
- that `tenant_id` is `default`
- that the request uses the correct demo user

## Key files

- [docker-compose.yml](./docker-compose.yml)
- [scripts/init.sql](./scripts/init.sql)
- [scripts/seed.py](./scripts/seed.py)
- [rag-service/main.py](./rag-service/main.py)
- [bff/src/app.module.ts](./bff/src/app.module.ts)
- [bff/src/auth/auth.module.ts](./bff/src/auth/auth.module.ts)
- [bff/src/rag/rag.module.ts](./bff/src/rag/rag.module.ts)

## Current status

The Docker composition has already been validated, and the stack has been brought up at least once with:

```powershell
docker compose up --build -d
```

If you want to restart from a clean run:

```powershell
docker compose down
docker compose up --build
```
