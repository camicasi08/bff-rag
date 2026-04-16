import asyncio
import base64
import json
import sys
import uuid

import httpx


RAG_BASE_URL = "http://localhost:8000"
BFF_BASE_URL = "http://localhost:3000"
BFF_GRAPHQL_URL = f"{BFF_BASE_URL}/graphql"
DEMO_USER_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "default"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


async def post_json(client: httpx.AsyncClient, url: str, payload: dict) -> dict:
    last_error: Exception | None = None
    for _ in range(10):
        try:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError) as exc:
            last_error = exc
            await asyncio.sleep(2.0)
    assert last_error is not None
    raise last_error


async def get_json(client: httpx.AsyncClient, url: str) -> dict:
    response = await client.get(url)
    response.raise_for_status()
    return response.json()


async def wait_for_json(
    client: httpx.AsyncClient,
    url: str,
    *,
    attempts: int = 30,
    delay_seconds: float = 2.0,
) -> dict:
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            return await get_json(client, url)
        except Exception as exc:
            last_error = exc
            await asyncio.sleep(delay_seconds)
    assert last_error is not None
    raise last_error


async def collect_sse_events(client: httpx.AsyncClient, url: str, params: dict[str, str]) -> list[str]:
    events: list[str] = []
    async with client.stream("GET", url, params=params, headers={"Accept": "text/event-stream"}) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if line:
                events.append(line)
            if line == "event: done":
                break
    return events


async def wait_for_ingest_job(client: httpx.AsyncClient, job_id: str, *, attempts: int = 60) -> dict:
    last_payload: dict | None = None
    for _ in range(attempts):
        response = await client.get(f"{RAG_BASE_URL}/admin/ingest/jobs/{job_id}")
        response.raise_for_status()
        last_payload = response.json()
        if last_payload.get("status") in {"completed", "failed"}:
            return last_payload
        await asyncio.sleep(1.0)
    raise AssertionError(f"Ingest job {job_id} did not finish in time: {last_payload}")


async def main() -> None:
    run_id = uuid.uuid4().hex[:8]
    unique_phrase = f"alpha-term-{run_id}"
    unique_support_phrase = f"support-window-{run_id}"
    query_text = f"What are the payment terms for {unique_phrase}?"
    source_name = f"smoke-test-{run_id}"

    async with httpx.AsyncClient(timeout=90.0) as client:
        health = await wait_for_json(client, f"{RAG_BASE_URL}/health")
        require(health.get("status") == "ok", "RAG health check failed")

        cache_before = await get_json(client, f"{RAG_BASE_URL}/cache/stats")

        ingest_payload = {
            "source": source_name,
            "documents": [
                {
                    "title": f"Payment Terms {run_id}",
                    "category": "billing",
                    "metadata_json": json.dumps({"region": "global"}),
                    "content": (
                        f"Invoices tagged {unique_phrase} are due within 30 days. "
                        "Enterprise customers may request net-45 terms with finance approval."
                    ),
                },
                {
                    "title": f"Support Policy {run_id}",
                    "category": "support",
                    "metadata_json": json.dumps({"region": "global"}),
                    "content": (
                        f"The {unique_support_phrase} priority support program runs Monday to Friday. "
                        "Gold plan users receive a first response target of 2 hours."
                    ),
                },
            ],
            "files": [
                {
                    "filename": f"File Policy {run_id}.md",
                    "title": f"File Policy {run_id}",
                    "category": "billing",
                    "metadata_json": json.dumps({"region": "global", "ingest_type": "file"}),
                    "content_base64": base64.b64encode(
                        (
                            f"# File Policy\nInvoices tagged {unique_phrase} include file-backed billing guidance.\n"
                            "Markdown uploads should be ingested through the same pipeline."
                        ).encode("utf-8")
                    ).decode("ascii"),
                }
            ],
        }
        graphql_ingest_mutation = """
mutation AdminIngest($input: AdminIngestInput!) {
  adminIngest(input: $input) {
    job_id
    status
  }
}
"""
        graphql_ingest = await post_json(
            client,
            BFF_GRAPHQL_URL,
            {"query": graphql_ingest_mutation, "variables": {"input": ingest_payload}},
        )
        queued_ingest = graphql_ingest.get("data", {}).get("adminIngest")
        require(queued_ingest is not None, "GraphQL adminIngest did not return data")
        require(queued_ingest.get("status") == "queued", "GraphQL adminIngest did not queue the ingest job")
        ingest = await wait_for_ingest_job(client, queued_ingest["job_id"])
        require(ingest.get("status") == "completed", "Document ingest job did not complete successfully")
        require(ingest.get("inserted_chunks", 0) >= 3, "Document ingest did not insert expected chunks")

        duplicate_graphql_ingest = await post_json(
            client,
            BFF_GRAPHQL_URL,
            {"query": graphql_ingest_mutation, "variables": {"input": ingest_payload}},
        )
        duplicate_queued = duplicate_graphql_ingest.get("data", {}).get("adminIngest")
        require(duplicate_queued is not None, "Duplicate GraphQL adminIngest did not return data")
        duplicate_ingest = await wait_for_ingest_job(client, duplicate_queued["job_id"])
        require(duplicate_ingest.get("status") == "completed", "Duplicate ingest job did not complete successfully")
        require(duplicate_ingest.get("inserted_chunks") == 0, "Duplicate ingest should not insert chunks again")
        require(duplicate_ingest.get("skipped_duplicates", 0) >= 1, "Duplicate ingest should report skipped duplicates")

        first_query_payload = {
            "user_id": DEMO_USER_ID,
            "tenant_id": TENANT_ID,
            "query": query_text,
            "stream": False,
            "source": source_name,
            "category": "billing",
            "title_contains": "Payment Terms",
        }
        first = await post_json(client, f"{RAG_BASE_URL}/query", first_query_payload)
        require(first.get("cache_hit") is False, "First RAG query unexpectedly hit the cache")
        require(unique_phrase in first.get("answer", "") or first.get("chunks_used"), "First RAG query returned no useful context")
        require(
            any(unique_phrase in chunk for chunk in first.get("chunks_used", [])),
            "First RAG query did not retrieve the unique payment chunk",
        )
        require(first.get("citations"), "First RAG query did not include citations")
        require(
            any(unique_phrase in citation.get("excerpt", "") for citation in first.get("citations", [])),
            "First RAG query citations did not include the unique payment chunk",
        )

        second = await post_json(client, f"{RAG_BASE_URL}/query", first_query_payload)
        require(second.get("cache_hit") is True, "Second RAG query did not hit the cache")
        require(second.get("answer") == first.get("answer"), "Cached answer does not match the original answer")
        require(second.get("citations") == first.get("citations"), "Cached citations do not match the original query response")

        filtered = await post_json(
            client,
            f"{RAG_BASE_URL}/query",
            first_query_payload,
        )
        require(filtered.get("citations"), "Filtered query did not return citations")
        require(
            all(citation.get("source") == source_name for citation in filtered.get("citations", [])),
            "Filtered query returned citations from the wrong source",
        )
        require(
            all(citation.get("title", "").startswith("Payment Terms") for citation in filtered.get("citations", [])),
            "Filtered query returned citations outside the requested title filter",
        )

        graphql_cache_stats = await post_json(
            client,
            BFF_GRAPHQL_URL,
            {"query": "{ cacheStats { cached_entries } }"},
        )
        cached_entries = graphql_cache_stats.get("data", {}).get("cacheStats", {}).get("cached_entries")
        require(isinstance(cached_entries, int), "GraphQL cacheStats did not return a numeric cached_entries value")
        require(cached_entries >= cache_before.get("cached_entries", 0), "Cache entry count did not stay consistent")

        graphql_metrics = await post_json(
            client,
            BFF_GRAPHQL_URL,
            {
                "query": "{ metricsSummary { total_queries cache_hits cache_misses cache_hit_rate total_ingest_requests total_chunks_ingested skipped_duplicates } }",
            },
        )
        metrics = graphql_metrics.get("data", {}).get("metricsSummary")
        require(metrics is not None, "GraphQL metricsSummary did not return data")
        require(metrics.get("total_queries", 0) >= 3, "Metrics summary total_queries is lower than expected")
        require(metrics.get("cache_hits", 0) >= 1, "Metrics summary cache_hits is lower than expected")
        require(metrics.get("cache_misses", 0) >= 1, "Metrics summary cache_misses is lower than expected")

        graphql_ask = await post_json(
            client,
            BFF_GRAPHQL_URL,
            {
                "query": f'{{ ask(query: "{query_text}", filters: {{ source: "{source_name}", category: "billing", title_contains: "Payment Terms" }}) {{ answer cache_hit chunks_used history_used citations {{ title excerpt source chunk_index }} }} }}',
            },
        )
        ask_payload = graphql_ask.get("data", {}).get("ask")
        require(ask_payload is not None, "GraphQL ask query did not return data")
        require(ask_payload.get("cache_hit") is True, "GraphQL ask should hit the warm cache")
        require(ask_payload.get("answer") == first.get("answer"), "GraphQL answer does not match direct RAG answer")
        require(ask_payload.get("citations"), "GraphQL ask did not include citations")
        require(
            all(citation.get("source") == source_name for citation in ask_payload.get("citations", [])),
            "GraphQL ask returned citations from the wrong source",
        )

        history = await post_json(
            client,
            BFF_GRAPHQL_URL,
            {"query": "{ conversationHistory(limit: 4) { role content created_at } }"},
        )
        turns = history.get("data", {}).get("conversationHistory")
        require(turns is not None, "GraphQL conversationHistory did not return data")
        require(len(turns) >= 2, "Conversation history should include the latest user and assistant turns")
        require(any(query_text in turn.get("content", "") for turn in turns), "Conversation history is missing the user query")

        admin_overview = await post_json(
            client,
            BFF_GRAPHQL_URL,
            {"query": "{ adminOverview { cached_entries total_chunks total_conversations metrics { total_queries cache_hits skipped_duplicates } } }"},
        )
        overview = admin_overview.get("data", {}).get("adminOverview")
        require(overview is not None, "GraphQL adminOverview did not return data")
        require(overview.get("total_chunks", 0) >= 2, "Admin overview total_chunks is lower than expected")
        require(overview.get("total_conversations", 0) >= 2, "Admin overview total_conversations is lower than expected")

        admin_chunks = await post_json(
            client,
            BFF_GRAPHQL_URL,
            {
                "query": f'{{ adminChunks(limit: 5, filters: {{ source: "{source_name}", category: "billing", title_contains: "Payment Terms" }}) {{ source title category excerpt content_hash }} }}',
            },
        )
        chunks = admin_chunks.get("data", {}).get("adminChunks")
        require(chunks is not None, "GraphQL adminChunks did not return data")
        require(len(chunks) >= 1, "Admin chunks query returned no rows")
        require(all(chunk.get("source") == source_name for chunk in chunks), "Admin chunks returned the wrong source")
        require(all(chunk.get("category") == "billing" for chunk in chunks), "Admin chunks returned the wrong category")

        stream_events = await collect_sse_events(
            client,
            f"{BFF_BASE_URL}/rag/stream",
            {
                "query": query_text,
                "source": source_name,
                "category": "billing",
                "title_contains": "Payment Terms",
            },
        )
        require(any(event.startswith("data: ") for event in stream_events), "BFF SSE stream returned no token events")
        require("event: done" in stream_events, "BFF SSE stream did not finish cleanly")

        wrong_tenant = await post_json(
            client,
            f"{RAG_BASE_URL}/query",
            {
                "user_id": DEMO_USER_ID,
                "tenant_id": "other-tenant",
                "query": query_text,
                "stream": False,
            },
        )
        require(wrong_tenant.get("chunks_used") == [], "Wrong-tenant query should not retrieve any chunks")

    print(
        json.dumps(
            {
                "status": "ok",
                "run_id": run_id,
                "query": query_text,
                "checks": [
                    "rag_health",
                    "graphql_admin_ingest",
                    "direct_query_miss",
                    "direct_query_cache_hit",
                    "deduplicated_ingest",
                    "metadata_filtered_query",
                    "graphql_cache_stats",
                    "graphql_metrics_summary",
                    "graphql_ask_cache_hit",
                    "graphql_history",
                    "graphql_admin_visibility",
                    "bff_sse_stream",
                    "tenant_isolation",
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"SMOKE TEST FAILED: {exc}", file=sys.stderr)
        raise
