// ── Shared OTLP/JSON wire layer for the PostHog span exporters ─────────────────
// The AI leg (aiOtlpSpanProcessor.ts → /i/v0/ai/otel) and the distributed leg
// (distributedSpanProcessor.ts → /i/v1/traces) emit the EXACT SAME OTLP/JSON
// span shape — only the endpoint path differs. This module is the single source
// of that shape: the structural OTel types we read, the attribute encoders, the
// HrTime→nanos conversion, the resourceSpans body builder, and the per-span POST
// helper (path is the only parameter). Both legs reuse it so the wire schema
// cannot drift between them.
//
// Best-effort, never throws (CLAUDE.md Rule 10): every export here either is a
// pure helper or swallows its own errors (postOtlpSpan). No new dependency — the
// OTel types are declared STRUCTURALLY, matching the rest of this package.

// EU region baked in as the default; host overridable via env only (never to
// silently leave the EU data region). Mirrors init.ts / the browser adapter.
export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';
export const SERVICE_NAME = 'salt-cloud-functions';

// ── Structural OTel types (no `@opentelemetry/sdk-trace-*` dependency) ─────────

/** OTel HrTime: [epoch seconds, nanos-within-second]. */
export type HrTime = readonly [number, number];

/** The subset of OTel `ReadableSpan` we read. */
export interface ReadableSpanLike {
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly startTime: HrTime;
  readonly endTime: HrTime;
  // OTel 1.x exposes `parentSpanId`; 2.x exposes `parentSpanContext`. Read both.
  readonly parentSpanId?: string;
  readonly parentSpanContext?: { readonly spanId?: string };
  readonly kind?: number;
  spanContext(): { readonly traceId: string; readonly spanId: string };
}

/** The `SpanProcessor` shape `BasicTracerProvider.addSpanProcessor` accepts. */
export interface SpanProcessorLike {
  onStart(): void;
  onEnd(span: ReadableSpanLike): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

// ── OTLP/JSON wire helpers (mirror the PoC's proven shape) ─────────────────────

export type AttrValue = { stringValue: string } | { intValue: string } | { boolValue: boolean };
export interface Attribute {
  key: string;
  value: AttrValue;
}
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Attribute[];
}

export const strAttr = (key: string, v: string): Attribute => ({
  key,
  value: { stringValue: v },
});
// int64 must be a string in OTLP/JSON to avoid JS number precision loss.
export const intAttr = (key: string, v: number): Attribute => ({
  key,
  value: { intValue: String(v) },
});
export const boolAttr = (key: string, v: boolean): Attribute => ({
  key,
  value: { boolValue: v },
});

export const SPAN_KIND_INTERNAL = 1;

/** HrTime → OTLP nanosecond string (BigInt: epoch-ns exceeds Number precision). */
export function hrTimeToNanos(t: HrTime): string {
  if (!Array.isArray(t) || t.length < 2) return '0';
  const seconds = Number(t[0]) || 0;
  const nanos = Number(t[1]) || 0;
  return (BigInt(Math.trunc(seconds)) * 1_000_000_000n + BigInt(Math.trunc(nanos))).toString();
}

/** `span.parentSpanId` (OTel 1.x) or `span.parentSpanContext.spanId` (2.x). */
export function parentSpanId(span: ReadableSpanLike): string | undefined {
  return span.parentSpanId ?? span.parentSpanContext?.spanId ?? undefined;
}

// Wrap a single OTLP span in the resourceSpans → scopeSpans → spans envelope
// PostHog's OTLP ingestion expects. Identical for both endpoints — only the path
// the body is POSTed to differs.
export function buildOtlpBody(otlpSpan: OtlpSpan): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: [strAttr('service.name', SERVICE_NAME)] },
        scopeSpans: [{ scope: { name: SERVICE_NAME }, spans: [otlpSpan] }],
      },
    ],
  };
}

// POST one OTLP span to PostHog at the given path. Both legs call this with their
// own endpoint (`/i/v0/ai/otel` for AI, `/i/v1/traces` for distributed). Same
// Bearer-token auth (POSTHOG_API_KEY) and host resolution (POSTHOG_HOST, EU
// default). No-ops without a key. Never throws (Rule 10) — a telemetry export
// failure must never surface to the caller's hot path.
export async function postOtlpSpan(otlpSpan: OtlpSpan, path: string): Promise<void> {
  const key = process.env['POSTHOG_API_KEY'];
  if (!key) return;
  const host = process.env['POSTHOG_HOST'] || DEFAULT_POSTHOG_HOST;
  try {
    await fetch(`${host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(buildOtlpBody(otlpSpan)),
    });
  } catch {
    // Never surface a telemetry export failure to the caller (Rule 10).
  }
}
