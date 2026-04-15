import asyncio
import base64
import datetime as dt
import hashlib
import json
import logging
import struct
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx
import numpy as np
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

try:
    from sentence_transformers import CrossEncoder
except Exception:  # pragma: no cover
    CrossEncoder = None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str = "postgresql+asyncpg://admin:secret@postgres:5432/bff_rag"
    redis_url: str = "redis://redis:6379"
    ollama_url: str = "http://ollama:11434"
    embed_model: str = "nomic-embed-text"
    llm_model: str = "llama3.1:8b"
    embed_dims: int = 768
    cache_threshold: float = 0.92
    cache_ttl: int = 3600
    top_k_retrieve: int = 20
    top_k_rerank: int = 5
    ingest_job_ttl: int = 3600


settings = Settings()
logger = logging.getLogger("rag-service")
logging.basicConfig(level=logging.INFO, format="%(message)s")


class AppState:
    session: async_sessionmaker[AsyncSession]
    redis: redis.Redis
    http: httpx.AsyncClient
    reranker: Any
    metrics: dict[str, int]
    ingest_queue: asyncio.Queue[str]
    ingest_jobs: dict[str, "IngestJobStatusResponse"]
    ingest_payloads: dict[str, "IngestRequest"]
    ingest_worker_task: asyncio.Task[None]


state = AppState()


class DocumentIn(BaseModel):
    title: str
    content: str
    category: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class IngestRequest(BaseModel):
    user_id: str
    tenant_id: str
    source: str = "manual"
    documents: list[DocumentIn]


class QueryRequest(BaseModel):
    user_id: str
    tenant_id: str
    query: str = Field(min_length=1)
    stream: bool = False
    source: str | None = None
    category: str | None = None
    title_contains: str | None = None


class Citation(BaseModel):
    chunk_id: str
    source: str
    title: str
    chunk_index: int
    excerpt: str


class HistoryTurn(BaseModel):
    role: str
    content: str
    created_at: str


class QueryResponse(BaseModel):
    answer: str
    cache_hit: bool
    chunks_used: list[str]
    history_used: int
    citations: list[Citation]


class HistoryResponse(BaseModel):
    turns: list[HistoryTurn]


class CacheStatsResponse(BaseModel):
    cached_entries: int


class ErrorResponse(BaseModel):
    error: str
    detail: str
    request_id: str


class MetricsSummaryResponse(BaseModel):
    total_queries: int
    cache_hits: int
    cache_misses: int
    cache_hit_rate: float
    total_ingest_requests: int
    total_chunks_ingested: int
    skipped_duplicates: int


class AdminChunkResponse(BaseModel):
    chunk_id: str
    source: str
    title: str
    category: str | None = None
    chunk_index: int
    excerpt: str
    created_at: str
    content_hash: str | None = None


class AdminOverviewResponse(BaseModel):
    metrics: MetricsSummaryResponse
    cached_entries: int
    total_chunks: int
    total_conversations: int


class IngestJobQueuedResponse(BaseModel):
    job_id: str
    status: str


class IngestJobStatusResponse(BaseModel):
    job_id: str
    status: str
    user_id: str
    tenant_id: str
    source: str
    submitted_at: str
    started_at: str | None = None
    finished_at: str | None = None
    inserted_chunks: int = 0
    skipped_duplicates: int = 0
    error: str | None = None


def filter_signature(source: str | None, category: str | None, title_contains: str | None) -> str:
    return json.dumps(
        {
            "source": source,
            "category": category,
            "title_contains": title_contains,
        },
        sort_keys=True,
    )


def log_event(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    logger.info(json.dumps(payload, default=str))


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


async def increment_metric(name: str, by: int = 1) -> None:
    state.metrics[name] += by
    await state.redis.incrby(f"metrics:{name}", by)


async def metrics_snapshot() -> MetricsSummaryResponse:
    keys = [
        "total_queries",
        "cache_hits",
        "cache_misses",
        "total_ingest_requests",
        "total_chunks_ingested",
        "skipped_duplicates",
    ]
    values = await state.redis.mget([f"metrics:{key}" for key in keys])
    counters = {
        key: int(value) if value is not None else state.metrics[key]
        for key, value in zip(keys, values)
    }
    total_queries = counters["total_queries"]
    cache_hits = counters["cache_hits"]
    cache_misses = counters["cache_misses"]
    hit_rate = round((cache_hits / total_queries), 4) if total_queries else 0.0
    return MetricsSummaryResponse(
        total_queries=total_queries,
        cache_hits=cache_hits,
        cache_misses=cache_misses,
        cache_hit_rate=hit_rate,
        total_ingest_requests=counters["total_ingest_requests"],
        total_chunks_ingested=counters["total_chunks_ingested"],
        skipped_duplicates=counters["skipped_duplicates"],
    )


def normalize(vector: list[float]) -> list[float]:
    arr = np.asarray(vector, dtype=np.float32)
    norm = np.linalg.norm(arr)
    if norm == 0:
        return arr.tolist()
    return (arr / norm).tolist()


def vec_to_string(embedding: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in embedding) + "]"


def compute_content_hash(source: str, title: str, content: str) -> str:
    payload = f"{source}\n{title}\n{content}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def encode_embedding(embedding: list[float]) -> str:
    payload = struct.pack(f"{len(embedding)}f", *embedding)
    return base64.b64encode(payload).decode("ascii")


def decode_embedding(payload: str) -> list[float]:
    raw = base64.b64decode(payload.encode("ascii"))
    count = len(raw) // 4
    return list(struct.unpack(f"{count}f", raw))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return -1.0
    return float(np.dot(np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)))


async def embed(text_value: str) -> list[float]:
    try:
        response = await state.http.post(
            f"{settings.ollama_url}/api/embed",
            json={"model": settings.embed_model, "input": text_value},
            timeout=60.0,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Embedding request failed: {exc}") from exc
    embeddings = payload.get("embeddings") or []
    if not embeddings:
        raise HTTPException(status_code=502, detail="Embedding model returned no vectors")
    embedding = normalize(embeddings[0])
    if len(embedding) != settings.embed_dims:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected embedding dims: {len(embedding)} != {settings.embed_dims}",
        )
    return embedding


def build_citations(top_chunks: list[dict[str, Any]]) -> list[Citation]:
    citations: list[Citation] = []
    for chunk in top_chunks:
        metadata = chunk.get("metadata") or {}
        citations.append(
            Citation(
                chunk_id=str(chunk["id"]),
                source=chunk.get("source", "unknown"),
                title=metadata.get("title", chunk.get("source", "Untitled")),
                chunk_index=int(chunk.get("chunk_index", 0)),
                excerpt=chunk["content"][:240],
            )
        )
    return citations


async def cache_lookup(
    query_emb: list[float],
    user_id: str,
    tenant_id: str,
    *,
    source: str | None = None,
    category: str | None = None,
    title_contains: str | None = None,
) -> QueryResponse | None:
    best_score = -1.0
    best_response: QueryResponse | None = None
    expected_signature = filter_signature(source, category, title_contains)
    async for key in state.redis.scan_iter("semcache:*"):
        entry = await state.redis.hgetall(key)
        if not entry:
            continue
        if entry.get("user_id") != user_id or entry.get("tenant_id") != tenant_id:
            continue
        if entry.get("filter_signature") != expected_signature:
            continue
        cached_emb = decode_embedding(entry["embedding"])
        score = cosine_similarity(query_emb, cached_emb)
        if score >= settings.cache_threshold and score > best_score:
            best_score = score
            if "response_payload" in entry:
                payload = json.loads(entry["response_payload"])
                best_response = QueryResponse.model_validate(payload)
            else:
                best_response = QueryResponse(
                    answer=entry["response"],
                    cache_hit=True,
                    chunks_used=[],
                    history_used=0,
                    citations=[],
                )
    return best_response


async def retrieve(
    query_emb: list[float],
    user_id: str,
    tenant_id: str,
    *,
    source: str | None = None,
    category: str | None = None,
    title_contains: str | None = None,
) -> list[dict[str, Any]]:
    vector_str = vec_to_string(query_emb)
    filters = ["tenant_id = :tenant_id", "user_id = :user_id"]
    params: dict[str, Any] = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "vec": vector_str,
        "limit": settings.top_k_retrieve,
    }
    if source:
        filters.append("source = :source")
        params["source"] = source
    if category:
        filters.append("metadata ->> 'category' = :category")
        params["category"] = category
    if title_contains:
        filters.append("metadata ->> 'title' ILIKE :title_pattern")
        params["title_pattern"] = f"%{title_contains}%"
    sql = text(
        f"""
        SELECT id, source, content, metadata, chunk_index
        FROM document_chunks
        WHERE {' AND '.join(filters)}
        ORDER BY embedding <=> CAST(:vec AS vector)
        LIMIT :limit
        """
    )
    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        rows = await session.execute(sql, params)
        return [dict(row._mapping) for row in rows]


def _simple_overlap_score(query: str, content: str) -> float:
    q_tokens = set(query.lower().split())
    c_tokens = set(content.lower().split())
    if not q_tokens:
        return 0.0
    return len(q_tokens & c_tokens) / len(q_tokens)


async def rerank(query: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not candidates:
        return []
    if state.reranker is None:
        ranked = sorted(
            candidates,
            key=lambda item: _simple_overlap_score(query, item["content"]),
            reverse=True,
        )
        return ranked[: settings.top_k_rerank]
    pairs = [(query, candidate["content"]) for candidate in candidates]
    scores = await asyncio.to_thread(state.reranker.predict, pairs)
    for candidate, score in zip(candidates, scores):
        candidate["score"] = float(score)
    ranked = sorted(candidates, key=lambda item: item["score"], reverse=True)
    return ranked[: settings.top_k_rerank]


async def get_history(user_id: str, tenant_id: str, limit: int = 6) -> list[dict[str, str]]:
    sql = text(
        """
        SELECT role, content, created_at
        FROM conversations
        WHERE tenant_id = :tenant_id AND user_id = :user_id
        ORDER BY created_at DESC
        LIMIT :limit
        """
    )
    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        rows = await session.execute(sql, {"tenant_id": tenant_id, "user_id": user_id, "limit": limit})
        history = [dict(row._mapping) for row in rows]
    history.reverse()
    for turn in history:
        turn["created_at"] = turn["created_at"].isoformat()
    return history


def build_prompt(query: str, top_chunks: list[dict[str, Any]], history: list[dict[str, str]]) -> list[dict[str, str]]:
    context = "\n\n".join(
        f"[{index + 1}] {chunk['content']}" for index, chunk in enumerate(top_chunks)
    )
    transcript = "\n".join(f"{turn['role']}: {turn['content']}" for turn in history)
    system = (
        "You are a contextual assistant for a BFF RAG system. "
        "Use the provided chunks first, keep answers grounded, and say when context is missing."
    )
    user_message = (
        f"Relevant context:\n{context or 'No matching chunks found.'}\n\n"
        f"Conversation history:\n{transcript or 'No prior history.'}\n\n"
        f"User question: {query}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_message},
    ]


async def llm_complete(messages: list[dict[str, str]]) -> str:
    try:
        response = await state.http.post(
            f"{settings.ollama_url}/api/chat",
            json={"model": settings.llm_model, "messages": messages, "stream": False},
            timeout=120.0,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}") from exc
    return payload["message"]["content"]


async def llm_stream(messages: list[dict[str, str]]) -> AsyncIterator[str]:
    try:
        async with state.http.stream(
            "POST",
            f"{settings.ollama_url}/api/chat",
            json={"model": settings.llm_model, "messages": messages, "stream": True},
            timeout=120.0,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                data = json.loads(line)
                piece = data.get("message", {}).get("content", "")
                if piece:
                    yield piece
                if data.get("done"):
                    break
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Streaming LLM request failed: {exc}") from exc


async def stream_cached_answer(answer: str) -> AsyncIterator[str]:
    if answer:
        yield f"data: {json.dumps({'token': answer})}\n\n"
    yield "event: done\ndata: {}\n\n"


async def cache_store(
    query_emb: list[float],
    user_id: str,
    tenant_id: str,
    response: QueryResponse,
    *,
    source: str | None = None,
    category: str | None = None,
    title_contains: str | None = None,
) -> None:
    cache_key = f"semcache:{hashlib.sha256(encode_embedding(query_emb).encode('utf-8')).hexdigest()}"
    await state.redis.hset(
        cache_key,
        mapping={
            "embedding": encode_embedding(query_emb),
            "user_id": user_id,
            "tenant_id": tenant_id,
            "filter_signature": filter_signature(source, category, title_contains),
            "response": response.answer,
            "response_payload": response.model_dump_json(),
        },
    )
    await state.redis.expire(cache_key, settings.cache_ttl)


async def save_turn(user_id: str, tenant_id: str, role: str, content: str) -> None:
    sql = text(
        """
        INSERT INTO conversations (tenant_id, user_id, role, content)
        VALUES (:tenant_id, :user_id, :role, :content)
        """
    )
    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        await session.execute(sql, {"tenant_id": tenant_id, "user_id": user_id, "role": role, "content": content})
        await session.commit()


async def run_ingest(payload: IngestRequest) -> dict[str, int]:
    inserted = 0
    skipped_duplicates = 0
    await increment_metric("total_ingest_requests")
    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": payload.tenant_id})
        for document in payload.documents:
            content_hash = compute_content_hash(payload.source, document.title, document.content)
            existing_metadata_rows = await session.execute(
                text(
                    """
                    SELECT metadata
                    FROM document_chunks
                    WHERE tenant_id = :tenant_id
                      AND user_id = :user_id
                      AND source = :source
                    """
                ),
                {
                    "tenant_id": payload.tenant_id,
                    "user_id": payload.user_id,
                    "source": payload.source,
                },
            )
            existing_hashes = {
                (row[0] or {}).get("content_hash")
                for row in existing_metadata_rows.fetchall()
                if isinstance(row[0], dict)
            }
            if content_hash in existing_hashes:
                skipped_duplicates += 1
                continue
            for chunk_index, chunk in enumerate(split_document(document.content)):
                embedding = await embed(chunk)
                metadata = {
                    "title": document.title,
                    "category": document.category,
                    "content_hash": content_hash,
                    **document.metadata,
                }
                await session.execute(
                    text(
                        """
                        INSERT INTO document_chunks (
                          id, tenant_id, user_id, source, chunk_index, content, embedding, metadata
                        )
                        VALUES (
                          :id, :tenant_id, :user_id, :source, :chunk_index, :content,
                          CAST(:embedding AS vector), CAST(:metadata AS jsonb)
                        )
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "tenant_id": payload.tenant_id,
                        "user_id": payload.user_id,
                        "source": payload.source,
                        "chunk_index": chunk_index,
                        "content": chunk,
                        "embedding": vec_to_string(embedding),
                        "metadata": json.dumps(metadata),
                    },
                )
                inserted += 1
        await session.commit()
    if inserted:
        await increment_metric("total_chunks_ingested", inserted)
    if skipped_duplicates:
        await increment_metric("skipped_duplicates", skipped_duplicates)
    return {"inserted_chunks": inserted, "skipped_duplicates": skipped_duplicates}


async def count_cache_entries() -> int:
    total = 0
    async for _ in state.redis.scan_iter("semcache:*"):
        total += 1
    return total


async def admin_overview_counts(user_id: str, tenant_id: str) -> dict[str, int]:
    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        chunk_count_result = await session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM document_chunks
                WHERE tenant_id = :tenant_id AND user_id = :user_id
                """
            ),
            {"tenant_id": tenant_id, "user_id": user_id},
        )
        conversation_count_result = await session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM conversations
                WHERE tenant_id = :tenant_id AND user_id = :user_id
                """
            ),
            {"tenant_id": tenant_id, "user_id": user_id},
        )
    return {
        "total_chunks": int(chunk_count_result.scalar_one()),
        "total_conversations": int(conversation_count_result.scalar_one()),
    }


async def list_admin_chunks(
    user_id: str,
    tenant_id: str,
    *,
    limit: int = 10,
    source: str | None = None,
    category: str | None = None,
    title_contains: str | None = None,
) -> list[AdminChunkResponse]:
    filters = ["tenant_id = :tenant_id", "user_id = :user_id"]
    params: dict[str, Any] = {"tenant_id": tenant_id, "user_id": user_id, "limit": limit}
    if source:
        filters.append("source = :source")
        params["source"] = source
    if category:
        filters.append("metadata ->> 'category' = :category")
        params["category"] = category
    if title_contains:
        filters.append("metadata ->> 'title' ILIKE :title_pattern")
        params["title_pattern"] = f"%{title_contains}%"
    sql = text(
        f"""
        SELECT id, source, chunk_index, content, metadata, created_at
        FROM document_chunks
        WHERE {' AND '.join(filters)}
        ORDER BY created_at DESC
        LIMIT :limit
        """
    )
    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        rows = await session.execute(sql, params)
        items = []
        for row in rows:
            record = dict(row._mapping)
            metadata = record.get("metadata") or {}
            items.append(
                AdminChunkResponse(
                    chunk_id=str(record["id"]),
                    source=record["source"],
                    title=metadata.get("title", record["source"]),
                    category=metadata.get("category"),
                    chunk_index=int(record["chunk_index"]),
                    excerpt=record["content"][:240],
                    created_at=record["created_at"].isoformat(),
                    content_hash=metadata.get("content_hash"),
                )
            )
    return items


async def ingest_worker() -> None:
    while True:
        job_id = await state.ingest_queue.get()
        job = state.ingest_jobs.get(job_id)
        payload = state.ingest_payloads.get(job_id)
        if job is None or payload is None:
            state.ingest_queue.task_done()
            continue
        state.ingest_jobs[job_id] = job.model_copy(
            update={
                "status": "running",
                "started_at": utc_now(),
                "error": None,
            }
        )
        try:
            result = await run_ingest(payload)
            state.ingest_jobs[job_id] = state.ingest_jobs[job_id].model_copy(
                update={
                    "status": "completed",
                    "finished_at": utc_now(),
                    "inserted_chunks": result["inserted_chunks"],
                    "skipped_duplicates": result["skipped_duplicates"],
                }
            )
            log_event("ingest_job_completed", job_id=job_id, **result)
        except Exception as exc:
            state.ingest_jobs[job_id] = state.ingest_jobs[job_id].model_copy(
                update={
                    "status": "failed",
                    "finished_at": utc_now(),
                    "error": str(exc),
                }
            )
            log_event("ingest_job_failed", job_id=job_id, error=str(exc))
        finally:
            state.ingest_payloads.pop(job_id, None)
            state.ingest_queue.task_done()


def create_ingest_job(payload: IngestRequest) -> IngestJobStatusResponse:
    job = IngestJobStatusResponse(
        job_id=str(uuid.uuid4()),
        status="queued",
        user_id=payload.user_id,
        tenant_id=payload.tenant_id,
        source=payload.source,
        submitted_at=utc_now(),
    )
    state.ingest_jobs[job.job_id] = job
    state.ingest_payloads[job.job_id] = payload
    state.ingest_queue.put_nowait(job.job_id)
    return job


def expire_finished_ingest_jobs() -> None:
    cutoff = time.time() - settings.ingest_job_ttl
    expired_ids: list[str] = []
    for job_id, job in state.ingest_jobs.items():
        if job.status not in {"completed", "failed"} or job.finished_at is None:
            continue
        finished = dt.datetime.strptime(job.finished_at, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=dt.timezone.utc
        ).timestamp()
        if finished < cutoff:
            expired_ids.append(job_id)
    for job_id in expired_ids:
        state.ingest_jobs.pop(job_id, None)
        state.ingest_payloads.pop(job_id, None)


def split_document(content: str, chunk_size: int = 500, overlap: int = 100) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(content):
        end = min(len(content), start + chunk_size)
        chunks.append(content[start:end])
        if end == len(content):
            break
        start = max(end - overlap, start + 1)
    return chunks


@asynccontextmanager
async def lifespan(_: FastAPI):
    engine = create_async_engine(settings.database_url, future=True)
    state.session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    state.redis = redis.from_url(settings.redis_url, decode_responses=True)
    state.http = httpx.AsyncClient()
    state.reranker = None
    state.ingest_queue = asyncio.Queue()
    state.ingest_jobs = {}
    state.ingest_payloads = {}
    state.metrics = {
        "total_queries": 0,
        "cache_hits": 0,
        "cache_misses": 0,
        "total_ingest_requests": 0,
        "total_chunks_ingested": 0,
        "skipped_duplicates": 0,
    }
    if CrossEncoder is not None:
        try:
            state.reranker = await asyncio.to_thread(CrossEncoder, "cross-encoder/ms-marco-MiniLM-L-6-v2")
        except Exception:
            state.reranker = None
    state.ingest_worker_task = asyncio.create_task(ingest_worker())
    try:
        yield
    finally:
        state.ingest_worker_task.cancel()
        try:
            await state.ingest_worker_task
        except asyncio.CancelledError:
            pass
        await state.http.aclose()
        await state.redis.close()
        await engine.dispose()


app = FastAPI(title="rag-service", lifespan=lifespan)


@app.middleware("http")
async def request_logging(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    request.state.request_id = request_id
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        log_event(
            "request_failed",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            elapsed_ms=elapsed_ms,
        )
        raise
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["x-request-id"] = request_id
    log_event(
        "request_completed",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        elapsed_ms=elapsed_ms,
    )
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    log_event(
        "http_exception",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status_code=exc.status_code,
        detail=exc.detail,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error="http_error",
            detail=str(exc.detail),
            request_id=request_id,
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    log_event(
        "unhandled_exception",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        error=type(exc).__name__,
        detail=str(exc),
    )
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error="internal_error",
            detail="An unexpected server error occurred",
            request_id=request_id,
        ).model_dump(),
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "model": settings.llm_model}


@app.get("/cache/stats", response_model=CacheStatsResponse)
async def cache_stats() -> CacheStatsResponse:
    return CacheStatsResponse(cached_entries=await count_cache_entries())


@app.get("/metrics/summary", response_model=MetricsSummaryResponse)
async def metrics_summary() -> MetricsSummaryResponse:
    return await metrics_snapshot()


@app.get("/history", response_model=HistoryResponse)
async def history(
    user_id: str = Query(...),
    tenant_id: str = Query(...),
    limit: int = Query(default=10, ge=1, le=50),
) -> HistoryResponse:
    turns = await get_history(user_id, tenant_id, limit=limit)
    return HistoryResponse(turns=[HistoryTurn.model_validate(turn) for turn in turns])


@app.get("/admin/overview", response_model=AdminOverviewResponse)
async def admin_overview(
    user_id: str = Query(...),
    tenant_id: str = Query(...),
) -> AdminOverviewResponse:
    counts = await admin_overview_counts(user_id, tenant_id)
    return AdminOverviewResponse(
        metrics=await metrics_snapshot(),
        cached_entries=await count_cache_entries(),
        total_chunks=counts["total_chunks"],
        total_conversations=counts["total_conversations"],
    )


@app.get("/admin/chunks", response_model=list[AdminChunkResponse])
async def admin_chunks(
    user_id: str = Query(...),
    tenant_id: str = Query(...),
    limit: int = Query(default=10, ge=1, le=50),
    source: str | None = Query(default=None),
    category: str | None = Query(default=None),
    title_contains: str | None = Query(default=None),
) -> list[AdminChunkResponse]:
    return await list_admin_chunks(
        user_id,
        tenant_id,
        limit=limit,
        source=source,
        category=category,
        title_contains=title_contains,
    )


@app.post("/admin/ingest")
async def ingest(payload: IngestRequest) -> dict[str, Any]:
    return await run_ingest(payload)


@app.post("/admin/ingest/jobs", response_model=IngestJobQueuedResponse)
async def enqueue_ingest(payload: IngestRequest) -> IngestJobQueuedResponse:
    expire_finished_ingest_jobs()
    job = create_ingest_job(payload)
    log_event(
        "ingest_job_queued",
        job_id=job.job_id,
        tenant_id=job.tenant_id,
        user_id=job.user_id,
        source=job.source,
        documents=len(payload.documents),
    )
    return IngestJobQueuedResponse(job_id=job.job_id, status=job.status)


@app.get("/admin/ingest/jobs/{job_id}", response_model=IngestJobStatusResponse)
async def ingest_job_status(job_id: str) -> IngestJobStatusResponse:
    expire_finished_ingest_jobs()
    job = state.ingest_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Ingest job not found")
    return job


@app.post("/query", response_model=QueryResponse)
async def query(payload: QueryRequest, request: Request) -> QueryResponse | StreamingResponse:
    await increment_metric("total_queries")
    query_emb = await embed(payload.query)
    cached_response = await cache_lookup(
        query_emb,
        payload.user_id,
        payload.tenant_id,
        source=payload.source,
        category=payload.category,
        title_contains=payload.title_contains,
    )
    if cached_response is not None:
        await increment_metric("cache_hits")
        cache_hit_response = cached_response.model_copy(update={"cache_hit": True})
        if payload.stream:
            return StreamingResponse(stream_cached_answer(cache_hit_response.answer), media_type="text/event-stream")
        return cache_hit_response
    await increment_metric("cache_misses")

    candidates = await retrieve(
        query_emb,
        payload.user_id,
        payload.tenant_id,
        source=payload.source,
        category=payload.category,
        title_contains=payload.title_contains,
    )
    top_chunks = await rerank(payload.query, candidates)
    history = await get_history(payload.user_id, payload.tenant_id)
    messages = build_prompt(payload.query, top_chunks, history)
    citations = build_citations(top_chunks)

    if payload.stream:
        async def event_stream() -> AsyncIterator[str]:
            full_response = ""
            async for token in llm_stream(messages):
                full_response += token
                yield f"data: {json.dumps({'token': token})}\n\n"
                if await request.is_disconnected():
                    return
            response_payload = QueryResponse(
                answer=full_response,
                cache_hit=False,
                chunks_used=[chunk["content"] for chunk in top_chunks],
                history_used=len(history),
                citations=citations,
            )
            await cache_store(
                query_emb,
                payload.user_id,
                payload.tenant_id,
                response_payload,
                source=payload.source,
                category=payload.category,
                title_contains=payload.title_contains,
            )
            await save_turn(payload.user_id, payload.tenant_id, "user", payload.query)
            await save_turn(payload.user_id, payload.tenant_id, "assistant", full_response)
            yield "event: done\ndata: {}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    answer = await llm_complete(messages)
    response_payload = QueryResponse(
        answer=answer,
        cache_hit=False,
        chunks_used=[chunk["content"] for chunk in top_chunks],
        history_used=len(history),
        citations=citations,
    )
    await cache_store(
        query_emb,
        payload.user_id,
        payload.tenant_id,
        response_payload,
        source=payload.source,
        category=payload.category,
        title_contains=payload.title_contains,
    )
    await save_turn(payload.user_id, payload.tenant_id, "user", payload.query)
    await save_turn(payload.user_id, payload.tenant_id, "assistant", answer)
    return response_payload
