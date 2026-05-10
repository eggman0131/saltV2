/**
 * Parity test: the client fast-path and the matchOrCreate pipeline (which the
 * CF wraps verbatim) must resolve to identical CanonItems for inputs that the
 * fast-path is allowed to short-circuit on (a clear stage 1–4 'match').
 *
 * Fast-path code path (web-pwa addCanonItem):
 *   1. findClosestMatch(items, rawName) → 'match'
 *   2. appendCanonSynonym(item, rawName)
 *   3. upsert(updated)
 *
 * CF code path (matchOrCreateCanon, which calls matchOrCreate verbatim):
 *   1. matchOrCreate runs findClosestMatch → 'match'
 *   2. resolveMatch calls appendCanonSynonym + store.upsert
 *
 * Both paths share the same domain primitives, so this test guards against
 * future drift (e.g. someone adding pre-/post-processing on one side only).
 */
import { describe, it, expect } from 'vitest';
import { findClosestMatch } from '../../src/canon/queries/findClosestMatch.js';
import { appendCanonSynonym } from '../../src/canon/commands/appendCanonSynonym.js';
import { matchOrCreate } from '../../src/canon/commands/matchOrCreate.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';
import type { CanonLocalStorePort } from '../../src/canon/ports/CanonLocalStorePort.js';
import type { AisleLocalStorePort } from '../../src/canon/ports/AisleLocalStorePort.js';
import type { EmbeddingPort } from '../../src/canon/ports/EmbeddingPort.js';
import type { CanonArbitrationPort } from '../../src/canon/ports/CanonArbitrationPort.js';
import type { IdGenerator } from '../../src/canon/ports/IdGenerator.js';

function canonItem(overrides: Partial<CanonItem> & { id: string; name: string }): CanonItem {
  return {
    schemaVersion: 4,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '',
    deletedAt: null,
    ...overrides,
  };
}

function makeStore(initial: CanonItem[]): CanonLocalStorePort & { items: CanonItem[] } {
  const items = initial.map((i) => ({ ...i }));
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

const aisleStore: AisleLocalStorePort = {
  load: async () => ({ kind: 'ok', value: { aisles: [], revision: 0 } }),
  save: async () => ({ kind: 'ok', value: undefined }),
  enqueuePendingSave: async () => ({ kind: 'ok', value: undefined }),
  drainPendingSave: async () => ({ kind: 'ok', value: null }),
};

// AI ports that throw if invoked — guarantees the fast-path-eligible cases
// never reach stages 5–6 inside matchOrCreate either.
const failingEmbedding: EmbeddingPort = {
  computeEmbedding: async () => {
    throw new Error('embedding must not be reached for clear stage 1–4 matches');
  },
  cosineSimilarity: () => 0,
};

const failingArbitration: CanonArbitrationPort = {
  arbitrate: async () => {
    throw new Error('arbitration must not be reached for clear stage 1–4 matches');
  },
};

const ids: IdGenerator = {
  newCanonId: () => 'never-used',
  newAisleId: () => 'never-used',
};

/** Run the client fast-path flow and return the resolved item + post-state of the canon. */
function runFastPath(
  items: readonly CanonItem[],
  rawName: string,
): { item: CanonItem; canon: readonly CanonItem[] } {
  const result = findClosestMatch(items, rawName);
  if (result.kind !== 'match') {
    throw new Error(`fixture expected a clear match; got ${result.kind}`);
  }
  const updated = appendCanonSynonym(result.candidate.item, rawName);
  const canon = items.map((i) => (i.id === updated.id ? updated : i));
  return { item: updated, canon };
}

/** Run the CF flow (matchOrCreate) and return the resolved item + post-state of the canon. */
async function runCfPath(
  items: readonly CanonItem[],
  rawName: string,
): Promise<{ item: CanonItem; canon: readonly CanonItem[] }> {
  const store = makeStore([...items]);
  const result = await matchOrCreate(
    { rawName },
    {
      store,
      aisleStore,
      embedding: failingEmbedding,
      arbitration: failingArbitration,
      ids,
      logging: null,
    },
  );
  if (result.kind !== 'ok') throw new Error(`fixture expected ok; got err ${result.error.kind}`);
  if (result.value.decision !== 'matched') {
    throw new Error(`fixture expected 'matched'; got ${result.value.decision}`);
  }
  return { item: result.value.item, canon: store.items };
}

describe('client fast-path ↔ CF path parity (clear stage 1–4 matches)', () => {
  const baseCanon: readonly CanonItem[] = [
    canonItem({ id: 'tomato-1', name: 'Tomato' }),
    canonItem({ id: 'apple-1', name: 'Apple', synonyms: ['pomme'] }),
    canonItem({ id: 'broccoli-1', name: 'Broccoli' }),
  ];

  const cases: Array<{ name: string; rawName: string; expectedId: string }> = [
    // Stage 1 — exact normalised name match (also exercises synonym append +
    // needs_approval flip, since the canon item starts with no synonyms)
    { name: 'stage 1 (exact name)', rawName: 'tomato', expectedId: 'tomato-1' },
    // Stage 1 with case/whitespace differences still normalises identically
    { name: 'stage 1 (case + whitespace)', rawName: '  TOMATO  ', expectedId: 'tomato-1' },
    // Stage 1 via singularization (normaliseName collapses plurals)
    { name: 'stage 1 (plural via normalise)', rawName: 'tomatoes', expectedId: 'tomato-1' },
    // Stage 3 — synonym hit (no name match, but matches an existing synonym)
    { name: 'stage 3 (synonym hit)', rawName: 'pomme', expectedId: 'apple-1' },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const fast = runFastPath(baseCanon, c.rawName);
      const cf = await runCfPath(baseCanon, c.rawName);

      // Both paths must resolve to the same item id and the same final state.
      expect(fast.item.id).toBe(c.expectedId);
      expect(cf.item.id).toBe(c.expectedId);
      expect(fast.item).toEqual(cf.item);
      expect(fast.canon).toEqual(cf.canon);
    });
  }
});
