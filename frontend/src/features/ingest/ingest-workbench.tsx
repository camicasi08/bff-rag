'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { LoginGate } from '@/components/login-gate';
import { StatusStack } from '@/components/status-stack';
import { loadSession } from '@/lib/auth';
import { fetchIngestJob, queueIngest } from '@/lib/api';
import { isSupportedFile, toBase64 } from '@/lib/files';
import type { AppSession, IngestJobQueued, IngestJobStatus } from '@/lib/types';

const TERMINAL_STATES = new Set(['completed', 'failed']);

function formatJobTag(status: string) {
  return status.replaceAll('_', ' ');
}

export function IngestWorkbench() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [source, setSource] = useState('manual-upload');
  const [category, setCategory] = useState('billing');
  const [metadataJson, setMetadataJson] = useState('{"origin":"frontend-ui"}');
  const [documentTitle, setDocumentTitle] = useState('Quick Note');
  const [documentContent, setDocumentContent] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [job, setJob] = useState<IngestJobQueued | null>(null);
  const [jobStatus, setJobStatus] = useState<IngestJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    setSession(loadSession());
    return () => {
      if (pollTimer.current !== null) {
        window.clearTimeout(pollTimer.current);
      }
    };
  }, []);

  const validFiles = useMemo(() => selectedFiles.filter((file) => isSupportedFile(file)), [selectedFiles]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) {
      setError('Create a local token first so the BFF can authorize admin ingest.');
      return;
    }

    if (!documentContent.trim() && validFiles.length === 0) {
      setError('Add either inline document content or at least one supported file.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setStatus('Encoding files and queueing adminIngest...');
    setJob(null);
    setJobStatus(null);

    try {
      const files = await Promise.all(
        validFiles.map(async (file) => ({
          filename: file.name,
          content_base64: await toBase64(file),
          category: category || undefined,
          content_type: file.type || undefined,
          metadata_json: metadataJson.trim() || undefined,
        })),
      );

      const documents = documentContent.trim()
        ? [
            {
              title: documentTitle.trim() || 'Quick Note',
              content: documentContent.trim(),
              category: category || undefined,
              metadata_json: metadataJson.trim() || undefined,
            },
          ]
        : [];

      const queued = await queueIngest(session, {
        source: source.trim() || undefined,
        documents,
        files,
      });

      setJob(queued);
      setStatus(`Job ${queued.job_id} queued. Polling status through GraphQL...`);
      await pollJob(session, queued.job_id);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : String(submissionError));
      setStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function pollJob(activeSession: AppSession, jobId: string): Promise<void> {
    const nextStatus = await fetchIngestJob(activeSession, jobId);
    setJobStatus(nextStatus);

    if (TERMINAL_STATES.has(nextStatus.status)) {
      setStatus(
        nextStatus.status === 'completed'
          ? `Job completed with ${nextStatus.inserted_chunks} inserted chunks.`
          : `Job failed: ${nextStatus.error ?? 'unknown error'}`,
      );
      return;
    }

    pollTimer.current = window.setTimeout(() => {
      void pollJob(activeSession, jobId);
    }, 1500);
  }

  if (!session) {
    return (
      <LoginGate
        title="Admin ingest needs an admin token"
        copy="The upload path stays behind the BFF admin role so we exercise the same auth and orchestration boundaries as the API."
      />
    );
  }

  const totalBytes = validFiles.reduce((sum, file) => sum + file.size, 0);
  const totalMegabytes = totalBytes / (1024 * 1024);
  const liveStatus = jobStatus?.status ?? job?.status ?? 'idle';
  const activeDocuments = validFiles.length + (documentContent.trim() ? 1 : 0);
  const hasInvalidFiles = selectedFiles.some((file) => !isSupportedFile(file));

  return (
    <div className="ingest-studio-page">
      <div className="ingest-studio-shell">
        <div className="ingest-studio-breadcrumb">
          <span>Studio</span>
          <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          <span>Ingest Studio</span>
        </div>

        <div className="ingest-studio-grid">
          <section className="ingest-studio-main">
            <div className="ingest-studio-intro">
              <h1>Data Ingestion</h1>
              <p>
                Streamline your RAG pipeline by feeding inline notes and uploaded documents into the same tenant-aware ingest queue.
              </p>
            </div>

            <form className="ingest-studio-composer" onSubmit={onSubmit}>
              <label className="ingest-dropzone" htmlFor="files">
                <div className="ingest-dropzone-icon">
                  <span className="material-symbols-outlined" aria-hidden="true">cloud_upload</span>
                </div>
                <div className="ingest-dropzone-copy">
                  <p>Drop documents here</p>
                  <span>Support for .txt, .md, and .pdf files</span>
                </div>
                <input
                  id="files"
                  type="file"
                  multiple
                  accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
                  onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
                />
              </label>

              <div className="ingest-studio-fields">
                <div className="ingest-studio-field">
                  <label htmlFor="source">Source Tag</label>
                  <input
                    id="source"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    placeholder="manual-upload"
                  />
                </div>

                <div className="ingest-studio-field">
                  <label htmlFor="category">Content Category</label>
                  <input
                    id="category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    placeholder="billing"
                  />
                </div>

                <div className="ingest-studio-field ingest-studio-field-wide">
                  <label htmlFor="metadata">Metadata Overlay (JSON)</label>
                  <textarea
                    id="metadata"
                    rows={4}
                    value={metadataJson}
                    onChange={(event) => setMetadataJson(event.target.value)}
                    placeholder='{ "origin": "frontend-ui" }'
                  />
                </div>

                <div className="ingest-studio-field">
                  <label htmlFor="document_title">Inline Document Title</label>
                  <input
                    id="document_title"
                    value={documentTitle}
                    onChange={(event) => setDocumentTitle(event.target.value)}
                    placeholder="Quick Note"
                  />
                </div>

                <div className="ingest-studio-field ingest-studio-field-wide">
                  <label htmlFor="document_content">Inline Content</label>
                  <textarea
                    id="document_content"
                    rows={5}
                    value={documentContent}
                    onChange={(event) => setDocumentContent(event.target.value)}
                    placeholder="Optional quick note to ingest together with uploaded files."
                  />
                </div>
              </div>

              <div className="ingest-studio-selection">
                {validFiles.length > 0 ? (
                  validFiles.map((file) => (
                    <span key={`${file.name}-${file.size}`} className="ingest-file-chip">
                      {file.name}
                    </span>
                  ))
                ) : (
                  <span className="ingest-file-chip muted">No files selected yet</span>
                )}
              </div>

              {hasInvalidFiles ? (
                <div className="status-banner warning">
                  Unsupported files are ignored. Only `.txt`, `.md`, and `.pdf` are accepted.
                </div>
              ) : null}

              <StatusStack status={status} error={error} />

              <button type="submit" className="ingest-primary-button" disabled={isSubmitting}>
                {isSubmitting ? 'Queueing...' : 'Queue ingest job'}
                <span className="material-symbols-outlined" aria-hidden="true">rocket_launch</span>
              </button>
            </form>
          </section>

          <aside className="ingest-studio-monitor">
            <div className="ingest-monitor-card">
              <div className="ingest-monitor-head">
                <h3>Active Job Monitor</h3>
                <div className="ingest-monitor-live">
                  <span className="ingest-live-dot" />
                  <span>Live</span>
                </div>
              </div>

              <div className="ingest-monitor-list">
                {job ? (
                  <>
                    <article className={`ingest-monitor-item ${liveStatus}`}>
                      <div className="ingest-monitor-item-head">
                        <div>
                          <p className="ingest-monitor-title">
                            {validFiles[0]?.name ?? (documentTitle.trim() || 'Inline document batch')}
                          </p>
                          <p className="ingest-monitor-id">ID: {job.job_id}</p>
                        </div>
                        <span className={`ingest-status-chip ${liveStatus}`}>
                          {formatJobTag(liveStatus)}
                        </span>
                      </div>
                      <div className="ingest-monitor-metrics">
                        <span>
                          <span className="material-symbols-outlined" aria-hidden="true">layers</span>
                          {jobStatus?.inserted_chunks ?? 0} chunks
                        </span>
                        <span>
                          <span className="material-symbols-outlined" aria-hidden="true">
                            {jobStatus?.error ? 'warning' : 'check_circle'}
                          </span>
                          {jobStatus?.error ? 'Error detected' : `${jobStatus?.skipped_duplicates ?? 0} duplicates`}
                        </span>
                      </div>
                      <div className="ingest-progress-track">
                        <div
                          className={`ingest-progress-bar ${liveStatus}`}
                          style={{
                            width:
                              liveStatus === 'completed'
                                ? '100%'
                                : liveStatus === 'failed'
                                  ? '100%'
                                  : liveStatus === 'running'
                                    ? '66%'
                                    : '32%',
                          }}
                        />
                      </div>
                      {jobStatus?.error ? (
                        <p className="ingest-monitor-error">{jobStatus.error}</p>
                      ) : null}
                    </article>

                    <article className="ingest-monitor-item muted">
                      <div className="ingest-monitor-item-head">
                        <div>
                          <p className="ingest-monitor-title">Batch metadata</p>
                          <p className="ingest-monitor-id">Source: {source || 'manual-upload'}</p>
                        </div>
                        <span className="ingest-status-chip neutral">{session.tenantId}</span>
                      </div>
                      <div className="ingest-monitor-metrics">
                        <span>
                          <span className="material-symbols-outlined" aria-hidden="true">description</span>
                          {activeDocuments} documents
                        </span>
                        <span>
                          <span className="material-symbols-outlined" aria-hidden="true">deployed_code</span>
                          {category || 'uncategorized'}
                        </span>
                      </div>
                    </article>
                  </>
                ) : (
                  <div className="ingest-monitor-empty">
                    Queue a job to see transitions from `queued` to `running` and `completed`.
                  </div>
                )}
              </div>

              <div className="ingest-monitor-stats">
                <div className="ingest-mini-stat">
                  <span>Total Selected</span>
                  <strong>{totalMegabytes > 0 ? `${totalMegabytes.toFixed(1)} MB` : '0.0 MB'}</strong>
                </div>
                <div className="ingest-mini-stat">
                  <span>Batch Items</span>
                  <strong>{activeDocuments}</strong>
                </div>
              </div>
            </div>

            <div className="ingest-system-card">
              <div className="ingest-system-left">
                <div className="ingest-system-icon">
                  <span className="material-symbols-outlined" aria-hidden="true">memory</span>
                </div>
                <div>
                  <p>Node Integrity</p>
                  <span>{jobStatus?.status === 'running' ? 'Polling every 1.5s' : 'Ready for next batch'}</span>
                </div>
              </div>
              <span className="material-symbols-outlined ingest-system-trend" aria-hidden="true">insights</span>
            </div>
          </aside>
        </div>

        <div className="ingest-studio-footnotes">
          <article>
            <div className="ingest-footnote-head">
              <span className="material-symbols-outlined" aria-hidden="true">security</span>
              <span>Tenant Boundaries</span>
            </div>
            <p>Uploads stay behind the BFF admin path so ingest, polling, and tenant scoping match the real backend contract.</p>
          </article>
          <article>
            <div className="ingest-footnote-head">
              <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
              <span>Smart Chunking</span>
            </div>
            <p>Plain text, markdown, and PDFs normalize into the same dedupe, chunking, and persistence flow.</p>
          </article>
          <article>
            <div className="ingest-footnote-head">
              <span className="material-symbols-outlined" aria-hidden="true">sync</span>
              <span>GraphQL Monitor</span>
            </div>
            <p>The monitor card reflects the real `adminIngestJob` GraphQL polling state instead of mocked progress.</p>
          </article>
        </div>
      </div>
    </div>
  );
}
