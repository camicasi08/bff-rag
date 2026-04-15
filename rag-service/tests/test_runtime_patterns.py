import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "main.py"
SPEC = importlib.util.spec_from_file_location("rag_service_main_runtime", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
rag_main = importlib.util.module_from_spec(SPEC)
sys.modules["rag_service_main_runtime"] = rag_main
SPEC.loader.exec_module(rag_main)


class RagServiceRuntimePatternsTest(unittest.TestCase):
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
        rag_main.state.ingest_jobs = {
            "old-completed": rag_main.IngestJobStatusResponse(
                job_id="old-completed",
                status="completed",
                user_id="user-1",
                tenant_id="default",
                source="seed",
                submitted_at="2026-01-01T00:00:00Z",
                finished_at="2026-01-01T00:00:00Z",
            ),
            "recent-running": rag_main.IngestJobStatusResponse(
                job_id="recent-running",
                status="running",
                user_id="user-1",
                tenant_id="default",
                source="seed",
                submitted_at=rag_main.utc_now(),
            ),
        }
        rag_main.state.ingest_payloads = {
            "old-completed": object(),
            "recent-running": object(),
        }

        rag_main.expire_finished_ingest_jobs(ingest_job_ttl=1)

        self.assertNotIn("old-completed", rag_main.state.ingest_jobs)
        self.assertNotIn("old-completed", rag_main.state.ingest_payloads)
        self.assertIn("recent-running", rag_main.state.ingest_jobs)
        self.assertIn("recent-running", rag_main.state.ingest_payloads)
