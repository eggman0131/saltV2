import { describe, it, expect } from 'vitest';
import { toBrowserOtlpSpan } from '../src/browserTracerImpl.js';
import { toDistributedOtlpSpan } from '../src/server/distributedSpanProcessor.js';
import type { ReadableSpanLike } from '../src/shared/otlpWire.js';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-web';

// ---------------------------------------------------------------------------
// Cross-leg OTLP wire parity (issue #1007 Phase 1; house style:
// matchLogParity.test.ts / reportabilityParity.test.ts).
//
// The browser distributed leg (toBrowserOtlpSpan) and the server distributed
// leg (toDistributedOtlpSpan) must produce the IDENTICAL OtlpSpan for the same
// finished span — that is the anti-drift premise of src/shared/otlpWire.ts. The
// fixtures carry ONLY plain scalar attributes (no genkit:* keys), so the server
// leg's genkit strip + preview policy stays out of the comparison and both legs
// take the shared mechanism path. If this test fails, the two legs' wire
// schemas have drifted — a real defect, not a fixture problem.
// ---------------------------------------------------------------------------

/** One shared fake span both mappers accept (ReadableSpan is structural here). */
function sharedSpan(overrides: Partial<ReadableSpanLike> = {}): ReadableSpanLike {
  return {
    name: 'Import recipe from example.com',
    attributes: {
      'import.outcome': 'ok', // string
      count: 3, // integer → intValue string
      ratio: 0.5, // float → stringValue
      flag: true, // boolean
      nan: NaN, // dropped by both
      obj: { nested: 1 }, // dropped by both
      arr: [1, 2], // dropped by both
      missing: null, // dropped by both
    },
    startTime: [1_700_000_000, 250_000_000],
    endTime: [1_700_000_001, 500_000_000],
    kind: 1,
    spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
    ...overrides,
  };
}

/** The browser mapper's ReadableSpan parameter, satisfied structurally. */
function asBrowserSpan(span: ReadableSpanLike): ReadableSpan {
  return span as unknown as ReadableSpan;
}

describe('OTLP wire parity — browser vs server distributed leg', () => {
  it('produces an identical OtlpSpan for a plain scalar root span', () => {
    const span = sharedSpan();
    expect(toBrowserOtlpSpan(asBrowserSpan(span))).toEqual(toDistributedOtlpSpan(span));
  });

  it('produces an identical OtlpSpan for a child span (parentSpanId forwarded)', () => {
    const span = sharedSpan({ parentSpanId: 'c'.repeat(16) });
    expect(toBrowserOtlpSpan(asBrowserSpan(span))).toEqual(toDistributedOtlpSpan(span));
  });

  // Known pre-existing cross-leg drift — see #1011. Un-fail when #1011 settles the wire semantics.
  it.fails('produces an identical OtlpSpan when kind is absent (both default INTERNAL)', () => {
    const span = sharedSpan({ kind: undefined });
    const browser = toBrowserOtlpSpan(asBrowserSpan(span));
    expect(browser.kind).toBe(1);
    expect(browser).toEqual(toDistributedOtlpSpan(span));
  });
});
