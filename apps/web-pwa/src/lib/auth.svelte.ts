import type { User } from '@salt/domain';
import { authProvider } from './firebase.js';
import { identifyUser, identifyAnonymous } from './observability.js';

const PENDING_EMAIL_KEY = 'salt:auth:pendingEmail';

// Web-pwa is the composition layer for auth — it holds the pending email
// (sessionStorage) so the firebase-sync adapter can stay stateless. The
// adapter rule keeps browser-storage primitives out of adapters; this file
// is in the app, which is allowed to touch sessionStorage directly.
function readPendingEmail(): string | null {
  try {
    return window.sessionStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

function writePendingEmail(email: string): void {
  try {
    window.sessionStorage.setItem(PENDING_EMAIL_KEY, email);
  } catch {
    /* sessionStorage unavailable — magic link will prompt for email on return */
  }
}

function clearPendingEmail(): void {
  try {
    window.sessionStorage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

class AuthStore {
  user = $state<User | null>(null);
  loading = $state(true);
  error = $state<string | null>(null);
  linkSent = $state(false);

  constructor() {
    this.user = authProvider.getCurrentUser();
    authProvider.observe((u) => {
      this.user = u;
      this.loading = false;
      if (u) identifyUser(u);
      else identifyAnonymous();
    });
    void this.maybeCompleteFromUrl();
  }

  private async maybeCompleteFromUrl(): Promise<void> {
    const url = window.location.href;
    if (!authProvider.isMagicLink(url)) {
      this.loading = false;
      return;
    }
    const email = readPendingEmail();
    if (!email) {
      this.error = 'Sign-in link opened on a different device — re-enter your email.';
      this.loading = false;
      return;
    }
    const result = await authProvider.completeMagicLink(url, email);
    if (result.kind === 'ok') {
      clearPendingEmail();
      // Strip the magic-link params so a refresh doesn't re-trigger sign-in.
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      this.error = formatError(result.error);
    }
    this.loading = false;
  }

  async sendLink(email: string): Promise<void> {
    this.error = null;
    writePendingEmail(email);
    const continueUrl = window.location.origin + window.location.pathname;
    const result = await authProvider.sendMagicLink(email, continueUrl);
    if (result.kind === 'ok') {
      this.linkSent = true;
    } else {
      this.error = formatError(result.error);
      clearPendingEmail();
    }
  }

  async signOut(): Promise<void> {
    this.error = null;
    const result = await authProvider.signOut();
    if (result.kind !== 'ok') {
      this.error = formatError(result.error);
    }
  }
}

function formatError(err: { kind: string }): string {
  if (err.kind === 'NetworkError') return 'Network error — please check your connection.';
  return 'Sign-in failed. Please try again.';
}

export const auth = new AuthStore();

// Dev-only helper: when running against the Auth emulator, fetch the pending
// magic link from the emulator's oobCodes endpoint and complete sign-in
// without a real email round-trip.
export async function devSignIn(email: string): Promise<void> {
  writePendingEmail(email);
  const continueUrl = window.location.origin + window.location.pathname;
  const send = await authProvider.sendMagicLink(email, continueUrl);
  if (send.kind !== 'ok') {
    auth.error = formatError(send.error);
    return;
  }
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const authPort = import.meta.env.VITE_EMULATOR_AUTH_PORT ?? '9099';
  const r = await fetch(`http://127.0.0.1:${authPort}/emulator/v1/projects/${projectId}/oobCodes`);
  const data = (await r.json()) as { oobCodes: { email: string; oobLink: string }[] };
  const link = [...data.oobCodes].reverse().find((c) => c.email === email)?.oobLink;
  if (!link) {
    auth.error = 'No pending sign-in link found in the emulator.';
    return;
  }
  const complete = await authProvider.completeMagicLink(link, email);
  if (complete.kind === 'ok') {
    clearPendingEmail();
  } else {
    auth.error = formatError(complete.error);
  }
}
