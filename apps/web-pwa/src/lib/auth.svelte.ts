import type { User } from '@salt/domain';
import { normaliseMemberEmail } from '@salt/domain';
import { authProvider } from './firebase.js';
import { identifyUser, identifyAnonymous } from './observability.js';

const PENDING_EMAIL_KEY = 'salt:auth:pendingEmail';

// Web-pwa is the composition layer for auth — it holds the pending email so
// the firebase-sync adapter can stay stateless. We use localStorage (not
// sessionStorage) because email clients open the magic link in a new tab or
// window, which gets a fresh sessionStorage; localStorage is shared across
// all tabs of the same browser, so the email survives the round-trip. The
// adapter rule keeps browser-storage primitives out of adapters; this file
// is in the app, which is allowed to touch localStorage directly.
function readPendingEmail(): string | null {
  try {
    return window.localStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

function writePendingEmail(email: string): void {
  try {
    window.localStorage.setItem(PENDING_EMAIL_KEY, email);
  } catch {
    /* localStorage unavailable — magic link will prompt for email on return */
  }
}

function clearPendingEmail(): void {
  try {
    window.localStorage.removeItem(PENDING_EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

class AuthStore {
  user = $state<User | null>(null);
  loading = $state(true);
  error = $state<string | null>(null);
  linkSent = $state(false);
  // True when we returned from a magic link but had no stored email to
  // complete it (link opened on a different device/browser, or storage was
  // cleared). The login UI prompts for the email and calls completeWithEmail.
  needsEmail = $state(false);
  // The magic-link URL we're waiting to complete, captured before any history
  // rewrite so completeWithEmail can finish sign-in after the user re-enters.
  private pendingUrl: string | null = null;

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
      // Not a magic-link return. Leave `loading` true and let the auth-state
      // observer resolve it: Firebase restores a persisted session
      // asynchronously, so `getCurrentUser()` is still null here on a cold
      // load. Setting `loading = false` now would flash the login screen for
      // the 1–5s the SDK takes to rehydrate an already-signed-in user.
      return;
    }
    const email = readPendingEmail();
    if (!email) {
      // Can't complete without the email (different device, or storage lost).
      // Prompt for it instead of dead-ending — completeWithEmail finishes up.
      this.pendingUrl = url;
      this.needsEmail = true;
      this.loading = false;
      return;
    }
    await this.finishSignIn(url, email);
    this.loading = false;
  }

  // Complete sign-in for a magic-link URL once we have the email. Shared by
  // the automatic path (stored email) and the manual re-entry path.
  private async finishSignIn(url: string, email: string): Promise<void> {
    const result = await authProvider.completeMagicLink(url, email);
    if (result.kind === 'ok') {
      clearPendingEmail();
      this.needsEmail = false;
      this.pendingUrl = null;
      // Strip the magic-link params so a refresh doesn't re-trigger sign-in.
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      this.error = formatError(result.error);
    }
  }

  // Called from the login UI when the user re-enters their email to finish a
  // magic-link sign-in we couldn't complete automatically.
  async completeWithEmail(email: string): Promise<void> {
    this.error = null;
    // Normalise so the Auth account's email (hence the ID-token email claim)
    // matches the member doc key the security rules look up (issue #155).
    await this.finishSignIn(this.pendingUrl ?? window.location.href, normaliseMemberEmail(email));
  }

  async sendLink(email: string): Promise<void> {
    this.error = null;
    // Normalise before sending: the email passed here becomes the Auth account
    // email, and the member allowlist + rules key on the normalised form (#155).
    const normalised = normaliseMemberEmail(email);
    writePendingEmail(normalised);
    const continueUrl = window.location.origin + window.location.pathname;
    const result = await authProvider.sendMagicLink(normalised, continueUrl);
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
export async function devSignIn(emailInput: string): Promise<void> {
  const email = normaliseMemberEmail(emailInput);
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
