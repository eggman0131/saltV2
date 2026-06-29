import {
  initObservability,
  identifyObservabilityUser,
  identifyObservabilityAnonymous,
  tagObservabilitySession,
  getObservabilitySessionURL,
  startObservabilitySession,
  stopObservabilitySession,
  isObservabilitySessionActive,
  sendSupportFeedback,
  type ObservabilitySessionMeta,
} from '@salt/observability';
import type { User } from '@salt/domain';

// Keep observability ON in dev — it's where we watch behaviour most — but start
// session replay manually there so e2e/automated runs don't auto-record every page.
const _phKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined;
const _useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
// Vite's mode is the build target — 'development' (vite dev), 'staging'
// (build:staging --mode staging), or 'production' (build). It maps 1:1 to the
// deployment environment, so it becomes the OTel-standard `deployment.environment`
// super property in the SAME vocabulary the cloud-functions side derives from its
// project id.
if (_phKey)
  initObservability(_phKey, {
    manualStart: _useEmulators,
    environment: import.meta.env.MODE,
    // Build commit (settings page "Version") → `app_version` super property on
    // every event, so exceptions/feedback/analytics all carry the running build.
    version: __APP_VERSION__,
  });

// Dev runs against the Firebase Auth emulator, whose uid is ephemeral (new on
// every restart / sign-in) and whose e2e suite signs in as uniqueEmail() per
// test — so identifying by uid minted a fresh PostHog person, and burned a
// billable MAU, on every dev/e2e sign-in (~1,000/mo, the whole cap). Dev is
// only ever one developer on one or two devices, so pin it to a single stable
// distinct id: full observability, ~1 MAU instead of thousands. Prod/staging
// keep the real uid (those are real, stable users — production is exactly 5).
const DEV_CONTEXT_KEY = 'dev-local';

export function identifyUser(user: User): void {
  const key = _useEmulators ? DEV_CONTEXT_KEY : user.uid;
  // It's a single-family app with no privacy concerns, so surface the email as
  // the human-readable name in the PostHog UI (the distinct id stays the stable uid).
  identifyObservabilityUser(key, user.email ?? undefined, user.email ?? undefined);
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

// Sends a user's settings-page feedback to PostHog Support as a new ticket. The
// signed-in email is attached as the ticket identity — identifyUser already calls
// posthog.identify with it, but passing it keeps the inbox ticket labelled
// regardless. Resolves true on a confirmed send; the settings page renders
// success/error from the boolean.
//
// Non-production feedback is footer-tagged with the deployment environment — the
// SAME `import.meta.env.MODE` value we register as the PostHog
// `deployment.environment` super property. The super property already rides on the $conversations_message_sent
// event (so analytics can split by env), but the Support *inbox* can't filter
// tickets by a super property, so the env has to live on the ticket itself. Prod
// feedback (real users) is sent verbatim; dev/staging tickets self-label as test.
export function submitFeedback(text: string, email?: string): Promise<boolean> {
  const env = import.meta.env.MODE;
  // Stamp every ticket with the running version (triage context for any bug
  // report), and additionally flag non-prod submissions as test. The super
  // properties carry these on the $conversations_message_sent event, but the
  // Support inbox can't read super properties, so they go on the ticket body too.
  const footer =
    env === 'production'
      ? `— version ${__APP_VERSION__}`
      : `— version ${__APP_VERSION__} · sent from ${env} (test)`;
  return sendSupportFeedback(`${text}\n\n${footer}`, email ? { name: email, email } : undefined);
}

export type { ObservabilitySessionMeta };
