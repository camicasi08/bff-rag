'use client';

import { FormEvent, useEffect, useState } from 'react';

import { LoginGate } from '@/components/login-gate';
import { StatusStack } from '@/components/status-stack';
import { loadSession } from '@/lib/auth';
import { askQuestion, fetchConversationHistory } from '@/lib/api';
import type { AppSession, AskFilters, ConversationTurn, RagAnswer } from '@/lib/types';

const EMPTY_ANSWER: RagAnswer = {
  answer: '',
  cache_hit: false,
  chunks_used: [],
  history_used: 0,
  latency_ms: null,
  citations: [],
};

function formatLatency(latencyMs: number | null | undefined) {
  if (!Number.isFinite(latencyMs ?? Number.NaN) || !latencyMs || latencyMs <= 0) {
    return 'n/a';
  }

  if (latencyMs < 1000) {
    return `${Math.round(latencyMs)} ms`;
  }

  const seconds = latencyMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
}

function formatHistoryBucketLabel(value: string) {
  if (value === 'Today') {
    return 'Today';
  }

  return 'Yesterday';
}

function groupHistory(turns: ConversationTurn[]) {
  const today = new Date().toDateString();
  const buckets = new Map<string, ConversationTurn[]>();

  turns.forEach((turn) => {
    const createdAt = new Date(turn.created_at);
    const label = createdAt.toDateString() === today ? 'Today' : 'Earlier';
    const current = buckets.get(label) ?? [];
    current.push(turn);
    buckets.set(label, current);
  });

  return Array.from(buckets.entries()).map(([label, items]) => ({ label, items }));
}

export function ChatWorkbench() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [query, setQuery] = useState('What are the payment terms in the uploaded policies?');
  const [filters, setFilters] = useState<AskFilters>({ source: 'manual-upload' });
  const [answer, setAnswer] = useState<RagAnswer>(EMPTY_ANSWER);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);

  useEffect(() => {
    const nextSession = loadSession();
    setSession(nextSession);

    if (nextSession) {
      fetchConversationHistory(nextSession, 8)
        .then(setHistory)
        .catch((historyError) => {
          setError(historyError instanceof Error ? historyError.message : String(historyError));
        });
    }
  }, []);

  async function submitStructured(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) {
      setError('Create a local token first so the BFF can authorize the request.');
      return;
    }

    setIsAsking(true);
    setError(null);
    setStatus('Running ask(...) through GraphQL...');

    try {
      const nextAnswer = await askQuestion(session, query, filters);
      setAnswer(nextAnswer);
      setStatus(nextAnswer.cache_hit ? 'Served from semantic cache.' : 'Fresh retrieval completed.');
      const nextHistory = await fetchConversationHistory(session, 8);
      setHistory(nextHistory);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : String(askError));
      setStatus(null);
    } finally {
      setIsAsking(false);
    }
  }

  if (!session) {
    return (
      <LoginGate
        title="Mint a local token first"
        copy="The chat workspace depends on the BFF JWT flow so history, admin permissions, and tenant scoping stay realistic."
      />
    );
  }

  const historyGroups = groupHistory(history);
  const activeQuestion = query.trim() || 'Enter a grounded question for the current tenant.';
  const topCitation = answer.citations[0];

  return (
    <div className="chat-lab-page">
      <div className="chat-lab-layout">
        <section className="chat-lab-main-stage">
          <div className="chat-lab-thread-shell">
            <div className="chat-lab-thread-meta">
              SESSION // {session.tenantId.toUpperCase()} // {session.roles.join('_').toUpperCase()}
            </div>

            <div className="chat-lab-thread">
              <article className="chat-lab-message user">
                <div className="chat-lab-message-icon">
                  <span className="material-symbols-outlined" aria-hidden="true">person</span>
                </div>
                <div className="chat-lab-message-body">
                  <p>{activeQuestion}</p>
                </div>
              </article>

              <article className="chat-lab-message assistant">
                <div className="chat-lab-message-icon assistant">
                  <span className="material-symbols-outlined" aria-hidden="true">bolt</span>
                </div>
                <div className="chat-lab-answer-stack">
                  <div className="chat-lab-answer-card">
                    {answer.answer ? (
                      <>
                        <div className="chat-lab-answer-prose">{answer.answer}</div>
                        <div className="chat-lab-answer-metrics">
                          <div className="chat-lab-answer-metric">
                            <span>Latency</span>
                            <strong>{formatLatency(answer.latency_ms)}</strong>
                          </div>
                          <div className="chat-lab-answer-metric">
                            <span>Cache</span>
                            <strong className={answer.cache_hit ? 'metric-hit' : 'metric-miss'}>
                              {answer.cache_hit ? 'Hit' : 'Miss'}
                            </strong>
                          </div>
                          <div className="chat-lab-answer-metric">
                            <span>Chunks</span>
                            <strong>{answer.chunks_used.length}</strong>
                          </div>
                          <div className="chat-lab-answer-metric">
                            <span>History</span>
                            <strong>{answer.history_used}</strong>
                          </div>
                          <div className="chat-lab-answer-metric">
                            <span>Tenant</span>
                            <strong>{session.tenantId}</strong>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="chat-lab-empty-copy">
                        Ask a grounded question to render the structured answer, cache signal, and source citations here.
                      </div>
                    )}
                  </div>

                  <div className="chat-lab-citations">
                    <h4 className="chat-lab-section-label">
                      <span className="material-symbols-outlined" aria-hidden="true">link</span>
                      Source Citations
                    </h4>
                    {answer.citations.length > 0 ? (
                      <div className="chat-lab-citation-grid">
                        {answer.citations.map((citation) => (
                          <article key={citation.chunk_id} className="chat-lab-citation-card">
                            <div className="chat-lab-citation-head">
                              <span className="chat-lab-citation-title">{citation.title}</span>
                              <span className="chat-lab-citation-rank">Chunk {citation.chunk_index}</span>
                            </div>
                            <p className="chat-lab-citation-source">{citation.source}</p>
                            <p className="chat-lab-citation-excerpt">{citation.excerpt}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="chat-lab-empty-copy small">
                        No citations yet. The grid fills after a successful `ask(...)` response.
                      </div>
                    )}
                  </div>
                </div>
              </article>
            </div>

            <div className="chat-lab-console-zone">
              <form className="chat-lab-console" onSubmit={submitStructured}>
                <div className="chat-lab-filter-bar">
                  <label className="chat-lab-filter-pill" htmlFor="source">
                    <span className="material-symbols-outlined" aria-hidden="true">source</span>
                    <span>Source</span>
                    <input
                      id="source"
                      value={filters.source ?? ''}
                      onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}
                      placeholder="All repos"
                    />
                  </label>
                  <label className="chat-lab-filter-pill" htmlFor="category">
                    <span className="material-symbols-outlined" aria-hidden="true">category</span>
                    <span>Category</span>
                    <input
                      id="category"
                      value={filters.category ?? ''}
                      onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}
                      placeholder="Infrastructure"
                    />
                  </label>
                  <label className="chat-lab-filter-pill" htmlFor="title_contains">
                    <span className="material-symbols-outlined" aria-hidden="true">label</span>
                    <span>Title</span>
                    <input
                      id="title_contains"
                      value={filters.title_contains ?? ''}
                      onChange={(event) =>
                        setFilters((current) => ({ ...current, title_contains: event.target.value }))
                      }
                      placeholder="Technical Spec"
                    />
                  </label>
                </div>

                <div className="chat-lab-query-area">
                  <label className="sr-only" htmlFor="query">Question</label>
                  <textarea
                    id="query"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Enter architectural query or technical prompt..."
                  />
                </div>

                <StatusStack status={status} error={error} />

                <div className="chat-lab-console-actions">
                  <div className="chat-lab-console-support">
                    <span className="chat-lab-console-meta">
                      {topCitation ? `Top source: ${topCitation.source}` : 'Use the same source as your latest ingest batch.'}
                    </span>
                  </div>
                  <div className="chat-lab-console-buttons">
                    <button type="submit" className="chat-lab-primary-button" disabled={isAsking}>
                      {isAsking ? 'Asking...' : 'Ask with citations'}
                    </button>
                  </div>
                </div>
              </form>
              <div className="chat-lab-console-footer">
                End-to-End Local RAG Session // Tenant-aware retrieval // GraphQL ask flow
              </div>
            </div>
          </div>
        </section>

        <aside className="chat-lab-sidepanel">
          <div className="chat-lab-sidepanel-head">
            <h3>Session History</h3>
            <span className="material-symbols-outlined" aria-hidden="true">history</span>
          </div>

          <div className="chat-lab-sidepanel-body">
            {historyGroups.length > 0 ? (
              historyGroups.map((group) => (
                <section key={group.label} className="chat-lab-history-group">
                  <div className="chat-lab-history-label">{formatHistoryBucketLabel(group.label)}</div>
                  <div className="chat-lab-history-cards">
                    {group.items.map((turn, index) => (
                      <article key={`${turn.created_at}-${index}`} className="chat-lab-history-card">
                        <p>{turn.content}</p>
                        <div className="chat-lab-history-card-meta">
                          <span>{new Date(turn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span>{turn.role === 'assistant' ? 'RAG-A' : 'QUERY'}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="chat-lab-empty-copy small">
                No stored history yet for this user and tenant.
              </div>
            )}

            <div className="chat-lab-tip-card">
              <div className="chat-lab-tip-head">
                <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
                <span>Pro Tip</span>
              </div>
              <p>
                Keep <code>source</code> aligned with the last ingest run so the answer and citations stay tightly scoped to the active dataset.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
