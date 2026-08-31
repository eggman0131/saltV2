import { describe, it, expect } from 'vitest';
import { SpanKind } from '@opentelemetry/api';
import { WebTracerProvider, type ReadableSpan } from '@opentelemetry/sdk-trace-web';
import { toBrowserOtlpSpan } from '../src/browserTracerImpl.js';
import { toDistributedOtlpSpan } from '../src/server/distributedSpanProcessor.js';
import { toWireSpanKind, type ReadableSpanLike } from '../src/shared/otlpWire.js';

// ---------------------------------------------------------------------------
// Span kind on the OTLP wire (issue #1011).
//
// `@opentelemetry/api`'s SpanKind is 0-based (INTERNAL = 0); the OTLP protobuf's
// Span.SpanKind is 1-based (0 is reserved for UNSPECIFIED). Both distributed legs
// used to forward the API value RAW, so every span shipped one kind too low. These
// tests pin the explicit mapping and — the point of putting it in src/shared/ —
// that the browser leg and the server leg cannot drift apart on it.
//
// The expected values below are the OTLP protobuf's own numbers, written as
// literals on purpose: deriving them from the module under test would assert only
// that it agrees with itself.
// ---------------------------------------------------------------------------

const cases = [
  { name: 'API INTERNAL', apiKind: SpanKind.INTERNAL, wire: 1 },
  { name: 'API SERVER', apiKind: SpanKind.SERVER, wire: 2 },
  { name: 'API CLIENT', apiKind: SpanKind.CLIENT, wire: 3 },
  { name: 'API PRODUCER', apiKind: SpanKind.PRODUCER, wire: 4 },
  { name: 'API CONSUMER', apiKind: SpanKind.CONSUMER, wire: 5 },
  // No kind and an unrecognised kind both fall back to wire INTERNAL rather than
  // throwing or emitting UNSPECIFIED — best-effort, never throws (Rule 10).
  { name: 'no kind at all', apiKind: undefined, wire: 1 },
  { name: 'an out-of-range kind (99)', apiKind: 99, wire: 1 },
] as const;

// A finished span carrying nothing but the kind under test. Structurally valid for
// both legs, so one object can be pushed through both and compared.
function spanWithKind(kind: number | undefined): ReadableSpanLike {
  return {
    name: 'canon.matchOrCreateCanon: garlic',
    attributes: {},
    startTime: [1_700_000_000, 0],
    endTime: [1_700_000_001, 500_000_000],
    // Spread rather than assign: `exactOptionalPropertyTypes` is on, so the
    // "no kind at all" case must OMIT the key, which is also how a span with no
    // kind actually reaches a processor.
    ...(kind === undefined ? {} : { kind }),
    spanContext: () => ({ traceId: 'trace-1', spanId: 'span-1' }),
  };
}

describe('toWireSpanKind', () => {
  it.each(cases)('maps $name → OTLP wire kind $wire', ({ apiKind, wire }) => {
    expect(toWireSpanKind(apiKind)).toBe(wire);
  });

  it('never emits SPAN_KIND_UNSPECIFIED (0) for any input', () => {
    const emitted = cases.map((c) => toWireSpanKind(c.apiKind));
    expect(emitted).not.toContain(0);
  });

  it('is mapping the 0-based API enum this repo actually depends on', () => {
    // If a future @opentelemetry/api renumbered its enum, the switch would still be
    // right (it cases on the members) but the wire values above would move — this
    // is the assertion that says so out loud instead of silently drifting.
    expect([
      SpanKind.INTERNAL,
      SpanKind.SERVER,
      SpanKind.CLIENT,
      SpanKind.PRODUCER,
      SpanKind.CONSUMER,
    ]).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('cross-leg parity: browser and server emit the same wire kind', () => {
  it.each(cases)('$name → $wire on BOTH legs', ({ apiKind, wire }) => {
    const span = spanWithKind(apiKind);
    const server = toDistributedOtlpSpan(span);
    const browser = toBrowserOtlpSpan(span as unknown as ReadableSpan);
    expect(server.kind).toBe(wire);
    expect(browser.kind).toBe(wire);
    expect(browser.kind).toBe(server.kind);
  });
});

describe('a live SDK span', () => {
  // Not a fixture: proves the value the legs read off a real span IS the 0-based
  // API enum, which is the whole reason a mapping is needed.
  const tracer = new WebTracerProvider().getTracer('span-kind-wire-test');

  it('carries the API kind, which the browser leg converts on the way out', () => {
    const span = tracer.startSpan('POST /i/v1/traces', { kind: SpanKind.CLIENT });
    span.end();
    const readable = span as unknown as ReadableSpan;
    expect(readable.kind).toBe(2); // API CLIENT, straight off a live span
    expect(toBrowserOtlpSpan(readable).kind).toBe(3); // OTLP SPAN_KIND_CLIENT
  });

  it('started with no kind defaults to API INTERNAL and ships as wire INTERNAL', () => {
    const span = tracer.startSpan('user.action');
    span.end();
    const readable = span as unknown as ReadableSpan;
    expect(readable.kind).toBe(0); // the SDK's own default, not `undefined`
    expect(toBrowserOtlpSpan(readable).kind).toBe(1);
  });
});
