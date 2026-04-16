import importlib.util
import asyncio
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "main.py"
SPEC = importlib.util.spec_from_file_location("rag_service_main", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
rag_main = importlib.util.module_from_spec(SPEC)
sys.modules["rag_service_main"] = rag_main
SPEC.loader.exec_module(rag_main)


class RagServiceHelpersTest(unittest.TestCase):
    def test_normalize_returns_unit_vector(self) -> None:
        normalized = rag_main.normalize([3.0, 4.0])

        self.assertAlmostEqual(normalized[0], 0.6, places=5)
        self.assertAlmostEqual(normalized[1], 0.8, places=5)

    def test_encode_and_decode_embedding_round_trip(self) -> None:
        embedding = [0.1, -0.25, 0.5]

        encoded = rag_main.encode_embedding(embedding)
        decoded = rag_main.decode_embedding(encoded)

        self.assertEqual(len(decoded), len(embedding))
        for original, restored in zip(embedding, decoded):
            self.assertAlmostEqual(original, restored, places=5)

    def test_build_citations_uses_metadata_and_content_excerpt(self) -> None:
        chunks = [
            {
                "id": "chunk-1",
                "source": "seed",
                "chunk_index": 2,
                "content": "Invoices tagged alpha-term are due within 30 days.",
                "metadata": {"title": "Payment Terms"},
            }
        ]

        citations = rag_main.build_citations(chunks)

        self.assertEqual(len(citations), 1)
        self.assertEqual(citations[0].chunk_id, "chunk-1")
        self.assertEqual(citations[0].title, "Payment Terms")
        self.assertIn("alpha-term", citations[0].excerpt)

    def test_build_prompt_includes_context_and_history(self) -> None:
        messages = rag_main.build_prompt(
            "What are the payment terms?",
            [{"content": "Invoices are due within 30 days."}],
            [{"role": "user", "content": "I need invoice details.", "created_at": "2026-01-01T00:00:00"}],
        )

        self.assertEqual(messages[0]["role"], "system")
        self.assertIn("Invoices are due within 30 days.", messages[1]["content"])
        self.assertIn("user: I need invoice details.", messages[1]["content"])

    def test_split_document_creates_overlapping_chunks(self) -> None:
        content = "abcdefghij"

        chunks = rag_main.split_document(content, chunk_size=4, overlap=1)

        self.assertEqual(chunks, ["abcd", "defg", "ghij"])

    def test_vec_to_string_formats_pgvector_literal(self) -> None:
        vec = rag_main.vec_to_string([1.0, 2.5, -3.25])

        self.assertEqual(vec, "[1.000000,2.500000,-3.250000]")

    def test_compute_content_hash_is_stable_for_same_document(self) -> None:
        first = rag_main.compute_content_hash("seed", "Payment Terms", "Invoices are due within 30 days.")
        second = rag_main.compute_content_hash("seed", "Payment Terms", "Invoices are due within 30 days.")

        self.assertEqual(first, second)

    def test_compute_content_hash_changes_when_source_changes(self) -> None:
        first = rag_main.compute_content_hash("seed-a", "Payment Terms", "Invoices are due within 30 days.")
        second = rag_main.compute_content_hash("seed-b", "Payment Terms", "Invoices are due within 30 days.")

        self.assertNotEqual(first, second)

    def test_create_ingest_job_registers_queued_job(self) -> None:
        rag_main.state.ingest_queue = asyncio.Queue()
        rag_main.state.ingest_jobs = {}
        rag_main.state.ingest_payloads = {}

        payload = rag_main.IngestRequest(
            user_id="user-1",
            tenant_id="default",
            source="manual",
            documents=[rag_main.DocumentIn(title="Doc", content="hello world")],
        )

        job = rag_main.create_ingest_job(payload)

        self.assertEqual(job.status, "queued")
        self.assertEqual(rag_main.state.ingest_jobs[job.job_id].status, "queued")
        self.assertEqual(rag_main.state.ingest_payloads[job.job_id].user_id, "user-1")


if __name__ == "__main__":
    unittest.main()
