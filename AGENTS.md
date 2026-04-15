# AGENTS.md — Intelligent BFF with Contextual RAG

This file instructs Codex (or any AI coding agent) on how to understand, build,
extend, and verify this project. Read it fully before making any changes.

---

## Project overview

A production-grade Backend for Frontend (BFF) that injects user context into every
LLM response via a RAG pipeline. Two microservices communicate internally via HTTP:

- **BFF Gateway** (`/bff`) — NestJS + TypeScript. Owns GraphQL schema, JWT auth,
  rate limiting, and SSE streaming to clients.
- **RAG Service** (`/rag-service`) — FastAPI + Python. Owns the full retrieval
  pipeline: embedding, ANN search, cross-encoder reranking, prompt construction,
  and LLM calls.

Local infrastructure (Docker Compose):

| Service    | Image                    | Port  | Role                              |
|------------|--------------------------|-------|-----------------------------------|
| postgres   | pgvector/pgvector:pg16   | 5432  | Vector store + conversation history |
| redis      | redis:7-alpine           | 6379  | Semantic cache + rate limiting    |
| ollama     | ollama/ollama:latest     | 11434 | LLM (llama3.1:8b) + embeddings    |
| rag-service| ./rag-service            | 8000  | FastAPI RAG pipeline              |
| bff        | ./bff                    | 3000  | NestJS GraphQL gateway            |

---

## Repository structure

```
bff-rag/
├── AGENTS.md                   ← you are here
├── docker-compose.yml
├── scripts/
│   ├── init.sql                PostgreSQL schema, pgvector, RLS policies
│   └── seed.py                 Ingest sample docs + run smoke queries
├── rag-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py                 Single-file FastAPI app (all pipeline logic)
└── bff/
    ├── Dockerfile
    ├── package.json
    ├── nest-cli.json
    ├── tsconfig.json
    └── src/
        ├── main.ts
        ├── app.module.ts
        ├── auth/
        │   └── auth.module.ts  JwtGuard + /auth/token REST endpoint
        └── rag/
            └── rag.module.ts   GraphQL resolver + RagService (calls FastAPI)
```

---

## How to build and run

### Full stack (recommended)

```bash
docker compose up --build
```

Wait for all health checks to pass — `ollama-setup` logs `Models ready` when done
(first run: ~10 min, ~6 GB download).

### Verify services

```bash
curl http://localhost:8000/health          # {"status":"ok","model":"llama3.1:8b"}
curl http://localhost:3000/graphql \
  -X POST -H "Content-Type: application/json" \
  -d '{"query":"{ cacheStats { cached_entries } }"}'
```

### Seed sample data

```bash
pip install httpx
python scripts/seed.py
```

### Rebuild a single service after code changes

```bash
docker compose up --build rag-service     # Python changes
docker compose up --build bff             # TypeScript changes
```

---

## Environment variables

All variables are set in `docker-compose.yml`. Do not hardcode them in source files.
When adding a new variable, add it to both the `environment` block in
`docker-compose.yml` and to the `Settings` class in `rag-service/main.py`
(or the NestJS config if it belongs to the BFF).

### RAG service (`rag-service`)

| Variable          | Default              | Description                                   |
|-------------------|----------------------|-----------------------------------------------|
| DATABASE_URL      | postgresql+asyncpg://admin:secret@postgres:5432/bff_rag | Async SQLAlchemy URL |
| REDIS_URL         | redis://redis:6379   | Redis connection string                       |
| OLLAMA_URL        | http://ollama:11434  | Ollama base URL                               |
| EMBED_MODEL       | nomic-embed-text     | Ollama embedding model (must output 768 dims) |
| LLM_MODEL         | llama3.1:8b          | Ollama chat model                             |
| EMBED_DIMS        | 768                  | Vector dimensions — must match pgvector index |
| CACHE_THRESHOLD   | 0.92                 | Cosine similarity threshold for cache hit     |
| CACHE_TTL         | 3600                 | Semantic cache TTL in seconds                 |
| TOP_K_RETRIEVE    | 20                   | Candidates retrieved from pgvector            |
| TOP_K_RERANK      | 5                    | Final chunks after cross-encoder reranking    |

### BFF gateway (`bff`)

| Variable        | Default                          | Description              |
|-----------------|----------------------------------|--------------------------|
| RAG_SERVICE_URL | http://rag-service:8000          | Internal RAG service URL |
| REDIS_URL       | redis://redis:6379               | Redis connection string  |
| JWT_SECRET      | local-dev-secret-change-in-prod  | JWT signing secret       |
| NODE_ENV        | development                      | NestJS environment       |

---

## RAG pipeline — execution order

When a query arrives at `POST /query` in `rag-service/main.py`, the pipeline runs
in this exact order. When modifying any step, preserve the sequence:

```
1. embed(query)
       ↓  768-dim L2-normalized vector via Ollama nomic-embed-text
2. cache_lookup(query_emb)
       ↓  cosine similarity against Redis semcache:* keys
       → HIT (sim ≥ CACHE_THRESHOLD): return cached response immediately
       → MISS: continue
3. retrieve(query_emb, user_id, tenant_id)
       ↓  pgvector IVFFlat ANN, filtered by user_id + tenant_id, top-20
4. rerank(query, candidates)
       ↓  cross-encoder ms-marco-MiniLM-L-6-v2, top-20 → top-5
5. get_history(user_id, tenant_id)
       ↓  last 6 turns from PostgreSQL conversations table
6. build_prompt(query, top_chunks, history)
       ↓  system instruction + context chunks + history + user query
7. llm_stream(messages) or llm_complete(messages)
       ↓  Ollama llama3.1:8b, SSE streaming or blocking
8. cache_store(query_emb, response)
       ↓  store embedding bytes + response text in Redis, TTL=CACHE_TTL
9. save_turn(user_id, tenant_id, role, content)  ×2
       ↓  persist user turn and assistant turn to PostgreSQL
```

---

## Database schema

Defined in `scripts/init.sql`. Do not alter table structures without updating
both the SQL file and any raw `text()` queries in `rag-service/main.py`.

### Key tables

**`document_chunks`** — stores text chunks with their 768-dim embeddings.
- `embedding vector(768)` — indexed with IVFFlat (`vector_cosine_ops`, lists=100)
- Row Level Security policy `tenant_chunks` filters by `app.tenant_id` setting
- Always set `SET app.tenant_id = :tid` before querying this table

**`conversations`** — append-only conversation history per user.
- Ordered by `created_at DESC`, fetch last N turns and reverse for chronological order
- Row Level Security policy `tenant_conversations` applies the same tenant filter

**`users`** — user profiles with preferences JSONB.
- Demo user seeded: `id = 00000000-0000-0000-0000-000000000001`

**`audit_log`** — append-only, no RLS, never update or delete rows.

### Vector format for pgvector

When inserting or querying, format vectors as a bracketed comma-separated string:
```python
vec_str = "[" + ",".join(f"{v:.6f}" for v in emb.tolist()) + "]"
# then use :vec::vector in the SQL
```

---

## Coding conventions

### Python (rag-service)

- All I/O is async. Use `async def` and `await` throughout.
- Database sessions come from `state.session()` — always use as async context manager.
- Never use `Session` (sync). Always `AsyncSession`.
- HTTP calls use `state.http` (`httpx.AsyncClient`) — never create a new client per request.
- The reranker (`state.reranker`) is a module-level singleton loaded at startup in `lifespan`.
  Do not reload it per request.
- Pydantic `BaseModel` for all request/response schemas.
- Settings come from `pydantic_settings.BaseSettings` — never use `os.environ.get()` directly.
- Error handling: raise `HTTPException` with appropriate status codes. Do not swallow exceptions.

### TypeScript (bff)

- All NestJS modules use the standard `@Module` / `@Injectable` / `@Resolver` decorator pattern.
- GraphQL types use code-first approach (`@ObjectType`, `@Field`, `@InputType`).
- All HTTP calls to the RAG service go through `RagService` — never call the RAG service
  directly from a resolver.
- JWT auth is handled by `JwtGuard`. Apply `@UseGuards(JwtGuard)` to every resolver
  or controller method that requires authentication.
- In local dev, `JwtGuard` falls back to the demo user when no token is provided —
  do not remove this fallback.
- Never import from `'../../auth'` across module boundaries — use the exported `JwtGuard`
  from `AuthModule`.

### General

- No secrets or credentials in source files — use environment variables only.
- All new API endpoints must have a corresponding entry in `scripts/seed.py` or
  a dedicated test script.
- When adding a new Ollama model, also add the `ollama pull <model>` command to the
  `ollama-setup` service entrypoint in `docker-compose.yml`.

---

## How to add a new feature

### Add a new GraphQL query or mutation

1. Define the return type with `@ObjectType()` in `bff/src/rag/rag.module.ts`
2. Add the method to `RagService` — it must call the RAG service via `this.http`
3. Add the resolver method decorated with `@Query()` or `@Mutation()`
4. Add the corresponding FastAPI endpoint in `rag-service/main.py`
5. Add a test call in `scripts/seed.py`

### Add a new RAG pipeline step

1. Implement it as a standalone `async def` function in `rag-service/main.py`
2. Insert it in the correct position in the `query()` route handler
3. Document the step in the pipeline execution order section of this file
4. Add the relevant environment variable to `Settings` if it has a tunable parameter

### Add a new database table

1. Add the `CREATE TABLE` statement to `scripts/init.sql`
2. Add the index and RLS policy if the table contains per-tenant data
3. Rebuild the postgres container to apply: `docker compose up --build postgres`
   (or connect and run the SQL manually: `docker exec -it bff_postgres psql -U admin -d bff_rag`)

### Change the embedding model

The embedding dimensions must stay consistent with the pgvector index.
If changing to a model with different dimensions:

1. Update `EMBED_MODEL` and `EMBED_DIMS` in `docker-compose.yml`
2. Update the `vector(768)` type in `scripts/init.sql` to the new dimension
3. Drop and recreate the `idx_chunks_embedding` index
4. Re-ingest all documents (the existing embeddings are incompatible)

---

## Verification checklist

Run these checks after any significant change before committing:

```bash
# 1. All containers healthy
docker compose ps

# 2. RAG service health
curl -sf http://localhost:8000/health | python -m json.tool

# 3. Ingest + query smoke test
python scripts/seed.py

# 4. Semantic cache is working (second query should show cache_hit=true)
curl -s -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","tenant_id":"default","query":"payment terms","stream":false}' \
  | python -m json.tool

# 5. GraphQL endpoint responds
curl -s http://localhost:3000/graphql \
  -X POST -H "Content-Type: application/json" \
  -d '{"query":"{ cacheStats { cached_entries } }"}' \
  | python -m json.tool

# 6. RLS is enforced (query with wrong tenant should return no chunks)
curl -s -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","tenant_id":"other-tenant","query":"payment terms","stream":false}' \
  | python -m json.tool
# chunks_used should be []
```

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `rag-service` unhealthy at startup | Ollama not ready yet | Wait 30s, run `docker compose restart rag-service` |
| `pgvector` ANN error on first query | IVFFlat index needs ≥1 row | Run `python scripts/seed.py` before querying |
| Embedding call returns 400 | Model not pulled in Ollama | `docker exec bff_ollama ollama pull nomic-embed-text` |
| LLM response very slow (>30s) | CPU inference, expected | Switch to `llama3.2:3b` for faster local responses |
| GraphQL `Cannot return null for field` | Missing `@Field()` decorator | Add `@Field()` to every property of the `@ObjectType` class |
| Redis cache never hits | Threshold too strict or TTL expired | Lower `CACHE_THRESHOLD` to `0.88` or increase `CACHE_TTL` |
| `SET app.tenant_id` error | RLS not configured | Ensure `init.sql` ran — recreate the postgres container |

---

## Out of scope for this local setup

These production concerns are intentionally omitted to keep the local stack simple.
Do not implement them here — they belong in the cloud deployment:

- HyDE query expansion (requires a second LLM call before embedding)
- Hybrid BM25 + dense search (requires a sparse index)
- Pub/Sub queue for traffic spike buffering
- OpenTelemetry distributed tracing
- Per-tenant LoRA adapter loading
- GPU-accelerated reranking (GKE T4 node pool)
- CDN edge caching
- Terraform infrastructure provisioning
