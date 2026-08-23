import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The pictogram upload wrapper (issue #892). What is worth pinning here is the
// wire shape — the four families and the optional contentType, since a wrong
// discriminator would write a photograph to the wrong Storage prefix — and the
// error-category mapping the reporting policy depends on (§7.6).

const callableMock = vi.fn();
const httpsCallable = vi.fn(() => callableMock);

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable,
}));

const { callSetIconUpload } = await import('../src/iconUploadCallables.js');

function codeError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  callableMock.mockReset();
  callableMock.mockResolvedValue({ data: { ok: true } });
  httpsCallable.mockClear();
  // Node >= 21 exposes navigator globally with onLine = false, and since #916 the
  // offline check runs FIRST in classifyCallableError — so every code-based case
  // has to say it is online, exactly as firestoreErrors.test.ts does.
  vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callSetIconUpload', () => {
  it('names the callable and sends family, id and bytes', async () => {
    const result = await callSetIconUpload('canon', 'milk', 'AAAA');
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'setIconUpload');
    expect(callableMock).toHaveBeenCalledWith({ family: 'canon', id: 'milk', imageBase64: 'AAAA' });
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('omits contentType entirely when none is given, rather than sending undefined', async () => {
    await callSetIconUpload('kitchenTool', 'whisk', 'AAAA');
    expect(callableMock.mock.calls[0]![0]).not.toHaveProperty('contentType');
  });

  it('forwards contentType when given', async () => {
    await callSetIconUpload('equipment', 'kenwood', 'AAAA', 'image/webp');
    expect(callableMock).toHaveBeenCalledWith({
      family: 'equipment',
      id: 'kenwood',
      imageBase64: 'AAAA',
      contentType: 'image/webp',
    });
  });

  it('maps not-found to NotFound on the family that asked', async () => {
    callableMock.mockRejectedValueOnce(codeError('functions/not-found'));
    expect(await callSetIconUpload('productForm', 'lime-juice', 'AAAA')).toEqual({
      kind: 'err',
      error: { kind: 'NotFound', resource: 'productForm', id: 'lime-juice' },
    });
  });

  it('maps a rejected payload to a suppressed ValidationError, not a network blip', async () => {
    callableMock.mockRejectedValueOnce(codeError('functions/invalid-argument'));
    const result = await callSetIconUpload('canon', 'milk', 'AAAA');
    expect(result.kind).toBe('err');
    if (result.kind !== 'err') return;
    expect(result.error.kind).toBe('ValidationError');
  });

  it('maps unauthenticated to AuthError, and a server 500 to a REPORTED StorageError', async () => {
    callableMock.mockRejectedValueOnce(codeError('functions/unauthenticated'));
    expect(await callSetIconUpload('canon', 'milk', 'AAAA')).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'unauthenticated' },
    });

    // Issue #916: `functions/internal` is a Cloud Function 500. Calling it a
    // NetworkError told the user to check their connection AND suppressed the
    // report, because NetworkError is a suppressed category under §7.6.
    callableMock.mockRejectedValueOnce(codeError('functions/internal'));
    expect(await callSetIconUpload('canon', 'milk', 'AAAA')).toEqual({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'unavailable' },
    });
  });

  it('still calls a genuine offline failure a suppressed NetworkError', async () => {
    // The callable SDK surfaces a failed fetch as `functions/internal` too, which
    // is why the offline check has to come first.
    vi.stubGlobal('navigator', { onLine: false });
    callableMock.mockRejectedValueOnce(codeError('functions/internal'));
    expect(await callSetIconUpload('canon', 'milk', 'AAAA')).toEqual({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'offline' },
    });
  });
});
