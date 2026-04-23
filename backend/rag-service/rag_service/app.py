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
from .metrics import count_cache_entries, increment_metric, metrics_snapshot, record_query_stage_duration
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
    rerank_candidates,
    retrieve,
    save_turn,
    stream_cached_answer,
)
from .state import state
from .utils import configure_logging, log_event, prepare_prompt_inputs

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
        "query_stage_totals_ms": {},
        "query_stage_counts": {},
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
        await expire_finished_ingest_jobs(settings.ingest_job_ttl)
        job = await create_ingest_job(payload)
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
        await expire_finished_ingest_jobs(settings.ingest_job_ttl)
        job = await state.load_ingest_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Ingest job not found")
        return job

    @app.post("/query", response_model=QueryResponse)
    async def query(payload: QueryRequest, request: Request) -> QueryResponse | StreamingResponse:
        started = time.perf_counter()
        request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
        stage_timings: dict[str, float] = {}

        async def record_stage(step: str, stage_started: float) -> None:
            duration_ms = round((time.perf_counter() - stage_started) * 1000, 2)
            stage_timings[step] = duration_ms
            await record_query_stage_duration(step, duration_ms)

        async def execute_stage(step: str, operation: Any) -> Any:
            stage_started = time.perf_counter()
            try:
                result = await operation
            finally:
                await record_stage(step, stage_started)
            return result

        await increment_metric("total_queries")
        embed_result, history_result = await asyncio.gather(
            execute_stage("embed", embed(payload.query)),
            execute_stage("history", get_history(payload.user_id, payload.tenant_id, limit=settings.query_history_limit)),
            return_exceptions=True,
        )
        if isinstance(embed_result, Exception):
            raise embed_result
        if isinstance(history_result, Exception):
            raise history_result
        query_emb = embed_result
        history = history_result

        stage_started = time.perf_counter()
        cached_response = await cache_lookup(
            query_emb,
            payload.user_id,
            payload.tenant_id,
            source=payload.source,
            category=payload.category,
            title_contains=payload.title_contains,
        )
        await record_stage("cache_lookup", stage_started)
        if cached_response is not None:
            await increment_metric("cache_hits")
            cache_hit_response = cached_response.model_copy(
                update={
                    "cache_hit": True,
                }
            )
            log_query_pipeline(
                request_id=request_id,
                payload=payload,
                cache_hit=True,
                candidate_count=0,
                reranked_count=0,
                history_count=0,
                prompt_chars=0,
                stage_timings=stage_timings,
                latency_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            if payload.stream:
                return StreamingResponse(
                    stream_cached_answer(cache_hit_response.answer),
                    media_type="text/event-stream",
                )
            return cache_hit_response

        await increment_metric("cache_misses")
        stage_started = time.perf_counter()
        candidates = await retrieve(
            query_emb,
            payload.user_id,
            payload.tenant_id,
            source=payload.source,
            category=payload.category,
            title_contains=payload.title_contains,
        )
        await record_stage("retrieve", stage_started)

        stage_started = time.perf_counter()
        top_chunks = await rerank_candidates(
            payload.query,
            candidates,
            source=payload.source,
            category=payload.category,
            title_contains=payload.title_contains,
        )
        await record_stage("rerank", stage_started)

        prepared_chunks, prepared_history = prepare_prompt_inputs(top_chunks, history)
        stage_started = time.perf_counter()
        messages = build_prompt(payload.query, prepared_chunks, prepared_history, already_prepared=True)
        await record_stage("prompt_build", stage_started)
        citations = build_citations(prepared_chunks)
        prompt_chars = sum(len(message["content"]) for message in messages)

        if payload.stream:

            async def event_stream() -> AsyncIterator[str]:
                full_response = ""
                llm_started = time.perf_counter()
                async for token in llm_stream(messages):
                    full_response += token
                    yield f"data: {json.dumps({'token': token})}\n\n"
                    if await request.is_disconnected():
                        return
                await record_stage("llm", llm_started)

                response_payload = QueryResponse(
                    answer=full_response,
                    cache_hit=False,
                    chunks_used=[chunk["content"] for chunk in prepared_chunks],
                    history_used=len(prepared_history),
                    latency_ms=round((time.perf_counter() - started) * 1000, 2),
                    citations=citations,
                )
                cache_started = time.perf_counter()
                await cache_store(
                    query_emb,
                    payload.user_id,
                    payload.tenant_id,
                    response_payload,
                    source=payload.source,
                    category=payload.category,
                    title_contains=payload.title_contains,
                )
                await record_stage("cache_store", cache_started)
                save_started = time.perf_counter()
                await save_turn(payload.user_id, payload.tenant_id, "user", payload.query)
                await save_turn(payload.user_id, payload.tenant_id, "assistant", full_response)
                await record_stage("save_turn", save_started)
                log_query_pipeline(
                    request_id=request_id,
                    payload=payload,
                    cache_hit=False,
                    candidate_count=len(candidates),
                    reranked_count=len(top_chunks),
                    history_count=len(prepared_history),
                    prompt_chars=prompt_chars,
                    stage_timings=stage_timings,
                    latency_ms=response_payload.latency_ms or 0.0,
                )
                yield "event: done\ndata: {}\n\n"

            return StreamingResponse(event_stream(), media_type="text/event-stream")

        llm_started = time.perf_counter()
        answer = await llm_complete(messages)
        await record_stage("llm", llm_started)
        response_payload = QueryResponse(
            answer=answer,
            cache_hit=False,
            chunks_used=[chunk["content"] for chunk in prepared_chunks],
            history_used=len(prepared_history),
            latency_ms=round((time.perf_counter() - started) * 1000, 2),
            citations=citations,
        )
        cache_started = time.perf_counter()
        await cache_store(
            query_emb,
            payload.user_id,
            payload.tenant_id,
            response_payload,
            source=payload.source,
            category=payload.category,
            title_contains=payload.title_contains,
        )
        await record_stage("cache_store", cache_started)
        save_started = time.perf_counter()
        await save_turn(payload.user_id, payload.tenant_id, "user", payload.query)
        await save_turn(payload.user_id, payload.tenant_id, "assistant", answer)
        await record_stage("save_turn", save_started)
        log_query_pipeline(
            request_id=request_id,
            payload=payload,
            cache_hit=False,
            candidate_count=len(candidates),
            reranked_count=len(top_chunks),
            history_count=len(prepared_history),
            prompt_chars=prompt_chars,
            stage_timings=stage_timings,
            latency_ms=response_payload.latency_ms or 0.0,
        )
        return response_payload

    return app


app = create_app()


def log_query_pipeline(
    *,
    request_id: str,
    payload: QueryRequest,
    cache_hit: bool,
    candidate_count: int,
    reranked_count: int,
    history_count: int,
    prompt_chars: int,
    stage_timings: dict[str, float],
    latency_ms: float,
) -> None:
    log_event(
        "query_pipeline_completed",
        request_id=request_id,
        cache_hit=cache_hit,
        stream=payload.stream,
        tenant_id=payload.tenant_id,
        user_id=payload.user_id,
        candidate_count=candidate_count,
        reranked_count=reranked_count,
        history_count=history_count,
        prompt_chars=prompt_chars,
        stage_timings_ms=stage_timings,
        latency_ms=latency_ms,
    )
