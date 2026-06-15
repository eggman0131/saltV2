import {
  initLDObservability,
  identifyObservabilityUser,
  identifyObservabilityAnonymous,
  tagObservabilitySession,
  getObservabilitySessionURL,
  startObservabilitySession,
  stopObservabilitySession,
  isObservabilitySessionActive,
  type ObservabilitySessionMeta,
} from '@salt/ld-observability';
import type { User } from '@salt/domain';

// Keep observability ON in dev — it's where we watch behaviour most — but start
// session replay manually there so e2e/automated runs don't auto-record every page.
const _ldKey = import.meta.env.VITE_LD_CLIENT_SIDE_ID as string | undefined;
const _useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
if (_ldKey) initLDObservability(_ldKey, { manualStart: _useEmulators });

// Dev runs against the Firebase Auth emulator, whose uid is ephemeral (new on
// every restart / sign-in) and whose e2e suite signs in as uniqueEmail() per
// test — so identifying by uid minted a fresh billable LD context, and burned a
// client-side MAU, on every dev/e2e sign-in (~1,000/mo, the whole cap). Dev is
// only ever one developer on one or two devices, so pin it to a single stable
// context key: full observability, ~1 MAU instead of thousands. Prod/staging
// keep the real uid (those are real, stable users — production is exactly 5).
const DEV_CONTEXT_KEY = 'dev-local';

export function identifyUser(user: User): void {
  const key = _useEmulators ? DEV_CONTEXT_KEY : user.uid;
  identifyObservabilityUser(key, user.email ?? undefined);
}

export function identifyAnonymous(): void {
  identifyObservabilityAnonymous();
}

export function tagSession(meta: ObservabilitySessionMeta): void {
  tagObservabilitySession(meta);
}

export function getSessionURL(): string | null {
  return getObservabilitySessionURL();
}

export function startSession(name?: string): void {
  startObservabilitySession(name);
}

export function stopSession(): void {
  stopObservabilitySession();
}

export function isSessionActive(): boolean {
  return isObservabilitySessionActive();
}

export type { ObservabilitySessionMeta };
