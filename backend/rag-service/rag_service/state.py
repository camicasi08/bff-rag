import asyncio
from typing import Any

import httpx
import redis.asyncio as redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .models import IngestJobStatusResponse, IngestRequest


class AppState:
    session: async_sessionmaker[AsyncSession]
    redis: redis.Redis
    http: httpx.AsyncClient
    reranker: Any
    metrics: dict[str, int]
    ingest_queue: asyncio.Queue[str]
    ingest_jobs: dict[str, IngestJobStatusResponse]
    ingest_payloads: dict[str, IngestRequest]
    ingest_worker_task: asyncio.Task[None]


state = AppState()
