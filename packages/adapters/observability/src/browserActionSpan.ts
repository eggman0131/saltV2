// ── User-action span contract + inert handle (issue #362 Phase 4; split #813) ──
// The OTel-FREE half of the browser tracer: the handle shape every call site
// programs against, and the no-op that stands in whenever tracing is not live.
//
// It is its own module so the facade (browserTracer.ts) and the implementation
// (browserTracerImpl.ts) can both use it without either importing the other:
// the facade must stay free of `@opentelemetry/*` to keep the SDK out of the boot
// graph, and the impl must not import the facade back (that would be a cycle —
// CLAUDE.md Rule 8). Nothing here pulls a dependency of any kind.

export interface UserActionSpan {
  /** W3C `traceparent` to hand to a firebase-sync callable wrapper. Empty string when tracing is inert. */
  readonly traceparent: string;
  /** Open a child span (e.g. the callable round-trip) under this action span. */
  child(name: string): UserActionChildSpan;
  /** Mark the action as failed before ending (records an ERROR status). */
  setError(err?: unknown): void;
  /** Set a bounded string attribute on the action span. */
  setAttribute(key: string, value: string | number | boolean): void;
  /** End the action span (captures total client-side latency). Idempotent. */
  end(): void;
}

export interface UserActionChildSpan {
  setError(err?: unknown): void;
  end(): void;
}

// Inert no-op action span returned when tracing is off — keeps every call site
// branch-free (no `if (ready)` at the call site) and never throws. An empty
// `traceparent` is the documented, already-handled degradation: the callable
// wrapper omits the header and the server leg roots its own plain trace.
export const NOOP_CHILD: UserActionChildSpan = { setError() {}, end() {} };
export const NOOP_ACTION: UserActionSpan = {
  traceparent: '',
  child: () => NOOP_CHILD,
  setError() {},
  setAttribute() {},
  end() {},
};
