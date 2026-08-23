import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The image-prompt wrapper (issue #892) is a READ across a trust boundary, so
// unlike the fire-and-forget callables beside it there are two things worth
// pinning: that a malformed response is caught rather than handed to the UI as a
// prompt, and that the three error codes land on the categories the reporting
// policy expects (§7.6) — a deleted item must be NotFound (suppressed), a broken
// payload must be StorageError (reported).

const callableMock = vi.fn();
const httpsCallable = vi.fn(() => callableMock);

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable,
}));

const { callGetImagePrompt } = await import('../src/imagePromptCallables.js');

const GOOD = {
  prompt: 'Generate a cute cartoon icon of milk. …',
  model: 'gemini-x',
  seedFile: 'canon-icon-seed.webp',
};

function codeError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  callableMock.mockReset();
  httpsCallable.mockClear();
  // Node >= 21 exposes navigator globally with onLine = false, and since #916 the
  // offline check runs FIRST in classifyCallableError — so every code-based case
  // has to say it is online, exactly as firestoreErrors.test.ts does.
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callGetImagePrompt', () => {
  it('sends the family and id, and returns the parsed result', async () => {
    callableMock.mockResolvedValueOnce({ data: GOOD });
    const result = await callGetImagePrompt('canon', 'milk');
    expect(callableMock).toHaveBeenCalledWith({ family: 'canon', id: 'milk' });
    expect(result).toEqual({ kind: 'ok', value: GOOD });
  });

  it('accepts a null seedFile — a recipe hero is prompt-only, not seeded', async () => {
    callableMock.mockResolvedValueOnce({ data: { ...GOOD, seedFile: null } });
    const result = await callGetImagePrompt('recipe', 'r1');
    expect(result.kind).toBe('ok');
  });

  it('maps a malformed response to StorageError rather than passing it through', async () => {
    callableMock.mockResolvedValueOnce({ data: { prompt: 42 } });
    const result = await callGetImagePrompt('canon', 'milk');
    expect(result).toEqual({ kind: 'err', error: { kind: 'StorageError', reason: 'corruption' } });
  });

  it('maps not-found to NotFound on the family that asked, carrying the id', async () => {
    callableMock.mockRejectedValueOnce(codeError('functions/not-found'));
    const result = await callGetImagePrompt('productForm', 'lime-juice');
    expect(result).toEqual({
      kind: 'err',
      error: { kind: 'NotFound', resource: 'productForm', id: 'lime-juice' },
    });
  });

  it('maps unauthenticated to AuthError, and a server 500 to a REPORTED StorageError', async () => {
    callableMock.mockRejectedValueOnce(codeError('functions/unauthenticated'));
    expect(await callGetImagePrompt('kitchenTool', 'whisk')).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'unauthenticated' },
    });

    // Issue #916: `functions/internal` is a Cloud Function 500 — a broken server,
    // not a broken connection, and the same reportable category a broken payload
    // already gets.
    callableMock.mockRejectedValueOnce(codeError('functions/internal'));
    expect(await callGetImagePrompt('equipment', 'kenwood')).toEqual({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'unavailable' },
    });
  });

  it('still calls a genuine offline failure a suppressed NetworkError', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    callableMock.mockRejectedValueOnce(codeError('functions/internal'));
    expect(await callGetImagePrompt('canon', 'milk')).toEqual({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });
  });
});
