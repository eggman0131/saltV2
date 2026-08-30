import { describe, it, expect } from 'vitest';
import type { CanonItem } from '@salt/domain';
import { canonIndex, matchMarkersReady } from '../src/lib/canonIndex.js';

// The index and the gate that `RecipeListPage`, `RecipeViewPage`,
// `IngredientMatchSheet` and `recipeService` each used to declare for themselves
// (issue #1055). Testable here without mounting any of the four.
//
// The gate's truth table is the load-bearing half: two pages must answer it
// identically or the list card counts three problems on a recipe whose rows show
// none (issue #867). The page-level tables in `RecipeListPage.test.ts` and
// `RecipeViewPage.matchMarkers.test.ts` assert that each surface still reaches
// this answer; what is asserted here is the answer itself.

function canon(id: string, name = id): CanonItem {
  return {
    embedding: null,
    id,
    schemaVersion: 5,
    name,
    synonyms: [],
    aisleId: null,
    thumbnail: null,
    needs_approval: false,
    shoppingBehavior: 'needed',
    updatedAt: '2026-08-28T00:00:00.000Z',
  } as CanonItem;
}

describe('canonIndex', () => {
  it('keys every item by its id', () => {
    const lemon = canon('canon-lemon', 'lemon');
    const bay = canon('canon-bay', 'bay leaves');

    const index = canonIndex([lemon, bay]);

    expect(index.size).toBe(2);
    expect(index.get('canon-lemon')).toBe(lemon);
    expect(index.get('canon-bay')).toBe(bay);
  });

  it('is empty for an empty collection, rather than absent', () => {
    // The state every cold load passes through. It must be a real empty map the
    // domain queries can read, not null — the GATE is what decides whether the
    // answer is trustworthy yet, never a missing index.
    const index = canonIndex([]);

    expect(index.size).toBe(0);
    expect(index.get('canon-lemon')).toBeUndefined();
  });

  it('takes the last of a duplicated id, as `new Map` does', () => {
    // Not a rule this function adds — canon ids are Firestore document ids and
    // cannot collide. Pinned because the behaviour is inherited rather than
    // chosen, so a future reimplementation cannot quietly pick the first.
    const first = canon('canon-lemon', 'lemon');
    const second = canon('canon-lemon', 'lemon, unwaxed');

    expect(canonIndex([first, second]).get('canon-lemon')).toBe(second);
  });
});

describe('matchMarkersReady', () => {
  it.each([
    ['everything has landed', false, false, 3, true],
    ['aisles are still loading', true, false, 3, false],
    ['product forms are still loading', false, true, 3, false],
    ['canon has not arrived yet', false, false, 0, false],
    ['nothing has landed at all', true, true, 0, false],
  ])('is %s → %s', (_case, loadingAisles, loadingForms, canonCount, expected) => {
    expect(matchMarkersReady(loadingAisles, loadingForms, canonCount)).toBe(expected);
  });

  it('does not require product forms to exist, only to have finished loading', () => {
    // The deliberate asymmetry: an empty product-form table is a legitimate
    // state, and precisely the one these markers exist to flag (issue #855). A
    // length check here would silence the markers on exactly the data that needs
    // them.
    expect(matchMarkersReady(false, false, 1)).toBe(true);
  });

  it('stays closed on an empty canon even with both flags settled', () => {
    // `isLoadingAisles` starts false, so a surface that never initialises sync
    // would read "loaded" over an empty store and amber the whole library.
    expect(matchMarkersReady(false, false, 0)).toBe(false);
  });
});
