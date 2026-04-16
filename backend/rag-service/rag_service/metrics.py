from .models import MetricsSummaryResponse
from .state import state


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
    hit_rate = round((cache_hits / total_queries), 4) if total_queries else 0.0
    return MetricsSummaryResponse(
        total_queries=total_queries,
        cache_hits=cache_hits,
        cache_misses=counters["cache_misses"],
        cache_hit_rate=hit_rate,
        total_ingest_requests=counters["total_ingest_requests"],
        total_chunks_ingested=counters["total_chunks_ingested"],
        skipped_duplicates=counters["skipped_duplicates"],
    )


async def count_cache_entries() -> int:
    total = 0
    async for _ in state.redis.scan_iter("semcache:*"):
        total += 1
    return total
