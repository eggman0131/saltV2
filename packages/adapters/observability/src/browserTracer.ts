// ── Browser OpenTelemetry tracer + OTLP/JSON exporter (issue #362, Phase 4) ─────
// Stands up a browser-side OTel tracer so user actions ("Import recipe", "Author
// recipe") START a human-readable ROOT span in the browser, capture client-side
// timing, and hand their W3C `traceparent` to the firebase-sync callable wrappers.
// Phase 3's server side already nests the CF + canon + AI sub-tree under a
// supplied traceparent, so the whole path renders as ONE trace id rooted at the
// browser click.
//
// The exporter POSTs OTLP/JSON to PostHog's distributed-tracing endpoint
// (`/i/v1/traces`) — the SAME endpoint and the SAME wire shape the server
// distributed leg uses, via the shared `buildOtlpBody` (anti-drift; src/shared/).
// service.name = `salt-web-pwa`, distinct from the server's `salt-cloud-functions`.
//
// CLAUDE.md: best-effort, NEVER throws (Rule 10) — a dropped span beats a thrown
// error in a user's hot path. Trace state is IN-MEMORY only (Rule 3): no
// localStorage / sessionStorage / IndexedDB / caches. No-ops entirely when the
// public PostHog key is absent (mirrors how PostHog init no-ops without a key).

import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
  type Context,
} from '@opentelemetry/api';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { Resource } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  WebTracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-web';
import {
  buildOtlpBody,
  hrTimeToNanos,
  intAttr,
  strAttr,
  boolAttr,
  type Attribute,
  type OtlpSpan,
} from './shared/otlpWire.js';

// Browser emitter identity — distinct from the server's `salt-cloud-functions`.
const SERVICE_NAME = 'salt-web-pwa';
// EU default; overridable via env only (never to silently leave the EU region).
const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';
// PostHog's distributed-tracing OTLP/JSON ingestion path — same as the server leg.
const DISTRIBUTED_OTLP_PATH = '/i/v1/traces';
// Cap human-readable span names so family-shared content (host/title) stays bounded.
const MAX_SPAN_NAME = 80;

const TRACER_NAME = 'salt-web-pwa';

// In-memory provider/tracer singletons (Rule 3 — no persisted trace state). Null
// until initBrowserTracing builds them; null again means tracing is inert and
// every public helper degrades to a safe no-op.
let provider: WebTracerProvider | null = null;
let tracer: Tracer | null = null;

// ── OTLP/JSON exporter ─────────────────────────────────────────────────────────

// Encode a span attribute value as OTLP/JSON. Only scalar types map cleanly;
// objects/arrays/null/undefined are dropped. Mirrors the server distributed leg
// (distributedSpanProcessor.encodeAttr) so both legs encode attributes identically.
function encodeAttr(key: string, value: unknown): Attribute | null {
  if (typeof value === 'string') return strAttr(key, value);
  if (typeof value === 'boolean') return boolAttr(key, value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? intAttr(key, value) : strAttr(key, String(value));
  }
  return null;
}

// Map a finished browser ReadableSpan → the shared OtlpSpan shape verbatim.
// Forwards name, ids, timing, kind and scalar attributes; omits parentSpanId on a
// root span (no empty string). Exported for the unit test.
export function toBrowserOtlpSpan(span: ReadableSpan): OtlpSpan {
  const ctx = span.spanContext();
  const attributes: Attribute[] = [];
  for (const [key, value] of Object.entries(span.attributes ?? {})) {
    const encoded = encodeAttr(key, value);
    if (encoded) attributes.push(encoded);
  }
  const out: OtlpSpan = {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    name: span.name,
    kind: typeof span.kind === 'number' ? span.kind : SpanKind.INTERNAL,
    startTimeUnixNano: hrTimeToNanos(span.startTime),
    endTimeUnixNano: hrTimeToNanos(span.endTime),
    attributes,
  };
  const parent = span.parentSpanId;
  if (parent) out.parentSpanId = parent;
  return out;
}

// A custom SpanExporter that POSTs a batch of OTLP/JSON spans to PostHog using the
// PUBLIC project key (Bearer) — the same VITE_PUBLIC_* env the browser PostHog
// init reads. Best-effort: every send swallows its own failure and reports
// SUCCESS to the SDK so a network error never escalates into a thrown export. When
// `useBeacon` is set (pagehide flush) it sends via navigator.sendBeacon / fetch
// keepalive so the in-flight spans survive an unloading page.
class PosthogOtlpSpanExporter implements SpanExporter {
  private readonly endpoint: string;
  constructor(
    private readonly key: string,
    host: string,
  ) {
    this.endpoint = `${host}${DISTRIBUTED_OTLP_PATH}`;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    try {
      const body = JSON.stringify(buildOtlpBody(spans.map(toBrowserOtlpSpan), SERVICE_NAME));
      // fetch keepalive lets the request outlive the export() call without us
      // awaiting it on a hot path; failures are swallowed (Rule 10).
      void fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body,
        keepalive: true,
      }).catch(() => {
        // Never surface a telemetry export failure to the caller (Rule 10).
      });
    } catch {
      // Swallow — a build/serialise failure must never throw across the SDK.
    }
    // Always report SUCCESS so the SDK's batch pipeline never treats a best-effort
    // telemetry POST as a retryable failure that could stall a flush.
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  // Best-effort beacon flush for pagehide: sendBeacon survives an unloading page
  // where a normal fetch may be cancelled. Falls back to fetch keepalive.
  sendBeacon(spans: ReadableSpan[]): void {
    try {
      const body = JSON.stringify(buildOtlpBody(spans.map(toBrowserOtlpSpan), SERVICE_NAME));
      const beacon =
        typeof navigator !== 'undefined' ? navigator.sendBeacon?.bind(navigator) : null;
      if (beacon) {
        // sendBeacon can't set an Authorization header; PostHog accepts the key as
        // a query param on the ingestion endpoint for beacon-style sends.
        beacon(`${this.endpoint}?api_key=${encodeURIComponent(this.key)}`, body);
        return;
      }
      void fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Best-effort.
    }
  }

  async shutdown(): Promise<void> {
    return Promise.resolve();
  }
  async forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

// ── Init ────────────────────────────────────────────────────────────────────────

// Read the host the same way init.ts does — VITE_PUBLIC_POSTHOG_HOST, EU default.
function resolveHost(): string {
  try {
    return (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined) || DEFAULT_POSTHOG_HOST;
  } catch {
    return DEFAULT_POSTHOG_HOST;
  }
}

// Build the in-memory tracer provider ONCE. No-op when `key` is empty (tracing
// gated off, exactly like PostHog init) or when already initialised. Never throws
// at startup — a provider construction failure leaves the package inert.
export function initBrowserTracing(key: string): void {
  if (provider || tracer) return;
  if (!key) return; // inert when the key is absent — mirrors initObservability
  try {
    const host = resolveHost();
    const exporter = new PosthogOtlpSpanExporter(key, host);
    const built = new WebTracerProvider({
      resource: new Resource({ 'service.name': SERVICE_NAME }),
    });
    // BatchSpanProcessor: client spans are not in a paused-between-invocations
    // runtime (unlike CF), so batching is fine and cheaper than per-span POSTs.
    // addSpanProcessor is the 1.x API (spanProcessors-in-config is 2.x-only).
    built.addSpanProcessor(new BatchSpanProcessor(exporter));
    provider = built;
    tracer = built.getTracer(TRACER_NAME);

    // Flush in-flight spans when the page is hidden/unloaded so a navigation away
    // mid-action doesn't drop the trace. pagehide is the reliable lifecycle event
    // across browsers (unload is unreliable on mobile). Best-effort, never throws.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => {
        try {
          void built.forceFlush();
        } catch {
          // Best-effort.
        }
      });
    }
  } catch {
    provider = null;
    tracer = null;
  }
}

// True once a real tracer is live. Mirrors isObservabilityReady for the tracer leg.
export function isBrowserTracingReady(): boolean {
  return tracer !== null;
}

// ── W3C traceparent ──────────────────────────────────────────────────────────────

// Build the standard W3C `traceparent` header value from a span's SpanContext:
//   00-<32hex traceId>-<16hex spanId>-01   (version 00, sampled flag 01)
// Built directly from span.spanContext() (the spec's "OR build it from
// span.spanContext()" option) — no propagator/context plumbing needed for a value
// we hand to the callable wrapper as a plain string.
function traceparentFromSpan(span: Span): string {
  const ctx = span.spanContext();
  // traceFlags is a bitfield; bit 0 = sampled. Render as 2 hex digits.
  const flags = (ctx.traceFlags & 0x1).toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

// ── Public action-span API ───────────────────────────────────────────────────────

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

function clampName(name: string): string {
  return name.length > MAX_SPAN_NAME ? `${name.slice(0, MAX_SPAN_NAME - 1)}…` : name;
}

function recordError(span: Span, err?: unknown): void {
  try {
    span.setStatus({ code: SpanStatusCode.ERROR });
    if (err !== undefined) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
    }
  } catch {
    // Best-effort.
  }
}

// Inert no-op action span returned when tracing is off — keeps every call site
// branch-free (no `if (ready)` at the call site) and never throws.
const NOOP_CHILD: UserActionChildSpan = { setError() {}, end() {} };
const NOOP_ACTION: UserActionSpan = {
  traceparent: '',
  child: () => NOOP_CHILD,
  setError() {},
  setAttribute() {},
  end() {},
};

// Start a ROOT span for a user action and return a handle carrying its W3C
// traceparent + lifecycle methods. The span is rooted (no active parent context),
// so it is the trace's origin — the browser click. Hand `.traceparent` to the
// firebase-sync callable wrapper (2nd arg) so the CF flow nests under THIS trace.
// Inert no-op when tracing is off. Never throws (Rule 10).
export function startUserActionSpan(name: string): UserActionSpan {
  const t = tracer;
  if (!t) return NOOP_ACTION;
  try {
    // ROOT span: start in an explicitly-empty context so it does not pick up any
    // ambient active span and becomes the trace origin.
    const rootSpan = t.startSpan(clampName(name), { root: true });
    const spanCtx: Context = trace.setSpan(context.active(), rootSpan);
    let ended = false;
    return {
      traceparent: traceparentFromSpan(rootSpan),
      child(childName: string): UserActionChildSpan {
        try {
          const childSpan = t.startSpan(clampName(childName), undefined, spanCtx);
          let childEnded = false;
          return {
            setError(err?: unknown) {
              recordError(childSpan, err);
            },
            end() {
              if (childEnded) return;
              childEnded = true;
              try {
                childSpan.end();
              } catch {
                /* best-effort */
              }
            },
          };
        } catch {
          return NOOP_CHILD;
        }
      },
      setError(err?: unknown) {
        recordError(rootSpan, err);
      },
      setAttribute(key, value) {
        try {
          rootSpan.setAttribute(key, value);
        } catch {
          /* best-effort */
        }
      },
      end() {
        if (ended) return;
        ended = true;
        try {
          rootSpan.end();
        } catch {
          /* best-effort */
        }
      },
    };
  } catch {
    return NOOP_ACTION;
  }
}
