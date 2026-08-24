// ── Browser tracer facade — keeps the OTel SDK out of the boot graph (#813) ────
// Same public surface as before the split; every `@opentelemetry/*` import now
// lives in browserTracerImpl.ts, reached only by the `await import()` below.
//
// Why: init.ts calls initBrowserTracing from initObservability, which main.ts
// reaches on its first statement — so a static import put the whole SDK (~58 kB
// of sdk-trace-base + core + api + resources + sdk-trace-web) in front of first
// paint on every phone, for a tracer that does nothing until the user taps
// something. This file must therefore stay free of `@opentelemetry/*`, including
// type-only imports of values.
//
// The load is FIRE-AND-FORGET, deliberately: it starts at boot rather than on the
// first traced action, because the first meaningful action of a session ("Add
// item", "Import recipe") is precisely the one worth tracing. It resolves within
// a few hundred ms — shorter than the time it takes anyone to tap.
//
// startUserActionSpan stays SYNCHRONOUS and its signature is unchanged. Before
// the implementation resolves it returns NOOP_ACTION, which is the exact handle
// it already returned whenever tracing was inert (no key, provider build failure)
// — so this widens an existing, documented degradation rather than introducing a
// new one: the callable gets no traceparent and the server leg roots its own
// plain trace. Call sites are untouched.
//
// CLAUDE.md Rule 10: best-effort, NEVER throws. A rejected dynamic import (chunk
// 404 after a stale deploy, offline first paint) leaves tracing permanently inert
// for that page load, exactly as an absent PostHog key does.

import { NOOP_ACTION, type UserActionSpan } from './browserActionSpan.js';

export type { UserActionSpan, UserActionChildSpan } from './browserActionSpan.js';

type BrowserTracerImpl = typeof import('./browserTracerImpl.js');

// Set once the implementation chunk has loaded AND been initialised. Null means
// every helper below degrades to its inert path.
let impl: BrowserTracerImpl | null = null;

// The in-flight load, or null when none is running. Guards a second
// initBrowserTracing call firing a second import while the first is still in
// flight (the import itself is cached, but its `.then` would re-run the
// implementation's own init). Cleared on failure so a later call may retry.
//
// Held as the PROMISE rather than a boolean purely so the load is observable —
// see loadSettled() below. Production still never awaits it.
let loading: Promise<void> | null = null;

// Kick off the implementation load and initialise it when it lands. Idempotent,
// and inert without a key (mirrors initObservability) — so the SDK chunk is never
// even requested when tracing is gated off.
export function initBrowserTracing(key: string, environment?: string): void {
  if (impl || loading) return;
  if (!key) return;
  // Not awaited: initObservability is on the boot path and must not block on a
  // telemetry chunk. Failures are swallowed (Rule 10) and leave tracing inert.
  loading = import('./browserTracerImpl.js')
    .then((module) => {
      module.initBrowserTracing(key, environment);
      impl = module;
    })
    .catch(() => {
      // Inert — no tracing this page load. Never surfaced to the caller.
      loading = null;
    });
}

// True once the implementation has loaded and stood up a real tracer. False for
// the whole pre-load window, which is what the inert path below keys off.
export function isBrowserTracingReady(): boolean {
  return impl?.isBrowserTracingReady() ?? false;
}

// Start a ROOT span for a user action and return a handle carrying its W3C
// traceparent + lifecycle methods. See browserTracerImpl for the real behaviour.
// Synchronous by contract: returns the inert handle while the implementation is
// still loading, or if it never does. Never throws (Rule 10).
export function startUserActionSpan(name: string): UserActionSpan {
  return impl ? impl.startUserActionSpan(name) : NOOP_ACTION;
}

// Resolves once the fire-and-forget load above has settled — loaded, or failed
// and left tracing inert. Resolves immediately when no load was ever started.
//
// NOT part of the observability port and deliberately NOT re-exported from
// index.ts: no application code should ever wait on telemetry. It exists for the
// TEST HARNESS (issue #977). A page can afford to be torn down with the chunk
// still in flight; a Vitest worker cannot. If the module finishes evaluating
// after the worker has taken its V8 coverage snapshot, V8 reports the same script
// a second time with every count at zero, and merging that zero-count entry into
// the real one misaligns the two statement maps — the report then credits lines
// that provably never ran (the `pagehide` block, in a `node` environment where
// `window` is undefined) and drops lines that provably did. That is what made
// `packages/adapters/observability/src/**` measure 422/511 lines on a cold Vite
// transform cache and 427/511 once warm. The observability project's setup file
// awaits this after every test so the load can never straddle teardown.
export function browserTracingLoadSettled(): Promise<void> {
  return loading ?? Promise.resolve();
}
