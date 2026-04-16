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
        <section className="hero-panel auth-hero">
          <span className="eyebrow">Architectural Logic</span>
          <h1>BFF RAG Studio</h1>
          <p className="page-copy">
            A restrained frontend for local validation of the BFF stack. Sign in once, upload source
            material, then pressure-test retrieval with grounded answers and citations.
          </p>
          <div className="auth-story">
            <div className="auth-story-item">
              <strong>Development Sandbox</strong>
              <span>This environment creates a local JWT for session testing without leaving the BFF boundary.</span>
            </div>
            <div className="auth-story-item">
              <strong>Identity Mocking</strong>
              <span>Set tenant context and roles manually so the frontend can exercise admin and ask flows quickly.</span>
            </div>
            <div className="auth-story-item">
              <strong>Simple MVP Surface</strong>
              <span>Only the critical browser actions remain: login, ingest, ask, and citation review.</span>
            </div>
          </div>
          <div className="stats-grid auth-stats" style={{ marginTop: '1.25rem' }}>
            <div className="stat-card">
              <div className="stat-label">Core flows</div>
              <div className="stat-value">3</div>
              <div className="helper-text">Login, ingest, and ask are the full MVP surface.</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Supported files</div>
              <div className="stat-value">3</div>
              <div className="helper-text">Upload `.txt`, `.md`, and `.pdf` through the BFF.</div>
            </div>
          </div>
          <div className="auth-meta">v0.1 // LOCAL_RAG // ARCHITECTURAL_INDIGO</div>
        </section>

        <section className="auth-card">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Session Setup</span>
              <h2>Enter the workspace</h2>
              <p className="helper-text">
                Default values target the seeded admin user so the simple frontend works immediately.
              </p>
            </div>
          </div>

          <form className="form-grid" onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="user_id">User ID</label>
              <input
                id="user_id"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder={DEFAULT_USER_ID}
              />
            </div>

            <div className="field">
              <label htmlFor="tenant_id">Tenant ID</label>
              <input
                id="tenant_id"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder={DEFAULT_TENANT_ID}
              />
            </div>

            <div className="checkbox-row">
              <label className="checkbox-pill">
                <input
                  type="checkbox"
                  checked={includeUserRole}
                  onChange={(event) => setIncludeUserRole(event.target.checked)}
                />
                User role
              </label>
              <label className="checkbox-pill">
                <input
                  type="checkbox"
                  checked={includeAdminRole}
                  onChange={(event) => setIncludeAdminRole(event.target.checked)}
                />
                Admin role
              </label>
            </div>

            {error ? <div className="status-banner error">{error}</div> : null}

            <div className="actions">
              <button type="submit" className="action-button" disabled={isSubmitting || roles.length === 0}>
                {isSubmitting ? 'Issuing token...' : 'Enter Studio'}
              </button>
            </div>
          </form>

          <div style={{ marginTop: '1rem' }}>
            <div className="helper-text">Issued roles</div>
            <div className="pill-row" style={{ marginTop: '0.55rem' }}>
              {roles.length > 0 ? (
                roles.map((role) => (
                  <span key={role} className="data-pill">
                    {role}
                  </span>
                ))
              ) : (
                <span className="data-pill">No roles selected</span>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
