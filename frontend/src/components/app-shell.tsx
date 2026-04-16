'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { QuickLinks } from '@/features/docs-consume/quick-links';
import { clearSession, loadSession } from '@/lib/auth';
import type { AppSession } from '@/lib/types';

const navItems = [
  {
    href: '/chat',
    title: 'Chat Lab',
    copy: 'Structured answers, citations, cache signals, and live stream preview.',
  },
  {
    href: '/admin/ingest',
    title: 'Ingest Studio',
    copy: 'Upload .txt, .md, and .pdf documents and watch job progress.',
  },
  {
    href: '/admin/overview',
    title: 'Overview Deck',
    copy: 'Inspect metrics, chunks, cache footprint, and recent history.',
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AppSession | null>(null);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  return (
    <div className="page-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="eyebrow">Local Studio</span>
          <h1 className="brand-title">BFF RAG Studio</h1>
          <p className="brand-copy">
            Frontend workspace for the NestJS gateway and the Python retrieval stack.
          </p>
          <div className="brand-orbit">
            <span>GraphQL-first</span>
            <span>Live SSE</span>
            <span>Admin ingest</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link${isActive ? ' active' : ''}`}
              >
                <span className="nav-title">{item.title}</span>
                <span className="nav-copy">{item.copy}</span>
              </Link>
            );
          })}
        </nav>

        <QuickLinks />

        <div className="sidebar-footer panel">
          <div className="panel-heading">
            <div>
              <h3>Session</h3>
              <p className="helper-text">
                The UI keeps a local dev token so admin and chat flows stay one click away.
              </p>
            </div>
          </div>
          {session ? (
            <>
              <div className="pill-row">
                <span className="data-pill mono">{session.userId}</span>
                <span className="data-pill">{session.tenantId}</span>
              </div>
              <div className="pill-row" style={{ marginTop: '0.7rem' }}>
                {session.roles.map((role) => (
                  <span key={role} className="data-pill">
                    {role}
                  </span>
                ))}
              </div>
              <div className="actions" style={{ marginTop: '0.9rem' }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    clearSession();
                    setSession(null);
                    router.push('/login');
                  }}
                >
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              No local token loaded yet. Use the login page to mint a dev JWT.
            </div>
          )}
        </div>
      </aside>

      <main className="workspace">{children}</main>
    </div>
  );
}
