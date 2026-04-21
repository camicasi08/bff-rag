'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { clearSession, loadSession } from '@/lib/auth';
import type { AppSession } from '@/lib/types';
import { WorkspaceSidebar, type WorkspaceSidebarItem, type WorkspaceSidebarUtilityItem } from './workspace-sidebar';

const navItems: WorkspaceSidebarItem[] = [
  {
    href: '/chat',
    label: 'Chat Lab',
    icon: 'chat_bubble',
  },
  {
    href: '/ingest',
    label: 'Ingest Studio',
    icon: 'database',
  },
];

const routeMeta = {
  '/chat': {
    label: 'Chat Lab',
    signature: 'RAG_QUERY',
  },
  '/ingest': {
    label: 'Ingest Studio',
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

  const sessionBadge = session?.tenantId ?? 'local';
  const userInitial = session?.userId?.slice(0, 1).toUpperCase() ?? 'L';

  return (
    <div className="page-shell">
      <WorkspaceSidebar
        tenantLabel={sessionBadge}
        items={navItems}
        activePath={pathname}
      />

      <main className="workspace-shell">
        <header className="workspace-topbar">
          <div className="workspace-topbar-left">
            <div className="topbar-title">{activeRoute.label}</div>
            <div className="topbar-links">
              <a href="http://localhost:3000/docs" target="_blank" rel="noreferrer">
                Docs
              </a>
              <a href="http://localhost:3000/docs/graphql-guide" target="_blank" rel="noreferrer">
                API
              </a>
              <a href="http://localhost:8000/health" target="_blank" rel="noreferrer">
                Status
              </a>
            </div>
          </div>
          <div className="workspace-topbar-actions">
            <button type="button" className="topbar-icon-button" aria-label="Session notifications">
              <span className="material-symbols-outlined" aria-hidden="true">notifications</span>
            </button>
            {session ? (
              <button
                type="button"
                className="topbar-icon-button"
                aria-label="Sign out"
                onClick={() => {
                  clearSession();
                  setSession(null);
                  router.push('/login');
                }}
              >
                <span className="material-symbols-outlined" aria-hidden="true">logout</span>
              </button>
            ) : (
              <Link href="/login" className="topbar-icon-button" aria-label="Login">
                <span className="material-symbols-outlined" aria-hidden="true">login</span>
              </Link>
            )}
            <div className="topbar-avatar" aria-label={`Session user ${sessionBadge}`}>
              {userInitial}
            </div>
          </div>
        </header>

        <div className="workspace">
          <div className="workspace-signature">SESSION // LOCAL_BFF // {activeRoute.signature}</div>
          {children}
        </div>
      </main>
    </div>
  );
}
