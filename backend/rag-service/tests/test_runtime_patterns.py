import importlib.util
import asyncio
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "main.py"
SPEC = importlib.util.spec_from_file_location("rag_service_main_runtime", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
rag_main = importlib.util.module_from_spec(SPEC)
sys.modules["rag_service_main_runtime"] = rag_main
SPEC.loader.exec_module(rag_main)


class FakeRedis:
    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.sorted_sets: dict[str, dict[str, float]] = {}
        self.values: dict[str, str] = {}
        self.queue: list[str] = []

    async def hset(self, key: str, mapping: dict[str, str]) -> None:
        self.hashes[key] = dict(mapping)

    async def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

    async def expire(self, key: str, _: int) -> None:
        return None

    async def zadd(self, key: str, mapping: dict[str, float]) -> None:
        bucket = self.sorted_sets.setdefault(key, {})
        bucket.update(mapping)

    async def zrevrange(self, key: str, start: int, end: int) -> list[str]:
        bucket = self.sorted_sets.get(key, {})
        ordered = [member for member, _ in sorted(bucket.items(), key=lambda item: item[1], reverse=True)]
        if end < 0:
            return ordered[start:]
        return ordered[start : end + 1]

    async def zrem(self, key: str, member: str) -> None:
        self.sorted_sets.get(key, {}).pop(member, None)

    async def scan_iter(self, pattern: str):
        if pattern == "semcache:entry:*":
            for key in self.hashes:
                if key.startswith("semcache:entry:"):
                    yield key
        if pattern == "ingest:job:*":
            for key in self.values:
                if key.startswith("ingest:job:"):
                    yield key

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.values[key] = value

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self.values.pop(key, None)

    async def rpush(self, key: str, value: str) -> None:
        self.queue.append(value)


class RagServiceRuntimePatternsTest(unittest.TestCase):
    def test_observability_metric_names_include_query_breakdown(self) -> None:
        from rag_service.observability import metric_names

        names = set(metric_names())

        self.assertIn("rag_query_stage_duration_seconds", names)
        self.assertIn("rag_query_pipeline_total", names)
        self.assertIn("rag_http_request_duration_seconds", names)
        self.assertIn("rag_ollama_llm_duration_seconds", names)
        self.assertIn("rag_ollama_llm_first_token_seconds", names)

    def test_filter_signature_is_stable_and_sorted(self) -> None:
        signature = rag_main.filter_signature("seed", "billing", "Payment Terms")

        self.assertEqual(
            signature,
            '{"category": "billing", "source": "seed", "title_contains": "Payment Terms"}',
        )

    def test_cosine_similarity_returns_negative_one_for_mismatched_lengths(self) -> None:
        similarity = rag_main.cosine_similarity([1.0, 0.0], [1.0])

        self.assertEqual(similarity, -1.0)

    def test_build_prompt_handles_missing_context_and_history(self) -> None:
        messages = rag_main.build_prompt("What is the answer?", [], [])

        self.assertEqual(messages[0]["role"], "system")
        self.assertIn("No matching chunks found.", messages[1]["content"])
        self.assertIn("No prior history.", messages[1]["content"])

    def test_expire_finished_ingest_jobs_removes_only_stale_finished_jobs(self) -> None:
        original_redis = getattr(rag_main.state, "redis", None)
        redis = FakeRedis()
        rag_main.state.redis = redis
        old_job = rag_main.IngestJobStatusResponse(
                job_id="old-completed",
                status="completed",
                user_id="user-1",
                tenant_id="default",
                source="seed",
                submitted_at="2026-01-01T00:00:00Z",
                finished_at="2026-01-01T00:00:00Z",
            )
        recent_job = rag_main.IngestJobStatusResponse(
                job_id="recent-running",
                status="running",
                user_id="user-1",
                tenant_id="default",
                source="seed",
                submitted_at=rag_main.utc_now(),
            )
        asyncio.run(redis.set("ingest:job:old-completed", old_job.model_dump_json(), ex=60))
        asyncio.run(redis.set("ingest:job:recent-running", recent_job.model_dump_json(), ex=60))
        asyncio.run(redis.set("ingest:payload:old-completed", "{}", ex=60))
        asyncio.run(redis.set("ingest:payload:recent-running", "{}", ex=60))

        try:
            asyncio.run(rag_main.expire_finished_ingest_jobs(ingest_job_ttl=1))

            self.assertIsNone(asyncio.run(redis.get("ingest:job:old-completed")))
            self.assertIsNone(asyncio.run(redis.get("ingest:payload:old-completed")))
            self.assertIsNotNone(asyncio.run(redis.get("ingest:job:recent-running")))
            self.assertIsNotNone(asyncio.run(redis.get("ingest:payload:recent-running")))
        finally:
            rag_main.state.redis = original_redis

    def test_cache_lookup_limits_candidates_within_scope(self) -> None:
        async def run_test() -> None:
            original_redis = getattr(rag_main.state, "redis", None)
            original_threshold = rag_main.settings.cache_threshold
            original_limit = rag_main.settings.cache_lookup_max_candidates
            rag_main.state.redis = FakeRedis()
            rag_main.settings.cache_threshold = 0.95
            rag_main.settings.cache_lookup_max_candidates = 2

            try:
                await rag_main.cache_store(
                    [1.0, 0.0],
                    "user-1",
                    "tenant-a",
                    rag_main.QueryResponse(
                        answer="older exact match",
                        cache_hit=False,
                        chunks_used=[],
                        history_used=0,
                        citations=[],
                    ),
                )
                await rag_main.cache_store(
                    [1.0, 0.0],
                    "user-1",
                    "tenant-b",
                    rag_main.QueryResponse(
                        answer="other tenant match",
                        cache_hit=False,
                        chunks_used=[],
                        history_used=0,
                        citations=[],
                    ),
                )
                await rag_main.cache_store(
                    [0.0, 1.0],
                    "user-1",
                    "tenant-a",
                    rag_main.QueryResponse(
                        answer="newer miss one",
                        cache_hit=False,
                        chunks_used=[],
                        history_used=0,
                        citations=[],
                    ),
                )
                await rag_main.cache_store(
                    [0.2, 0.8],
                    "user-1",
                    "tenant-a",
                    rag_main.QueryResponse(
                        answer="newer miss two",
                        cache_hit=False,
                        chunks_used=[],
                        history_used=0,
                        citations=[],
                    ),
                )

                missed = await rag_main.cache_lookup([1.0, 0.0], "user-1", "tenant-a")
                self.assertIsNone(missed)

                rag_main.settings.cache_lookup_max_candidates = 3
                hit = await rag_main.cache_lookup([1.0, 0.0], "user-1", "tenant-a")
                self.assertIsNotNone(hit)
                self.assertEqual(hit.answer, "older exact match")
            finally:
                rag_main.state.redis = original_redis
                rag_main.settings.cache_threshold = original_threshold
                rag_main.settings.cache_lookup_max_candidates = original_limit

        asyncio.run(run_test())

    def test_rerank_candidates_bypasses_cross_encoder_for_filtered_queries(self) -> None:
        class FailingReranker:
            def predict(self, _: object) -> list[float]:
                raise AssertionError("cross encoder should not run for filtered queries")

        original_reranker = getattr(rag_main.state, "reranker", None)
        original_min = rag_main.settings.rerank_min_candidates
        original_top_k = rag_main.settings.top_k_rerank
        try:
            rag_main.state.reranker = FailingReranker()
            rag_main.settings.rerank_min_candidates = 1
            rag_main.settings.top_k_rerank = 2
            ranked = asyncio.run(
                rag_main.rerank_candidates(
                    "renewal payment terms",
                    [
                        {"content": "renewal payment terms are due promptly"},
                        {"content": "shipping details only"},
                        {"content": "renewal and payment policies"},
                    ],
                    source="manual",
                )
            )
        finally:
            rag_main.state.reranker = original_reranker
            rag_main.settings.rerank_min_candidates = original_min
            rag_main.settings.top_k_rerank = original_top_k

        self.assertEqual(len(ranked), 2)
        self.assertIn("renewal", ranked[0]["content"])

    def test_rerank_candidates_uses_cross_encoder_when_candidate_volume_justifies_it(self) -> None:
        class FakeReranker:
            def __init__(self) -> None:
                self.calls = 0

            def predict(self, _: object) -> list[float]:
                self.calls += 1
                return [0.1, 0.9, 0.4]

        original_reranker = getattr(rag_main.state, "reranker", None)
        original_min = rag_main.settings.rerank_min_candidates
        original_top_k = rag_main.settings.top_k_rerank
        reranker = FakeReranker()
        try:
            rag_main.state.reranker = reranker
            rag_main.settings.rerank_min_candidates = 2
            rag_main.settings.top_k_rerank = 2
            ranked = asyncio.run(
                rag_main.rerank_candidates(
                    "payment terms",
                    [
                        {"content": "candidate-a"},
                        {"content": "candidate-b"},
                        {"content": "candidate-c"},
                    ],
                )
            )
        finally:
            rag_main.state.reranker = original_reranker
            rag_main.settings.rerank_min_candidates = original_min
            rag_main.settings.top_k_rerank = original_top_k

        self.assertEqual(reranker.calls, 1)
        self.assertEqual([item["content"] for item in ranked], ["candidate-b", "candidate-c"])

    def test_rerank_candidates_bypasses_cross_encoder_for_direct_hit_similarity(self) -> None:
        class FailingReranker:
            def predict(self, _: object) -> list[float]:
                raise AssertionError("cross encoder should not run for strong direct hits")

        original_reranker = getattr(rag_main.state, "reranker", None)
        original_threshold = rag_main.settings.rerank_direct_hit_threshold
        original_min = rag_main.settings.rerank_min_candidates
        try:
            rag_main.state.reranker = FailingReranker()
            rag_main.settings.rerank_direct_hit_threshold = 0.85
            rag_main.settings.rerank_min_candidates = 1
            ranked = asyncio.run(
                rag_main.rerank_candidates(
                    "payment terms",
                    [
                        {"content": "payment terms are due within 30 days", "similarity": 0.91},
                        {"content": "support details only", "similarity": 0.32},
                    ],
                )
            )
        finally:
            rag_main.state.reranker = original_reranker
            rag_main.settings.rerank_direct_hit_threshold = original_threshold
            rag_main.settings.rerank_min_candidates = original_min

        self.assertEqual(ranked[0]["similarity"], 0.91)
