import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Member } from '@salt/domain';

const {
  mockUnsubscribe,
  mockOnSnapshot,
  mockSetDoc,
  mockDeleteDoc,
  mockDoc,
  mockCollection,
  mockGetFirestore,
} = vi.hoisted(() => ({
  mockUnsubscribe: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockSetDoc: vi.fn(),
  mockDeleteDoc: vi.fn(),
  mockDoc: vi.fn(() => 'mock-doc-ref'),
  mockCollection: vi.fn(() => 'mock-collection-ref'),
  mockGetFirestore: vi.fn(() => 'mock-db'),
}));

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({})),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  doc: mockDoc,
  collection: mockCollection,
  onSnapshot: mockOnSnapshot,
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
}));

import { subscribeMembers, upsertMember, deleteMember } from '../src/membersSubscription.js';

type SnapCallback = (snap: { docs: { id: string; data: () => unknown }[] }) => void;
type ErrorCallback = (err: Error & { code?: string }) => void;

function validMemberData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'daniel@pendery.org',
    schemaVersion: 1,
    name: 'Daniel',
    email: 'daniel@pendery.org',
    admin: true,
    sortOrder: 0,
    icon: null,
    updatedAt: '2026-06-07T12:00:00.000Z',
    ...overrides,
  };
}

function member(overrides: Partial<Member> & { id: string }): Member {
  return {
    schemaVersion: 1,
    name: 'Daniel',
    email: overrides.id,
    admin: false,
    sortOrder: 0,
    icon: null,
    updatedAt: '2026-06-07T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOnSnapshot.mockReturnValue(mockUnsubscribe);
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  // classifyFirestoreError short-circuits to NetworkError/offline when
  // navigator.onLine is false; stub it online so error-code mapping is exercised.
  vi.stubGlobal('navigator', { onLine: true });
});

describe('subscribeMembers', () => {
  it('targets the members collection', () => {
    subscribeMembers(
      () => {},
      () => {},
    );
    expect(mockCollection).toHaveBeenCalledWith('mock-db', 'members');
  });

  it('returns the unsubscribe function from onSnapshot', () => {
    const unsub = subscribeMembers(
      () => {},
      () => {},
    );
    expect(unsub).toBe(mockUnsubscribe);
  });

  it('delivers all valid members', () => {
    const onMembers = vi.fn();
    subscribeMembers(onMembers, () => {});

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({
      docs: [
        { id: 'daniel@pendery.org', data: () => validMemberData() },
        {
          id: 'amy@pendery.org',
          data: () =>
            validMemberData({
              id: 'amy@pendery.org',
              email: 'amy@pendery.org',
              name: 'Amy',
              admin: false,
            }),
        },
      ],
    });

    expect(onMembers).toHaveBeenCalledTimes(1);
    expect(onMembers.mock.calls[0][0]).toHaveLength(2);
  });

  it('skips corrupt docs and delivers the valid subset', () => {
    const onMembers = vi.fn();
    const onError = vi.fn();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    subscribeMembers(onMembers, onError);

    const snapCb = mockOnSnapshot.mock.calls[0][1] as SnapCallback;
    snapCb({
      docs: [
        {
          id: 'good@e.org',
          data: () => validMemberData({ id: 'good@e.org', email: 'good@e.org' }),
        },
        {
          id: 'bad@e.org',
          data: () => ({ id: 'bad@e.org', schemaVersion: 1 /* missing fields */ }),
        },
      ],
    });

    const delivered = onMembers.mock.calls[0][0] as Member[];
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.id).toBe('good@e.org');
    expect(onError).not.toHaveBeenCalled(); // corrupt doc is skipped, not a stream error
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('classifies a stream-level permission error', () => {
    const onError = vi.fn();
    subscribeMembers(() => {}, onError);

    const errCb = mockOnSnapshot.mock.calls[0][2] as ErrorCallback;
    errCb(Object.assign(new Error('denied'), { code: 'permission-denied' }));

    expect(onError).toHaveBeenCalledWith({ kind: 'AuthError', reason: 'forbidden' });
  });
});

describe('upsertMember', () => {
  it('writes to members/{id} and returns ok', async () => {
    const m = member({ id: 'daniel@pendery.org', admin: true });
    const result = await upsertMember(m);

    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'members', 'daniel@pendery.org');
    expect(mockSetDoc).toHaveBeenCalledWith('mock-doc-ref', { ...m });
    expect(result.kind).toBe('ok');
  });

  it('returns a Failure (does not throw) when the write rejects', async () => {
    mockSetDoc.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'permission-denied' }),
    );
    const result = await upsertMember(member({ id: 'x@e.org' }));
    expect(result.kind).toBe('err');
  });
});

describe('deleteMember', () => {
  it('deletes members/{id} and returns ok', async () => {
    const result = await deleteMember('daniel@pendery.org');
    expect(mockDoc).toHaveBeenCalledWith('mock-db', 'members', 'daniel@pendery.org');
    expect(mockDeleteDoc).toHaveBeenCalledWith('mock-doc-ref');
    expect(result.kind).toBe('ok');
  });

  it('returns a Failure when the delete rejects', async () => {
    mockDeleteDoc.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'permission-denied' }),
    );
    const result = await deleteMember('x@e.org');
    expect(result.kind).toBe('err');
  });
});
