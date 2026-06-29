import { describe, it, expect } from 'vitest';
import {
  genkitPromptPreview,
  genkitCompletionPreview,
  PREVIEW_MAX_CHARS,
} from '../src/server/genkitContent.js';

// ---------------------------------------------------------------------------
// Short prompt/response previews for the distributed (end-to-end) trace view.
// The maintainer wants ~200 chars of each prompt + response for context, EXCEPT
// embedding and image responses (no readable text → meaningless in the trace).
// Media (base64 data URIs) is redacted to `[media]`, never forwarded as bytes.
// ---------------------------------------------------------------------------

const modelInput = (messages: unknown) => ({ 'genkit:input': JSON.stringify({ messages }) });
const modelOutput = (output: unknown) => ({ 'genkit:output': JSON.stringify(output) });

describe('genkitPromptPreview', () => {
  it('previews a model prompt (GenerateRequest.messages), joining message text', () => {
    const attrs = modelInput([
      { role: 'system', content: [{ text: 'You are a parser.' }] },
      { role: 'user', content: [{ text: 'two pounds of tomatoes' }] },
    ]);
    expect(genkitPromptPreview(attrs)).toBe('You are a parser.\ntwo pounds of tomatoes');
  });

  it('previews an embedder prompt (input documents)', () => {
    const attrs = {
      'genkit:input': JSON.stringify({ input: [{ content: [{ text: 'garlic' }] }] }),
    };
    expect(genkitPromptPreview(attrs)).toBe('garlic');
  });

  it('previews an embedder prompt given as a raw string input', () => {
    const attrs = { 'genkit:input': JSON.stringify({ input: 'tinned tomatoes' }) };
    expect(genkitPromptPreview(attrs)).toBe('tinned tomatoes');
  });

  it('caps the prompt at PREVIEW_MAX_CHARS with an ellipsis', () => {
    const long = 'a'.repeat(500);
    const attrs = modelInput([{ role: 'user', content: [{ text: long }] }]);
    const preview = genkitPromptPreview(attrs);
    expect(preview).toBe(`${'a'.repeat(PREVIEW_MAX_CHARS)}…`);
    expect(preview).not.toContain(long);
  });

  it('redacts media in the prompt — never forwards base64 bytes', () => {
    const attrs = modelInput([
      {
        role: 'user',
        content: [
          { media: { url: 'data:image/png;base64,AAAABBBBCCCC' } },
          { text: 'draw a leek' },
        ],
      },
    ]);
    const preview = genkitPromptPreview(attrs);
    expect(preview).toContain('[media]');
    expect(preview).toContain('draw a leek');
    expect(preview).not.toContain('AAAABBBB');
  });

  it('is empty when there is no input', () => {
    expect(genkitPromptPreview({})).toBe('');
  });
});

describe('genkitCompletionPreview', () => {
  it('previews a model completion (single message)', () => {
    const attrs = modelOutput({
      message: { role: 'model', content: [{ text: '{"name":"tomato"}' }] },
    });
    expect(genkitCompletionPreview(attrs)).toBe('{"name":"tomato"}');
  });

  it('previews a model completion from candidates[]', () => {
    const attrs = modelOutput({
      candidates: [{ message: { role: 'model', content: [{ text: 'hi there' }] } }],
    });
    expect(genkitCompletionPreview(attrs)).toBe('hi there');
  });

  it('caps the completion at PREVIEW_MAX_CHARS with an ellipsis', () => {
    const long = 'b'.repeat(500);
    const attrs = modelOutput({ message: { role: 'model', content: [{ text: long }] } });
    expect(genkitCompletionPreview(attrs)).toBe(`${'b'.repeat(PREVIEW_MAX_CHARS)}…`);
  });

  it('OMITS an image response (media only — no readable text)', () => {
    const attrs = modelOutput({
      message: { role: 'model', content: [{ media: { url: 'data:image/png;base64,ZZZZ' } }] },
    });
    expect(genkitCompletionPreview(attrs)).toBe('');
  });

  it('OMITS an embedding response (no message/candidates in output)', () => {
    const attrs = modelOutput({
      embeddings: [{ embedding: [0.1, 0.2] }],
      usage: { inputTokens: 3 },
    });
    expect(genkitCompletionPreview(attrs)).toBe('');
  });

  it('is empty when there is no output', () => {
    expect(genkitCompletionPreview({})).toBe('');
  });
});
