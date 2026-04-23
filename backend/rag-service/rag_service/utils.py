import base64
import hashlib
import json
import logging
import math
import struct
import time
from typing import Any

import numpy as np

from .config import settings
from .models import Citation


logger = logging.getLogger("rag-service")
APPROX_CHARS_PER_TOKEN = 3


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")


def filter_signature(source: str | None, category: str | None, title_contains: str | None) -> str:
    return json.dumps(
        {
            "source": source,
            "category": category,
            "title_contains": title_contains,
        },
        sort_keys=True,
    )


def log_event(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    logger.info(json.dumps(payload, default=str))


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def normalize(vector: list[float]) -> list[float]:
    arr = np.asarray(vector, dtype=np.float32)
    norm = np.linalg.norm(arr)
    if norm == 0:
        return arr.tolist()
    return (arr / norm).tolist()


def vec_to_string(embedding: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in embedding) + "]"


def compute_content_hash(source: str, title: str, content: str) -> str:
    payload = f"{source}\n{title}\n{content}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def encode_embedding(embedding: list[float]) -> str:
    payload = struct.pack(f"{len(embedding)}f", *embedding)
    return base64.b64encode(payload).decode("ascii")


def decode_embedding(payload: str) -> list[float]:
    raw = base64.b64decode(payload.encode("ascii"))
    count = len(raw) // 4
    return list(struct.unpack(f"{count}f", raw))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return -1.0
    return float(np.dot(np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)))


def build_citations(top_chunks: list[dict[str, Any]]) -> list[Citation]:
    citations: list[Citation] = []
    for chunk in top_chunks:
        metadata = chunk.get("metadata") or {}
        citations.append(
            Citation(
                chunk_id=str(chunk["id"]),
                source=chunk.get("source", "unknown"),
                title=metadata.get("title", chunk.get("source", "Untitled")),
                chunk_index=int(chunk.get("chunk_index", 0)),
                excerpt=chunk["content"][:240],
            )
        )
    return citations


def _trim_text(value: str, limit: int) -> str:
    if limit <= 0 or len(value) <= limit:
        return value
    if limit <= 3:
        return value[:limit]
    return value[: limit - 3].rstrip() + "..."


def approximate_token_count(value: str) -> int:
    if not value:
        return 0
    return max(1, math.ceil(len(value) / APPROX_CHARS_PER_TOKEN))


def trim_text_to_token_budget(value: str, token_budget: int) -> str:
    if token_budget <= 0:
        return ""
    char_budget = token_budget * APPROX_CHARS_PER_TOKEN
    return _trim_text(value, char_budget)


def prepare_prompt_inputs(
    top_chunks: list[dict[str, Any]],
    history: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    max_context_tokens = max(settings.query_max_context_tokens, 0)
    max_history_tokens = max(settings.query_max_history_tokens, 0)
    chunk_budget = math.floor(max_context_tokens / max(len(top_chunks), 1)) if max_context_tokens else 0

    trimmed_chunks: list[dict[str, Any]] = []
    remaining_context_tokens = max_context_tokens
    for chunk in top_chunks:
        if remaining_context_tokens <= 0:
            break
        chunk_limit = min(remaining_context_tokens, chunk_budget or remaining_context_tokens)
        content = trim_text_to_token_budget(chunk["content"], chunk_limit)
        trimmed_chunk = dict(chunk)
        trimmed_chunk["content"] = content
        trimmed_chunks.append(trimmed_chunk)
        remaining_context_tokens -= approximate_token_count(content)

    trimmed_history: list[dict[str, str]] = []
    remaining_history_tokens = max_history_tokens
    selected_history = history[-settings.query_history_limit :] if settings.query_history_limit > 0 else []
    for turn in reversed(selected_history):
        content = turn.get("content", "").strip()
        if not content or remaining_history_tokens <= 0:
            continue
        trimmed_content = trim_text_to_token_budget(content, remaining_history_tokens)
        trimmed_turn = dict(turn)
        trimmed_turn["content"] = trimmed_content
        trimmed_history.append(trimmed_turn)
        remaining_history_tokens -= approximate_token_count(trimmed_content)

    trimmed_history.reverse()
    return trimmed_chunks, trimmed_history


def build_prompt(
    query: str,
    top_chunks: list[dict[str, Any]],
    history: list[dict[str, str]],
    *,
    already_prepared: bool = False,
) -> list[dict[str, str]]:
    prepared_chunks, prepared_history = (
        (top_chunks, history) if already_prepared else prepare_prompt_inputs(top_chunks, history)
    )
    context = "\n\n".join(f"[{index + 1}] {chunk['content']}" for index, chunk in enumerate(prepared_chunks))
    transcript = "\n".join(f"{turn['role']}: {turn['content']}" for turn in prepared_history)
    system = (
        "You are a contextual assistant for a BFF RAG system. "
        "Use the provided chunks first, keep answers grounded, and say when context is missing."
    )
    user_message = (
        f"Relevant context:\n{context or 'No matching chunks found.'}\n\n"
        f"Conversation history:\n{transcript or 'No prior history.'}\n\n"
        f"User question: {query}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_message},
    ]


def split_document(content: str, chunk_size: int = 500, overlap: int = 100) -> list[str]:
    chunks: list[str] = []
    start = 0
    while start < len(content):
        end = min(len(content), start + chunk_size)
        chunks.append(content[start:end])
        if end == len(content):
            break
        start = max(end - overlap, start + 1)
    return chunks
