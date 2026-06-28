import { describe, it, expect, afterEach } from 'vitest';
import {
  remapGenkitSpan,
  aiOtlpSpanProcessor,
  flushAiOtlp,
  type ReadableSpanLike,
  type OtlpSpan,
} from '../src/server/aiOtlpSpanProcessor.js';

// ---------------------------------------------------------------------------
// remapGenkitSpan: genkit:* span → PostHog-recognised OTLP span (or dropped).
// Attribute names mirror Genkit's real encoding (verified against
// @genkit-ai/core instrumentation + @genkit-ai/google-cloud generate telemetry):
//   genkit:type, genkit:metadata:subtype, genkit:name (provider/model),
//   genkit:isRoot, genkit:state, genkit:output (JSON; usage.{input,output}Tokens).
// ---------------------------------------------------------------------------

function fakeSpan(opts: {
  attributes: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTime?: readonly [number, number];
  endTime?: readonly [number, number];
}): ReadableSpanLike {
  return {
    name: opts.name ?? 'live-span-name',
    attributes: opts.attributes,
    startTime: opts.startTime ?? [1_700_000_000, 0],
    endTime: opts.endTime ?? [1_700_000_001, 500_000_000],
    parentSpanId: opts.parentSpanId,
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

describe('remapGenkitSpan', () => {
  it('maps a model action → $ai_generation (gen_ai.* chat + tokens)', () => {
    const span = fakeSpan({
      parentSpanId: 'parent-1',
      attributes: {
        'genkit:type': 'action',
        'genkit:metadata:subtype': 'model',
        'genkit:name': 'googleai/gemini-2.5-flash',
        'genkit:state': 'success',
        'genkit:output': JSON.stringify({ usage: { inputTokens: 9, outputTokens: 1 } }),
      },
    });

    const out = remapGenkitSpan(span);
    expect(out).not.toBeNull();
    const o = out!;
    expect(attr(o, 'gen_ai.operation.name')).toBe('chat');
    expect(attr(o, 'gen_ai.system')).toBe('gemini');
    expect(attr(o, 'gen_ai.response.model')).toBe('gemini-2.5-flash');
    expect(attr(o, 'gen_ai.usage.input_tokens')).toBe('9');
    expect(attr(o, 'gen_ai.usage.output_tokens')).toBe('1');
    expect(attr(o, 'gen_ai.state')).toBe('success');
    // Canonical genkit:name is the span name (never the live span.name).
    expect(o.name).toBe('googleai/gemini-2.5-flash');
    expect(o.parentSpanId).toBe('parent-1');
    expect(o.traceId).toBe('trace-1');
    expect(o.spanId).toBe('span-1');
  });

  it('omits token attrs when usage is absent (fake/offline model run)', () => {
    const out = remapGenkitSpan(
      fakeSpan({
        attributes: {
          'genkit:type': 'action',
          'genkit:metadata:subtype': 'model',
          'genkit:name': 'fake-model',
        },
      }),
    )!;
    expect(attr(out, 'gen_ai.response.model')).toBe('fake-model');
    expect(attr(out, 'gen_ai.usage.input_tokens')).toBeUndefined();
    expect(attr(out, 'gen_ai.usage.output_tokens')).toBeUndefined();
  });

  it('maps an embedder action → $ai_embedding (gen_ai.* embeddings)', () => {
    const out = remapGenkitSpan(
      fakeSpan({
        attributes: {
          'genkit:type': 'action',
          'genkit:metadata:subtype': 'embedder',
          'genkit:name': 'googleai/text-embedding-004',
          'genkit:state': 'success',
        },
      }),
    )!;
    expect(attr(out, 'gen_ai.operation.name')).toBe('embeddings');
    expect(attr(out, 'gen_ai.system')).toBe('gemini');
    expect(attr(out, 'gen_ai.request.model')).toBe('text-embedding-004');
    expect(attr(out, 'gen_ai.response.model')).toBe('text-embedding-004');
  });

  it('maps a root flow → $ai_trace (ai.operation.name=workflow), no parent', () => {
    const out = remapGenkitSpan(
      fakeSpan({
        attributes: {
          'genkit:type': 'flow',
          'genkit:name': 'matchOrCreateCanon',
          'genkit:isRoot': true,
          'genkit:state': 'success',
        },
      }),
    )!;
    expect(attr(out, 'ai.operation.name')).toBe('workflow');
    expect(attr(out, 'ai.span.name')).toBe('matchOrCreateCanon');
    expect(attr(out, 'ai.state')).toBe('success');
    expect(out.parentSpanId).toBeUndefined();
  });

  it('maps a non-root flow/step → $ai_span (ai.operation.name=chain)', () => {
    const out = remapGenkitSpan(
      fakeSpan({
        parentSpanId: 'root-1',
        attributes: { 'genkit:type': 'flowStep', 'genkit:name': 'generate' },
      }),
    )!;
    expect(attr(out, 'ai.operation.name')).toBe('chain');
    expect(out.parentSpanId).toBe('root-1');
  });

  it('drops a span with no genkit:* attributes (canon structural / infra span)', () => {
    expect(
      remapGenkitSpan(fakeSpan({ attributes: { 'canon.outcome': 'matched', 'canon.path': 'cf' } })),
    ).toBeNull();
    expect(remapGenkitSpan(fakeSpan({ attributes: {} }))).toBeNull();
  });

  it('encodes start/end as OTLP nanosecond strings without precision loss', () => {
    const out = remapGenkitSpan(
      fakeSpan({
        attributes: { 'genkit:type': 'flow', 'genkit:name': 'f', 'genkit:isRoot': true },
        startTime: [1_700_000_000, 250_000_000],
        endTime: [1_700_000_002, 0],
      }),
    )!;
    expect(out.startTimeUnixNano).toBe('1700000000250000000');
    expect(out.endTimeUnixNano).toBe('1700000002000000000');
  });
});

describe('aiOtlpSpanProcessor', () => {
  const prevKey = process.env['POSTHOG_API_KEY'];
  afterEach(() => {
    if (prevKey === undefined) delete process.env['POSTHOG_API_KEY'];
    else process.env['POSTHOG_API_KEY'] = prevKey;
  });

  it('onEnd no-ops without POSTHOG_API_KEY and never throws; flush resolves', async () => {
    delete process.env['POSTHOG_API_KEY'];
    expect(() =>
      aiOtlpSpanProcessor.onEnd(
        fakeSpan({
          attributes: {
            'genkit:type': 'action',
            'genkit:metadata:subtype': 'model',
            'genkit:name': 'googleai/gemini-2.5-flash',
          },
        }),
      ),
    ).not.toThrow();
    await expect(flushAiOtlp()).resolves.toBeUndefined();
  });
});
