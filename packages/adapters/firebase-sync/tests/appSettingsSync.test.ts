import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUnsubscribe, mockOnSnapshot, mockSetDoc, mockDoc, mockGetFirestore } = vi.hoisted(
  () => ({
    mockUnsubscribe: vi.fn(),
    mockOnSnapshot: vi.fn(),
    mockSetDoc: vi.fn(),
    mockDoc: vi.fn(() => 'mock-doc-ref'),
    mockGetFirestore: vi.fn(() => 'mock-db'),
  }),
);

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  doc: mockDoc,
  onSnapshot: mockOnSnapshot,
  setDoc: mockSetDoc,
}));

import { subscribeAppSettings, saveAppSettings } from '../src/appSettingsSync.js';
import { AI_MODEL_DEFAULTS, type AppSettings } from '@salt/domain/schemas';

type SnapCallback = (snap: { exists: () => boolean; data: () => unknown }) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  mockSetDoc.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { onLine: true });
});

describe('subscribeAppSettings', () => {
  it('targets appSettings/singleton and returns the unsubscribe', () => {
    const unsub = subscribeAppSettings(
      () => {},
      () => {},
    );
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'appSettings', 'singleton');
    expect(unsub).toBe(mockUnsubscribe);
  });

  it('calls onSettings(null) when the doc does not exist', () => {
    const onSettings = vi.fn();
    subscribeAppSettings(onSettings, () => {});
    (mockOnSnapshot.mock.calls[0][1] as SnapCallback)({
      exists: () => false,
      data: () => undefined,
    });
    expect(onSettings).toHaveBeenCalledWith(null);
  });

  it('maps a valid doc, defaulting unset roles', () => {
    const onSettings = vi.fn();
    subscribeAppSettings(onSettings, () => {});
    (mockOnSnapshot.mock.calls[0][1] as SnapCallback)({
      exists: () => true,
      data: () => ({ fast: 'custom-fast' }),
    });
    expect(onSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        fast: 'custom-fast',
        pro: AI_MODEL_DEFAULTS.pro,
        embedding: AI_MODEL_DEFAULTS.embedding,
        image: AI_MODEL_DEFAULTS.image,
        schemaVersion: 1,
      }),
    );
  });

  it('surfaces a corrupt doc as a StorageError/corruption Failure (does not throw)', () => {
    const onSettings = vi.fn();
    const onError = vi.fn();
    subscribeAppSettings(onSettings, onError);
    (mockOnSnapshot.mock.calls[0][1] as SnapCallback)({
      exists: () => true,
      data: () => ({ fast: 123 }), // wrong type
    });
    expect(onSettings).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({ kind: 'StorageError', reason: 'corruption' });
  });

  it('classifies a stream-level error via onError', () => {
    const onError = vi.fn();
    subscribeAppSettings(() => {}, onError);
    const err = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
    (mockOnSnapshot.mock.calls[0][2] as ErrorCallback)(err);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('saveAppSettings', () => {
  it('writes the full doc to appSettings/singleton and returns ok', async () => {
    const settings: AppSettings = {
      fast: 'a',
      pro: 'b',
      embedding: 'c',
      image: 'd',
      schemaVersion: 1,
    };
    const result = await saveAppSettings(settings);
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'appSettings', 'singleton');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...settings });
    expect(result.kind).toBe('ok');
  });

  it('returns a Failure when setDoc rejects (never throws across the seam)', async () => {
    mockSetDoc.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'unavailable' }));
    const result = await saveAppSettings({
      fast: 'a',
      pro: 'b',
      embedding: 'c',
      image: 'd',
      schemaVersion: 1,
    });
    expect(result.kind).toBe('err');
  });
});
