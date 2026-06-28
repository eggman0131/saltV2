import { describe, it, expect } from 'vitest';
import {
  remapGenkitSpan,
  type ReadableSpanLike,
  type OtlpSpan,
} from '../src/server/aiOtlpSpanProcessor.js';

// ---------------------------------------------------------------------------
// Content-forwarding policy (#356, maintainer decision): generations forward the
// full prompt + completion; embeddings forward only a short input preview; media
// (base64 data URIs) is never forwarded. Model ids are normalised to PostHog's
// priced catalog so AI cost rolls up.
// ---------------------------------------------------------------------------

function fakeSpan(attributes: Record<string, unknown>, name = 'live-span-name'): ReadableSpanLike {
  return {
    name,
    attributes,
    startTime: [1_700_000_000, 0],
    endTime: [1_700_000_001, 0],
    spanContext: () => ({ traceId: 't', spanId: 's' }),
  };
}

function attr(span: OtlpSpan, key: string): string | undefined {
  const a = span.attributes.find((x) => x.key === key);
  if (!a) return undefined;
  const v = a.value as Record<string, unknown>;
  return (v['stringValue'] ?? v['intValue']) as string | undefined;
}

const SYSTEM = 'You are a shopping-list parser.';
const USER_TEXT = 'two pounds of organic heirloom tomatoes, finely diced';
const ASSISTANT_TEXT = '{"name":"tomatoes","amount":900}';

describe('generation content forwarding', () => {
  const span = fakeSpan(
    {
      'genkit:type': 'action',
      'genkit:metadata:subtype': 'model',
      'genkit:name': 'googleai/gemini-2.5-flash',
      'genkit:input': JSON.stringify({
        messages: [
          { role: 'system', content: [{ text: SYSTEM }] },
          { role: 'user', content: [{ text: USER_TEXT }] },
        ],
      }),
      'genkit:output': JSON.stringify({
        message: { role: 'model', content: [{ text: ASSISTANT_TEXT }] },
        usage: { inputTokens: 12, outputTokens: 5 },
      }),
    },
    `parseEntry: ${USER_TEXT}`,
  );

  it('forwards the full prompt as gen_ai.input.messages with normalised roles', () => {
    const input = attr(remapGenkitSpan(span)!, 'gen_ai.input.messages')!;
    const parsed = JSON.parse(input) as Array<{ role: string; content: string }>;
    expect(parsed).toEqual([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: USER_TEXT },
    ]);
  });

  it('forwards the completion as gen_ai.output.messages (model → assistant)', () => {
    const output = attr(remapGenkitSpan(span)!, 'gen_ai.output.messages')!;
    const parsed = JSON.parse(output) as Array<{ role: string; content: string }>;
    expect(parsed).toEqual([{ role: 'assistant', content: ASSISTANT_TEXT }]);
  });

  it('keeps the OTLP span name as the canonical genkit:name, not the user-renamed live name', () => {
    const out = remapGenkitSpan(span)!;
    expect(out.name).toBe('googleai/gemini-2.5-flash');
    expect(out.name).not.toContain(USER_TEXT);
  });

  it('replaces media (base64 data URIs) with a placeholder — never forwards the bytes', () => {
    const dataUri = 'data:image/png;base64,AAAABBBBCCCCDDDDEEEEFFFF';
    const out = remapGenkitSpan(
      fakeSpan({
        'genkit:type': 'action',
        'genkit:metadata:subtype': 'model',
        'genkit:name': 'googleai/gemini-2.5-flash-image',
        'genkit:input': JSON.stringify({
          messages: [
            { role: 'user', content: [{ media: { url: dataUri } }, { text: 'draw a leek' }] },
          ],
        }),
        'genkit:output': JSON.stringify({
          message: { role: 'model', content: [{ media: { url: dataUri } }] },
        }),
      }),
    )!;
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('AAAABBBB');
    expect(serialised).toContain('[media]');
    expect(serialised).toContain('draw a leek');
  });
});

describe('embedding content forwarding', () => {
  it('forwards only a short preview of the embedded input', () => {
    const long = 'a'.repeat(500);
    const out = remapGenkitSpan(
      fakeSpan({
        'genkit:type': 'action',
        'genkit:metadata:subtype': 'embedder',
        'genkit:name': 'googleai/gemini-embedding-001',
        'genkit:input': JSON.stringify({ input: [{ content: [{ text: long }] }] }),
      }),
    )!;
    const input = attr(out, 'gen_ai.input.messages')!;
    const parsed = JSON.parse(input) as Array<{ role: string; content: string }>;
    expect(parsed[0]!.content.length).toBeLessThanOrEqual(80);
    // The full 500-char payload is NOT shipped.
    expect(input).not.toContain(long);
  });
});

describe('model id for cost (real served model from the API response)', () => {
  it('emits the concrete served model (custom.modelVersion) as response.model, alias as request.model', () => {
    const out = remapGenkitSpan(
      fakeSpan({
        'genkit:type': 'action',
        'genkit:metadata:subtype': 'model',
        'genkit:name': 'googleai/gemini-flash-lite-latest',
        // The Gemini API reports the concrete model it actually served.
        'genkit:output': JSON.stringify({
          message: { role: 'model', content: [{ text: 'ok' }] },
          custom: { modelVersion: 'gemini-flash-lite-9000' },
        }),
      }),
    )!;
    expect(attr(out, 'gen_ai.request.model')).toBe('gemini-flash-lite-latest');
    expect(attr(out, 'gen_ai.response.model')).toBe('gemini-flash-lite-9000');
  });

  it('falls back to the requested id when no served modelVersion is present', () => {
    const out = remapGenkitSpan(
      fakeSpan({
        'genkit:type': 'action',
        'genkit:metadata:subtype': 'model',
        'genkit:name': 'googleai/gemini-flash-lite-latest',
      }),
    )!;
    expect(attr(out, 'gen_ai.response.model')).toBe('gemini-flash-lite-latest');
  });
});
