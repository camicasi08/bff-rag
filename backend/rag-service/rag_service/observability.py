from __future__ import annotations

from typing import Iterable

try:
    from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
except Exception:  # pragma: no cover - local test environments may not have optional deps installed yet
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"
    Counter = Gauge = Histogram = None  # type: ignore[assignment]
    generate_latest = None  # type: ignore[assignment]


PROMETHEUS_AVAILABLE = generate_latest is not None

QUERY_STAGE_BUCKETS = (
    0.001,
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
    60.0,
    120.0,
)
HTTP_BUCKETS = (
    0.001,
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
    60.0,
    120.0,
)
COUNT_BUCKETS = (0, 1, 2, 3, 5, 8, 13, 20, 30, 50, 100)
PROMPT_CHAR_BUCKETS = (0, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000)
RESPONSE_CHAR_BUCKETS = (0, 100, 250, 500, 1000, 2000, 4000, 8000, 16000)

if PROMETHEUS_AVAILABLE:
    HTTP_REQUESTS_TOTAL = Counter(
        "rag_http_requests_total",
        "Total HTTP requests handled by rag-service.",
        ("method", "path", "status_code"),
    )
    HTTP_REQUEST_DURATION_SECONDS = Histogram(
        "rag_http_request_duration_seconds",
        "HTTP request duration in seconds for rag-service.",
        ("method", "path", "status_code"),
        buckets=HTTP_BUCKETS,
    )
    APP_COUNTER_TOTAL = Counter(
        "rag_app_events_total",
        "Application-level counters emitted by rag-service.",
        ("event",),
    )
    QUERY_STAGE_DURATION_SECONDS = Histogram(
        "rag_query_stage_duration_seconds",
        "RAG query pipeline stage duration in seconds.",
        ("stage",),
        buckets=QUERY_STAGE_BUCKETS,
    )
    QUERY_PIPELINE_TOTAL = Counter(
        "rag_query_pipeline_total",
        "Completed RAG query pipelines by cache and streaming mode.",
        ("cache_hit", "stream"),
    )
    QUERY_CANDIDATES = Histogram(
        "rag_query_candidates",
        "Number of retrieval candidates considered per query.",
        buckets=COUNT_BUCKETS,
    )
    QUERY_RERANKED_CHUNKS = Histogram(
        "rag_query_reranked_chunks",
        "Number of chunks kept after reranking per query.",
        buckets=COUNT_BUCKETS,
    )
    QUERY_HISTORY_TURNS = Histogram(
        "rag_query_history_turns",
        "Number of conversation history turns included per query.",
        buckets=COUNT_BUCKETS,
    )
    QUERY_PROMPT_CHARS = Histogram(
        "rag_query_prompt_chars",
        "Prompt size in characters sent to the LLM.",
        buckets=PROMPT_CHAR_BUCKETS,
    )
    SEMANTIC_CACHE_ENTRIES = Gauge(
        "rag_semantic_cache_entries",
        "Semantic cache entries currently visible to rag-service.",
    )
    OLLAMA_LLM_DURATION_SECONDS = Histogram(
        "rag_ollama_llm_duration_seconds",
        "Ollama chat call duration in seconds.",
        ("model", "stream", "status"),
        buckets=QUERY_STAGE_BUCKETS,
    )
    OLLAMA_LLM_FIRST_TOKEN_SECONDS = Histogram(
        "rag_ollama_llm_first_token_seconds",
        "Time to first streamed Ollama chat token in seconds.",
        ("model", "status"),
        buckets=QUERY_STAGE_BUCKETS,
    )
    OLLAMA_LLM_RESPONSE_CHARS = Histogram(
        "rag_ollama_llm_response_chars",
        "Ollama chat response size in characters.",
        ("model", "stream"),
        buckets=RESPONSE_CHAR_BUCKETS,
    )
else:
    HTTP_REQUESTS_TOTAL = None
    HTTP_REQUEST_DURATION_SECONDS = None
    APP_COUNTER_TOTAL = None
    QUERY_STAGE_DURATION_SECONDS = None
    QUERY_PIPELINE_TOTAL = None
    QUERY_CANDIDATES = None
    QUERY_RERANKED_CHUNKS = None
    QUERY_HISTORY_TURNS = None
    QUERY_PROMPT_CHARS = None
    SEMANTIC_CACHE_ENTRIES = None
    OLLAMA_LLM_DURATION_SECONDS = None
    OLLAMA_LLM_FIRST_TOKEN_SECONDS = None
    OLLAMA_LLM_RESPONSE_CHARS = None


def record_http_request(method: str, path: str, status_code: int, duration_ms: float) -> None:
    if not PROMETHEUS_AVAILABLE:
        return
    labels = (method, path, str(status_code))
    HTTP_REQUESTS_TOTAL.labels(*labels).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(*labels).observe(duration_ms / 1000)


def record_app_counter(name: str, by: int = 1) -> None:
    if not PROMETHEUS_AVAILABLE:
        return
    APP_COUNTER_TOTAL.labels(name).inc(by)


def record_query_stage(step: str, duration_ms: float) -> None:
    if not PROMETHEUS_AVAILABLE:
        return
    QUERY_STAGE_DURATION_SECONDS.labels(step).observe(duration_ms / 1000)


def record_query_pipeline(
    *,
    cache_hit: bool,
    stream: bool,
    candidate_count: int,
    reranked_count: int,
    history_count: int,
    prompt_chars: int,
) -> None:
    if not PROMETHEUS_AVAILABLE:
        return
    QUERY_PIPELINE_TOTAL.labels(str(cache_hit).lower(), str(stream).lower()).inc()
    QUERY_CANDIDATES.observe(candidate_count)
    QUERY_RERANKED_CHUNKS.observe(reranked_count)
    QUERY_HISTORY_TURNS.observe(history_count)
    QUERY_PROMPT_CHARS.observe(prompt_chars)


def set_semantic_cache_entries(total: int) -> None:
    if not PROMETHEUS_AVAILABLE:
        return
    SEMANTIC_CACHE_ENTRIES.set(total)


def record_ollama_llm_duration(*, model: str, stream: bool, status: str, duration_ms: float) -> None:
    if not PROMETHEUS_AVAILABLE:
        return
    OLLAMA_LLM_DURATION_SECONDS.labels(model, str(stream).lower(), status).observe(duration_ms / 1000)


def record_ollama_llm_first_token(*, model: str, status: str, duration_ms: float) -> None:
    if not PROMETHEUS_AVAILABLE:
        return
    OLLAMA_LLM_FIRST_TOKEN_SECONDS.labels(model, status).observe(duration_ms / 1000)


def record_ollama_llm_response_chars(*, model: str, stream: bool, chars: int) -> None:
    if not PROMETHEUS_AVAILABLE:
        return
    OLLAMA_LLM_RESPONSE_CHARS.labels(model, str(stream).lower()).observe(chars)


def prometheus_exposition() -> tuple[bytes, str]:
    if not PROMETHEUS_AVAILABLE:
        return b"# prometheus_client is not installed\n", CONTENT_TYPE_LATEST
    return generate_latest(), CONTENT_TYPE_LATEST


def metric_names() -> Iterable[str]:
    return (
        "rag_http_requests_total",
        "rag_http_request_duration_seconds",
        "rag_app_events_total",
        "rag_query_stage_duration_seconds",
        "rag_query_pipeline_total",
        "rag_query_candidates",
        "rag_query_reranked_chunks",
        "rag_query_history_turns",
        "rag_query_prompt_chars",
        "rag_semantic_cache_entries",
        "rag_ollama_llm_duration_seconds",
        "rag_ollama_llm_first_token_seconds",
        "rag_ollama_llm_response_chars",
    )
