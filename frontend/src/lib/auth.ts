'use client';

import { AppSession } from './types';

const SESSION_KEY = 'bff-rag-ui-session';

export function saveSession(session: AppSession): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): AppSession | null {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AppSession;
    if (!parsed?.accessToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}
