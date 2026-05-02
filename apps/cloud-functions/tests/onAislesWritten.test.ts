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

const { handleAislesWritten } = await import('../src/triggers/onAislesWritten.js');

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

const aislesRef = { id: 'aisles' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleAislesWritten — aisles stamp', () => {
  it('increments aislesRevision and stamps revision + updatedAt on the aisles doc', async () => {
    const db = makeDb({ itemsRevision: 4, aislesRevision: 2 });

    await handleAislesWritten(db as any, undefined, { revision: 0 }, aislesRef as any);

    const [, setData] = db._tx._sets[0]!;
    expect(setData).toMatchObject({ aislesRevision: 3 });

    const [, updateData] = db._tx._updates[0]!;
    expect(updateData).toMatchObject({ revision: 3, updatedAt: fakeIso });
  });

  it('uses merge:true on manifest so existing fields are preserved', async () => {
    const db = makeDb({ itemsRevision: 4, aislesRevision: 2 });

    await handleAislesWritten(db as any, undefined, { revision: 0 }, aislesRef as any);

    const [, , opts] = db._tx._sets[0]!;
    expect(opts).toEqual({ merge: true });
  });

  it('starts aislesRevision at 1 when manifest document does not exist yet', async () => {
    const db = makeDb(undefined);

    await handleAislesWritten(db as any, undefined, { revision: 0 }, aislesRef as any);

    const [, setData] = db._tx._sets[0]!;
    expect(setData).toMatchObject({ aislesRevision: 1 });
  });
});

describe('handleAislesWritten — cross-scope isolation', () => {
  it('does not include itemsRevision in the manifest set payload', async () => {
    const db = makeDb({ itemsRevision: 4, aislesRevision: 2 });

    await handleAislesWritten(db as any, undefined, { revision: 0 }, aislesRef as any);

    const [, setData] = db._tx._sets[0]! as [unknown, Record<string, unknown>, unknown];
    expect(setData).not.toHaveProperty('itemsRevision');
  });

  it('does not include latestItemsUpdatedAt in the manifest set payload', async () => {
    const db = makeDb({ itemsRevision: 4, aislesRevision: 2 });

    await handleAislesWritten(db as any, undefined, { revision: 0 }, aislesRef as any);

    const [, setData] = db._tx._sets[0]! as [unknown, Record<string, unknown>, unknown];
    expect(setData).not.toHaveProperty('latestItemsUpdatedAt');
  });
});

describe('handleAislesWritten — delete path', () => {
  it('bumps aislesRevision on hard delete (afterData undefined)', async () => {
    const db = makeDb({ itemsRevision: 4, aislesRevision: 2 });

    await handleAislesWritten(db as any, { revision: 2 }, undefined, undefined);

    const [, setData] = db._tx._sets[0]!;
    expect(setData).toMatchObject({ aislesRevision: 3 });
    expect(db._tx._updates).toHaveLength(0);
  });
});

describe('handleAislesWritten — idempotency', () => {
  it('skips transaction when re-triggered after CF stamp (afterRevision > beforeRevision)', async () => {
    const db = makeDb({ itemsRevision: 4, aislesRevision: 3 });

    await handleAislesWritten(
      db as any,
      { revision: 0 },
      { revision: 3 },
      aislesRef as any,
    );

    expect(db.runTransaction).not.toHaveBeenCalled();
  });

  it('advances aislesRevision exactly twice across two client writes (four trigger fires)', async () => {
    // --- First client write ---
    const db1 = makeDb({ itemsRevision: 0, aislesRevision: 0 });
    await handleAislesWritten(db1 as any, undefined, { revision: 0 }, aislesRef as any);
    expect(db1.runTransaction).toHaveBeenCalledOnce();
    const [, d1] = db1._tx._sets[0]!;
    expect((d1 as any).aislesRevision).toBe(1);

    // --- CF re-trigger: before={revision:0}, after={revision:1} → skip ---
    const db2 = makeDb({ itemsRevision: 0, aislesRevision: 1 });
    await handleAislesWritten(db2 as any, { revision: 0 }, { revision: 1 }, aislesRef as any);
    expect(db2.runTransaction).not.toHaveBeenCalled();

    // --- Second client write: before={revision:1}, after={revision:1} ---
    const db3 = makeDb({ itemsRevision: 0, aislesRevision: 1 });
    await handleAislesWritten(
      db3 as any,
      { revision: 1 },
      { revision: 1 },
      aislesRef as any,
    );
    expect(db3.runTransaction).toHaveBeenCalledOnce();
    const [, d3] = db3._tx._sets[0]!;
    expect((d3 as any).aislesRevision).toBe(2);

    // --- CF re-trigger: before={revision:1}, after={revision:2} → skip ---
    const db4 = makeDb({ itemsRevision: 0, aislesRevision: 2 });
    await handleAislesWritten(db4 as any, { revision: 1 }, { revision: 2 }, aislesRef as any);
    expect(db4.runTransaction).not.toHaveBeenCalled();
  });
});
