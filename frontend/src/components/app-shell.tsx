'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { clearSession, loadSession } from '@/lib/auth';
import type { AppSession } from '@/lib/types';

const navItems = [
  {
    href: '/chat',
    title: 'Ask',
    copy: 'Submit questions and review grounded answers with citations.',
  },
  {
    href: '/ingest',
    title: 'Ingest',
    copy: 'Upload .txt, .md, and .pdf files and track the job status.',
  },
];

const routeMeta = {
  '/chat': {
    label: 'Chat Lab',
    eyebrow: 'Grounded Retrieval',
    signature: 'RAG_QUERY',
  },
  '/ingest': {
    label: 'Ingest Studio',
    eyebrow: 'Document Intake',
    signature: 'ADMIN_INGEST',
  },
} as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AppSession | null>(null);

  const activeRoute = pathname.startsWith('/ingest') || pathname.startsWith('/admin/ingest')
    ? routeMeta['/ingest']
    : routeMeta['/chat'];

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
            Minimal workspace for the BFF login, document ingest, and grounded question flow.
          </p>
          <div className="brand-orbit">
            <span>Login</span>
            <span>Upload</span>
            <span>Ask</span>
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
                <span className="nav-kicker">{isActive ? 'Active lane' : 'Available lane'}</span>
                <span className="nav-title">{item.title}</span>
                <span className="nav-copy">{item.copy}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer panel">
          <div className="panel-heading">
            <div>
              <h3>Session</h3>
              <p className="helper-text">
                A local dev token keeps the frontend aligned with the BFF auth boundary.
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

      <main className="workspace-shell">
        <header className="workspace-topbar">
          <div>
            <span className="eyebrow">{activeRoute.eyebrow}</span>
            <h2 className="topbar-title">{activeRoute.label}</h2>
          </div>
          <div className="topbar-signature">SESSION // LOCAL_BFF // {activeRoute.signature}</div>
          <div className="topbar-links">
            <a href="http://localhost:3000/docs" target="_blank" rel="noreferrer">
              REST Docs
            </a>
            <a href="http://localhost:3000/docs/graphql-guide" target="_blank" rel="noreferrer">
              GraphQL Guide
            </a>
          </div>
        </header>

        <div className="workspace">{children}</div>
      </main>
    </div>
  );
}
