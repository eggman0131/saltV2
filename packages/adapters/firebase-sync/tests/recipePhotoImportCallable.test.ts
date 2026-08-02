import { describe, it, expect, vi, beforeEach } from 'vitest';

// callExtractRecipeFromPhoto (issue #649, Phase 3). The wrapper's three jobs:
//  • pass an EXPLICIT client timeout — the callable SDK defaults to 70s, which
//    would abandon a slow multi-page extraction while the server still worked;
//  • forward the optional traceparent on the payload (Rule 4: no observability
//    import here — firebase-sync only carries the string);
//  • NEVER throw (Rule 10) — every failure crosses as a Failure carrying the
//    photo-import failure code, its own closed set, not the URL one.

const callableMock = vi.fn();
const httpsCallable = vi.fn(() => callableMock);
const getFunctions = vi.fn(() => ({}));

vi.mock('firebase/functions', () => ({ getFunctions, httpsCallable }));

const { callExtractRecipeFromPhoto } = await import('../src/recipeCallables.js');
const { PHOTO_IMPORT_TIMEOUT_SECONDS } = await import('@salt/domain/schemas');

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const INPUT = { images: [{ base64: 'AAAA', contentType: 'image/webp' as const }] };
const RECIPE = { id: 'r1', title: 'Ragù' };

const rejectWith = (code: string) => {
  const err = Object.assign(new Error('nope'), { code });
  callableMock.mockRejectedValueOnce(err);
};

beforeEach(() => {
  vi.clearAllMocks();
  callableMock.mockResolvedValue({ data: RECIPE });
});

describe('callExtractRecipeFromPhoto', () => {
  it('returns the assembled draft on success', async () => {
    const result = await callExtractRecipeFromPhoto(INPUT);
    expect(result).toEqual({ kind: 'ok', value: RECIPE });
  });

  it('passes an explicit client timeout matching the server budget', async () => {
    await callExtractRecipeFromPhoto(INPUT);

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'extractRecipeFromPhoto', {
      timeout: PHOTO_IMPORT_TIMEOUT_SECONDS * 1000,
    });
    // Load-bearing: without it the SDK's 70s default truncates the call.
    expect(PHOTO_IMPORT_TIMEOUT_SECONDS * 1000).toBeGreaterThan(70_000);
  });

  it('forwards the traceparent on the payload when supplied', async () => {
    await callExtractRecipeFromPhoto(INPUT, TRACEPARENT);
    expect(callableMock).toHaveBeenCalledWith({ ...INPUT, traceparent: TRACEPARENT });
  });

  it('omits the field entirely when no traceparent is supplied', async () => {
    await callExtractRecipeFromPhoto(INPUT);
    expect(callableMock).toHaveBeenCalledWith(INPUT);
    expect(callableMock.mock.calls[0]![0]).not.toHaveProperty('traceparent');
  });

  it('never throws — a rejected payload crosses as invalid-photos', async () => {
    rejectWith('functions/invalid-argument');
    await expect(callExtractRecipeFromPhoto(INPUT)).resolves.toEqual({
      kind: 'err',
      error: 'invalid-photos',
    });
  });

  it('maps failed-precondition to unreadable-photos', async () => {
    rejectWith('functions/failed-precondition');
    await expect(callExtractRecipeFromPhoto(INPUT)).resolves.toEqual({
      kind: 'err',
      error: 'unreadable-photos',
    });
  });

  it('maps a reader failure, and any transport hiccup, to import-failed', async () => {
    for (const code of [
      'functions/internal',
      'functions/deadline-exceeded',
      'functions/unavailable',
      'functions/unauthenticated',
      '',
    ]) {
      rejectWith(code);
      // Never a claim about the user's photos when the server never got to look
      // at them.
      await expect(callExtractRecipeFromPhoto(INPUT)).resolves.toEqual({
        kind: 'err',
        error: 'import-failed',
      });
    }
  });
});
