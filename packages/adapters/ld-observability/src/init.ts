import { createClient, type LDClient, type LDContext } from '@launchdarkly/js-client-sdk';
import Observability, { LDObserve } from '@launchdarkly/observability';
import SessionReplay from '@launchdarkly/session-replay';
import { trace, context as otelContext } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';

let client: LDClient | null = null;

const ANON_CONTEXT: LDContext = { kind: 'user', key: 'anonymous', anonymous: true };

export interface LDObservabilityOptions {
  manualStart?: boolean;
}

export function initLDObservability(clientSideId: string, opts?: LDObservabilityOptions): void {
  if (client) return;
  // Observe and Record from highlight.run satisfy the plugin interface at runtime
  // but don't align with LDPluginBase's generic shape — cast required.
  const replayOpts = {
    privacySetting: 'none' as const,
    ...(opts?.manualStart ? { manualStart: true } : {}),
  };
  client = createClient(clientSideId, ANON_CONTEXT, {
    plugins: [new Observability() as never, new SessionReplay(replayOpts) as never],
  });
  void client.start();
}

// True once initLDObservability has created the LD client and registered the
// Observe/Record plugins. The adapter entrypoints that reach LDObserve/LDRecord
// directly gate on this so they stay inert — rather than throwing — when LD is
// uninitialised (e.g. gated off in the e2e build via an empty
// VITE_LD_CLIENT_SIDE_ID). Adapters never throw for operational reasons.
export function isObservabilityReady(): boolean {
  return client !== null;
}

// `name` sets the human-readable label LaunchDarkly's Contexts and session-replay
// UI show in place of the opaque `key`. The key stays the stable uid so MAU dedup
// is unaffected; `name` is display-only.
export function identifyObservabilityUser(uid: string, email?: string, name?: string): void {
  void client?.identify({ kind: 'user', key: uid, name, email, anonymous: false });
}

export function identifyObservabilityAnonymous(): void {
  void client?.identify(ANON_CONTEXT);
}

export function trackObservabilityEvent(key: string, data?: unknown): void {
  client?.track(key, data);
}

export interface ObservabilitySpan {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

// Inert span returned when observability is uninitialised (see startSpan). Its
// methods no-op and it exposes no spanContext, so extractTraceHeaders() yields
// {} and callers parent nothing — exactly the "tracing disabled" path.
const NOOP_SPAN: ObservabilitySpan = {
  setAttribute() {},
  end() {},
};

export function startSpan(name: string, opts?: { parent?: ObservabilitySpan }): ObservabilitySpan {
  // Stay inert until initLDObservability has wired the LDObserve singleton — e.g.
  // when LD is gated off in the e2e build. LDObserve.startManualSpan() throws
  // before init, and callers open their span outside their own try/catch (e.g.
  // canonService.addCanonItem), so the throw would abort the whole operation.
  if (!isObservabilityReady()) return NOOP_SPAN;
  if (opts?.parent) {
    // ObservabilitySpan is our abstraction over the underlying OTel Span; the
    // LDObserve API requires the concrete type — runtime identity is preserved.
    const ctx = trace.setSpan(otelContext.active(), opts.parent as unknown as Span);
    return LDObserve.startManualSpan(name, {}, ctx, (s) => s);
  }
  return LDObserve.startManualSpan(name, (s) => s);
}

// W3C trace context extraction. Reads the OTel span context off the underlying
// span and formats a traceparent string so the CF can parent its server-side
// span to this client span. Empty record when the span has no valid context
// (e.g. tracing disabled).
export function extractTraceHeaders(span: ObservabilitySpan): Record<string, string> {
  const otelSpan = span as unknown as Span; // see cast rationale above
  const ctx = otelSpan.spanContext?.();
  if (!ctx || !ctx.traceId || !ctx.spanId) return {};
  const flags = (ctx.traceFlags ?? 0).toString(16).padStart(2, '0');
  const headers: Record<string, string> = {
    traceparent: `00-${ctx.traceId}-${ctx.spanId}-${flags}`,
  };
  if (ctx.traceState) {
    const state = ctx.traceState.serialize();
    if (state) headers['tracestate'] = state;
  }
  return headers;
}
