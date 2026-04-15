import json
import sys
import time
import uuid
from pathlib import Path
from urllib import error, parse, request


ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = ROOT / "tests" / "eval_cases.json"
RAG_BASE_URL = "http://localhost:8000"
USER_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "default"


def http_json(method: str, url: str, payload: dict | None = None) -> dict:
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, method=method, data=data, headers=headers)
    try:
        with request.urlopen(req, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed with {exc.code}: {detail}") from exc


def wait_for_job(job_id: str) -> dict:
    for _ in range(90):
        payload = http_json("GET", f"{RAG_BASE_URL}/admin/ingest/jobs/{job_id}")
        if payload.get("status") in {"completed", "failed"}:
            return payload
        time.sleep(1.0)
    raise TimeoutError(f"Ingest job {job_id} did not finish in time")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    with CASES_PATH.open("r", encoding="utf-8") as handle:
        cases = json.load(handle)

    run_id = uuid.uuid4().hex[:8]
    source = f"eval-{run_id}"
    documents = [
        {
            "title": case["title"],
            "category": case["category"],
            "content": case["content"],
            "metadata": {"evaluation_case": case["id"]},
        }
        for case in cases
    ]

    queued = http_json(
        "POST",
        f"{RAG_BASE_URL}/admin/ingest/jobs",
        {
            "user_id": USER_ID,
            "tenant_id": TENANT_ID,
            "source": source,
            "documents": documents,
        },
    )
    job = wait_for_job(queued["job_id"])
    require(job.get("status") == "completed", f"Evaluation ingest job failed: {job}")
    require(job.get("inserted_chunks", 0) >= len(cases), "Evaluation ingest inserted fewer chunks than expected")

    results: list[dict] = []
    for case in cases:
        payload = {
            "user_id": USER_ID,
            "tenant_id": TENANT_ID,
            "query": case["query"],
            "stream": False,
            "source": source,
            **case.get("filters", {}),
        }
        first = http_json("POST", f"{RAG_BASE_URL}/query", payload)
        second = http_json("POST", f"{RAG_BASE_URL}/query", payload)

        citations = first.get("citations", [])
        answer = first.get("answer", "")
        require(answer.strip(), f"{case['id']} returned an empty answer")
        require(citations, f"{case['id']} returned no citations")
        require(first.get("cache_hit") is False, f"{case['id']} first query unexpectedly hit cache")
        require(second.get("cache_hit") is True, f"{case['id']} second query did not hit cache")
        require(
            any(case["title"] in citation.get("title", "") for citation in citations),
            f"{case['id']} citations did not include the expected title",
        )
        require(
            all(citation.get("source") == source for citation in citations),
            f"{case['id']} citations returned the wrong source",
        )
        for term in case.get("expected_excerpt_terms", []):
            require(
                any(term in citation.get("excerpt", "") for citation in citations),
                f"{case['id']} citations did not include excerpt term {term!r}",
            )
        for term in case.get("expected_answer_terms", []):
            require(term.lower() in answer.lower(), f"{case['id']} answer did not include term {term!r}")

        results.append(
            {
                "id": case["id"],
                "cache_hit_second_query": second.get("cache_hit"),
                "citations": len(citations),
                "answer_preview": answer[:120],
            }
        )

    print(
        json.dumps(
            {
                "status": "ok",
                "source": source,
                "cases": results,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"EVALUATION FAILED: {exc}", file=sys.stderr)
        raise
