import datetime as dt
import io
import json
import time
import uuid
from base64 import b64decode
from pathlib import Path
from fastapi import HTTPException
from sqlalchemy import text

from .config import settings
from .metrics import increment_metric
from .models import DocumentIn, FileDocumentIn, IngestJobStatusResponse, IngestRequest
from .rag import embed_many
from .state import state
from .utils import compute_content_hash, log_event, split_document, utc_now, vec_to_string

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover
    PdfReader = None


TEXT_FILE_EXTENSIONS = {".txt", ".md"}
INGEST_JOB_KEY_PREFIX = "ingest:job:"
INGEST_PAYLOAD_KEY_PREFIX = "ingest:payload:"
INGEST_QUEUE_KEY = "ingest:queue"


def decode_file_bytes(file_document: FileDocumentIn) -> bytes:
    try:
        return b64decode(file_document.content_base64, validate=True)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid base64 content for file '{file_document.filename}'",
        ) from exc


def extract_pdf_text(file_bytes: bytes, filename: str) -> str:
    if PdfReader is None:
        raise HTTPException(
            status_code=500,
            detail="PDF ingestion is unavailable because the PDF parser dependency is not installed",
        )

    try:
        reader = PdfReader(io.BytesIO(file_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to read PDF file '{filename}'") from exc

    extracted_parts = [(page.extract_text() or "").strip() for page in reader.pages]
    extracted_text = "\n\n".join(part for part in extracted_parts if part)
    if not extracted_text.strip():
        raise HTTPException(status_code=400, detail=f"PDF file '{filename}' did not contain extractable text")
    return extracted_text


def parse_file_document(file_document: FileDocumentIn) -> DocumentIn:
    suffix = Path(file_document.filename).suffix.lower()
    file_bytes = decode_file_bytes(file_document)

    if suffix in TEXT_FILE_EXTENSIONS:
        try:
            content = file_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"File '{file_document.filename}' must be UTF-8 encoded",
            ) from exc
    elif suffix == ".pdf":
        content = extract_pdf_text(file_bytes, file_document.filename)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type for '{file_document.filename}'. Supported types: .txt, .md, .pdf",
        )

    normalized_content = content.strip()
    if not normalized_content:
        raise HTTPException(status_code=400, detail=f"File '{file_document.filename}' did not contain usable text")

    metadata = {
        "filename": file_document.filename,
        "file_extension": suffix or None,
        "content_type": file_document.content_type,
        **file_document.metadata,
    }
    return DocumentIn(
        title=file_document.title or Path(file_document.filename).stem,
        content=normalized_content,
        category=file_document.category,
        metadata=metadata,
    )


def normalize_ingest_documents(payload: IngestRequest) -> list[DocumentIn]:
    normalized_documents = list(payload.documents)
    normalized_documents.extend(parse_file_document(file_document) for file_document in payload.files)
    return normalized_documents


def _job_key(job_id: str) -> str:
    return f"{INGEST_JOB_KEY_PREFIX}{job_id}"


def _payload_key(job_id: str) -> str:
    return f"{INGEST_PAYLOAD_KEY_PREFIX}{job_id}"


async def _save_job(job: IngestJobStatusResponse, ttl_seconds: int) -> None:
    await state.redis.set(_job_key(job.job_id), job.model_dump_json(), ex=max(ttl_seconds, 1))


async def _load_job(job_id: str) -> IngestJobStatusResponse | None:
    payload = await state.redis.get(_job_key(job_id))
    if payload is None:
        return None
    return IngestJobStatusResponse.model_validate_json(payload)


async def _save_payload(job_id: str, payload: IngestRequest, ttl_seconds: int) -> None:
    await state.redis.set(_payload_key(job_id), payload.model_dump_json(), ex=max(ttl_seconds, 1))


async def _load_payload(job_id: str) -> IngestRequest | None:
    payload = await state.redis.get(_payload_key(job_id))
    if payload is None:
        return None
    return IngestRequest.model_validate_json(payload)


async def _delete_job_payload(job_id: str) -> None:
    await state.redis.delete(_payload_key(job_id))


def _batched(values: list[str], batch_size: int) -> list[list[str]]:
    safe_batch_size = max(batch_size, 1)
    return [values[index : index + safe_batch_size] for index in range(0, len(values), safe_batch_size)]


async def run_ingest(payload: IngestRequest) -> dict[str, int]:
    inserted = 0
    skipped_duplicates = 0
    await increment_metric("total_ingest_requests")
    documents = normalize_ingest_documents(payload)

    async with state.session() as session:
        await session.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": payload.tenant_id})
        existing_metadata_rows = await session.execute(
            text(
                """
                SELECT metadata
                FROM document_chunks
                WHERE tenant_id = :tenant_id
                  AND user_id = :user_id
                  AND source = :source
                """
            ),
            {
                "tenant_id": payload.tenant_id,
                "user_id": payload.user_id,
                "source": payload.source,
            },
        )
        existing_hashes = {
            (row[0] or {}).get("content_hash")
            for row in existing_metadata_rows.fetchall()
            if isinstance(row[0], dict)
        }
        for document in documents:
            content_hash = compute_content_hash(payload.source, document.title, document.content)
            if content_hash in existing_hashes:
                skipped_duplicates += 1
                continue
            existing_hashes.add(content_hash)

            metadata = {
                "title": document.title,
                "category": document.category,
                "content_hash": content_hash,
                **document.metadata,
            }
            metadata_json = json.dumps(metadata)
            chunks = split_document(document.content)
            chunk_embeddings: list[list[float]] = []
            for chunk_batch in _batched(chunks, settings.embed_batch_size):
                chunk_embeddings.extend(await embed_many(chunk_batch))

            for chunk_index, (chunk, embedding) in enumerate(zip(chunks, chunk_embeddings)):
                await session.execute(
                    text(
                        """
                        INSERT INTO document_chunks (
                          id, tenant_id, user_id, source, chunk_index, content, embedding, metadata
                        )
                        VALUES (
                          :id, :tenant_id, :user_id, :source, :chunk_index, :content,
                          CAST(:embedding AS vector), CAST(:metadata AS jsonb)
                        )
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "tenant_id": payload.tenant_id,
                        "user_id": payload.user_id,
                        "source": payload.source,
                        "chunk_index": chunk_index,
                        "content": chunk,
                        "embedding": vec_to_string(embedding),
                        "metadata": metadata_json,
                    },
                )
                inserted += 1

        await session.commit()

    if inserted:
        await increment_metric("total_chunks_ingested", inserted)
    if skipped_duplicates:
        await increment_metric("skipped_duplicates", skipped_duplicates)

    return {"inserted_chunks": inserted, "skipped_duplicates": skipped_duplicates}


async def ingest_worker() -> None:
    while True:
        queue_entry = await state.redis.blpop(INGEST_QUEUE_KEY, timeout=1)
        if queue_entry is None:
            continue
        _, job_id = queue_entry
        job = await _load_job(job_id)
        payload = await _load_payload(job_id)
        if job is None or payload is None:
            continue

        running_job = job.model_copy(
            update={
                "status": "running",
                "started_at": utc_now(),
                "error": None,
            }
        )
        await _save_job(running_job, settings.ingest_job_ttl)
        try:
            result = await run_ingest(payload)
            completed_job = running_job.model_copy(
                update={
                    "status": "completed",
                    "finished_at": utc_now(),
                    "inserted_chunks": result["inserted_chunks"],
                    "skipped_duplicates": result["skipped_duplicates"],
                }
            )
            await _save_job(completed_job, settings.ingest_job_ttl)
            log_event("ingest_job_completed", job_id=job_id, **result)
        except Exception as exc:
            failed_job = running_job.model_copy(
                update={
                    "status": "failed",
                    "finished_at": utc_now(),
                    "error": str(exc),
                }
            )
            await _save_job(failed_job, settings.ingest_job_ttl)
            log_event("ingest_job_failed", job_id=job_id, error=str(exc))
        finally:
            await _delete_job_payload(job_id)


async def create_ingest_job(payload: IngestRequest) -> IngestJobStatusResponse:
    documents = normalize_ingest_documents(payload)
    normalized_payload = payload.model_copy(update={"documents": documents, "files": []})
    job = IngestJobStatusResponse(
        job_id=str(uuid.uuid4()),
        status="queued",
        user_id=payload.user_id,
        tenant_id=payload.tenant_id,
        source=payload.source,
        submitted_at=utc_now(),
    )
    await _save_job(job, settings.ingest_job_ttl)
    await _save_payload(job.job_id, normalized_payload, settings.ingest_job_ttl)
    await state.redis.rpush(INGEST_QUEUE_KEY, job.job_id)
    return job


async def expire_finished_ingest_jobs(ingest_job_ttl: int) -> None:
    cutoff = time.time() - ingest_job_ttl
    expired_ids: list[str] = []
    async for key in state.redis.scan_iter(f"{INGEST_JOB_KEY_PREFIX}*"):
        payload = await state.redis.get(key)
        if payload is None:
            continue
        job = IngestJobStatusResponse.model_validate_json(payload)
        if job.status not in {"completed", "failed"} or job.finished_at is None:
            continue
        finished = dt.datetime.strptime(job.finished_at, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=dt.timezone.utc
        ).timestamp()
        if finished < cutoff:
            expired_ids.append(job.job_id)

    for job_id in expired_ids:
        await state.redis.delete(_job_key(job_id), _payload_key(job_id))
