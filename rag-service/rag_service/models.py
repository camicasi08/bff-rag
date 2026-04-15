from typing import Any

from pydantic import BaseModel, Field


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
