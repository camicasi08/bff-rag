'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { saveSession } from '@/lib/auth';
import { issueToken } from '@/lib/api';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_TENANT_ID = 'default';

export function LoginScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID);
  const [includeUserRole, setIncludeUserRole] = useState(true);
  const [includeAdminRole, setIncludeAdminRole] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = useMemo(() => {
    const nextRoles: string[] = [];
    if (includeUserRole) {
      nextRoles.push('user');
    }
    if (includeAdminRole) {
      nextRoles.push('admin');
    }
    return nextRoles;
  }, [includeAdminRole, includeUserRole]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await issueToken({
        user_id: userId,
        tenant_id: tenantId,
        roles,
      });

      saveSession({
        accessToken: response.access_token,
        userId,
        tenantId,
        roles,
        createdAt: new Date().toISOString(),
      });

      router.push('/chat');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : String(submissionError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-layout">
        <section className="hero-panel auth-hero auth-hero-panel">
          <div className="auth-hero-top">
            <span className="auth-login-kicker">Architectural Logic</span>
            <h1>BFF RAG Studio</h1>
            <div className="auth-brand-bar" />
          </div>

          <div className="auth-story auth-story-compact">
            <div className="auth-story-item auth-story-feature">
              <span className="material-symbols-outlined auth-story-icon" aria-hidden="true">
                terminal
              </span>
              <div>
                <strong>Development Sandbox</strong>
                <span>This environment creates a local JWT for session testing without leaving the BFF boundary.</span>
              </div>
            </div>
            <div className="auth-story-item auth-story-feature">
              <span className="material-symbols-outlined auth-story-icon" aria-hidden="true">
                security
              </span>
              <div>
                <strong>Identity Mocking</strong>
                <span>Define tenant context and roles manually so the frontend can exercise admin and ask flows quickly.</span>
              </div>
            </div>
          </div>

          <div className="auth-panel-footer">
            <span className="auth-meta">v2.4.0-alpha.1 // RAG_CORE</span>
          </div>
        </section>

        <section className="auth-card auth-form-panel">
          <div className="auth-form-divider">
            <span>Session Setup</span>
            <div />
          </div>

          <form className="form-grid auth-login-form" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="user_id">User Identifier</label>
              <input
                id="user_id"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="e.g. dev_user_88"
              />
            </div>

            <div className="field">
              <label htmlFor="tenant_id">Tenant Context</label>
              <input
                id="tenant_id"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="Enterprise-Alpha"
              />
            </div>

            <div className="field">
              <label>Assigned Roles</label>
            </div>

            <div className="auth-role-grid">
              <label className="auth-role-card">
                <input
                  type="checkbox"
                  checked={includeUserRole}
                  onChange={(event) => setIncludeUserRole(event.target.checked)}
                />
                <span>User</span>
              </label>
              <label className="auth-role-card">
                <input
                  type="checkbox"
                  checked={includeAdminRole}
                  onChange={(event) => setIncludeAdminRole(event.target.checked)}
                />
                <span>Admin</span>
              </label>
            </div>

            {error ? <div className="status-banner error">{error}</div> : null}

            <div className="actions">
              <button
                type="submit"
                className="action-button auth-submit-button"
                disabled={isSubmitting || roles.length === 0}
              >
                {isSubmitting ? 'Issuing token...' : 'Enter Studio'}
              </button>
            </div>

            <p className="auth-submit-note">
              System bypass enabled for local development. Session persists for 24 hours.
            </p>
          </form>
        </section>
      </div>

      <footer className="auth-footer">
        <div className="auth-footer-meta">
          <span>Architectural Indigo System</span>
          <span className="auth-footer-dot" />
          <a href="http://localhost:3000/docs" target="_blank" rel="noreferrer">
            Documentation
          </a>
          <span className="auth-footer-dot" />
          <a href="http://localhost:3000/docs/graphql-guide" target="_blank" rel="noreferrer">
            GraphQL Guide
          </a>
        </div>
        <div className="auth-footer-status">
          <span className="auth-footer-pulse" />
          <span>Cluster: Local-Region-1</span>
        </div>
      </footer>
    </div>
  );
}
