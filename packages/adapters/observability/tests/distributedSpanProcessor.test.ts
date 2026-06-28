import { describe, it, expect, afterEach } from 'vitest';
import {
  toDistributedOtlpSpan,
  distributedSpanProcessor,
  flushDistributedOtlp,
} from '../src/server/distributedSpanProcessor.js';
import type { ReadableSpanLike, OtlpSpan } from '../src/server/otlpWire.js';

// ---------------------------------------------------------------------------
// toDistributedOtlpSpan: any finished span → OTLP span verbatim (no remap, no
// drop). Unlike the AI leg it forwards EVERY span, keeps the live span.name
// (which setActiveSpanName may have set), and encodes scalar attributes as-is.
// ---------------------------------------------------------------------------

function fakeSpan(opts: {
  attributes?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  parentSpanContext?: { spanId?: string };
  name?: string;
  kind?: number;
  startTime?: readonly [number, number];
  endTime?: readonly [number, number];
}): ReadableSpanLike {
  return {
    name: opts.name ?? 'canon.matchOrCreateCanon: garlic',
    attributes: opts.attributes ?? {},
    startTime: opts.startTime ?? [1_700_000_000, 0],
    endTime: opts.endTime ?? [1_700_000_001, 500_000_000],
    parentSpanId: opts.parentSpanId,
    parentSpanContext: opts.parentSpanContext,
    kind: opts.kind,
    spanContext: () => ({ traceId: opts.traceId ?? 'trace-1', spanId: opts.spanId ?? 'span-1' }),
  };
}

function attr(span: OtlpSpan, key: string): string | undefined {
  const a = span.attributes.find((x) => x.key === key);
  if (!a) return undefined;
  const v = a.value as Record<string, unknown>;
  if ('stringValue' in v) return v['stringValue'] as string;
  if ('intValue' in v) return v['intValue'] as string;
  if ('boolValue' in v) return String(v['boolValue']);
  return undefined;
}

describe('toDistributedOtlpSpan', () => {
  it('forwards a non-genkit (canon structural) span verbatim — never dropped', () => {
    const out = toDistributedOtlpSpan(
      fakeSpan({
        name: 'canon.matchOrCreateCanon: garlic',
        parentSpanId: 'parent-1',
        attributes: { 'canon.outcome': 'matched', 'canon.path': 'cf' },
      }),
    );
    expect(out.name).toBe('canon.matchOrCreateCanon: garlic');
    expect(out.traceId).toBe('trace-1');
    expect(out.spanId).toBe('span-1');
    expect(out.parentSpanId).toBe('parent-1');
    expect(attr(out, 'canon.outcome')).toBe('matched');
    expect(attr(out, 'canon.path')).toBe('cf');
  });

  it('keeps the LIVE span name (setActiveSpanName may have rewritten it)', () => {
    const out = toDistributedOtlpSpan(fakeSpan({ name: 'Import recipe from bbcgoodfood.com' }));
    expect(out.name).toBe('Import recipe from bbcgoodfood.com');
  });

  it('encodes scalar attribute types and drops non-scalars', () => {
    const out = toDistributedOtlpSpan(
      fakeSpan({
        attributes: {
          'canon.batchSize': 7, // integer → intValue string
          ratio: 0.5, // float → stringValue
          done: true, // boolean → boolValue
          obj: { nested: 1 }, // dropped
          arr: [1, 2], // dropped
          missing: null, // dropped
        },
      }),
    );
    expect(attr(out, 'canon.batchSize')).toBe('7');
    expect(attr(out, 'ratio')).toBe('0.5');
    expect(attr(out, 'done')).toBe('true');
    expect(out.attributes.find((a) => a.key === 'obj')).toBeUndefined();
    expect(out.attributes.find((a) => a.key === 'arr')).toBeUndefined();
    expect(out.attributes.find((a) => a.key === 'missing')).toBeUndefined();
  });

  it('reads the OTel 2.x parentSpanContext.spanId when parentSpanId is absent', () => {
    const out = toDistributedOtlpSpan(fakeSpan({ parentSpanContext: { spanId: 'ctx-parent' } }));
    expect(out.parentSpanId).toBe('ctx-parent');
  });

  it('omits parentSpanId on a root span (no empty string)', () => {
    const out = toDistributedOtlpSpan(fakeSpan({}));
    expect(out.parentSpanId).toBeUndefined();
  });

  it('defaults kind to INTERNAL when the span omits it', () => {
    expect(toDistributedOtlpSpan(fakeSpan({})).kind).toBe(1);
    expect(toDistributedOtlpSpan(fakeSpan({ kind: 2 })).kind).toBe(2);
  });

  it('encodes start/end as OTLP nanosecond strings without precision loss', () => {
    const out = toDistributedOtlpSpan(
      fakeSpan({ startTime: [1_700_000_000, 250_000_000], endTime: [1_700_000_002, 0] }),
    );
    expect(out.startTimeUnixNano).toBe('1700000000250000000');
    expect(out.endTimeUnixNano).toBe('1700000002000000000');
  });
});

describe('distributedSpanProcessor', () => {
  const prevKey = process.env['POSTHOG_API_KEY'];
  afterEach(() => {
    if (prevKey === undefined) delete process.env['POSTHOG_API_KEY'];
    else process.env['POSTHOG_API_KEY'] = prevKey;
  });

  it('onEnd no-ops without POSTHOG_API_KEY and never throws; flush resolves', async () => {
    delete process.env['POSTHOG_API_KEY'];
    expect(() =>
      distributedSpanProcessor.onEnd(fakeSpan({ attributes: { 'canon.outcome': 'matched' } })),
    ).not.toThrow();
    await expect(flushDistributedOtlp()).resolves.toBeUndefined();
  });
});
