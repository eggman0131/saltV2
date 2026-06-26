import posthog from 'posthog-js';

// EU region is baked in as the default; the host is overridable via env only so
// a self-hosted/dev proxy can be pointed at, never to silently leave the EU
// data region. See CLAUDE.md — Region = EU.
const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

let ready = false;

export interface ObservabilityOptions {
  // When set, session replay is NOT auto-started even in production. e2e and
  // automated runs pass this so they don't record every page. Mirrors the LD
  // `manualStart` flag.
  manualStart?: boolean;
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

// Wires PostHog for the browser. No-ops entirely when `key` is empty (the e2e
// build empties VITE_PUBLIC_POSTHOG_KEY exactly as it empties the LD id today),
// so posthog.init is never called and every adapter method silently no-ops.
export function initObservability(key: string, opts?: ObservabilityOptions): void {
  if (ready) return;
  if (!key) return; // inert when the key is absent

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
      // Session replay only in production; PostHog default masking (mask all
      // text + all inputs) so no user content leaks into recordings.
      disable_session_recording: !replayEnabled,
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
      },
    });
    ready = true;
  } catch {
    // If init itself throws (misconfig, blocked network), stay inert rather
    // than crash the app at startup.
    ready = false;
  }
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

// ── Span/trace compatibility shims ──────────────────────────────────────────
// The fast-path call site (canonService.addCanonItem) opens an observability
// span and extracts W3C trace headers for the CF. PostHog has no client-side
// span/trace primitive, and cross-callable trace propagation is DORMANT
// (CLAUDE.md — trace propagation disabled 2026-05-11). These shims preserve the
// call-site surface: the span is inert (events are emitted via capture in the
// match adapter, not via span attributes), and extractTraceHeaders yields {}
// so the CF parents nothing — exactly the "tracing disabled" path.

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
