import { describe, it, expect } from 'vitest';
import type { CanonItem } from '@salt/domain';
import { createFirestoreCanonStore } from '../../src/adapters/firestoreCanonStore.js';

// ─── Embedding relocation (issue #410) ────────────────────────────────────────
//
// Vectors live in the server-only `canonEmbeddings/{id}` collection, no longer
// inline on the client-subscribed `canonItems` doc. The adapter is the seam that
// keeps the pure-domain CanonItem whole: it JOINS the vector back on read (with an
// inline fallback for un-migrated docs) and STRIPS it on write (the CF embedding
// branch is the single writer of the companion collection). These tests pin that
// split with a lightweight in-memory Firestore double.

type DocData = Record<string, unknown>;

interface Writes {
  set: Array<{ col: string; id: string; data: DocData }>;
  del: Array<{ col: string; id: string }>;
}

function makeDb(collections: Record<string, Record<string, DocData>>) {
  const writes: Writes = { set: [], del: [] };
  const db = {
    collection(name: string) {
      const coll = (collections[name] ??= {});
      return {
        doc(id: string) {
          return {
            async get() {
              const data = coll[id];
              return { exists: data !== undefined, data: () => data };
            },
            async set(data: DocData) {
              writes.set.push({ col: name, id, data });
              coll[id] = data;
            },
            async delete() {
              writes.del.push({ col: name, id });
              delete coll[id];
            },
          };
        },
        async get() {
          return { docs: Object.entries(coll).map(([id, data]) => ({ id, data: () => data })) };
        },
      };
    },
  };
  return { db: db as unknown as Parameters<typeof createFirestoreCanonStore>[0], writes };
}

function canonDoc(id: string, overrides: DocData = {}): DocData {
  return {
    id,
    schemaVersion: 5,
    name: id,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    ...overrides,
  };
}

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

describe('firestoreCanonStore — embedding read merge (#410)', () => {
  it('list() joins the relocated vector back onto its canon item by id', async () => {
    const { db } = makeDb({
      canonItems: { a: canonDoc('a'), b: canonDoc('b') },
      canonEmbeddings: { a: { embedding: [1, 2, 3] } },
    });
    const res = await createFirestoreCanonStore(db).list();

    expect(res.kind).toBe('ok');
    const items = res.kind === 'ok' ? res.value : [];
    expect(items.find((i) => i.id === 'a')?.embedding).toEqual([1, 2, 3]);
    // No companion, no inline → null (stage 5 skips it).
    expect(items.find((i) => i.id === 'b')?.embedding).toBeNull();
  });

  it('list() falls back to an inline vector on an un-migrated doc', async () => {
    const { db } = makeDb({
      canonItems: { a: canonDoc('a', { embedding: [9, 9] }) },
      canonEmbeddings: {},
    });
    const res = await createFirestoreCanonStore(db).list();
    const items = res.kind === 'ok' ? res.value : [];
    expect(items.find((i) => i.id === 'a')?.embedding).toEqual([9, 9]);
  });

  it('list() prefers the relocated vector over a stale inline one (transitional)', async () => {
    const { db } = makeDb({
      canonItems: { a: canonDoc('a', { embedding: [0, 0] }) },
      canonEmbeddings: { a: { embedding: [1, 1] } },
    });
    const res = await createFirestoreCanonStore(db).list();
    const items = res.kind === 'ok' ? res.value : [];
    expect(items.find((i) => i.id === 'a')?.embedding).toEqual([1, 1]);
  });

  it('list() skips a corrupt embedding doc without failing the whole read', async () => {
    const { db } = makeDb({
      canonItems: { a: canonDoc('a'), b: canonDoc('b') },
      canonEmbeddings: { a: { embedding: 'not-an-array' }, b: { embedding: [4, 5] } },
    });
    const res = await createFirestoreCanonStore(db).list();
    expect(res.kind).toBe('ok');
    const items = res.kind === 'ok' ? res.value : [];
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.id === 'a')?.embedding).toBeNull(); // corrupt → dropped
    expect(items.find((i) => i.id === 'b')?.embedding).toEqual([4, 5]);
  });

  it('load() merges the companion vector, with inline fallback and null default', async () => {
    const merged = await createFirestoreCanonStore(
      makeDb({ canonItems: { a: canonDoc('a') }, canonEmbeddings: { a: { embedding: [1, 2] } } })
        .db,
    ).load('a');
    expect(merged.kind === 'ok' && merged.value?.embedding).toEqual([1, 2]);

    const inline = await createFirestoreCanonStore(
      makeDb({ canonItems: { a: canonDoc('a', { embedding: [7] }) }, canonEmbeddings: {} }).db,
    ).load('a');
    expect(inline.kind === 'ok' && inline.value?.embedding).toEqual([7]);

    const none = await createFirestoreCanonStore(
      makeDb({ canonItems: { a: canonDoc('a') }, canonEmbeddings: {} }).db,
    ).load('a');
    expect(none.kind === 'ok' && none.value?.embedding).toBeNull();

    const missing = await createFirestoreCanonStore(
      makeDb({ canonItems: {}, canonEmbeddings: {} }).db,
    ).load('nope');
    expect(missing.kind === 'ok' && missing.value).toBeNull();
  });
});

describe('firestoreCanonStore — embedding write split (#410)', () => {
  it('upsert() writes the canon doc WITHOUT embedding and never writes canonEmbeddings', async () => {
    const { db, writes } = makeDb({ canonItems: {}, canonEmbeddings: {} });
    const item = canonDoc('a', { embedding: [5, 5] }) as unknown as CanonItem;

    const res = await createFirestoreCanonStore(db).upsert(item);
    expect(res.kind).toBe('ok');

    expect(writes.set).toHaveLength(1);
    expect(writes.set[0]!.col).toBe('canonItems');
    expect(writes.set[0]!.data['embedding']).toBeUndefined();
    expect(writes.set.some((w) => w.col === 'canonEmbeddings')).toBe(false);
  });

  it('upsert() stamps traceContext at the adapter boundary but still omits embedding', async () => {
    const { db, writes } = makeDb({ canonItems: {}, canonEmbeddings: {} });
    const item = canonDoc('a', { embedding: [5, 5] }) as unknown as CanonItem;

    await createFirestoreCanonStore(db, undefined, TRACEPARENT).upsert(item);

    expect(writes.set[0]!.data['traceContext']).toBe(TRACEPARENT);
    expect(writes.set[0]!.data['embedding']).toBeUndefined();
  });

  it('delete() removes the canon doc and its companion vector together', async () => {
    const { db, writes } = makeDb({
      canonItems: { a: canonDoc('a') },
      canonEmbeddings: { a: { embedding: [1] } },
    });
    await createFirestoreCanonStore(db).delete('a');

    expect(writes.del).toContainEqual({ col: 'canonItems', id: 'a' });
    expect(writes.del).toContainEqual({ col: 'canonEmbeddings', id: 'a' });
  });
});
