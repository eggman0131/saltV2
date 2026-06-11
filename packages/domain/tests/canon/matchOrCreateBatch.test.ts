import { describe, it, expect, vi } from 'vitest';
import { matchOrCreateBatch } from '../../src/canon/commands/matchOrCreate.js';
import type { MatchOrCreateInput } from '../../src/canon/commands/matchOrCreate.js';
import type { CanonLocalStorePort } from '../../src/canon/ports/CanonLocalStorePort.js';
import type { AisleLocalStorePort } from '../../src/canon/ports/AisleLocalStorePort.js';
import type { EmbeddingPort } from '../../src/canon/ports/EmbeddingPort.js';
import type { CanonArbitrationPort } from '../../src/canon/ports/CanonArbitrationPort.js';
import type { IdGenerator } from '../../src/canon/ports/IdGenerator.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';

// ─── Fixtures (mirrors matchOrCreate.test.ts) ────────────────────────────────

function canonItem(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    schemaVersion: 5,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    ...overrides,
  };
}

let idCounter = 0;
function makeIds(): IdGenerator {
  return { newCanonId: () => `id-${++idCounter}`, newAisleId: () => `aisle-${++idCounter}` };
}

function makeStore(initial: CanonItem[] = []): CanonLocalStorePort & { items: CanonItem[] } {
  const items = [...initial];
  return {
    items,
    list: async () => ({ kind: 'ok', value: items }),
    load: async (id) => ({ kind: 'ok', value: items.find((i) => i.id === id) ?? null }),
    upsert: async (item) => {
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.push(item);
      return { kind: 'ok', value: item };
    },
    delete: async () => ({ kind: 'ok', value: undefined }),
  };
}

function makeAisleStore(): AisleLocalStorePort {
  return {
    load: async () => ({ kind: 'ok', value: [] }),
    save: async () => ({ kind: 'ok', value: undefined }),
  };
}

const eX = [1, 0] as const;
function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

function failEmbedding(): EmbeddingPort {
  return {
    computeEmbedding: async () => ({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    }),
    cosineSimilarity: cosine,
  };
}

function noMatchArbitration(): CanonArbitrationPort {
  return { arbitrate: async () => ({ kind: 'ok', value: { kind: 'no-match' } }) };
}

function makePorts(
  store: CanonLocalStorePort,
  opts: { embedding?: EmbeddingPort; arbitration?: CanonArbitrationPort } = {},
) {
  return {
    store,
    aisleStore: makeAisleStore(),
    embedding: opts.embedding ?? failEmbedding(),
    arbitration: opts.arbitration ?? noMatchArbitration(),
    ids: makeIds(),
    logging: null,
  };
}

// ─── (a) batch-of-one parity with a single multi-item batch ──────────────────
// Running each corpus input as its own batch([x]) against an accumulating store
// must yield the same per-input decision / item id / synonyms / needs_approval
// as folding the whole corpus through one batch([x, y, z, …]). This is the
// structural guarantee that the single-item and batch paths cannot drift.

describe('batch parity — single batch vs sequential batches-of-one', () => {
  // 'garlic' (input 2) must match the 'Garlic' created by input 1 via the
  // growing snapshot; 'olive oil' (input 4) matches the seeded near-miss and
  // mutates it (synonym + needs_approval). Arbitration never fires (no aisles,
  // single near-miss is a direct match), so outcomes are fully deterministic.
  const CORPUS = ['Garlic', 'garlic', 'Basil', 'olive oil'];
  const seed = () => [canonItem({ id: 'x1', name: 'olive oil extra', needs_approval: false })];

  type Shape = {
    kind: string;
    decision?: string;
    id?: string;
    synonyms?: readonly string[];
    needs_approval?: boolean;
  };

  function shape(results: Awaited<ReturnType<typeof matchOrCreateBatch>>): Shape[] {
    return results.map((r) =>
      r.kind === 'ok'
        ? {
            kind: 'ok',
            decision: r.value.decision,
            id: r.value.item.id,
            synonyms: r.value.item.synonyms,
            needs_approval: r.value.item.needs_approval,
          }
        : { kind: 'err' },
    );
  }

  async function runCombined(): Promise<Shape[]> {
    idCounter = 0;
    const ports = makePorts(makeStore(seed()));
    const inputs: MatchOrCreateInput[] = CORPUS.map((rawName) => ({ rawName }));
    return shape(await matchOrCreateBatch(inputs, ports));
  }

  async function runSequential(): Promise<Shape[]> {
    idCounter = 0;
    const ports = makePorts(makeStore(seed())); // one accumulating store + id stream
    const out: Shape[] = [];
    for (const rawName of CORPUS) {
      out.push(...shape(await matchOrCreateBatch([{ rawName }], ports)));
    }
    return out;
  }

  it('produces identical per-input results either way', async () => {
    const combined = await runCombined();
    const sequential = await runSequential();
    expect(combined).toEqual(sequential);
  });

  it('the second input matches the new item created by the first', async () => {
    const combined = await runCombined();
    expect(combined[0]).toMatchObject({ decision: 'created' });
    expect(combined[1]).toMatchObject({ decision: 'matched', id: combined[0]!.id });
  });
});

// ─── (b) duplicate collapse — two inputs → the same new item → one item ──────

describe('intra-batch accumulation — duplicate new item collapses to one', () => {
  it('two inputs resolving to the same new item produce exactly one canon item', async () => {
    idCounter = 0;
    const store = makeStore([]);
    const results = await matchOrCreateBatch(
      [{ rawName: 'Garlic' }, { rawName: 'garlic' }],
      makePorts(store),
    );
    expect(results[0]).toMatchObject({ kind: 'ok' });
    expect(results[1]).toMatchObject({ kind: 'ok' });
    if (results[0]!.kind === 'ok' && results[1]!.kind === 'ok') {
      expect(results[0]!.value.decision).toBe('created');
      expect(results[1]!.value.decision).toBe('matched');
      expect(results[1]!.value.item.id).toBe(results[0]!.value.item.id);
    }
    // The race that the per-item fan-out suffers (two creations) is gone.
    expect(store.items).toHaveLength(1);
  });
});

// ─── (c) one canon read per batch ─────────────────────────────────────────────

describe('one snapshot per batch', () => {
  it('calls store.list() exactly once regardless of input count', async () => {
    idCounter = 0;
    const store = makeStore([]);
    const listSpy = vi.spyOn(store, 'list');
    await matchOrCreateBatch(
      [{ rawName: 'Garlic' }, { rawName: 'Basil' }, { rawName: 'Thyme' }],
      makePorts(store),
    );
    expect(listSpy).toHaveBeenCalledOnce();
  });

  it('returns the store.list() failure for every input', async () => {
    idCounter = 0;
    const brokenStore: CanonLocalStorePort = {
      list: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      load: async () => ({ kind: 'ok', value: null }),
      upsert: async (i) => ({ kind: 'ok', value: i }),
      delete: async () => ({ kind: 'ok', value: undefined }),
    };
    const results = await matchOrCreateBatch(
      [{ rawName: 'Garlic' }, { rawName: 'Basil' }],
      makePorts(brokenStore),
    );
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.kind).toBe('err');
      if (r.kind === 'err') expect(r.error.kind).toBe('StorageError');
    }
  });
});

// ─── Batched embedding — one computeEmbeddings call, embedMatch served cached ─

describe('batched embedding cache', () => {
  it('pre-computes via computeEmbeddings once and serves embedMatch from cache', async () => {
    idCounter = 0;
    const computeEmbeddings = vi.fn().mockResolvedValue({ kind: 'ok', value: [eX] });
    const computeEmbedding = vi.fn();
    const embedding: EmbeddingPort = {
      computeEmbedding,
      computeEmbeddings,
      cosineSimilarity: cosine,
    };
    // Seeded item carries an embedding so stage 5 (embedMatch) actually runs;
    // 'zeta' shares no tokens with 'alpha', so stages 1–4 miss and embedMatch fires.
    const store = makeStore([canonItem({ id: 'o1', name: 'alpha', embedding: eX })]);
    await matchOrCreateBatch([{ rawName: 'zeta' }], makePorts(store, { embedding }));

    expect(computeEmbeddings).toHaveBeenCalledOnce();
    expect(computeEmbeddings).toHaveBeenCalledWith(['zeta']);
    // embedMatch was served from the warm cache, never the per-name path.
    expect(computeEmbedding).not.toHaveBeenCalled();
  });
});
