import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import type { Recipe, CanonItem, Ingredient, ShoppingBehavior } from '@salt/domain';

// Buy-or-make at add-to-list (Phase 2). Exercises buildRecipeAddPlan's producer
// flagging + the "make" fan-out in commitRecipeAddPlan.
//
// The recipes store is module-internal singleton state with no test-reset seam,
// so seeded recipes accumulate across tests. Every fixture id is namespaced per
// test (see `nsId` + the beforeEach counter) so any leakage is inert — a leaked
// recipe can never share a canonId with the test currently running.

// ─── Mock firebase-sync ──────────────────────────────────────────────────────
vi.mock('@salt/firebase-sync', () => ({
  subscribeRecipes: vi.fn(() => vi.fn()),
  saveRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  deleteRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  callParseRecipeIngredients: vi.fn(),
  callCanonicaliseRecipeIngredients: vi.fn(),
  saveShoppingListItem: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
}));

vi.mock('@salt/observability', () => ({
  createObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

// ─── Mock canonService ───────────────────────────────────────────────────────
const { mockGetCanonItemsSnapshot } = vi.hoisted(() => ({
  mockGetCanonItemsSnapshot: vi.fn(() => [] as CanonItem[]),
}));
vi.mock('../src/lib/canonService.js', () => ({
  getCanonItemsSnapshot: mockGetCanonItemsSnapshot,
}));

import * as firebaseSync from '@salt/firebase-sync';
import {
  buildRecipeAddPlan,
  commitRecipeAddPlan,
  recipeAddPlanItemCount,
  initRecipeSync,
} from '../src/lib/recipeService.js';

const fs = firebaseSync as Mocked<typeof firebaseSync>;

// Per-test id namespace so the accumulating recipes store can't cross-contaminate.
let ns = 0;
const nsId = (base: string) => `${base}#${ns}`;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function canon(id: string, shoppingBehavior: ShoppingBehavior = 'needed'): CanonItem {
  return {
    id,
    schemaVersion: 5,
    name: id,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    embedding: null,
    needs_approval: false,
    shoppingBehavior,
    updatedAt: '',
  };
}

function ingredient(id: string, item: string, canonId: string | null): Ingredient {
  return {
    id,
    rawText: item,
    parsed:
      canonId !== null
        ? {
            quantity: { type: 'single', value: 100 },
            unit: 'g',
            item,
            preparation: [],
            notes: null,
            displayText: null,
          }
        : null,
    canonId,
    matchState: canonId !== null ? 'matched' : 'pending',
    isOptional: false,
    firstUsedInStepId: null,
  };
}

function recipe(
  id: string,
  opts: {
    title?: string;
    servings?: number;
    producesCanonId?: string | null;
    ingredients?: Ingredient[];
  } = {},
): Recipe {
  return {
    id,
    schemaVersion: 1,
    title: opts.title ?? id,
    description: null,
    ingredients: [{ id: `${id}-grp`, name: null, items: opts.ingredients ?? [] }],
    steps: [],
    metadata: {
      servings: opts.servings ?? 2,
      totalTimeMinutes: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    producesCanonId: opts.producesCanonId ?? null,
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    // Fresh, monotonically-increasing stamp so a re-seed of the same id is never
    // rejected by the store's stale-echo guard.
    updatedAt: new Date().toISOString(),
  };
}

// Seed the in-memory recipes store via the (mocked) subscription seam.
function seedRecipes(list: Recipe[]): void {
  (fs.subscribeRecipes as ReturnType<typeof vi.fn>).mockImplementation(
    (onNext: (r: Recipe[]) => void) => {
      onNext(list);
      return () => {};
    },
  );
  initRecipeSync();
}

function savedItems() {
  return (fs.saveShoppingListItem as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  ns++;
  fs.saveShoppingListItem.mockResolvedValue({ kind: 'ok', value: undefined });
  mockGetCanonItemsSnapshot.mockReturnValue([]);
});

// ─── buildRecipeAddPlan: producer flagging ───────────────────────────────────

describe('buildRecipeAddPlan — buy-or-make flagging', () => {
  it('flags a row whose ingredient canonId has a producing recipe', () => {
    const canonMayo = nsId('canon-mayo');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    seedRecipes([recipe(nsId('r-mayo'), { title: 'Homemade Mayo', producesCanonId: canonMayo })]);

    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    const rows = buildRecipeAddPlan(parent, 2);

    expect(rows[0].producers.map((r) => r.id)).toEqual([nsId('r-mayo')]);
    expect(rows[0].make).toBe(false); // default buy
    expect(rows[0].producerId).toBe(nsId('r-mayo'));
  });

  it('shows no producer for an ingredient nobody makes', () => {
    const canonSalt = nsId('canon-salt');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonSalt)]);
    seedRecipes([recipe(nsId('r-mayo'), { producesCanonId: nsId('canon-mayo') })]);

    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-salt', 'salt', canonSalt)],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    expect(rows[0].producers).toEqual([]);
    expect(rows[0].producerId).toBeNull();
  });

  it('excludes the recipe being added from its own producer candidates', () => {
    const canonMayo = nsId('canon-mayo');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    const other = recipe(nsId('r-other-mayo'), { producesCanonId: canonMayo });
    // The parent both produces canonMayo AND lists a canonMayo ingredient.
    const parent = recipe(nsId('r-self'), {
      producesCanonId: canonMayo,
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    seedRecipes([parent, other]);

    const rows = buildRecipeAddPlan(parent, 2);
    expect(rows[0].producers.map((r) => r.id)).toEqual([nsId('r-other-mayo')]);
  });

  it('lists every candidate when more than one recipe produces the item', () => {
    const canonMayo = nsId('canon-mayo');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    seedRecipes([
      recipe(nsId('r-mayo-a'), { producesCanonId: canonMayo }),
      recipe(nsId('r-mayo-b'), { producesCanonId: canonMayo }),
    ]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    expect(rows[0].producers.map((r) => r.id)).toEqual([nsId('r-mayo-a'), nsId('r-mayo-b')]);
    expect(rows[0].producerId).toBe(nsId('r-mayo-a')); // seeded to first candidate
  });
});

// ─── commitRecipeAddPlan: make fan-out ───────────────────────────────────────

describe('commitRecipeAddPlan — make fan-out', () => {
  it('Buy (default) adds the single item, not the producer ingredients', async () => {
    const canonMayo = nsId('canon-mayo');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    seedRecipes([
      recipe(nsId('r-mayo'), {
        producesCanonId: canonMayo,
        ingredients: [ingredient('m-egg', 'egg yolk', nsId('canon-egg'))],
      }),
    ]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    const rows = buildRecipeAddPlan(parent, 2); // make stays false

    await commitRecipeAddPlan(parent, 'list-1', 2, rows);
    const items = savedItems();
    expect(items).toHaveLength(1);
    expect(items[0].rawText).toBe('mayonnaise');
    expect(items[0].canonId).toBe(canonMayo);
  });

  it('Make fans out the producer ingredients at its base servings with the producer SourceRef', async () => {
    const canonMayo = nsId('canon-mayo');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    const mayo = recipe(nsId('r-mayo'), {
      title: 'Homemade Mayo',
      servings: 4,
      producesCanonId: canonMayo,
      ingredients: [
        ingredient('m-egg', 'egg yolk', nsId('canon-egg')),
        ingredient('m-oil', 'oil', nsId('canon-oil')),
      ],
    });
    seedRecipes([mayo]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    rows[0].make = true; // user chose "Make"

    const result = await commitRecipeAddPlan(parent, 'list-1', 2, rows);
    expect(result).toEqual({ kind: 'ok', value: undefined });

    const items = savedItems();
    // The single mayo item is NOT written; the producer's ingredients are.
    expect(items.map((i) => i.rawText).sort()).toEqual(['egg yolk', 'oil']);
    expect(items.some((i) => i.rawText === 'mayonnaise')).toBe(false);
    // Every fanned-out item carries the producer's SourceRef at its base servings.
    for (const item of items) {
      expect(item.sources).toEqual([
        { kind: 'recipe', recipeId: nsId('r-mayo'), servings: 4, label: 'Homemade Mayo' },
      ]);
    }
  });

  it('is one level deep — a producer ingredient that itself has a producer is added plain, not expanded', async () => {
    const canonMayo = nsId('canon-mayo');
    const canonEgg = nsId('canon-egg');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    const eggProducer = recipe(nsId('r-egg'), {
      producesCanonId: canonEgg,
      ingredients: [ingredient('e-hen', 'a whole hen', nsId('canon-hen'))],
    });
    const mayo = recipe(nsId('r-mayo'), {
      producesCanonId: canonMayo,
      ingredients: [ingredient('m-egg', 'egg yolk', canonEgg)],
    });
    seedRecipes([mayo, eggProducer]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    rows[0].make = true;

    await commitRecipeAddPlan(parent, 'list-1', 2, rows);
    const items = savedItems();
    // The egg (a producer ingredient) is added as a plain item; the hen (its
    // producer's ingredient) is NOT — recursion stops after one level.
    expect(items.map((i) => i.rawText)).toEqual(['egg yolk']);
    expect(items.some((i) => i.rawText === 'a whole hen')).toBe(false);
  });

  it('mixes a made row with a normal bought row in the same commit', async () => {
    const canonMayo = nsId('canon-mayo');
    const canonSalt = nsId('canon-salt');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo), canon(canonSalt)]);
    seedRecipes([
      recipe(nsId('r-mayo'), {
        producesCanonId: canonMayo,
        ingredients: [ingredient('m-egg', 'egg yolk', nsId('canon-egg'))],
      }),
    ]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [
        ingredient('i-mayo', 'mayonnaise', canonMayo),
        ingredient('i-salt', 'salt', canonSalt),
      ],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    const mayoRow = rows.find((r) => r.ingredientId === 'i-mayo')!;
    mayoRow.make = true;

    await commitRecipeAddPlan(parent, 'list-1', 2, rows);
    const items = savedItems();
    // egg yolk from the fan-out + salt bought directly; no single "mayonnaise".
    expect(items.map((i) => i.rawText).sort()).toEqual(['egg yolk', 'salt']);
    const salt = items.find((i) => i.rawText === 'salt')!;
    expect(salt.sources[0]).toMatchObject({ kind: 'recipe', recipeId: nsId('r-salad') });
  });
});

// ─── recipeAddPlanItemCount: preview count matches the committed write ─────────
// The review sheet's "Add N to list" footer uses this; a Make row must count the
// producer's fanned-out ingredients, not 1, so the preview matches what commit
// actually writes.

describe('recipeAddPlanItemCount — footer preview count', () => {
  it('counts a Buy row as 1', () => {
    const canonMayo = nsId('canon-mayo');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    seedRecipes([
      recipe(nsId('r-mayo'), {
        producesCanonId: canonMayo,
        ingredients: [ingredient('m-egg', 'egg yolk', nsId('canon-egg'))],
      }),
    ]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    const rows = buildRecipeAddPlan(parent, 2); // make stays false → Buy
    expect(recipeAddPlanItemCount(rows)).toBe(1);
  });

  it('counts a Make row as the producer fan-out size, and matches the committed write', async () => {
    const canonMayo = nsId('canon-mayo');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    seedRecipes([
      recipe(nsId('r-mayo'), {
        producesCanonId: canonMayo,
        ingredients: [
          ingredient('m-egg', 'egg yolk', nsId('canon-egg')),
          ingredient('m-oil', 'oil', nsId('canon-oil')),
        ],
      }),
    ]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    rows[0].make = true; // user chose "Make"

    // Preview: the two producer ingredients, not the single mayo row.
    expect(recipeAddPlanItemCount(rows)).toBe(2);

    // …and it equals what commit actually writes.
    await commitRecipeAddPlan(parent, 'list-1', 2, rows);
    expect(savedItems()).toHaveLength(recipeAddPlanItemCount(rows));
  });

  it('sums a Make row and a Buy row', () => {
    const canonMayo = nsId('canon-mayo');
    const canonSalt = nsId('canon-salt');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo), canon(canonSalt)]);
    seedRecipes([
      recipe(nsId('r-mayo'), {
        producesCanonId: canonMayo,
        ingredients: [
          ingredient('m-egg', 'egg yolk', nsId('canon-egg')),
          ingredient('m-oil', 'oil', nsId('canon-oil')),
        ],
      }),
    ]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [
        ingredient('i-mayo', 'mayonnaise', canonMayo),
        ingredient('i-salt', 'salt', canonSalt),
      ],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    rows.find((r) => r.ingredientId === 'i-mayo')!.make = true; // 2 from fan-out
    // + 1 for the salt Buy row = 3.
    expect(recipeAddPlanItemCount(rows)).toBe(3);
  });

  it('excludes rows the user removed (add:false)', () => {
    const canonSalt = nsId('canon-salt');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonSalt)]);
    seedRecipes([]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-salt', 'salt', canonSalt)],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    rows[0].add = false;
    expect(recipeAddPlanItemCount(rows)).toBe(0);
  });

  it('resolves an unknown producerId back to the first candidate (matches commit)', async () => {
    const canonMayo = nsId('canon-mayo');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    seedRecipes([
      recipe(nsId('r-mayo'), {
        producesCanonId: canonMayo,
        ingredients: [ingredient('m-egg', 'egg yolk', nsId('canon-egg'))],
      }),
    ]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    rows[0].make = true;
    rows[0].producerId = 'does-not-exist'; // find() misses → falls back to producers[0]
    // producers[0] (r-mayo) fans out one ingredient → 1, same as commit does.
    expect(recipeAddPlanItemCount(rows)).toBe(1);
    await commitRecipeAddPlan(parent, 'list-1', 2, rows);
    expect(savedItems()).toHaveLength(recipeAddPlanItemCount(rows));
  });

  it('counts a Make row with an empty-fan-out producer as 0 (matches commit)', () => {
    const canonMayo = nsId('canon-mayo');
    mockGetCanonItemsSnapshot.mockReturnValue([canon(canonMayo)]);
    // Producer exists but lists no ingredients, so the fan-out writes nothing.
    seedRecipes([recipe(nsId('r-mayo'), { producesCanonId: canonMayo })]);
    const parent = recipe(nsId('r-salad'), {
      ingredients: [ingredient('i-mayo', 'mayonnaise', canonMayo)],
    });
    const rows = buildRecipeAddPlan(parent, 2);
    rows[0].make = true;
    expect(recipeAddPlanItemCount(rows)).toBe(0);
  });
});
