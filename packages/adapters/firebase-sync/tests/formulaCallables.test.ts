import { describe, it, expect, vi, beforeEach } from 'vitest';

// callExtractProcessStages (issue #806, phase 2 of epic #778). The whole surface is
// one call and a failure map, and the failure map is the part worth pinning: this
// adapter must NEVER throw (Rule 10), because the formula screen's answer to "the
// call failed" is to leave the stages the user already has exactly where they are
// and say so — which it cannot do if the promise rejects.

const callableMock = vi.fn(async () => ({ data: { stages: [] } }));
const httpsCallable = vi.fn(() => callableMock);
const getFunctions = vi.fn(() => ({}));

vi.mock('firebase/functions', () => ({ getFunctions, httpsCallable }));

const { callExtractProcessStages } = await import('../src/formulaCallables.js');

const STAGE = {
  label: 'Bulk ferment',
  kind: 'wait' as const,
  environment: { celsius: 20 },
  duration: { kind: 'fixed' as const, minutes: 240 },
  until: null,
  stepId: 'step-2',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('callExtractProcessStages', () => {
  it('sends only the recipe id, to the europe-west2 callable', async () => {
    callableMock.mockResolvedValueOnce({ data: { stages: [STAGE] } });

    const result = await callExtractProcessStages({ recipeId: 'recipe-1' });

    expect(getFunctions).toHaveBeenCalledWith(undefined, 'europe-west2');
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'extractProcessStages');
    expect(callableMock).toHaveBeenCalledWith({ recipeId: 'recipe-1' });
    expect(result).toEqual({ kind: 'ok', value: { stages: [STAGE] } });
  });

  it('returns the empty list through unchanged', async () => {
    // A recipe with nothing to wait for is a SUCCESS carrying no stages, not a
    // failure. The adapter must not mistake one for the other.
    callableMock.mockResolvedValueOnce({ data: { stages: [] } });
    const result = await callExtractProcessStages({ recipeId: 'recipe-1' });
    expect(result).toEqual({ kind: 'ok', value: { stages: [] } });
  });

  it.each([
    ['functions/unauthenticated', { kind: 'AuthError', reason: 'unauthenticated' }],
    ['functions/permission-denied', { kind: 'AuthError', reason: 'forbidden' }],
    ['functions/internal', { kind: 'NetworkError', reason: 'transient' }],
    ['', { kind: 'NetworkError', reason: 'transient' }],
  ])('maps %s to a Failure rather than throwing', async (code, error) => {
    callableMock.mockRejectedValueOnce(Object.assign(new Error('nope'), code ? { code } : {}));

    const result = await callExtractProcessStages({ recipeId: 'recipe-1' });

    expect(result).toEqual({ kind: 'err', error });
  });

  it('does not throw even when the SDK rejects with something that is not an Error', async () => {
    callableMock.mockRejectedValueOnce('a string');
    await expect(callExtractProcessStages({ recipeId: 'recipe-1' })).resolves.toEqual({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    });
  });
});
