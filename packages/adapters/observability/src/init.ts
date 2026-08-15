import posthog from 'posthog-js';
import { initBrowserTracing } from './browserTracer.js';

// EU region is baked in as the default; the host is overridable via env only so
// a self-hosted/dev proxy can be pointed at, never to silently leave the EU
// data region. See CLAUDE.md — Region = EU.
const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

let ready = false;

// True once PostHog has delivered a flag payload at least once — or has
// definitively failed to. See `areObservabilityFeatureFlagsSettled` for why the
// distinction between "not yet" and "false" is the whole point of this bit.
let flagsSettled = false;

// True once initObservability was called WITH a key — i.e. this build is meant to
// have live PostHog, whether or not the SDK then came up. Deliberately NOT the
// same bit as `ready`, which cannot tell "no telemetry configured" apart from
// "telemetry configured and broken". Only the feature-flag gate needs to tell them
// apart, and it must: see `isObservabilityFeatureEnabled` (issue #831).
let configured = false;

export interface ObservabilityOptions {
  // When set, session replay is NOT auto-started even in production. e2e and
  // automated runs pass this so they don't record every page. Mirrors the LD
  // `manualStart` flag.
  manualStart?: boolean;
  // Deployment environment ('production' | 'staging' | 'development'). When set, it
  // is registered as a PostHog super property under the OTel-standard
  // `deployment.environment` key so it rides on EVERY event the SDK emits —
  // autocapture, pageviews, manual captures, exceptions, and replay metadata —
  // without each call site having to attach it.
  environment?: string;
  // App version stamp (the release tag / __APP_VERSION__). Like `environment`, it
  // is registered as a super property so EVERY event carries the version the user
  // was running — invaluable for "which release introduced this exception?" and
  // for triaging feedback against a specific build.
  version?: string;
}

// True once initObservability has successfully called posthog.init. Adapter
// entrypoints gate on this so they stay inert — rather than throwing — when
// PostHog is uninitialised (e.g. gated off by an empty VITE_PUBLIC_POSTHOG_KEY
// in the e2e build). Adapters never throw for operational reasons (CLAUDE.md
// Rule 10).
export function isObservabilityReady(): boolean {
  return ready;
}

// Guards every PostHog call so an internal SDK failure (capture, identify,
// replay) can never throw across the port boundary. Telemetry is best-effort:
// a dropped event is always preferable to a thrown error in a caller's hot path.
export function safePosthog(fn: (ph: typeof posthog) => void): void {
  if (!ready) return;
  try {
    fn(posthog);
  } catch {
    // Swallow — observability must never surface failures to callers.
  }
}

// ── Feature flags (issue #831) ───────────────────────────────────────────────
// PostHog's flag evaluation, wrapped in the same never-throws posture as every
// other entrypoint here (CLAUDE.md Rule 10). Three functions because a caller
// gating a whole screen needs all three: the answer, whether the answer has
// arrived, and a way to be told when it changes.

// Whether `key` is on for the person PostHog currently believes it is talking to.
//
// UNCONFIGURED MEANS UNGATED, and that is deliberate rather than a convenience.
// Live PostHog is the only thing that can say "yes" here, so where there is no key
// at all the honest reading is not "everything is off" but "nothing is being
// gated" — which is what an empty VITE_PUBLIC_POSTHOG_KEY means in the e2e build
// and in every unit test. Fail-closed there would switch off half the app in the
// suites that exist to exercise it, for a gate that is cosmetic in the first place.
//
// A CONFIGURED-BUT-BROKEN SDK IS NOT THAT CASE, and the two must not be conflated:
// a key was supplied and posthog.init threw (misconfig, an ad blocker, a blocked
// network), which is a failure, and failures fail closed. `ready` alone cannot tell
// the two apart — hence `configured`.
//
// Every other path fails closed too. Note posthog.isFeatureEnabled returns
// `boolean | undefined` — undefined while the payload is still in flight — so the
// `=== true` is what makes "not yet loaded" read as off rather than as on.
export function isObservabilityFeatureEnabled(key: string): boolean {
  if (!configured) return true; // no PostHog in this build — nothing is gated
  if (!ready) return false; // PostHog was meant to be here and isn't — fail closed
  try {
    return posthog.isFeatureEnabled(key) === true;
  } catch {
    return false;
  }
}

// Whether the flag answer above is final. A route guard needs this: without it,
// "in flight" and "off" are the same `false`, and the flagged user gets bounced
// off their own page on first paint, a beat before the payload lands.
//
// Not-ready is settled by definition — no payload is coming, so the answer will
// never change. That covers BOTH of the cases the function above separates: with
// no key the answer is a settled "ungated", and with a broken SDK it is a settled
// "off". Either way the guard must act rather than spin forever.
export function areObservabilityFeatureFlagsSettled(): boolean {
  return !ready || flagsSettled;
}

// Subscribe to flag payloads. Returns an unsubscribe; callers must call it.
// Inert (and still returning a no-op unsubscribe, so callers need no branch) when
// observability never came up.
export function onObservabilityFeatureFlags(cb: () => void): () => void {
  if (!ready) return () => {};
  try {
    return posthog.onFeatureFlags(() => cb());
  } catch {
    return () => {};
  }
}

// Wires PostHog for the browser. No-ops entirely when `key` is empty (the e2e
// build empties VITE_PUBLIC_POSTHOG_KEY exactly as it empties the LD id today),
// so posthog.init is never called and every adapter method silently no-ops.
export function initObservability(key: string, opts?: ObservabilityOptions): void {
  if (ready) return;
  if (!key) return; // inert when the key is absent
  // A key was supplied, so this build is MEANT to have live PostHog. Recorded
  // before the init attempt precisely so a failed attempt still counts as
  // configured — see isObservabilityFeatureEnabled.
  configured = true;

  // Session replay runs only in production builds (import.meta.env.PROD), and
  // even then is held back when manualStart is requested (e2e/automated runs).
  const replayEnabled = Boolean(import.meta.env.PROD) && !opts?.manualStart;

  const host =
    (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined) || DEFAULT_POSTHOG_HOST;

  try {
    posthog.init(key, {
      api_host: host,
      // EU region — derived from the host above; kept explicit so the SDK does
      // not fall back to the US ingestion endpoint for any sub-feature.
      ui_host: 'https://eu.posthog.com',
      // Autocapture (clicks/inputs/etc.) and pageviews on — the closest PostHog
      // analogue to LD's automatic observability instrumentation.
      autocapture: true,
      capture_pageview: true,
      capture_pageleave: true,
      // Session replay only in production. On-screen text is captured so
      // recordings are legible — recipe-app content (recipes, shopping list,
      // canon, aisles) is family-shared and non-PII. Inputs stay masked
      // (maskAllInputs) so what users actively type — including the login
      // email field — never lands in a recording.
      disable_session_recording: !replayEnabled,
      session_recording: {
        maskAllInputs: true,
      },
    });
    ready = true;
  } catch {
    // If init itself throws (misconfig, blocked network), stay inert rather
    // than crash the app at startup.
    ready = false;
  }

  // Flip the "the answer has arrived" bit the first time PostHog delivers a flag
  // payload (issue #831). Registered through safePosthog so it no-ops when init
  // above failed and can never throw at startup. PostHog fires this callback even
  // when the payload errored (`{ errorsLoading }`), which is exactly what is
  // wanted: settled means the answer arrived OR definitively failed, and a failed
  // load leaves every flag false — fail closed, but without hanging a route guard
  // on a spinner forever.
  safePosthog((ph) =>
    ph.onFeatureFlags(() => {
      flagsSettled = true;
    }),
  );

  // Register environment + app version as super properties so they persist in the
  // SDK and ride on every subsequent event. Guarded via safePosthog so a register
  // failure can never unset readiness or throw at startup, and so it no-ops when
  // init above failed (ready === false). Built into a local bag so both register
  // in a single call and so absent values are simply omitted.
  const superProperties: Record<string, string> = {};
  // OTel-standard `deployment.environment` — the single environment key across all
  // telemetry (browser/server events + spans), so the app is standard + consistent.
  if (opts?.environment) superProperties['deployment.environment'] = opts.environment;
  if (opts?.version) superProperties.app_version = opts.version;
  if (Object.keys(superProperties).length > 0) {
    safePosthog((ph) => ph.register(superProperties));
  }

  // Stand up the browser OTel tracer (issue #362, Phase 4) on the SAME public key
  // PostHog uses. Gated/inert without a key exactly like posthog.init above, and
  // never throws — a tracer build failure must not crash app startup. This is what
  // makes "Import recipe" / "Author recipe" traces ROOT at the browser click and
  // hand a W3C traceparent to the callable so the CF+canon+AI sub-tree nests under
  // one trace id. The same `environment` registered as a super property above is
  // handed down so the browser-rooted spans carry it as a resource attribute too.
  initBrowserTracing(key, opts?.environment);
}

// `name`/`email` set the human-readable identity PostHog's Persons and replay
// UI show in place of the opaque distinct id. The distinct id stays the stable
// uid so person dedup is unaffected; name/email are display-only person props.
export function identifyObservabilityUser(uid: string, email?: string, name?: string): void {
  safePosthog((ph) => {
    const props: Record<string, string> = {};
    if (email) props.email = email;
    if (name) props.name = name;
    ph.identify(uid, props);
  });
}

export function identifyObservabilityAnonymous(): void {
  // Drop the identified person and revert to an anonymous distinct id.
  safePosthog((ph) => ph.reset());
}

export function trackObservabilityEvent(key: string, data?: Record<string, unknown>): void {
  safePosthog((ph) => ph.capture(key, data));
}

// ── Support feedback (PostHog Conversations) ─────────────────────────────────
// posthog-js exposes `posthog.conversations` once the Support product is enabled
// for the project (conversations_enabled) AND the conversations module has lazily
// loaded from remote config. sendMessage opens a support ticket that lands in the
// PostHog inbox with the session replay + exceptions attached. The web-pwa
// settings-page feedback box uses this in place of the floating chat widget.

// Public traits shape for the adapter API — intentionally NOT posthog-js's
// UserProvidedTraits, so the SDK type never leaks across the package boundary.
export interface SupportFeedbackTraits {
  name?: string;
  email?: string;
}

// posthog-js types `conversations` as a tree-shakeable handle; narrow it to the
// methods we use at this single SDK seam rather than depend on that wrapper type.
interface ConversationsApi {
  isAvailable(): boolean;
  sendMessage(
    message: string,
    userTraits?: SupportFeedbackTraits,
    newTicket?: boolean,
  ): Promise<unknown>;
}

// Sends a one-off feedback message as a NEW support ticket. Resolves true on a
// confirmed send; false when observability is inert, the conversations module is
// unavailable (not yet loaded, Support disabled, or blocked by CSP), or the send
// fails. Best-effort and never throws across the boundary (CLAUDE.md Rule 10) —
// the caller renders success/error from the boolean.
export async function sendSupportFeedback(
  message: string,
  traits?: SupportFeedbackTraits,
): Promise<boolean> {
  if (!ready) return false;
  const conversations = posthog.conversations as unknown as ConversationsApi | undefined;
  if (!conversations?.isAvailable()) return false;
  try {
    // newTicket=true so each submission is its own ticket instead of appending
    // to a stale thread.
    const response = await conversations.sendMessage(message, traits, true);
    return Boolean(response);
  } catch {
    return false;
  }
}

// ── Span/trace compatibility shims ──────────────────────────────────────────
// The fast-path call site (canonService.addCanonItem) opens an observability
// span purely to label its in-app match logging; that span is intentionally inert
// (events are emitted via capture in the match adapter, not via span attributes),
// and extractTraceHeaders yields {} — the canon fast path does NOT mint a
// browser→CF trace (server-side unification reads the request, not these).
//
// Browser-ROOTED distributed tracing (issue #362, Phase 4) is a SEPARATE, real
// surface: see `startUserActionSpan` in browserTracer.ts, re-exported from the
// barrel. That is what the instrumented user actions ("Import recipe", "Author
// recipe") use to start a real OTel root span and hand its W3C traceparent to the
// callable. These two shims stay for the canon fast-path call-site surface only.

export interface ObservabilitySpan {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

const NOOP_SPAN: ObservabilitySpan = {
  setAttribute() {},
  end() {},
};

export function startSpan(
  _name: string,
  _opts?: { parent?: ObservabilitySpan },
): ObservabilitySpan {
  return NOOP_SPAN;
}

export function extractTraceHeaders(_span: ObservabilitySpan): Record<string, string> {
  return {};
}
