'use client';

import { FormEvent, useEffect, useState } from 'react';

import { LoginGate } from '@/components/login-gate';
import { StatusStack } from '@/components/status-stack';
import { WorkspaceHero } from '@/components/workspace-hero';
import { loadSession } from '@/lib/auth';
import { askQuestion, fetchConversationHistory } from '@/lib/api';
import type { AppSession, AskFilters, ConversationTurn, RagAnswer } from '@/lib/types';

const EMPTY_ANSWER: RagAnswer = {
  answer: '',
  cache_hit: false,
  chunks_used: [],
  history_used: 0,
  citations: [],
};

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

  return (
    <>
      <WorkspaceHero
        eyebrow="Ask"
        title="One clear question lane with grounded citations."
        copy="Inspired by the Stitch chat lab, this screen keeps the answer surface editorial and focused: a single structured ask flow, light metadata filters, and evidence that remains easy to scan."
        meta={
          <>
            <span className="data-pill">tenant: {session.tenantId}</span>
            <span className="data-pill">history: {history.length} turns</span>
          </>
        }
      >
        <div className="hero-note">
          <strong>Primary workflow</strong>
          <span>Use the same source you ingested with so the answer and citations stay tightly scoped.</span>
        </div>
      </WorkspaceHero>

      <div className="workspace-grid two-up">
        <section className="panel panel-spotlight">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Session</span>
              <h2>Current lane</h2>
            </div>
          </div>
          <div className="pill-row">
            <span className="data-pill mono">{session.userId}</span>
            <span className="data-pill">{session.roles.join(' / ')}</span>
          </div>
          <p className="helper-text" style={{ marginTop: '0.85rem' }}>
            Keep the source filter aligned with your latest ingest job so retrieval stays crisp.
          </p>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Output</span>
              <h2>What you get back</h2>
            </div>
          </div>
          <p className="helper-text">
            A single `ask(...)` run returns the answer, citations, cache signal, and chunk usage.
          </p>
        </section>
      </div>

      <div className="workspace-grid two-up">
        <section className="panel panel-spotlight console-panel">
          <div className="panel-heading">
            <div>
              <h2>Query console</h2>
              <p className="helper-text">Shape the question once, then submit the structured ask flow.</p>
            </div>
          </div>
          <form className="form-grid" onSubmit={submitStructured}>
            <div className="console-breadcrumb">SESSION // LOCAL_BFF // RAG_QUERY</div>
            <div className="field">
              <label htmlFor="query">Question</label>
              <textarea id="query" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>

            <div className="form-grid two-col">
              <div className="field">
                <label htmlFor="source">Source filter</label>
                <input
                  id="source"
                  value={filters.source ?? ''}
                  onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}
                  placeholder="manual-upload"
                />
              </div>
              <div className="field">
                <label htmlFor="category">Category filter</label>
                <input
                  id="category"
                  value={filters.category ?? ''}
                  onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}
                  placeholder="billing"
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="title_contains">Title contains</label>
              <input
                id="title_contains"
                value={filters.title_contains ?? ''}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, title_contains: event.target.value }))
                }
                placeholder="Payment Terms"
              />
            </div>

            <StatusStack status={status} error={error} />

            <div className="actions">
              <button type="submit" className="action-button" disabled={isAsking}>
                {isAsking ? 'Asking...' : 'Ask with citations'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel answer-panel">
          <div className="panel-heading">
            <div>
              <h2>Latest answer</h2>
              <p className="helper-text">Grounded response plus cache and chunk usage details.</p>
            </div>
          </div>

          {answer.answer ? (
            <div className="list">
              <div className="answer-lead">
                <strong>Answer</strong>
                <p>{answer.answer}</p>
              </div>
              <div className="pill-row">
                <span className="data-pill">cache: {answer.cache_hit ? 'hit' : 'miss'}</span>
                <span className="data-pill">history used: {answer.history_used}</span>
                <span className="data-pill">chunks used: {answer.chunks_used.length}</span>
              </div>
              <div className="list">
                <div className="citation-heading">Source citations</div>
                {answer.citations.length > 0 ? (
                  answer.citations.map((citation) => (
                    <article key={citation.chunk_id} className="citation-card">
                      <strong>
                        {citation.title} - chunk {citation.chunk_index}
                      </strong>
                      <div className="helper-text">{citation.source}</div>
                      <div style={{ marginTop: '0.45rem' }}>{citation.excerpt}</div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No citations returned for the current answer.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">Run an `ask(...)` query to populate answer details and citations.</div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent history</h2>
            <p className="helper-text">A compact read on the last turns stored for this user and tenant.</p>
          </div>
        </div>
        <div className="list">
          {history.length > 0 ? (
            history.map((turn, index) => (
              <article key={`${turn.created_at}-${index}`} className="list-item">
                <strong>{turn.role}</strong>
                <div className="helper-text">{new Date(turn.created_at).toLocaleString()}</div>
                <div style={{ marginTop: '0.45rem' }}>{turn.content}</div>
              </article>
            ))
          ) : (
            <div className="empty-state">No stored history yet for this user and tenant.</div>
          )}
        </div>
      </section>
    </>
  );
}
