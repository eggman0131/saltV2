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
    // Spread rather than assign: `exactOptionalPropertyTypes` is on, so an
    // optional property may be absent or hold a value but never an explicit
    // `undefined` — and an absent key is what a real root span looks like.
    ...(opts.parentSpanId === undefined ? {} : { parentSpanId: opts.parentSpanId }),
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

// ---------------------------------------------------------------------------
// gen_ai.flow — which flow spent the call (#817).
//
// The `genkit:path` strings below are VERBATIM output from @genkit-ai/core
// 1.40.1's own runInNewSpan, captured by driving it with an in-memory OTel
// processor over the two real shapes seen in production. Do not "tidy" them —
// they are the contract this parser is written against.
// ---------------------------------------------------------------------------
const CHEF_CHAT_PATH =
  '/{chefChat,t:flow}/{generate,t:helper}/{googleai/gemini-pro-latest,t:action}';
const PRODUCT_FORM_PATH =
  '/{authorRecipe,t:flow}/{canonicaliseRecipeIngredients,t:flow}/{arbitrateProductForm,t:flow}' +
  '/{generate,t:helper}/{googleai/gemini-flash-lite-latest,t:action}';

function modelSpanWithPath(path?: string): ReadableSpanLike {
  return fakeSpan({
    attributes: {
      'genkit:type': 'action',
      'genkit:metadata:subtype': 'model',
      'genkit:name': 'googleai/gemini-pro-latest',
      ...(path === undefined ? {} : { 'genkit:path': path }),
    },
  });
}

describe('remapGenkitSpan — gen_ai.flow', () => {
  it('reads the enclosing flow from genkit:path on a model span', () => {
    expect(attr(remapGenkitSpan(modelSpanWithPath(CHEF_CHAT_PATH))!, 'gen_ai.flow')).toBe(
      'chefChat',
    );
  });

  it('takes the INNERMOST flow, not the trace root, when flows nest', () => {
    // The whole point of the fix: one recipe import nests several
    // arbitrateProductForm generations under an authorRecipe root, and
    // attributing them to the root would be a confidently wrong answer.
    expect(attr(remapGenkitSpan(modelSpanWithPath(PRODUCT_FORM_PATH))!, 'gen_ai.flow')).toBe(
      'arbitrateProductForm',
    );
  });

  it('attributes an embedder span too (embeddings are the highest-volume call)', () => {
    const out = remapGenkitSpan(
      fakeSpan({
        attributes: {
          'genkit:type': 'action',
          'genkit:metadata:subtype': 'embedder',
          'genkit:name': 'googleai/gemini-embedding-001',
          'genkit:path':
            '/{embedText,t:flow}/{embed,t:helper}/{googleai/gemini-embedding-001,t:action}',
        },
      }),
    )!;
    expect(attr(out, 'gen_ai.operation.name')).toBe('embeddings');
    expect(attr(out, 'gen_ai.flow')).toBe('embedText');
  });

  it('keeps a model id containing a slash out of the flow name', () => {
    // Names may contain `/` and `:` (model ids do); only `,` and `}` delimit.
    expect(attr(remapGenkitSpan(modelSpanWithPath(CHEF_CHAT_PATH))!, 'gen_ai.flow')).not.toContain(
      '/',
    );
  });

  it('omits the attribute rather than guessing when there is no flow to name', () => {
    // Additive and best-effort (Rule 10): a missing, malformed or flow-less path
    // must leave the event unattributed, never throw and never invent a value.
    for (const path of [undefined, '', 'not-a-path', '/{generate,t:helper}']) {
      expect(attr(remapGenkitSpan(modelSpanWithPath(path))!, 'gen_ai.flow')).toBeUndefined();
    }
    expect(attr(remapGenkitSpan(modelSpanWithPath(42 as unknown as string))!, 'gen_ai.flow')).toBe(
      undefined,
    );
  });

  it('is stateless across calls (the /g literal must not carry lastIndex)', () => {
    // A shared /g regex is a classic lastIndex trap; matchAll clones it, and this
    // asserts that stays true — the second call must not come back undefined.
    for (let i = 0; i < 3; i += 1) {
      expect(attr(remapGenkitSpan(modelSpanWithPath(PRODUCT_FORM_PATH))!, 'gen_ai.flow')).toBe(
        'arbitrateProductForm',
      );
    }
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
