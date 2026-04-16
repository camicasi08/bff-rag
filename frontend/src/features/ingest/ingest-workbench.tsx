'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { LoginGate } from '@/components/login-gate';
import { StatusStack } from '@/components/status-stack';
import { WorkspaceHero } from '@/components/workspace-hero';
import { loadSession } from '@/lib/auth';
import { fetchIngestJob, queueIngest } from '@/lib/api';
import { isSupportedFile, toBase64 } from '@/lib/files';
import type { AppSession, IngestJobQueued, IngestJobStatus } from '@/lib/types';

const TERMINAL_STATES = new Set(['completed', 'failed']);

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

  return (
    <>
      <WorkspaceHero
        eyebrow="Ingest Studio"
        title="Turn browser uploads into retrieval-ready chunks."
        copy="This screen uses the GraphQL admin ingest mutation and the BFF-backed job status query. It is the browser-first path for the .txt, .md, and .pdf support we added to the stack."
        meta={
          <>
            <span className="data-pill">supports: .txt / .md / .pdf</span>
            <span className="data-pill">tenant: {session.tenantId}</span>
          </>
        }
      >
        <div className="hero-note">
          <strong>Fastest validation loop</strong>
          <span>Upload, wait for completion, then jump to Chat Lab with the same source filter.</span>
        </div>
      </WorkspaceHero>

      <div className="workspace-grid three-up">
        <section className="panel panel-spotlight">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Source</span>
              <h2>Batch metadata</h2>
            </div>
          </div>
          <p className="helper-text">
            Keep `source` stable across a test batch so retrieval, admin overview, and chat filters stay aligned.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Files</span>
              <h2>Supported</h2>
            </div>
          </div>
          <p className="helper-text">Plain text, markdown, and PDFs all normalize into the existing ingest flow.</p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Jobs</span>
              <h2>Observed</h2>
            </div>
          </div>
          <p className="helper-text">Status stays visible through GraphQL, so the browser never bypasses the BFF boundary.</p>
        </section>
      </div>

      <div className="workspace-grid two-up">
        <section className="panel panel-spotlight">
          <div className="panel-heading">
            <div>
              <h2>Upload composer</h2>
              <p className="helper-text">Batch source and category apply to inline notes and uploaded files.</p>
            </div>
          </div>

          <form className="form-grid" onSubmit={onSubmit}>
            <div className="form-grid two-col">
              <div className="field">
                <label htmlFor="source">Source</label>
                <input id="source" value={source} onChange={(event) => setSource(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="category">Category</label>
                <input id="category" value={category} onChange={(event) => setCategory(event.target.value)} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="metadata">Metadata JSON</label>
              <textarea id="metadata" value={metadataJson} onChange={(event) => setMetadataJson(event.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="document_title">Inline document title</label>
              <input id="document_title" value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="document_content">Inline document content</label>
              <textarea
                id="document_content"
                value={documentContent}
                onChange={(event) => setDocumentContent(event.target.value)}
                placeholder="Optional quick note to ingest together with uploaded files."
              />
            </div>

            <div className="field">
              <label htmlFor="files">Files (.txt, .md, .pdf)</label>
              <input
                id="files"
                type="file"
                multiple
                accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
                onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
              />
            </div>

            <div className="pill-row">
              {selectedFiles.length > 0 ? (
                selectedFiles.map((file) => (
                  <span key={`${file.name}-${file.size}`} className="data-pill">
                    {file.name}
                  </span>
                ))
              ) : (
                <span className="data-pill">No files selected yet</span>
              )}
            </div>

            {selectedFiles.some((file) => !isSupportedFile(file)) ? (
              <div className="status-banner warning">
                Unsupported files are ignored. Only `.txt`, `.md`, and `.pdf` are accepted.
              </div>
            ) : null}

            <StatusStack status={status} error={error} />

            <div className="actions">
              <button type="submit" className="action-button" disabled={isSubmitting}>
                {isSubmitting ? 'Queueing...' : 'Queue ingest job'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Job monitor</h2>
              <p className="helper-text">Polls the new `adminIngestJob` GraphQL query until completion.</p>
            </div>
          </div>

          {job ? (
            <div className="list">
              <div className="list-item">
                <strong>Queued job</strong>
                <div className="mono">{job.job_id}</div>
                <div className="helper-text">Initial state: {job.status}</div>
              </div>
              {jobStatus ? (
                <div className="job-card">
                  <strong>Current status</strong>
                  <div className="pill-row" style={{ marginTop: '0.5rem' }}>
                    <span className="data-pill">{jobStatus.status}</span>
                    <span className="data-pill">inserted: {jobStatus.inserted_chunks}</span>
                    <span className="data-pill">duplicates: {jobStatus.skipped_duplicates}</span>
                  </div>
                  <div style={{ marginTop: '0.7rem' }} className="helper-text">
                    submitted: {new Date(jobStatus.submitted_at).toLocaleString()}
                  </div>
                  {jobStatus.started_at ? (
                    <div className="helper-text">
                      started: {new Date(jobStatus.started_at).toLocaleString()}
                    </div>
                  ) : null}
                  {jobStatus.finished_at ? (
                    <div className="helper-text">
                      finished: {new Date(jobStatus.finished_at).toLocaleString()}
                    </div>
                  ) : null}
                  {jobStatus.error ? (
                    <div className="status-banner error" style={{ marginTop: '0.7rem' }}>
                      {jobStatus.error}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="empty-state">Waiting for the first job status response...</div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              Queue a job to see status transitions from `queued` to `running` and `completed`.
            </div>
          )}
        </section>
      </div>
    </>
  );
}
