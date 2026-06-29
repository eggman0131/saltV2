// ── Server OTLP/JSON wire layer for the PostHog span exporters ─────────────────
// The runtime-neutral OTLP shape (structural OTel types, attr encoders,
// HrTime→nanos, parentSpanId, span kinds, buildOtlpBody, DEFAULT_POSTHOG_HOST)
// now lives in ../shared/otlpWire.ts so the browser exporter (Phase 4, issue
// #362) and these server legs share ONE shape and the wire schema cannot drift.
// This module keeps ONLY the server-specific pieces — the per-span POST helper
// (Node `fetch` + `process.env.POSTHOG_API_KEY`) and the server SERVICE_NAME —
// and RE-EXPORTS the shared helpers so existing server imports
// (distributedSpanProcessor.ts, aiOtlpSpanProcessor.ts) keep working unchanged.
//
// Best-effort, never throws (CLAUDE.md Rule 10): postOtlpSpan swallows its own
// errors. No new dependency — the OTel types are declared STRUCTURALLY.

import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';

import { buildOtlpBody, DEFAULT_POSTHOG_HOST, type OtlpSpan } from '../shared/otlpWire.js';
// Read-only: the `environment` recorded at init, stamped onto every exported span
// resource. Lives in a leaf module so this does NOT cycle back through init.ts.
import { getServerEnvironment } from './serverEnvironment.js';

// Re-export the runtime-neutral wire layer so every existing
// `from './otlpWire.js'` import (types, encoders, builders, host) keeps resolving.
export {
  DEFAULT_POSTHOG_HOST,
  SPAN_KIND_INTERNAL,
  strAttr,
  intAttr,
  boolAttr,
  hrTimeToNanos,
  parentSpanId,
  buildOtlpBody,
} from '../shared/otlpWire.js';
export type {
  HrTime,
  ReadableSpanLike,
  SpanProcessorLike,
  Attribute,
  AttrValue,
  OtlpSpan,
} from '../shared/otlpWire.js';

// Server emitter identity — distinct from the browser's `salt-web-pwa`. Stays
// here (not in shared/) because it is the server leg's value.
export const SERVICE_NAME = 'salt-cloud-functions';

// POST one OTLP span to PostHog at the given path. Both server legs call this with
// their own endpoint (`/i/v0/ai/otel` for AI, `/i/v1/traces` for distributed).
// Bearer-token auth (POSTHOG_API_KEY) and host resolution (POSTHOG_HOST, EU
// default). No-ops without a key. Never throws (Rule 10) — a telemetry export
// failure must never surface to the caller's hot path. Node-only (process.env +
// global fetch); this is why it stays out of the runtime-neutral shared module.
export async function postOtlpSpan(otlpSpan: OtlpSpan, path: string): Promise<void> {
  const key = process.env['POSTHOG_API_KEY'];
  if (!key) return;
  const host = process.env['POSTHOG_HOST'] || DEFAULT_POSTHOG_HOST;
  try {
    // Suppress tracing for our own export call: enableFirebaseTelemetry() turns on
    // HTTP auto-instrumentation, which would otherwise mint a CLIENT span for this
    // very POST — that span would then be exported, minting another, a feedback
    // loop. suppressTracing makes the instrumentation skip span creation here.
    await context.with(suppressTracing(context.active()), () =>
      fetch(`${host}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        // Stamp the deployment environment onto the span resource — the same
        // dimension server events/logs carry — so both legs' spans surface it.
        body: JSON.stringify(buildOtlpBody(otlpSpan, SERVICE_NAME, getServerEnvironment())),
      }),
    );
  } catch {
    // Never surface a telemetry export failure to the caller (Rule 10).
  }
}
