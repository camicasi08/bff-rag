import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import httpx
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import settings
from .ingest import create_ingest_job, expire_finished_ingest_jobs, ingest_worker, run_ingest
from .metrics import count_cache_entries, increment_metric, metrics_snapshot
from .models import (
    AdminChunkResponse,
    AdminOverviewResponse,
    CacheStatsResponse,
    ErrorResponse,
    HistoryResponse,
    HistoryTurn,
    IngestJobQueuedResponse,
    IngestJobStatusResponse,
    IngestRequest,
    MetricsSummaryResponse,
    QueryRequest,
    QueryResponse,
)
from .rag import (
    admin_overview_counts,
    build_citations,
    build_prompt,
    cache_lookup,
    cache_store,
    embed,
    get_history,
    list_admin_chunks,
    llm_complete,
    llm_stream,
    rerank,
    retrieve,
    save_turn,
    stream_cached_answer,
)
from .state import state
from .utils import configure_logging, log_event

try:
    from sentence_transformers import CrossEncoder
except Exception:  # pragma: no cover
    CrossEncoder = None


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
        await state.redis.aclose()
        await engine.dispose()


def create_app() -> FastAPI:
    configure_logging()
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
        expire_finished_ingest_jobs(settings.ingest_job_ttl)
        job = create_ingest_job(payload)
        log_event(
            "ingest_job_queued",
            job_id=job.job_id,
            tenant_id=job.tenant_id,
            user_id=job.user_id,
            source=job.source,
            documents=len(payload.documents) + len(payload.files),
        )
        return IngestJobQueuedResponse(job_id=job.job_id, status=job.status)

    @app.get("/admin/ingest/jobs/{job_id}", response_model=IngestJobStatusResponse)
    async def ingest_job_status(job_id: str) -> IngestJobStatusResponse:
        expire_finished_ingest_jobs(settings.ingest_job_ttl)
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
                return StreamingResponse(
                    stream_cached_answer(cache_hit_response.answer),
                    media_type="text/event-stream",
                )
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

    return app


app = create_app()
