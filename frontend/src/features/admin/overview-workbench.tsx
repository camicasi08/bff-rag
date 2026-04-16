'use client';

import { FormEvent, useEffect, useState } from 'react';

import { LoginGate } from '@/components/login-gate';
import { StatusStack } from '@/components/status-stack';
import { StatCard } from '@/components/stat-card';
import { WorkspaceHero } from '@/components/workspace-hero';
import { loadSession } from '@/lib/auth';
import {
  fetchAdminChunks,
  fetchCacheStats,
  fetchConversationHistory,
  fetchOverview,
} from '@/lib/api';
import type {
  AdminChunk,
  AdminOverview,
  AppSession,
  AskFilters,
  CacheStats,
  ConversationTurn,
} from '@/lib/types';

export function OverviewWorkbench() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [chunks, setChunks] = useState<AdminChunk[]>([]);
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [filters, setFilters] = useState<AskFilters>({ source: 'manual-upload' });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>('Loading overview through GraphQL...');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const nextSession = loadSession();
    setSession(nextSession);

    if (nextSession) {
      void refresh(nextSession, { source: 'manual-upload' });
    }
  }, []);

  async function refresh(activeSession: AppSession, nextFilters: AskFilters) {
    setIsRefreshing(true);
    setError(null);

    try {
      const [nextOverview, nextCacheStats, nextChunks, nextHistory] = await Promise.all([
        fetchOverview(activeSession),
        fetchCacheStats(activeSession),
        fetchAdminChunks(activeSession, 8, nextFilters),
        fetchConversationHistory(activeSession, 6),
      ]);

      setOverview(nextOverview);
      setCacheStats(nextCacheStats);
      setChunks(nextChunks);
      setHistory(nextHistory);
      setStatus('Overview synced from the BFF.');
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      setStatus(null);
    } finally {
      setIsRefreshing(false);
    }
  }

  async function onFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (session) {
      await refresh(session, filters);
    }
  }

  if (!session) {
    return (
      <LoginGate
        title="Mint a token before opening the admin overview"
        copy="The overview is intentionally admin-shaped because it reflects metrics, chunk inventory, and stored history from the BFF."
      />
    );
  }

  return (
    <>
      <WorkspaceHero
        eyebrow="Overview Deck"
        title="Read the operational shape of the stack."
        copy="This deck pulls together adminOverview, cacheStats, adminChunks, and conversationHistory so we can validate the BFF as the single API surface for the frontend."
        meta={
          <>
            <span className="data-pill">chunks: {overview?.total_chunks ?? 0}</span>
            <span className="data-pill">conversations: {overview?.total_conversations ?? 0}</span>
          </>
        }
      >
        <div className="actions">
          <button
            type="button"
            className="ghost-button"
            disabled={isRefreshing}
            onClick={() => session && void refresh(session, filters)}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </WorkspaceHero>

      <StatusStack status={status} error={error} />

      <section className="stats-grid">
        <StatCard label="Total queries" value={String(overview?.metrics.total_queries ?? 0)} />
        <StatCard label="Cache hit rate" value={`${Math.round((overview?.metrics.cache_hit_rate ?? 0) * 100)}%`} />
        <StatCard label="Chunks stored" value={String(overview?.total_chunks ?? 0)} />
        <StatCard label="Cached entries" value={String(cacheStats?.cached_entries ?? 0)} />
      </section>

      <div className="workspace-grid two-up">
        <section className="panel panel-spotlight">
          <div className="panel-heading">
            <div>
              <h2>Chunk browser</h2>
              <p className="helper-text">Filter chunks with the same metadata knobs that the RAG flow understands.</p>
            </div>
          </div>

          <form className="form-grid" onSubmit={onFilterSubmit}>
            <div className="form-grid two-col">
              <div className="field">
                <label htmlFor="filter_source">Source</label>
                <input
                  id="filter_source"
                  value={filters.source ?? ''}
                  onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="filter_category">Category</label>
                <input
                  id="filter_category"
                  value={filters.category ?? ''}
                  onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="filter_title_contains">Title contains</label>
              <input
                id="filter_title_contains"
                value={filters.title_contains ?? ''}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, title_contains: event.target.value }))
                }
              />
            </div>
            <div className="actions">
              <button type="submit" className="action-button" disabled={isRefreshing}>
                Apply filters
              </button>
            </div>
          </form>

          <div className="list" style={{ marginTop: '1rem' }}>
            {chunks.length > 0 ? (
              chunks.map((chunk) => (
                <article key={chunk.chunk_id} className="citation-card">
                  <strong>
                    {chunk.title} - chunk {chunk.chunk_index}
                  </strong>
                  <div className="pill-row" style={{ marginTop: '0.45rem' }}>
                    <span className="data-pill">{chunk.source}</span>
                    {chunk.category ? <span className="data-pill">{chunk.category}</span> : null}
                  </div>
                  <div style={{ marginTop: '0.7rem' }}>{chunk.excerpt}</div>
                  <div className="helper-text" style={{ marginTop: '0.55rem' }}>
                    created: {new Date(chunk.created_at).toLocaleString()}
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">No chunks matched the current filters.</div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Recent history</h2>
              <p className="helper-text">A quick read on how the demo user has been interacting with the stack.</p>
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
              <div className="empty-state">No history available yet for this session.</div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
