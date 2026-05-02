import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeIso = '2026-05-02T00:00:00.000Z';
const fakeTimestamp = { toDate: () => new Date(fakeIso) };

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  Timestamp: { now: vi.fn(() => fakeTimestamp) },
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const { handleCanonItemWritten } = await import(
  '../src/triggers/onCanonItemWritten.js'
);

function makeDb(manifestData?: Record<string, unknown>) {
  const manifestRef = { id: 'global' };
  const sets: Array<[unknown, unknown, unknown]> = [];
  const updates: Array<[unknown, unknown]> = [];

  const tx = {
    get: vi.fn().mockResolvedValue({ data: () => manifestData }),
    set: vi.fn((ref, data, opts) => {
      sets.push([ref, data, opts]);
    }),
    update: vi.fn((ref, data) => {
      updates.push([ref, data]);
    }),
    _sets: sets,
    _updates: updates,
  };

  return {
    doc: vi.fn().mockReturnValue(manifestRef),
    runTransaction: vi.fn((fn: (tx: typeof tx) => Promise<void>) => fn(tx)),
    _tx: tx,
    _manifestRef: manifestRef,
  };
}

const itemRef = { id: 'item-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleCanonItemWritten — item stamp', () => {
  it('increments itemsRevision and stamps revision + updatedAt on new item', async () => {
    const db = makeDb({ itemsRevision: 5, aislesRevision: 3 });

    await handleCanonItemWritten(
      db as any,
      'item-1',
      undefined,
      { revision: 0 },
      itemRef as any,
    );

    const [, setData] = db._tx._sets[0]!;
    expect(setData).toMatchObject({ itemsRevision: 6 });

    const [, updateData] = db._tx._updates[0]!;
    expect(updateData).toMatchObject({ revision: 6, updatedAt: fakeIso });
  });

  it('uses merge:true on manifest so existing fields are preserved', async () => {
    const db = makeDb({ itemsRevision: 5, aislesRevision: 3 });

    await handleCanonItemWritten(db as any, 'item-1', undefined, { revision: 0 }, itemRef as any);

    const [, , opts] = db._tx._sets[0]!;
    expect(opts).toEqual({ merge: true });
  });

  it('starts itemsRevision at 1 when manifest document does not exist yet', async () => {
    const db = makeDb(undefined);

    await handleCanonItemWritten(db as any, 'item-1', undefined, { revision: 0 }, itemRef as any);

    const [, setData] = db._tx._sets[0]!;
    expect(setData).toMatchObject({ itemsRevision: 1 });
  });
});

describe('handleCanonItemWritten — cross-scope isolation', () => {
  it('does not include aislesRevision in the manifest set payload', async () => {
    const db = makeDb({ itemsRevision: 5, aislesRevision: 3 });

    await handleCanonItemWritten(db as any, 'item-1', undefined, { revision: 0 }, itemRef as any);

    const [, setData] = db._tx._sets[0]! as [unknown, Record<string, unknown>, unknown];
    expect(setData).not.toHaveProperty('aislesRevision');
  });

  it('does not include latestAislesUpdatedAt in the manifest set payload', async () => {
    const db = makeDb({ itemsRevision: 5, aislesRevision: 3 });

    await handleCanonItemWritten(db as any, 'item-1', undefined, { revision: 0 }, itemRef as any);

    const [, setData] = db._tx._sets[0]! as [unknown, Record<string, unknown>, unknown];
    expect(setData).not.toHaveProperty('latestAislesUpdatedAt');
  });
});

describe('handleCanonItemWritten — delete path', () => {
  it('bumps itemsRevision on hard delete (afterData undefined)', async () => {
    const db = makeDb({ itemsRevision: 5, aislesRevision: 3 });

    await handleCanonItemWritten(
      db as any,
      'item-1',
      { revision: 5 },
      undefined,
      undefined,
    );

    const [, setData] = db._tx._sets[0]!;
    expect(setData).toMatchObject({ itemsRevision: 6 });
    expect(db._tx._updates).toHaveLength(0);
  });

  it('bumps itemsRevision on soft delete (deletedAt set, revision unchanged)', async () => {
    const db = makeDb({ itemsRevision: 5, aislesRevision: 3 });

    await handleCanonItemWritten(
      db as any,
      'item-1',
      { revision: 5 },
      { revision: 5, deletedAt: fakeIso },
      itemRef as any,
    );

    const [, setData] = db._tx._sets[0]!;
    expect(setData).toMatchObject({ itemsRevision: 6 });
    expect(db._tx._updates[0]![1]).toMatchObject({ revision: 6, updatedAt: fakeIso });
  });
});

describe('handleCanonItemWritten — idempotency', () => {
  it('skips transaction when re-triggered after CF stamp (afterRevision > beforeRevision)', async () => {
    const db = makeDb({ itemsRevision: 6, aislesRevision: 3 });

    await handleCanonItemWritten(
      db as any,
      'item-1',
      { revision: 0 },
      { revision: 6 },
      itemRef as any,
    );

    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it('advances revision exactly twice across two client writes (four trigger fires)', async () => {
    // --- First client write: before=undefined (create), after={revision:0} ---
    const db1 = makeDb({ itemsRevision: 0, aislesRevision: 0 });
    await handleCanonItemWritten(db1 as any, 'item-1', undefined, { revision: 0 }, itemRef as any);
    expect(db1.runTransaction).toHaveBeenCalledOnce();
    const [, d1] = db1._tx._sets[0]!;
    expect((d1 as any).itemsRevision).toBe(1);

    // --- CF re-trigger: before={revision:0}, after={revision:1} → skip ---
    const db2 = makeDb({ itemsRevision: 1, aislesRevision: 0 });
    await handleCanonItemWritten(
      db2 as any,
      'item-1',
      { revision: 0 },
      { revision: 1 },
      itemRef as any,
    );
    expect(db2.runTransaction).not.toHaveBeenCalled();

    // --- Second client write: before={revision:1}, after={revision:1} (same — client updated name etc.) ---
    const db3 = makeDb({ itemsRevision: 1, aislesRevision: 0 });
    await handleCanonItemWritten(
      db3 as any,
      'item-1',
      { revision: 1 },
      { revision: 1 },
      itemRef as any,
    );
    expect(db3.runTransaction).toHaveBeenCalledOnce();
    const [, d3] = db3._tx._sets[0]!;
    expect((d3 as any).itemsRevision).toBe(2);

    // --- CF re-trigger: before={revision:1}, after={revision:2} → skip ---
    const db4 = makeDb({ itemsRevision: 2, aislesRevision: 0 });
    await handleCanonItemWritten(
      db4 as any,
      'item-1',
      { revision: 1 },
      { revision: 2 },
      itemRef as any,
    );
    expect(db4.runTransaction).not.toHaveBeenCalled();
  });
});
