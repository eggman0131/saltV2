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
  subscribeMealPlanConfig,
  subscribeMealPlanTemplate,
  subscribeMealPlanWeek,
  loadMealPlanWeek,
  saveMealPlanConfig,
  saveMealPlanTemplate,
  saveMealPlanWeek,
} from '../src/mealPlanSync.js';
import type { MealPlanConfig, MealPlanTemplate, MealPlanWeek } from '@salt/domain';
import { emptyDay, emptyTemplate, emptyWeek } from '@salt/domain';

type SnapCallback = (snap: { exists: () => boolean; data: () => unknown }) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

const CONFIG: MealPlanConfig = { firstDayOfWeek: 'mon', schemaVersion: 1 };
const TEMPLATE: MealPlanTemplate = emptyTemplate();
const WEEK: MealPlanWeek = { ...emptyWeek('2026-06-08'), updatedAt: '2026-06-08T00:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  mockSetDoc.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { onLine: true });
});

describe('subscribeMealPlanConfig', () => {
  it('targets mealPlanConfig/singleton and returns the unsubscribe', () => {
    const unsub = subscribeMealPlanConfig(
      () => {},
      () => {},
    );
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'mealPlanConfig', 'singleton');
    expect(unsub).toBe(mockUnsubscribe);
  });

  it('calls onConfig(null) when the doc does not exist', () => {
    const onConfig = vi.fn();
    subscribeMealPlanConfig(onConfig, () => {});
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({
      exists: () => false,
      data: () => undefined,
    });
    expect(onConfig).toHaveBeenCalledWith(null);
  });

  it('maps a valid config doc', () => {
    const onConfig = vi.fn();
    subscribeMealPlanConfig(onConfig, () => {});
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({
      exists: () => true,
      data: () => ({ firstDayOfWeek: 'mon', schemaVersion: 1 }),
    });
    expect(onConfig).toHaveBeenCalledWith(CONFIG);
  });

  it('surfaces corruption on an invalid config doc (single-doc read)', () => {
    const onError = vi.fn();
    subscribeMealPlanConfig(() => {}, onError);
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({
      exists: () => true,
      data: () => ({ firstDayOfWeek: 'notaday', schemaVersion: 1 }),
    });
    expect(onError).toHaveBeenCalledWith({ kind: 'StorageError', reason: 'corruption' });
  });

  // The RAW error rides alongside the classified one. These three reads took a
  // single-argument `onError` until #928 Phase 1 deleted `forwardsRawError`, and
  // the second argument carries the stack a reporting call site sends — note the
  // contrast with the corruption rows above, which pass ONE argument because the
  // parse path has no Firestore error behind it.
  it('classifies stream-level errors', () => {
    const onError = vi.fn();
    subscribeMealPlanConfig(() => {}, onError);
    const raw = Object.assign(new Error('e'), { code: 'permission-denied' });
    (mockOnSnapshot.mock.calls[0]![2] as ErrorCallback)(raw);
    expect(onError).toHaveBeenCalledWith({ kind: 'AuthError', reason: 'forbidden' }, raw);
  });
});

describe('subscribeMealPlanTemplate', () => {
  it('targets mealPlanTemplate/singleton', () => {
    subscribeMealPlanTemplate(
      () => {},
      () => {},
    );
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'mealPlanTemplate', 'singleton');
  });

  it('maps a valid template doc', () => {
    const onTemplate = vi.fn();
    subscribeMealPlanTemplate(onTemplate, () => {});
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({
      exists: () => true,
      data: () => ({ schemaVersion: 1, days: TEMPLATE.days }),
    });
    expect(onTemplate).toHaveBeenCalledWith(TEMPLATE);
  });

  it('surfaces corruption on an invalid template doc', () => {
    const onError = vi.fn();
    subscribeMealPlanTemplate(() => {}, onError);
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({
      exists: () => true,
      data: () => ({ schemaVersion: 2, days: {} }),
    });
    expect(onError).toHaveBeenCalledWith({ kind: 'StorageError', reason: 'corruption' });
  });
});

describe('subscribeMealPlanWeek', () => {
  it('targets mealPlans/{startDate}', () => {
    subscribeMealPlanWeek(
      '2026-06-08',
      () => {},
      () => {},
    );
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'mealPlans', '2026-06-08');
  });

  it('calls onWeek(null) when the week does not exist yet', () => {
    const onWeek = vi.fn();
    subscribeMealPlanWeek('2026-06-08', onWeek, () => {});
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({
      exists: () => false,
      data: () => undefined,
    });
    expect(onWeek).toHaveBeenCalledWith(null);
  });

  it('maps a valid week doc (round-trips a null home-time attendee)', () => {
    const onWeek = vi.fn();
    const week: MealPlanWeek = {
      ...WEEK,
      days: {
        ...WEEK.days,
        '2026-06-08': {
          ...emptyDay(),
          attendees: [{ memberId: 'a@x.org', homeTime: null, note: '' }],
        },
      },
    };
    subscribeMealPlanWeek('2026-06-08', onWeek, () => {});
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({
      exists: () => true,
      data: () => week,
    });
    const [received] = onWeek.mock.calls[0] as [MealPlanWeek];
    expect(received.days['2026-06-08']!.attendees[0]!.homeTime).toBeNull();
  });

  it('surfaces corruption on an invalid week doc', () => {
    const onError = vi.fn();
    subscribeMealPlanWeek('2026-06-08', () => {}, onError);
    (mockOnSnapshot.mock.calls[0]![1] as SnapCallback)({
      exists: () => true,
      data: () => ({ id: '2026-06-08', schemaVersion: 1 }),
    });
    expect(onError).toHaveBeenCalledWith({ kind: 'StorageError', reason: 'corruption' });
  });
});

// One-shot read (issue #639): the load-template picker asks whether a week it is
// not subscribed to already holds edits.
describe('loadMealPlanWeek', () => {
  it('targets mealPlans/{startDate} and maps a valid doc', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => WEEK });
    const result = await loadMealPlanWeek('2026-06-08');
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'mealPlans', '2026-06-08');
    expect(result).toEqual({ kind: 'ok', value: WEEK });
  });

  it('returns null when the week has never been written', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    expect(await loadMealPlanWeek('2026-06-08')).toEqual({ kind: 'ok', value: null });
  });

  it('returns corruption on an invalid doc (single-doc read contract)', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ id: '2026-06-08', schemaVersion: 1 }),
    });
    expect(await loadMealPlanWeek('2026-06-08')).toEqual({
      kind: 'err',
      error: { kind: 'StorageError', reason: 'corruption' },
    });
  });

  it('returns failure (never throws) on a Firestore error', async () => {
    mockGetDoc.mockRejectedValue(Object.assign(new Error('e'), { code: 'permission-denied' }));
    expect(await loadMealPlanWeek('2026-06-08')).toEqual({
      kind: 'err',
      error: { kind: 'AuthError', reason: 'forbidden' },
    });
  });
});

describe('save*', () => {
  it('saveMealPlanConfig writes to the singleton', async () => {
    const result = await saveMealPlanConfig(CONFIG);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'mealPlanConfig', 'singleton');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...CONFIG });
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('saveMealPlanTemplate writes to the singleton', async () => {
    const result = await saveMealPlanTemplate(TEMPLATE);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'mealPlanTemplate', 'singleton');
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('saveMealPlanWeek is keyed by week.id', async () => {
    const result = await saveMealPlanWeek(WEEK);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'mealPlans', '2026-06-08');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...WEEK });
    expect(result).toEqual({ kind: 'ok', value: undefined });
  });

  it('returns failure (never throws) on a Firestore error', async () => {
    mockSetDoc.mockRejectedValue(Object.assign(new Error('e'), { code: 'permission-denied' }));
    const result = await saveMealPlanWeek(WEEK);
    expect(result).toEqual({ kind: 'err', error: { kind: 'AuthError', reason: 'forbidden' } });
  });
});
