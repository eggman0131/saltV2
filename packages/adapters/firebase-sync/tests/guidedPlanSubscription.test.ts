import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUnsubscribe, mockOnSnapshot, mockSetDoc, mockGetDoc, mockDoc, mockGetFirestore } =
  vi.hoisted(() => ({
    mockUnsubscribe: vi.fn(),
    mockOnSnapshot: vi.fn(),
    mockSetDoc: vi.fn(),
    mockGetDoc: vi.fn(),
    mockDoc: vi.fn(() => 'mock-doc-ref'),
    mockGetFirestore: vi.fn(() => 'mock-db'),
  }));

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  doc: mockDoc,
  onSnapshot: mockOnSnapshot,
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
}));

import {
  subscribeGuidedPlan,
  loadGuidedPlan,
  saveGuidedPlan,
} from '../src/guidedPlanSubscription.js';
import type { GuidedPlanDoc } from '@salt/domain/schemas';

type Snap = { id: string; exists: () => boolean; data: () => unknown };
type DocCallback = (snap: Snap) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

const PLAN: GuidedPlanDoc = {
  id: 'recipe-1',
  schemaVersion: 1,
  recipeId: 'recipe-1',
  recipeUpdatedAtAtSave: '2026-08-01T09:00:00.000Z',
  needs_approval: true,
  prep: [
    {
      id: 'prep-1',
      text: 'Dice the onion',
      container: 'small bowl',
      ingredientIds: ['ing-1'],
    },
  ],
  stepNotes: [
    {
      stepId: 'step-1',
      container: 'small bowl',
      setup: 'small hob burner, medium-low',
      cue: 'a very gentle sizzle',
      checkIns: [],
      lookahead: 'the onions soften',
      getAhead: null,
    },
  ],
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

function snap(data: unknown, exists = true): Snap {
  return { id: 'recipe-1', exists: () => exists, data: () => data };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  mockSetDoc.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { onLine: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('subscribeGuidedPlan', () => {
  it('targets guidedPlans/{recipeId} and returns the unsubscribe', () => {
    const unsub = subscribeGuidedPlan(
      'recipe-1',
      () => {},
      () => {},
    );
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'guidedPlans', 'recipe-1');
    expect(unsub).toBe(mockUnsubscribe);
  });

  it('emits the parsed plan', () => {
    const onPlan = vi.fn();
    subscribeGuidedPlan('recipe-1', onPlan, () => {});
    (mockOnSnapshot.mock.calls[0][1] as DocCallback)(snap(PLAN));
    expect(onPlan).toHaveBeenCalledWith(PLAN);
  });

  it('emits null when no plan has been written yet', () => {
    const onPlan = vi.fn();
    subscribeGuidedPlan('recipe-1', onPlan, () => {});
    (mockOnSnapshot.mock.calls[0][1] as DocCallback)(snap(undefined, false));
    expect(onPlan).toHaveBeenCalledWith(null);
  });

  it('reports a corrupt plan as an error, NOT as "no plan yet"', () => {
    // The deliberate divergence from cookSessionSubscription, which turns an
    // invalid doc into null because a cook session is disposable. A plan is not:
    // a human wrote it. Emitting null would show the editor's "Write the plan"
    // button over a document that is still there, and the first thing the user
    // does is overwrite it.
    const onPlan = vi.fn();
    const onError = vi.fn();
    subscribeGuidedPlan('recipe-1', onPlan, onError);
    (mockOnSnapshot.mock.calls[0][1] as DocCallback)(snap({ id: 'recipe-1', schemaVersion: 2 }));
    expect(onPlan).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({ kind: 'StorageError', reason: 'corruption' });
    expect(console.error).toHaveBeenCalled();
  });

  it('classifies stream-level errors and forwards the raw error', () => {
    const onError = vi.fn();
    subscribeGuidedPlan('recipe-1', () => {}, onError);
    const raw = Object.assign(new Error('e'), { code: 'permission-denied' });
    (mockOnSnapshot.mock.calls[0][2] as ErrorCallback)(raw);
    expect(onError).toHaveBeenCalledWith({ kind: 'AuthError', reason: 'forbidden' }, raw);
  });
});

describe('loadGuidedPlan', () => {
  it('returns the plan', async () => {
    mockGetDoc.mockResolvedValue(snap(PLAN));
    expect(await loadGuidedPlan('recipe-1')).toEqual({ kind: 'ok', value: PLAN });
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'guidedPlans', 'recipe-1');
  });

  it('returns null when there is no plan', async () => {
    mockGetDoc.mockResolvedValue(snap(undefined, false));
    expect(await loadGuidedPlan('recipe-1')).toEqual({ kind: 'ok', value: null });
  });

  it('returns a corruption Failure on an invalid doc (single-doc-read contract)', async () => {
    mockGetDoc.mockResolvedValue(snap({ id: 'recipe-1', schemaVersion: 2 }));
    expect(await loadGuidedPlan('recipe-1')).toEqual({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'corruption' },
    });
  });

  it('returns failure (never throws) on a Firestore error', async () => {
    mockGetDoc.mockRejectedValue(Object.assign(new Error('e'), { code: 'unavailable' }));
    expect((await loadGuidedPlan('recipe-1')).kind).toBe('err');
  });
});

describe('saveGuidedPlan', () => {
  it('writes the WHOLE document to guidedPlans/{recipeId} — a re-run replaces, never merges', async () => {
    const result = await saveGuidedPlan(PLAN);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'guidedPlans', 'recipe-1');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...PLAN });
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure (never throws) on a Firestore error', async () => {
    mockSetDoc.mockRejectedValue(Object.assign(new Error('e'), { code: 'permission-denied' }));
    expect(await saveGuidedPlan(PLAN)).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'forbidden' },
    });
  });
});
