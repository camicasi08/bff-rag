import asyncio
import hashlib
import json
from typing import Any, AsyncIterator

import httpx
from fastapi import HTTPException
from sqlalchemy import text

from .config import settings
from .models import AdminChunkResponse, QueryResponse
from .state import state
from .utils import (
    build_citations,
    build_prompt,
    cosine_similarity,
    decode_embedding,
    encode_embedding,
    filter_signature,
    normalize,
    vec_to_string,
)


async def embed(text_value: str) -> list[float]:
    try:
        response = await state.http.post(
            f"{settings.ollama_url}/api/embed",
            json={"model": settings.embed_model, "input": text_value},
            timeout=60.0,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Embedding request failed: {exc}") from exc

    embeddings = payload.get("embeddings") or []
    if not embeddings:
        raise HTTPException(status_code=502, detail="Embedding model returned no vectors")

    embedding = normalize(embeddings[0])
    if len(embedding) != settings.embed_dims:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected embedding dims: {len(embedding)} != {settings.embed_dims}",
        )
    return embedding


async def cache_lookup(
    query_emb: list[float],
    user_id: str,
    tenant_id: str,
    *,
    source: str | None = None,
    category: str | None = None,
    title_contains: str | None = None,
) -> QueryResponse | None:
    best_score = -1.0
    best_response: QueryResponse | None = None
    expected_signature = filter_signature(source, category, title_contains)

    async for key in state.redis.scan_iter("semcache:*"):
        entry = await state.redis.hgetall(key)
        if not entry:
            continue
        if entry.get("user_id") != user_id or entry.get("tenant_id") != tenant_id:
            continue
        if entry.get("filter_signature") != expected_signature:
            continue

        cached_emb = decode_embedding(entry["embedding"])
        score = cosine_similarity(query_emb, cached_emb)
        if score >= settings.cache_threshold and score > best_score:
            best_score = score
            if "response_payload" in entry:
                best_response = QueryResponse.model_validate(json.loads(entry["response_payload"]))
            else:
                best_response = QueryResponse(
                    answer=entry["response"],
                    cache_hit=True,
                    chunks_used=[],
                    history_used=0,
                    citations=[],
                )

    return best_response


async def retrieve(
    query_emb: list[float],
    user_id: str,
    tenant_id: str,
    *,
    source: str | None = None,
    category: str | None = None,
    title_contains: str | None = None,
) -> list[dict[str, Any]]:
    vector_str = vec_to_string(query_emb)
    filters = ["tenant_id = :tenant_id", "user_id = :user_id"]
    params: dict[str, Any] = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "vec": vector_str,
        "limit": settings.top_k_retrieve,
    }
    if source:
        filters.append("source = :source")
        params["source"] = source
    if category:
        filters.append("metadata ->> 'category' = :category")
        params["category"] = category
    if title_contains:
        filters.append("metadata ->> 'title' ILIKE :title_pattern")
        params["title_pattern"] = f"%{title_contains}%"

    sql = text(
        f"""
        SELECT id, source, content, metadata, chunk_index
        FROM document_chunks
        WHERE {' AND '.join(filters)}
        ORDER BY embedding <=> CAST(:vec AS vector)
        LIMIT :limit
        """
    )

    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        rows = await session.execute(sql, params)
        return [dict(row._mapping) for row in rows]


def _simple_overlap_score(query: str, content: str) -> float:
    query_tokens = set(query.lower().split())
    content_tokens = set(content.lower().split())
    if not query_tokens:
        return 0.0
    return len(query_tokens & content_tokens) / len(query_tokens)


async def rerank(query: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not candidates:
        return []
    if state.reranker is None:
        ranked = sorted(candidates, key=lambda item: _simple_overlap_score(query, item["content"]), reverse=True)
        return ranked[: settings.top_k_rerank]

    pairs = [(query, candidate["content"]) for candidate in candidates]
    scores = await asyncio.to_thread(state.reranker.predict, pairs)
    for candidate, score in zip(candidates, scores):
        candidate["score"] = float(score)
    ranked = sorted(candidates, key=lambda item: item["score"], reverse=True)
    return ranked[: settings.top_k_rerank]


async def get_history(user_id: str, tenant_id: str, limit: int = 6) -> list[dict[str, str]]:
    sql = text(
        """
        SELECT role, content, created_at
        FROM conversations
        WHERE tenant_id = :tenant_id AND user_id = :user_id
        ORDER BY created_at DESC
        LIMIT :limit
        """
    )
    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        rows = await session.execute(sql, {"tenant_id": tenant_id, "user_id": user_id, "limit": limit})
        history = [dict(row._mapping) for row in rows]

    history.reverse()
    for turn in history:
        turn["created_at"] = turn["created_at"].isoformat()
    return history


async def llm_complete(messages: list[dict[str, str]]) -> str:
    try:
        response = await state.http.post(
            f"{settings.ollama_url}/api/chat",
            json={"model": settings.llm_model, "messages": messages, "stream": False},
            timeout=120.0,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}") from exc
    return payload["message"]["content"]


async def llm_stream(messages: list[dict[str, str]]) -> AsyncIterator[str]:
    try:
        async with state.http.stream(
            "POST",
            f"{settings.ollama_url}/api/chat",
            json={"model": settings.llm_model, "messages": messages, "stream": True},
            timeout=120.0,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                data = json.loads(line)
                piece = data.get("message", {}).get("content", "")
                if piece:
                    yield piece
                if data.get("done"):
                    break
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Streaming LLM request failed: {exc}") from exc


async def stream_cached_answer(answer: str) -> AsyncIterator[str]:
    if answer:
        yield f"data: {json.dumps({'token': answer})}\n\n"
    yield "event: done\ndata: {}\n\n"


async def cache_store(
    query_emb: list[float],
    user_id: str,
    tenant_id: str,
    response: QueryResponse,
    *,
    source: str | None = None,
    category: str | None = None,
    title_contains: str | None = None,
) -> None:
    cache_key = f"semcache:{hashlib.sha256(encode_embedding(query_emb).encode('utf-8')).hexdigest()}"
    await state.redis.hset(
        cache_key,
        mapping={
            "embedding": encode_embedding(query_emb),
            "user_id": user_id,
            "tenant_id": tenant_id,
            "filter_signature": filter_signature(source, category, title_contains),
            "response": response.answer,
            "response_payload": response.model_dump_json(),
        },
    )
    await state.redis.expire(cache_key, settings.cache_ttl)


async def save_turn(user_id: str, tenant_id: str, role: str, content: str) -> None:
    sql = text(
        """
        INSERT INTO conversations (tenant_id, user_id, role, content)
        VALUES (:tenant_id, :user_id, :role, :content)
        """
    )
    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        await session.execute(sql, {"tenant_id": tenant_id, "user_id": user_id, "role": role, "content": content})
        await session.commit()


async def admin_overview_counts(user_id: str, tenant_id: str) -> dict[str, int]:
    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        chunk_count_result = await session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM document_chunks
                WHERE tenant_id = :tenant_id AND user_id = :user_id
                """
            ),
            {"tenant_id": tenant_id, "user_id": user_id},
        )
        conversation_count_result = await session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM conversations
                WHERE tenant_id = :tenant_id AND user_id = :user_id
                """
            ),
            {"tenant_id": tenant_id, "user_id": user_id},
        )
    return {
        "total_chunks": int(chunk_count_result.scalar_one()),
        "total_conversations": int(conversation_count_result.scalar_one()),
    }


async def list_admin_chunks(
    user_id: str,
    tenant_id: str,
    *,
    limit: int = 10,
    source: str | None = None,
    category: str | None = None,
    title_contains: str | None = None,
) -> list[AdminChunkResponse]:
    filters = ["tenant_id = :tenant_id", "user_id = :user_id"]
    params: dict[str, Any] = {"tenant_id": tenant_id, "user_id": user_id, "limit": limit}
    if source:
        filters.append("source = :source")
        params["source"] = source
    if category:
        filters.append("metadata ->> 'category' = :category")
        params["category"] = category
    if title_contains:
        filters.append("metadata ->> 'title' ILIKE :title_pattern")
        params["title_pattern"] = f"%{title_contains}%"

    sql = text(
        f"""
        SELECT id, source, chunk_index, content, metadata, created_at
        FROM document_chunks
        WHERE {' AND '.join(filters)}
        ORDER BY created_at DESC
        LIMIT :limit
        """
    )

    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        rows = await session.execute(sql, params)
        items = []
        for row in rows:
            record = dict(row._mapping)
            metadata = record.get("metadata") or {}
            items.append(
                AdminChunkResponse(
                    chunk_id=str(record["id"]),
                    source=record["source"],
                    title=metadata.get("title", record["source"]),
                    category=metadata.get("category"),
                    chunk_index=int(record["chunk_index"]),
                    excerpt=record["content"][:240],
                    created_at=record["created_at"].isoformat(),
                    content_hash=metadata.get("content_hash"),
                )
            )
    return items
