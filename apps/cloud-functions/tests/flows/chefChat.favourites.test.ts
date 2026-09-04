/**
 * Household taste context for the chef (issue #726, Phase 2).
 *
 * The chef learns what this household buys from the tick-off counts Phase 1
 * captures, so "give us something a bit different" can mean *different from what
 * we usually cook*. Two things carry the feature and are pinned here:
 *
 *  - PANTRY STAPLES ARE EXCLUDED. Milk, flour and black pepper are the
 *    most-bought things in any household and say nothing about what anyone
 *    enjoys; letting them to the top would make the whole signal worthless.
 *  - IT DEGRADES TO SILENCE. With no counts document, an empty one, or any
 *    failure at all, the section is omitted entirely and chat behaves exactly as
 *    it did before this existed. Taste context is an enhancement, never a
 *    dependency.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWarn = vi.fn();
vi.mock('firebase-functions', () => ({
  logger: { warn: mockWarn, info: vi.fn(), error: vi.fn() },
}));

// chefChat.ts pulls in Genkit at module scope; stub it so importing the module
// costs nothing. The flow itself is not under test here.
vi.mock('../../src/genkit.js', () => ({
  ai: {
    defineFlow: (_config: unknown, handler: unknown) => handler,
    // chefChat defines its findRecipes tool at module load (issue #840); the
    // identity stub keeps importing the module free for tests that are not about it.
    defineTool: (_config: unknown, handler: unknown) => handler,
  },
}));
vi.mock('../../src/ai/fakeModel.js', () => ({ flowModel: vi.fn(async () => 'fake-model') }));

const { readFavouritesContext } = await import('../../src/flows/chefChat.js');

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Firestore stub ───────────────────────────────────────────────────────────

type Canon = { name: string; shoppingBehavior: 'stocked' | 'check' | 'needed' };

function canonDoc(id: string, c: Canon) {
  return {
    id,
    schemaVersion: 5,
    name: c.name,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    needs_approval: false,
    shoppingBehavior: c.shoppingBehavior,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/**
 * A Firestore stub: `canonData/purchaseCounts` resolves to `countsDoc` (undefined
 * = absent), and getAll resolves each requested canon id against `canon`.
 */
function dbWith(
  countsDoc: unknown | undefined,
  canon: Record<string, Canon | 'corrupt'> = {},
): never {
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        _path: `${name}/${id}`,
        id,
        get: () =>
          Promise.resolve(
            countsDoc === undefined
              ? { exists: false, data: () => undefined }
              : { exists: true, data: () => countsDoc },
          ),
      }),
    }),
    getAll: (...refs: { id: string }[]) =>
      Promise.resolve(
        refs.map((ref) => {
          const entry = canon[ref.id];
          if (entry === undefined) return { id: ref.id, exists: false, data: () => undefined };
          if (entry === 'corrupt')
            return { id: ref.id, exists: true, data: () => ({ nonsense: true }) };
          return { id: ref.id, exists: true, data: () => canonDoc(ref.id, entry) };
        }),
      ),
  };
  return db as never;
}

const needed = (name: string): Canon => ({ name, shoppingBehavior: 'needed' });
const stocked = (name: string): Canon => ({ name, shoppingBehavior: 'stocked' });

/** The rendered bullet names, in order. */
function names(section: string): string[] {
  return section
    .split('\n')
    .filter((l) => l.startsWith('- ') && !l.includes('When they ask'))
    .map((l) => l.slice(2));
}

// ─── Degrading to silence ─────────────────────────────────────────────────────

describe('readFavouritesContext — no signal', () => {
  it('returns nothing when the counts document does not exist', async () => {
    await expect(readFavouritesContext(dbWith(undefined))).resolves.toBe('');
  });

  it('returns nothing when the counts document is empty', async () => {
    await expect(readFavouritesContext(dbWith({ counts: {}, lastAt: {} }))).resolves.toBe('');
  });

  it('returns nothing when every counted item has since been deleted from canon', async () => {
    const section = await readFavouritesContext(dbWith({ counts: { 'c-gone': 9 } }, {}));
    expect(section).toBe('');
  });

  it('returns nothing when every counted item is a pantry staple', async () => {
    const section = await readFavouritesContext(
      dbWith(
        { counts: { 'c-milk': 40, 'c-flour': 30 } },
        {
          'c-milk': stocked('semi-skimmed milk'),
          'c-flour': stocked('plain flour'),
        },
      ),
    );
    expect(section).toBe('');
  });

  it('returns nothing, and warns, when the counts document is malformed', async () => {
    const section = await readFavouritesContext(dbWith({ counts: { 'c-onion': 'lots' } }));
    expect(section).toBe('');
    expect(mockWarn).toHaveBeenCalled();
  });

  it('returns nothing, and warns, rather than throwing when Firestore fails', async () => {
    const db = {
      collection: () => ({ doc: () => ({ get: () => Promise.reject(new Error('boom')) }) }),
    } as never;

    await expect(readFavouritesContext(db)).resolves.toBe('');
    expect(mockWarn).toHaveBeenCalled();
  });
});

// ─── The staple filter ────────────────────────────────────────────────────────

describe('readFavouritesContext — staple filter', () => {
  it('drops staples and keeps the taste signal, even when the staples are bought far more', async () => {
    const section = await readFavouritesContext(
      dbWith(
        {
          counts: { 'c-milk': 90, 'c-pepper': 80, 'c-flour': 70, 'c-lamb': 6, 'c-halloumi': 4 },
        },
        {
          'c-milk': stocked('semi-skimmed milk'),
          'c-pepper': stocked('black pepper'),
          'c-flour': stocked('plain flour'),
          'c-lamb': needed('lamb shoulder'),
          'c-halloumi': needed('halloumi'),
        },
      ),
    );

    // The three staples outrank both keepers by an order of magnitude and are
    // still absent — the filter runs before the ranking is handed over.
    expect(names(section)).toEqual(['lamb shoulder', 'halloumi']);
  });

  it("keeps 'check' items — only 'stocked' means pantry", async () => {
    const section = await readFavouritesContext(
      dbWith(
        { counts: { 'c-toms': 5 } },
        {
          'c-toms': { name: 'tinned tomatoes', shoppingBehavior: 'check' },
        },
      ),
    );

    expect(names(section)).toEqual(['tinned tomatoes']);
  });

  it('skips a canon item that fails validation without losing the rest', async () => {
    const section = await readFavouritesContext(
      dbWith(
        { counts: { 'c-bad': 9, 'c-lamb': 5 } },
        {
          'c-bad': 'corrupt',
          'c-lamb': needed('lamb shoulder'),
        },
      ),
    );

    expect(names(section)).toEqual(['lamb shoulder']);
  });
});

// ─── Ranking and rendering ────────────────────────────────────────────────────

describe('readFavouritesContext — ranking and rendering', () => {
  it('orders most-bought first', async () => {
    const section = await readFavouritesContext(
      dbWith(
        { counts: { 'c-a': 2, 'c-b': 30, 'c-c': 11 } },
        {
          'c-a': needed('anchovies'),
          'c-b': needed('chicken thighs'),
          'c-c': needed('chorizo'),
        },
      ),
    );

    expect(names(section)).toEqual(['chicken thighs', 'chorizo', 'anchovies']);
  });

  it('ignores a zero count', async () => {
    const section = await readFavouritesContext(
      dbWith(
        { counts: { 'c-lamb': 3, 'c-never': 0 } },
        {
          'c-lamb': needed('lamb shoulder'),
          'c-never': needed('okra'),
        },
      ),
    );

    expect(names(section)).toEqual(['lamb shoulder']);
  });

  it('caps the list rather than handing over the whole history', async () => {
    const counts: Record<string, number> = {};
    const canon: Record<string, Canon> = {};
    for (let i = 0; i < 60; i++) {
      counts[`c-${i}`] = 100 - i;
      canon[`c-${i}`] = needed(`ingredient ${i}`);
    }

    const section = await readFavouritesContext(dbWith({ counts }, canon));

    expect(names(section)).toHaveLength(25);
    expect(names(section)[0]).toBe('ingredient 0');
  });

  it('tells the chef to steer both ways, and never to mention the list', async () => {
    const section = await readFavouritesContext(
      dbWith({ counts: { 'c-lamb': 3 } }, { 'c-lamb': needed('lamb shoulder') }),
    );

    expect(section).toContain('DIFFERENT');
    expect(section).toContain('FAMILIAR');
    expect(section).toContain('ignore it entirely');
    expect(section).toContain('Never mention this list');
  });
});
