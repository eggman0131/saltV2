import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  toDistributedOtlpSpan,
  shouldShipDistributed,
  distributedSpanProcessor,
  flushDistributedOtlp,
} from '../src/server/distributedSpanProcessor.js';
import { setServerEnvironment } from '../src/server/serverEnvironment.js';
import type { ReadableSpanLike, OtlpSpan } from '../src/server/otlpWire.js';

// ---------------------------------------------------------------------------
// toDistributedOtlpSpan: maps a span (whatever shouldShipDistributed kept) to an
// OTLP span with no namespace remap — keeps the live span.name (which
// setActiveSpanName may have set) and encodes scalar attributes as-is, but strips
// Genkit's bulky genkit:* content attributes (those ride the AI leg).
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
  scope?: string;
  legacyScope?: string;
}): ReadableSpanLike {
  return {
    name: opts.name ?? 'canon.matchOrCreateCanon: garlic',
    attributes: opts.attributes ?? {},
    startTime: opts.startTime ?? [1_700_000_000, 0],
    endTime: opts.endTime ?? [1_700_000_001, 500_000_000],
    parentSpanId: opts.parentSpanId,
    parentSpanContext: opts.parentSpanContext,
    kind: opts.kind,
    instrumentationScope: opts.scope === undefined ? undefined : { name: opts.scope },
    instrumentationLibrary: opts.legacyScope === undefined ? undefined : { name: opts.legacyScope },
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

  it('strips genkit:* content attributes (they ride the AI leg) but keeps our own', () => {
    const out = toDistributedOtlpSpan(
      fakeSpan({
        attributes: {
          'genkit:input': '{"a big prompt blob":"..."}',
          'genkit:output': '{"a big completion blob":"..."}',
          'genkit:type': 'flow',
          'canon.candidateCount': 12,
        },
      }),
    );
    expect(out.attributes.find((a) => a.key.startsWith('genkit:'))).toBeUndefined();
    expect(attr(out, 'canon.candidateCount')).toBe('12');
  });

  it('attaches short prompt + completion previews on a model span', () => {
    const out = toDistributedOtlpSpan(
      fakeSpan({
        attributes: {
          'genkit:type': 'action',
          'genkit:metadata:subtype': 'model',
          'genkit:input': JSON.stringify({
            messages: [{ role: 'user', content: [{ text: 'two pounds of tomatoes' }] }],
          }),
          'genkit:output': JSON.stringify({
            message: { role: 'model', content: [{ text: '{"name":"tomatoes"}' }] },
          }),
        },
      }),
    );
    // The bulky genkit:* blobs are still stripped...
    expect(out.attributes.find((a) => a.key.startsWith('genkit:'))).toBeUndefined();
    // ...but a readable preview rides as a scalar attribute.
    expect(attr(out, 'ai.prompt.preview')).toBe('two pounds of tomatoes');
    expect(attr(out, 'ai.completion.preview')).toBe('{"name":"tomatoes"}');
  });

  it('previews an embedder prompt but no completion (embedding response is meaningless)', () => {
    const out = toDistributedOtlpSpan(
      fakeSpan({
        attributes: {
          'genkit:type': 'action',
          'genkit:metadata:subtype': 'embedder',
          'genkit:input': JSON.stringify({ input: [{ content: [{ text: 'garlic' }] }] }),
        },
      }),
    );
    expect(attr(out, 'ai.prompt.preview')).toBe('garlic');
    expect(attr(out, 'ai.completion.preview')).toBeUndefined();
  });

  it('previews an image prompt but drops the image (media-only) response', () => {
    const dataUri = 'data:image/png;base64,AAAABBBBCCCC';
    const out = toDistributedOtlpSpan(
      fakeSpan({
        attributes: {
          'genkit:type': 'action',
          'genkit:metadata:subtype': 'model',
          'genkit:input': JSON.stringify({
            messages: [{ role: 'user', content: [{ text: 'draw a leek' }] }],
          }),
          'genkit:output': JSON.stringify({
            message: { role: 'model', content: [{ media: { url: dataUri } }] },
          }),
        },
      }),
    );
    expect(attr(out, 'ai.prompt.preview')).toBe('draw a leek');
    expect(attr(out, 'ai.completion.preview')).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('AAAABBBB');
  });

  it('adds no previews on a non-AI structural span (no genkit subtype)', () => {
    const out = toDistributedOtlpSpan(fakeSpan({ attributes: { 'canon.outcome': 'matched' } }));
    expect(attr(out, 'ai.prompt.preview')).toBeUndefined();
    expect(attr(out, 'ai.completion.preview')).toBeUndefined();
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

// ---------------------------------------------------------------------------
// shouldShipDistributed: keep only app-level spans (our own tracer scope +
// Genkit), drop OTel auto-instrumentation noise (fs/HTTP/firestore) so the
// end-to-end view reads like the app, not SDK internals (issue #362 follow-up).
// ---------------------------------------------------------------------------
describe('shouldShipDistributed', () => {
  it('ships our own spans (salt-cloud-functions tracer scope)', () => {
    expect(
      shouldShipDistributed(
        fakeSpan({ name: 'Firestore: load canon candidates', scope: 'salt-cloud-functions' }),
      ),
    ).toBe(true);
    expect(
      shouldShipDistributed(
        fakeSpan({ name: 'shoppingList.matchItem: soreen', scope: 'salt-cloud-functions' }),
      ),
    ).toBe(true);
  });

  it('ships Genkit spans (any genkit:* attribute), incl. renamed flow roots', () => {
    expect(
      shouldShipDistributed(
        fakeSpan({
          name: 'Import recipe from bbcgoodfood.com',
          scope: 'genkit',
          attributes: { 'genkit:type': 'flow' },
        }),
      ),
    ).toBe(true);
  });

  it('also reads the legacy OTel 1.x instrumentationLibrary scope', () => {
    expect(shouldShipDistributed(fakeSpan({ legacyScope: 'salt-cloud-functions' }))).toBe(true);
  });

  it('drops auto-instrumentation noise (fs / HTTP / firestore)', () => {
    expect(
      shouldShipDistributed(
        fakeSpan({ name: 'fs realpathSync', scope: '@opentelemetry/instrumentation-fs' }),
      ),
    ).toBe(false);
    expect(
      shouldShipDistributed(
        fakeSpan({ name: 'POST', kind: 2, scope: '@opentelemetry/instrumentation-http' }),
      ),
    ).toBe(false);
    expect(
      shouldShipDistributed(fakeSpan({ name: 'Batch.Commit', scope: '@google-cloud/firestore' })),
    ).toBe(false);
  });

  it('drops a span with no recognised scope and no genkit attributes', () => {
    expect(
      shouldShipDistributed(fakeSpan({ name: 'PUT', attributes: { 'http.method': 'PUT' } })),
    ).toBe(false);
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

  it('with a key, drops auto-instrumentation noise but ships app spans', async () => {
    process.env['POSTHOG_API_KEY'] = 'phc_test';
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const prevFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      // noise → not shipped
      distributedSpanProcessor.onEnd(
        fakeSpan({ name: 'fs realpathSync', scope: '@opentelemetry/instrumentation-fs' }),
      );
      // app span → shipped
      distributedSpanProcessor.onEnd(
        fakeSpan({ name: 'shoppingList.matchItem: soreen', scope: 'salt-cloud-functions' }),
      );
      await flushDistributedOtlp();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain('/i/v1/traces');
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it('stamps the recorded server environment onto the exported span resource', async () => {
    process.env['POSTHOG_API_KEY'] = 'phc_test';
    setServerEnvironment('staging');
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const prevFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      distributedSpanProcessor.onEnd(
        fakeSpan({ name: 'shoppingList.matchItem: soreen', scope: 'salt-cloud-functions' }),
      );
      await flushDistributedOtlp();
      const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
      const body = JSON.parse(String(init?.body)) as {
        resourceSpans: Array<{
          resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
        }>;
      };
      expect(body.resourceSpans[0]!.resource.attributes).toContainEqual({
        key: 'deployment.environment',
        value: { stringValue: 'staging' },
      });
    } finally {
      globalThis.fetch = prevFetch;
      setServerEnvironment(undefined); // don't leak into sibling tests
    }
  });
});
