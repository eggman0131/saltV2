import { describe, it, expect, vi } from 'vitest';
import { matchOrCreate } from '../../src/canon/commands/matchOrCreate.js';
import type { CanonLocalStorePort } from '../../src/canon/ports/CanonLocalStorePort.js';
import type { AisleLocalStorePort } from '../../src/canon/ports/AisleLocalStorePort.js';
import type { EmbeddingPort } from '../../src/canon/ports/EmbeddingPort.js';
import type { CanonArbitrationPort } from '../../src/canon/ports/CanonArbitrationPort.js';
import type { IdGenerator } from '../../src/canon/ports/IdGenerator.js';
import type { MatchLoggingPort } from '../../src/canon/ports/MatchLoggingPort.js';
import type { CanonItem } from '../../src/canon/entities/CanonItem.js';
import type { MatchLogEntry } from '../../src/canon/entities/MatchLogEntry.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

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
    load: async (id) => {
      const found = items.find((i) => i.id === id) ?? null;
      return { kind: 'ok', value: found };
    },
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

function makeAisleStoreWithAisles(): AisleLocalStorePort {
  const aisles = [{ id: 'produce', name: 'Produce', order: 1 }];
  return {
    load: async () => ({ kind: 'ok', value: aisles }),
    save: async () => ({ kind: 'ok', value: undefined }),
  };
}

// eX · eX = 1.0 (above stage5Stop=0.75); eX · eY = 0.0 (below)
const eX = [1, 0] as const;
const eY = [0, 1] as const;

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

function makeEmbedding(queryVec: readonly number[], itemVec?: readonly number[]): EmbeddingPort {
  return {
    computeEmbedding: async () => ({ kind: 'ok', value: queryVec }),
    cosineSimilarity: (a, b) => cosine(a, itemVec ?? b),
  };
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

function newArbitration(canonName: string, aisleId: string | null = null): CanonArbitrationPort {
  return {
    arbitrate: async () => ({
      kind: 'ok',
      value: { kind: 'new', canonName, aisleId, shoppingBehavior: 'needed' as const },
    }),
  };
}

function matchArbitration(itemId: string, reasoning?: string): CanonArbitrationPort {
  return {
    arbitrate: async () => ({
      kind: 'ok',
      value: {
        kind: 'match',
        itemId,
        confidence: 0.95,
        shoppingBehavior: 'needed' as const,
        ...(reasoning !== undefined ? { reasoning } : {}),
      },
    }),
  };
}

function errorArbitration(): CanonArbitrationPort {
  return {
    arbitrate: async () => ({
      kind: 'err',
      error: { kind: 'NetworkError', reason: 'transient' },
    }),
  };
}

function makePipeline(
  opts: {
    store?: CanonLocalStorePort & { items: CanonItem[] };
    items?: CanonItem[];
    aisleStore?: AisleLocalStorePort;
    embedding?: EmbeddingPort;
    arbitration?: CanonArbitrationPort;
    logging?: MatchLoggingPort | null;
  } = {},
) {
  const store = opts.store ?? makeStore(opts.items ?? []);
  idCounter = 0;
  const ports = {
    store,
    aisleStore: opts.aisleStore ?? makeAisleStore(),
    embedding: opts.embedding ?? failEmbedding(),
    arbitration: opts.arbitration ?? noMatchArbitration(),
    ids: makeIds(),
    logging: opts.logging ?? null,
  };
  const run = (rawName: string, selectedAisleId?: string | null, forceCreate?: boolean) =>
    matchOrCreate({ rawName, selectedAisleId, forceCreate }, ports);
  return { run, store };
}

// ─── Stage 1: exact normalised name match ────────────────────────────────────

describe('stage 1 — exact name match', () => {
  it('returns the matched item when normalised names are identical', async () => {
    const apple = canonItem({ id: 'a1', name: 'Apple' });
    const { run } = makePipeline({ items: [apple] });
    const result = await run('apple');
    // No synonym added: normalised input equals normalised item name.
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.item.id).toBe('a1');
      expect(result.value.decision).toBe('matched');
    }
  });

  it('matches despite casing differences', async () => {
    const apple = canonItem({ id: 'a1', name: 'APPLE' });
    const { run } = makePipeline({ items: [apple] });
    const result = await run('apple');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.item.id).toBe('a1');
  });

  it('matches plural forms after singularisation', async () => {
    const apple = canonItem({ id: 'a1', name: 'apple' });
    const { run } = makePipeline({ items: [apple] });
    const result = await run('apples');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.item.id).toBe('a1');
  });

  it('does not create a new item when stage 1 matches', async () => {
    const apple = canonItem({ id: 'a1', name: 'apple' });
    const { run, store } = makePipeline({ items: [apple] });
    await run('apple');
    expect((store as ReturnType<typeof makeStore>).items).toHaveLength(1);
  });

  it('returns decision=matched for a stage-1 hit', async () => {
    const apple = canonItem({ id: 'a1', name: 'apple' });
    const { run } = makePipeline({ items: [apple] });
    const result = await run('apple');
    if (result.kind === 'ok') expect(result.value.decision).toBe('matched');
  });
});

// ─── Stage 3: synonym match ───────────────────────────────────────────────────

describe('stage 3 — synonym match', () => {
  it('matches via a stored synonym', async () => {
    const tomato = canonItem({ id: 't1', name: 'tomato', synonyms: ['love apple'] });
    const { run } = makePipeline({ items: [tomato] });
    const result = await run('Love Apple');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.value.item.id).toBe('t1');
  });
});

// ─── Stage 5: embedding match ─────────────────────────────────────────────────

describe('stage 5 — embedding match', () => {
  it('returns the best cosine match when above stage5Stop threshold', async () => {
    // Item embedding = eX; query embedding = eX → cosine = 1.0 >= 0.75
    const oil = canonItem({ id: 'o1', name: 'XYZ-unique-name', embedding: eX });
    const { run } = makePipeline({
      items: [oil],
      embedding: makeEmbedding(eX),
    });
    const result = await run('XYZ-unique-name');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.item.id).toBe('o1');
      expect(result.value.decision).toBe('matched');
    }
  });

  it('prefers the approved item when confidence is equal', async () => {
    const unapproved = canonItem({
      id: 'u1',
      name: 'foo bar baz',
      embedding: eX,
      needs_approval: true,
    });
    const approved = canonItem({
      id: 'a1',
      name: 'foo bar baz',
      embedding: eX,
      needs_approval: false,
    });
    const { run } = makePipeline({
      items: [unapproved, approved],
      embedding: makeEmbedding(eX),
    });
    const result = await run('foo bar baz qux'); // stage 1–4 won't fire; stage 5 will
    if (result.kind === 'ok') expect(result.value.item.id).toBe('a1');
  });
});

// ─── Stage 6: single near-miss → direct match ────────────────────────────────
// When exactly one candidate is above aiThreshold (but below a deterministic
// stop threshold), it is matched directly without calling the arbitration port.

describe('stage 6 — single near-miss: direct match', () => {
  it('matches the single near-miss candidate directly', async () => {
    // tokenMatch('olive oil', 'olive oil extra') ≈ 0.67 — above aiThreshold (0.6)
    const item = canonItem({ id: 'x1', name: 'olive oil extra' });
    const { run } = makePipeline({ items: [item] });
    const result = await run('olive oil');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.item.id).toBe('x1');
      expect(result.value.decision).toBe('matched');
    }
  });

  it('does not call the arbitration port for a single near-miss', async () => {
    const item = canonItem({ id: 'x1', name: 'olive oil extra' });
    const arbitrateSpy = vi.fn().mockResolvedValue({ kind: 'ok', value: { kind: 'no-match' } });
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'olive oil' },
      {
        store: makeStore([item]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: { arbitrate: arbitrateSpy },
        ids: makeIds(),
        logging: null,
      },
    );
    expect(arbitrateSpy).not.toHaveBeenCalled();
  });
});

// ─── Stage 6: multiple near-misses → AI arbitration is sole decider ──────────

describe('stage 6 — multiple near-misses: AI arbitrates', () => {
  // Both items score above aiThreshold (0.6) with tokenMatch for 'olive oil'
  const item1 = canonItem({ id: 'x1', name: 'olive oil extra' });
  const item2 = canonItem({ id: 'x2', name: 'olive oil light' });

  it('returns ai_arbitrated when AI picks one candidate', async () => {
    const { run } = makePipeline({
      items: [item1, item2],
      arbitration: matchArbitration('x2'),
    });
    const result = await run('olive oil');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.decision).toBe('ai_arbitrated');
      expect(result.value.item.id).toBe('x2');
    }
  });

  it('sets reasoning on the matched item when AI provides reasoning', async () => {
    const { run } = makePipeline({
      items: [item1, item2],
      arbitration: matchArbitration('x2', 'synonym is a regional variant'),
    });
    const result = await run('olive oil');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.item.reasoning).toBe('synonym is a regional variant');
    }
  });

  it('falls back to highest-confidence candidate when AI errors, flagged needs_approval', async () => {
    const { run, store } = makePipeline({
      items: [item1, item2],
      arbitration: errorArbitration(),
    });
    const result = await run('olive oil');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.decision).toBe('ai_arbitrated');
      expect(['x1', 'x2']).toContain(result.value.item.id);
      // appendCanonSynonym sets needs_approval=true so the user can review.
      expect(result.value.item.needs_approval).toBe(true);
    }
    // Original two items still exist; no third item created.
    expect((store as ReturnType<typeof makeStore>).items).toHaveLength(2);
  });
});

// ─── Aisle suggestion via arbitration ────────────────────────────────────────
// Arbitration is called with empty candidates when a new item needs an aisle.

describe('aisle suggestion — arbitration called on creation', () => {
  it('uses the AI-suggested aisle when creating a new item with no match', async () => {
    const { run } = makePipeline({
      aisleStore: makeAisleStoreWithAisles(),
      arbitration: newArbitration('Garlic', 'produce'),
    });
    const result = await run('garlic-xyz-unique');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.item.aisleId).toBe('produce');
      expect(result.value.decision).toBe('created');
    }
  });

  it('creates item from the AI-arbitrated canonName, not the raw input', async () => {
    const { run } = makePipeline({
      aisleStore: makeAisleStoreWithAisles(),
      arbitration: newArbitration('Garlic', 'produce'),
    });
    const result = await run('5 cloves garlic (minced)');
    if (result.kind === 'ok') {
      expect(result.value.item.name).toBe('Garlic');
    }
  });

  it('user-provided aisle overrides AI-suggested aisle', async () => {
    const { run } = makePipeline({
      aisleStore: makeAisleStoreWithAisles(),
      arbitration: newArbitration('Garlic', 'produce'),
    });
    const result = await run('garlic-xyz-unique', 'spices');
    if (result.kind === 'ok') expect(result.value.item.aisleId).toBe('spices');
  });
});

// ─── No candidates → straight creation ───────────────────────────────────────

describe('creation path — no candidates', () => {
  it('creates a new item when the catalog is empty', async () => {
    const { run, store } = makePipeline();
    const result = await run('Garlic');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.item.name).toBe('Garlic');
      expect(result.value.item.aisleId).toBeNull();
      expect(result.value.item.needs_approval).toBe(true);
      expect(result.value.decision).toBe('created');
    }
    expect((store as ReturnType<typeof makeStore>).items).toHaveLength(1);
  });

  it('uses selectedAisleId when provided', async () => {
    const { run } = makePipeline();
    const result = await run('Garlic', 'produce');
    if (result.kind === 'ok') expect(result.value.item.aisleId).toBe('produce');
  });

  it('falls back to null when selectedAisleId is null', async () => {
    const { run } = makePipeline();
    const result = await run('Garlic', null);
    if (result.kind === 'ok') expect(result.value.item.aisleId).toBeNull();
  });

  it('uses arbitration-suggested aisle when selectedAisleId is absent and aisles exist', async () => {
    const { run } = makePipeline({
      aisleStore: makeAisleStoreWithAisles(),
      arbitration: newArbitration('Garlic', 'produce'),
    });
    const result = await run('Garlic', null);
    if (result.kind === 'ok') expect(result.value.item.aisleId).toBe('produce');
  });

  it('leaves aisle null when no aisles are configured', async () => {
    const { run } = makePipeline({ arbitration: newArbitration('Garlic', 'produce') });
    const result = await run('Garlic', null);
    if (result.kind === 'ok') expect(result.value.item.aisleId).toBeNull();
  });
});

// ─── forceCreate ─────────────────────────────────────────────────────────────

describe('forceCreate — bypass matching', () => {
  it('creates a new item even when an exact match exists', async () => {
    const apple = canonItem({ id: 'a1', name: 'apple' });
    const { run, store } = makePipeline({ items: [apple] });
    const result = await run('apple', null, true);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.decision).toBe('created');
      // a new item, not the existing one
      expect(result.value.item.id).not.toBe('a1');
    }
    expect((store as ReturnType<typeof makeStore>).items).toHaveLength(2);
  });

  it('uses selectedAisleId when provided alongside forceCreate', async () => {
    const { run } = makePipeline({ arbitration: newArbitration('Garlic', 'produce') });
    const result = await run('Garlic', 'spices', true);
    if (result.kind === 'ok') expect(result.value.item.aisleId).toBe('spices');
  });

  it('falls back to arbitration-suggested aisle when selectedAisleId is absent', async () => {
    const { run } = makePipeline({
      aisleStore: makeAisleStoreWithAisles(),
      arbitration: newArbitration('Garlic', 'produce'),
    });
    const result = await run('Garlic', null, true);
    if (result.kind === 'ok') expect(result.value.item.aisleId).toBe('produce');
  });

  it('leaves aisle null when arbitration provides no aisle', async () => {
    const { run } = makePipeline({ arbitration: noMatchArbitration() });
    const result = await run('Garlic', null, true);
    if (result.kind === 'ok') expect(result.value.item.aisleId).toBeNull();
  });

  it('returns decision=created', async () => {
    const { run } = makePipeline();
    const result = await run('Garlic', null, true);
    if (result.kind === 'ok') expect(result.value.decision).toBe('created');
  });
});

// ─── Error paths ──────────────────────────────────────────────────────────────

describe('error paths', () => {
  it('returns err when rawName normalises to empty string', async () => {
    const { run } = makePipeline();
    const result = await run('   ');
    expect(result.kind).toBe('err');
    if (result.kind === 'err') expect(result.error.kind).toBe('ValidationError');
  });

  it('propagates store.list() failure', async () => {
    const brokenStore: CanonLocalStorePort = {
      list: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      load: async () => ({ kind: 'ok', value: null }),
      upsert: async (i) => ({ kind: 'ok', value: i }),
      delete: async () => ({ kind: 'ok', value: undefined }),
    };
    idCounter = 0;
    const result = await matchOrCreate(
      { rawName: 'Garlic' },
      {
        store: brokenStore,
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: null,
      },
    );
    expect(result.kind).toBe('err');
    if (result.kind === 'err') expect(result.error.kind).toBe('StorageError');
  });

  it('propagates store.upsert() failure', async () => {
    const brokenStore: CanonLocalStorePort = {
      list: async () => ({ kind: 'ok', value: [] }),
      load: async () => ({ kind: 'ok', value: null }),
      upsert: async () => ({ kind: 'err', error: { kind: 'StorageError', reason: 'unavailable' } }),
      delete: async () => ({ kind: 'ok', value: undefined }),
    };
    idCounter = 0;
    const result = await matchOrCreate(
      { rawName: 'Garlic' },
      {
        store: brokenStore,
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: null,
      },
    );
    expect(result.kind).toBe('err');
    if (result.kind === 'err') expect(result.error.kind).toBe('StorageError');
  });

  it('falls through to creation when arbitration port errors (aisle suggestion path)', async () => {
    // Empty catalog → no match → aisle arbitration triggered → errors → item created with null aisle
    idCounter = 0;
    const result = await matchOrCreate(
      { rawName: 'Garlic' },
      {
        store: makeStore([]),
        aisleStore: makeAisleStoreWithAisles(),
        embedding: failEmbedding(),
        arbitration: errorArbitration(),
        ids: makeIds(),
        logging: null,
      },
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.item.name).toBe('Garlic');
      expect(result.value.item.aisleId).toBeNull();
    }
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('idempotency (stages 1–4)', () => {
  it('returns the same item for identical input after first creation', async () => {
    const { run, store } = makePipeline();
    const first = await run('Garlic');
    expect(first.kind).toBe('ok');

    // Second call: the item now exists in the store, stage 1 will match it
    const second = await run('Garlic');
    expect(second.kind).toBe('ok');
    if (first.kind === 'ok' && second.kind === 'ok') {
      expect(second.value.item.id).toBe(first.value.item.id);
    }
    expect((store as ReturnType<typeof makeStore>).items).toHaveLength(1);
  });

  it('matches the same item regardless of input casing', async () => {
    const { run } = makePipeline();
    const first = await run('Garlic');
    const second = await run('GARLIC');
    if (first.kind === 'ok' && second.kind === 'ok') {
      expect(second.value.item.id).toBe(first.value.item.id);
    }
  });
});

// ─── Ambiguity gap — near-tie at stages 1–4 → AI arbitration ─────────────────

describe('ambiguity gap — near-tie at stage 2 forwards to AI', () => {
  // Two items with the same token-overlap score against the query
  // 'alpha beta gamma delta epsilon' vs both 6-token items → both score 5/6 ≈ 0.833, gap ≈ 0
  const item1 = canonItem({ id: 'i1', name: 'alpha beta gamma delta epsilon zeta' });
  const item2 = canonItem({ id: 'i2', name: 'alpha beta gamma delta epsilon eta' });

  it('calls the arbitration port with the near-tie candidates', async () => {
    const arbitrateSpy = vi.fn().mockResolvedValue({
      kind: 'ok',
      value: { kind: 'match', itemId: 'i1', confidence: 0.9, shoppingBehavior: 'needed' },
    });
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'alpha beta gamma delta epsilon' },
      {
        store: makeStore([item1, item2]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: { arbitrate: arbitrateSpy },
        ids: makeIds(),
        logging: null,
      },
    );
    expect(arbitrateSpy).toHaveBeenCalledOnce();
    const req = arbitrateSpy.mock.calls[0]![0];
    expect(req.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns ai_arbitrated when arbitration picks one of the near-tie candidates', async () => {
    const { run } = makePipeline({
      items: [item1, item2],
      arbitration: matchArbitration('i1'),
    });
    const result = await run('alpha beta gamma delta epsilon');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.decision).toBe('ai_arbitrated');
      expect(result.value.item.id).toBe('i1');
    }
  });

  it('creates a new item when arbitration returns new for a near-tie', async () => {
    const { run, store } = makePipeline({
      items: [item1, item2],
      aisleStore: makeAisleStoreWithAisles(),
      arbitration: newArbitration('Alpha Beta', 'produce'),
    });
    const result = await run('alpha beta gamma delta epsilon');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.decision).toBe('created');
      expect(result.value.item.name).toBe('Alpha Beta');
    }
    // Original two items still exist; one new item added
    expect((store as ReturnType<typeof makeStore>).items).toHaveLength(3);
  });
});

// ─── Auto-synonym capture — stages 1–5 matches ───────────────────────────────

describe('auto-synonym capture', () => {
  it('does not add a synonym when the normalised input equals the canonical name', async () => {
    const apple = canonItem({ id: 'a1', name: 'apple' });
    const { run, store } = makePipeline({ items: [apple] });
    await run('apple');
    const stored = (store as ReturnType<typeof makeStore>).items.find((i) => i.id === 'a1');
    expect(stored?.synonyms).toHaveLength(0);
    expect(stored?.needs_approval).toBe(false);
  });

  it('does not add a synonym or flip needs_approval for plural/case variants that normalise to the canonical name', async () => {
    const approved = canonItem({ id: 'a1', name: 'onion', needs_approval: false });
    const { run, store } = makePipeline({ items: [approved] });
    await run('onions');
    const stored = (store as ReturnType<typeof makeStore>).items.find((i) => i.id === 'a1');
    expect(stored?.synonyms).toHaveLength(0);
    expect(stored?.needs_approval).toBe(false);
  });

  it('does not upsert when the synonym is already present (deduped)', async () => {
    const apple = canonItem({ id: 'a1', name: 'apple', synonyms: ['apple'] });
    const { run, store } = makePipeline({ items: [apple] });
    const upsertSpy = vi.spyOn(store as ReturnType<typeof makeStore>, 'upsert');
    await run('apple');
    // 'apple' already in synonyms → no upsert called (beyond any initial store setup)
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('appends the normalised input as a synonym on a stage-5 (embedding) match', async () => {
    const oil = canonItem({ id: 'o1', name: 'coconut oil', embedding: eX });
    const { run, store } = makePipeline({
      items: [oil],
      embedding: makeEmbedding(eX),
    });
    // 'coconut oil xyz' won't match stages 1–4; embedding will fire
    await run('coconut oil xyz');
    const stored = (store as ReturnType<typeof makeStore>).items.find((i) => i.id === 'o1');
    expect(stored?.synonyms).toContain('coconut oil xyz');
    expect(stored?.needs_approval).toBe(true);
  });
});

// ─── Concurrent creation ──────────────────────────────────────────────────────

describe('concurrent creation', () => {
  it('both calls complete without error when run in parallel', async () => {
    const store = makeStore();
    idCounter = 0;
    const ports = {
      store,
      aisleStore: makeAisleStore(),
      embedding: failEmbedding(),
      arbitration: noMatchArbitration(),
      ids: makeIds(),
      logging: null,
    };
    const [a, b] = await Promise.all([
      matchOrCreate({ rawName: 'Cilantro' }, ports),
      matchOrCreate({ rawName: 'Cilantro' }, ports),
    ]);
    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
  });
});

// ─── Logging ─────────────────────────────────────────────────────────────────

describe('logging integration', () => {
  it('writes a log entry after a stage-1 match', async () => {
    const written: MatchLogEntry[] = [];
    const loggingPort: MatchLoggingPort = {
      write: async (e) => {
        written.push(e);
      },
    };
    const apple = canonItem({ id: 'a1', name: 'apple' });
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'apple' },
      {
        store: makeStore([apple]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: loggingPort,
      },
    );
    await Promise.resolve();
    expect(written).toHaveLength(1);
    expect(written[0]?.finalDecision).toBe('matched');
    expect(written[0]?.finalItemId).toBe('a1');
    expect(written[0]?.rawInput).toBe('apple');
  });

  it('writes a log entry with schemaVersion 2', async () => {
    const written: MatchLogEntry[] = [];
    const loggingPort: MatchLoggingPort = {
      write: async (e) => {
        written.push(e);
      },
    };
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'Basil' },
      {
        store: makeStore([]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: loggingPort,
      },
    );
    await Promise.resolve();
    expect(written[0]?.schemaVersion).toBe(2);
  });

  it('writes a log entry with finalDecision=created when creating a new item', async () => {
    const written: MatchLogEntry[] = [];
    const loggingPort: MatchLoggingPort = {
      write: async (e) => {
        written.push(e);
      },
    };
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'Basil' },
      {
        store: makeStore([]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: loggingPort,
      },
    );
    await Promise.resolve();
    expect(written[0]?.finalDecision).toBe('created');
  });

  it('records inputItemCount matching the catalog size at call time', async () => {
    const written: MatchLogEntry[] = [];
    const loggingPort: MatchLoggingPort = {
      write: async (e) => {
        written.push(e);
      },
    };
    const items = [canonItem({ id: 'a1', name: 'apple' }), canonItem({ id: 'b1', name: 'banana' })];
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'mango' },
      {
        store: makeStore(items),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: loggingPort,
      },
    );
    await Promise.resolve();
    expect(written[0]?.inputItemCount).toBe(2);
  });

  it('records totalDurationMs as a non-negative number', async () => {
    const written: MatchLogEntry[] = [];
    const loggingPort: MatchLoggingPort = {
      write: async (e) => {
        written.push(e);
      },
    };
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'Basil' },
      {
        store: makeStore([]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: loggingPort,
      },
    );
    await Promise.resolve();
    expect(written[0]?.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('records arbitration log when AI is called for aisle suggestion', async () => {
    const written: MatchLogEntry[] = [];
    const loggingPort: MatchLoggingPort = {
      write: async (e) => {
        written.push(e);
      },
    };
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'Garlic' },
      {
        store: makeStore([]),
        aisleStore: makeAisleStoreWithAisles(),
        embedding: failEmbedding(),
        arbitration: newArbitration('Garlic', 'produce'),
        ids: makeIds(),
        logging: loggingPort,
      },
    );
    await Promise.resolve();
    expect(written[0]?.arbitration).not.toBeNull();
    expect(written[0]?.arbitration?.reason).toBe('aisle_suggestion');
    expect(written[0]?.arbitration?.aislesIn).toBe(1);
    expect(written[0]?.arbitration?.candidatesIn).toBe(0);
    expect(written[0]?.arbitration?.outcome).toBe('new');
  });

  it('records null arbitration when no AI is called', async () => {
    const written: MatchLogEntry[] = [];
    const loggingPort: MatchLoggingPort = {
      write: async (e) => {
        written.push(e);
      },
    };
    const apple = canonItem({ id: 'a1', name: 'apple' });
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'apple' },
      {
        store: makeStore([apple]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: loggingPort,
      },
    );
    await Promise.resolve();
    expect(written[0]?.arbitration).toBeNull();
  });

  it('writes a log entry with finalDecision=matched for a single near-miss above aiThreshold', async () => {
    const written: MatchLogEntry[] = [];
    const loggingPort: MatchLoggingPort = {
      write: async (e) => {
        written.push(e);
      },
    };
    const item = canonItem({ id: 'x1', name: 'olive oil extra' });
    idCounter = 0;
    await matchOrCreate(
      { rawName: 'olive oil' },
      {
        store: makeStore([item]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: loggingPort,
      },
    );
    await Promise.resolve();
    expect(written[0]?.finalDecision).toBe('matched');
    expect(written[0]?.finalItemId).toBe('x1');
  });

  it('does not block the pipeline when the logging port throws', async () => {
    const loggingPort: MatchLoggingPort = {
      write: async () => {
        throw new Error('log write failed');
      },
    };
    idCounter = 0;
    const result = await matchOrCreate(
      { rawName: 'Basil' },
      {
        store: makeStore([]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: loggingPort,
      },
    );
    expect(result.kind).toBe('ok');
  });

  it('skips logging entirely when logging port is null', async () => {
    const writeSpy = vi.fn();
    idCounter = 0;
    const result = await matchOrCreate(
      { rawName: 'Basil' },
      {
        store: makeStore([]),
        aisleStore: makeAisleStore(),
        embedding: failEmbedding(),
        arbitration: noMatchArbitration(),
        ids: makeIds(),
        logging: null,
      },
    );
    expect(result.kind).toBe('ok');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
