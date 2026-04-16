import asyncio
import json

import httpx


RAG_BASE_URL = "http://localhost:8000"
BFF_GRAPHQL_URL = "http://localhost:3000/graphql"
DEMO_USER_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "default"


async def wait_for_ingest_job(client: httpx.AsyncClient, job_id: str) -> dict:
    for _ in range(60):
        response = await client.get(f"{RAG_BASE_URL}/admin/ingest/jobs/{job_id}")
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") in {"completed", "failed"}:
            return payload
        await asyncio.sleep(1.0)
    raise TimeoutError(f"Ingest job {job_id} did not finish in time")


async def main() -> None:
    async with httpx.AsyncClient(timeout=60.0) as client:
        ingest_payload = {
            "user_id": DEMO_USER_ID,
            "tenant_id": TENANT_ID,
            "source": "seed",
            "documents": [
                {
                    "title": "Payment Terms",
                    "content": (
                        "Invoices are due within 30 days. Enterprise customers may request "
                        "net-45 terms with finance approval."
                    ),
                },
                {
                    "title": "Support Policy",
                    "content": (
                        "Priority support is available Monday to Friday. Gold plan users "
                        "receive a first response target of 2 hours."
                    ),
                },
            ],
        }
        ingest = await client.post(f"{RAG_BASE_URL}/admin/ingest/jobs", json=ingest_payload)
        ingest.raise_for_status()
        queued = ingest.json()
        print("ingest job queued:", json.dumps(queued, indent=2))

        job = await wait_for_ingest_job(client, queued["job_id"])
        print("ingest job result:", json.dumps(job, indent=2))

        query_payload = {
            "user_id": DEMO_USER_ID,
            "tenant_id": TENANT_ID,
            "query": "payment terms",
            "stream": False,
        }
        first = await client.post(f"{RAG_BASE_URL}/query", json=query_payload)
        first.raise_for_status()
        print("first query:", json.dumps(first.json(), indent=2))

        second = await client.post(f"{RAG_BASE_URL}/query", json=query_payload)
        second.raise_for_status()
        print("second query:", json.dumps(second.json(), indent=2))

        graphql = await client.post(
            BFF_GRAPHQL_URL,
            json={"query": "{ cacheStats { cached_entries } }"},
        )
        graphql.raise_for_status()
        print("graphql:", json.dumps(graphql.json(), indent=2))


if __name__ == "__main__":
    asyncio.run(main())
