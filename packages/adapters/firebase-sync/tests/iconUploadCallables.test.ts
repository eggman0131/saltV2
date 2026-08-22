import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  it('maps unauthenticated to AuthError and anything else to a transient NetworkError', async () => {
    callableMock.mockRejectedValueOnce(codeError('functions/unauthenticated'));
    expect(await callSetIconUpload('canon', 'milk', 'AAAA')).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'unauthenticated' },
    });

    callableMock.mockRejectedValueOnce(codeError('functions/internal'));
    expect(await callSetIconUpload('canon', 'milk', 'AAAA')).toEqual({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    });
  });
});
