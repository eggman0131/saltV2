// ── PostHog distributed-tracing span processor ─────────────────────────────────
// Ships EVERY finished span (not just genkit:*/AI spans) to PostHog's
// distributed-tracing OTLP endpoint (`/i/v1/traces`) so a CF invocation renders
// as ONE coherent end-to-end trace — the canon-matching structural spans, their
// single-invocation parents, and the auto-instrumented Firestore/HTTP spans, all
// correlated by trace_id to the AI generations the AI leg ships to
// `/i/v0/ai/otel` (#356 follow-up).
//
// This runs ALONGSIDE aiOtlpSpanProcessor on the same Genkit-owned tracer
// provider: the AI leg forwards only genkit:* spans (remapped into PostHog's
// LLM-observability gen_ai.*/ai.* namespace) to the AI endpoint, while this leg
// forwards ALL spans verbatim to the distributed endpoint. The two endpoints
// stitch on shared trace/parent ids, so a span can legitimately appear in both
// the LLM view (as $ai_generation) and the end-to-end trace view.
//
// The OTLP/JSON span shape and the per-span POST are SHARED with the AI leg via
// otlpWire.ts — only the endpoint path differs. Unlike the AI leg there is no
// remap/namespace requirement: the distributed endpoint keeps arbitrary spans,
// so we forward each span's name, ids, timing, kind and scalar attributes as-is.
//
// Best-effort, never throws (CLAUDE.md Rule 10): a dropped span is always better
// than a thrown error in a hot path. No-ops entirely without POSTHOG_API_KEY.
// Per-span export (SimpleSpanProcessor-style) for the same reason as the AI leg —
// CF instances pause between invocations, so a batch timer would strand spans.

import {
  type Attribute,
  type OtlpSpan,
  type ReadableSpanLike,
  type SpanProcessorLike,
  SPAN_KIND_INTERNAL,
  boolAttr,
  hrTimeToNanos,
  intAttr,
  parentSpanId,
  postOtlpSpan,
  strAttr,
} from './otlpWire.js';

// Distributed-tracing ingestion endpoint — the only thing that differs from the
// AI leg (`/i/v0/ai/otel`).
const DISTRIBUTED_OTLP_PATH = '/i/v1/traces';

// Encode a span attribute value as OTLP/JSON. Only scalar types map cleanly;
// objects/arrays/null/undefined are dropped (the distributed view wants
// structural metadata, not serialised blobs — and a JSON.stringify of arbitrary
// genkit:input/output would re-ship the same bulky payloads the AI leg already
// caps). int64s ride as strings to dodge JS number precision loss.
function encodeAttr(key: string, value: unknown): Attribute | null {
  if (typeof value === 'string') return strAttr(key, value);
  if (typeof value === 'boolean') return boolAttr(key, value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? intAttr(key, value) : strAttr(key, String(value));
  }
  return null;
}

/**
 * Map a finished span to an OTLP span verbatim (no namespace remap). Forwards the
 * span's live name (which setActiveSpanName may have set to a human-readable
 * descriptor — that IS the value for the end-to-end trace view), ids, timing,
 * kind and its scalar attributes. Never returns null — the distributed endpoint
 * keeps every span.
 */
export function toDistributedOtlpSpan(span: ReadableSpanLike): OtlpSpan {
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
    kind: typeof span.kind === 'number' ? span.kind : SPAN_KIND_INTERNAL,
    startTimeUnixNano: hrTimeToNanos(span.startTime),
    endTimeUnixNano: hrTimeToNanos(span.endTime),
    attributes,
  };
  const parent = parentSpanId(span);
  if (parent) out.parentSpanId = parent; // omitted on root (no empty string)
  return out;
}

// ── Export pipeline ────────────────────────────────────────────────────────────

// Per-span export (SimpleSpanProcessor-style), mirroring the AI leg: each ended
// span POSTs immediately; the in-flight promise is tracked so
// flushServerObservability() can drain it before the function returns. PostHog
// stitches the tree by trace/parent id across the separate POSTs.
const inFlight = new Set<Promise<void>>();

function track(p: Promise<void>): void {
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
}

/** Await any in-flight distributed-trace span exports. Called from flushServerObservability(). */
export async function flushDistributedOtlp(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

/**
 * The span processor added to the Genkit-owned global provider (via
 * attachDistributedSpanProcessor), ALONGSIDE the AI processor. `onEnd` ships
 * EVERY finished span to the distributed endpoint; the other hooks are no-ops /
 * drains. Never throws.
 */
export const distributedSpanProcessor: SpanProcessorLike = {
  onStart(): void {
    // no-op — we only act on finished spans.
  },
  onEnd(span: ReadableSpanLike): void {
    try {
      if (!process.env['POSTHOG_API_KEY']) return;
      track(postOtlpSpan(toDistributedOtlpSpan(span), DISTRIBUTED_OTLP_PATH));
    } catch {
      // Best-effort; a map/export failure must never propagate.
    }
  },
  async forceFlush(): Promise<void> {
    await flushDistributedOtlp();
  },
  async shutdown(): Promise<void> {
    await flushDistributedOtlp();
  },
};
