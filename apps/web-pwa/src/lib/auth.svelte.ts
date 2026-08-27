import type { User } from '@salt/domain';
import type { DomainError } from '@salt/shared-types';
import type { PendingEmailOtp } from '@salt/domain/schemas';
import { normaliseMemberEmail } from '@salt/domain';
import { PendingEmailOtpSchema } from '@salt/domain/schemas';
import { authProvider } from './firebase.js';
import { identifyUser, identifyAnonymous } from './observability.js';

// The two sanctioned `localStorage` keys in the app (CLAUDE.md Rule 3). Both hold
// PRE-AUTHENTICATION state, so there is no Firestore-backed alternative — there is
// no signed-in user to write a document as — and both must survive the user leaving
// the app to go and read their email:
//
//   pendingEmail  the magic-link address. Email clients open the link in a fresh
//                 tab or window, which gets a fresh `sessionStorage`, so
//                 `sessionStorage` cannot carry it.
//   pendingOtp    the in-flight code-entry step, `{ email, sentAt }`, TTL-checked
//                 on read against the server's code expiry below. An installed iOS
//                 PWA is routinely killed while backgrounded and a fresh launch
//                 gets a fresh `sessionStorage`, so holding this in memory (or in
//                 `sessionStorage`) strands the user on the request page with a
//                 code they cannot type in.
//
// Every access is wrapped so that storage being unavailable degrades quietly and
// never throws. Nothing else in the app may add a key here.
const PENDING_EMAIL_KEY = 'salt:auth:pendingEmail';
const PENDING_OTP_KEY = 'salt:auth:pendingOtp';

// Mirrors CODE_TTL_MS in apps/cloud-functions/src/auth/otpStore.ts — apps can't
// import each other, so the value is duplicated. Only used to decide whether a
// persisted code-entry step is still worth restoring; the server remains the
// authority on whether a code is actually live.
const OTP_TTL_MS = 10 * 60 * 1000;

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

// The in-flight OTP step gets the same treatment as the magic-link pending
// email, and for a sharper version of the same reason: the user MUST leave the
// app to fetch the code. An installed iOS PWA is routinely killed while it sits
// in the background, so an in-memory `codeSent` came back false and dumped the
// user on the request step with a freshly-read code and nowhere to type it
// (#585 follow-up). localStorage, not sessionStorage — a relaunched standalone
// app starts a new session, which is precisely the case being rescued.
function readPendingOtp(): PendingEmailOtp | null {
  try {
    const raw = window.localStorage.getItem(PENDING_OTP_KEY);
    if (!raw) return null;
    const parsed = PendingEmailOtpSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Storage unavailable or the value isn't JSON — treat as "no pending code"
    // and fall back to the request step, exactly as before this existed.
    return null;
  }
}

function writePendingOtp(pending: PendingEmailOtp): void {
  try {
    window.localStorage.setItem(PENDING_OTP_KEY, JSON.stringify(pending));
  } catch {
    /* localStorage unavailable — the code step just won't survive a relaunch */
  }
}

function clearPendingOtp(): void {
  try {
    window.localStorage.removeItem(PENDING_OTP_KEY);
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
  // Email-OTP flow (issue #546): true once a 6-digit code has been emailed, so
  // the login UI switches to the code-entry step. Backed by localStorage so the
  // step survives the app being killed while the user is off reading the email
  // (see readPendingOtp) — it is restored in the constructor.
  codeSent = $state(false);
  // The address the pending code was sent to. Restored alongside `codeSent`:
  // the code step names it, and submitCode has to verify against it, neither of
  // which the login form can supply after a relaunch has emptied its input.
  codeEmail = $state('');
  // The magic-link URL we're waiting to complete, captured before any history
  // rewrite so completeWithEmail can finish sign-in after the user re-enters.
  private pendingUrl: string | null = null;

  constructor() {
    this.restorePendingOtp();
    this.user = authProvider.getCurrentUser();
    authProvider.observe((u) => {
      this.user = u;
      this.loading = false;
      if (u) identifyUser(u);
      else identifyAnonymous();
    });
    void this.maybeCompleteFromUrl();
  }

  // Put the UI back on the code-entry step after a relaunch, provided the code
  // could still be live. An expired one is dropped rather than restored — the
  // server would reject it, so the request step is the honest place to land.
  private restorePendingOtp(): void {
    const pending = readPendingOtp();
    if (!pending) return;
    if (Date.now() - pending.sentAt >= OTP_TTL_MS) {
      clearPendingOtp();
      return;
    }
    this.codeEmail = pending.email;
    this.codeSent = true;
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

  // ── Email-OTP sign-in (issue #546) — an in-app alternative to magic link ──

  // Ask the server to email a 6-digit code. Enumeration-safe on the server, so a
  // success just means "if this email is a member, a code is on its way".
  async requestCode(email: string): Promise<void> {
    this.error = null;
    const normalised = normaliseMemberEmail(email);
    const result = await authProvider.requestEmailCode(normalised);
    if (result.kind === 'ok') {
      this.codeEmail = normalised;
      this.codeSent = true;
      // Persist before the user leaves for their email client — that departure
      // is what can kill the app, and it happens the moment this resolves.
      writePendingOtp({ email: normalised, sentAt: Date.now() });
    } else {
      this.error = formatError(result.error);
    }
  }

  // Verify the entered code. On success the auth-state observer updates `user`;
  // on failure we surface a code-specific message (not the generic one).
  async submitCode(email: string, code: string): Promise<void> {
    this.error = null;
    const result = await authProvider.signInWithEmailCode(normaliseMemberEmail(email), code);
    if (result.kind === 'ok') {
      // Spent — don't leave a step behind that a later sign-out would restore.
      this.resetCode();
    } else {
      this.error = formatOtpError(result.error);
    }
  }

  // Return to the "enter your email" step (change email / start over).
  resetCode(): void {
    this.codeSent = false;
    this.codeEmail = '';
    this.error = null;
    clearPendingOtp();
  }

  async signOut(): Promise<void> {
    this.error = null;
    const result = await authProvider.signOut();
    if (result.kind !== 'ok') {
      this.error = formatError(result.error);
    }
  }
}

// OTP verify failures map to a code-specific message: a wrong/expired code
// arrives as AuthError.expired, an off-allowlist email as AuthError.forbidden.
function formatOtpError(err: DomainError): string {
  if (err.kind === 'NetworkError') return 'Network error — please check your connection.';
  if (err.kind === 'AuthError' && err.reason === 'forbidden') {
    return 'This email address is not on the Salt member list. Ask an admin to add you.';
  }
  if (err.kind === 'AuthError' && err.reason === 'expired') {
    return 'That code is incorrect or has expired. Request a new one.';
  }
  return 'Sign-in failed. Please try again.';
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
