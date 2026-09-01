import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, waitFor } from '@testing-library/svelte';
import type { Recipe } from '@salt/domain';
import type { KitchenToolDoc } from '@salt/domain/schemas';

// The Equipment tab (issue #882's "You'll need" strip, moved into a third tab by
// #1140). The property under test is the one the whole design rests on: the recipe
// stores WORDS, and the picture is looked up from those words at render time. A
// label the drawn vocabulary does not know renders its words with NO picture —
// never a near match, never a generic tile — which is what lets the vocabulary grow
// later without a recipe being rewritten, and what makes the icon kill-switch cost
// pictures and nothing else. The move changed the container and the test ids
// (`recipe-kit-list` / `recipe-kit-row`); it changed none of that contract.

const {
  mockRecipes,
  mockCanonItems,
  mockGuidedPlan,
  mockFormula,
  mockIsLoading,
  mockDefaultListId,
  mockSessions,
  mockEquipment,
  mockEquipmentIcons,
  toolSink,
} = await vi.hoisted(async () => {
  const { makeStore } = await import('./support/testStore.js');
  return {
    mockRecipes: makeStore<readonly Recipe[]>([]),
    mockCanonItems: makeStore<readonly { id: string }[]>([]),
    mockGuidedPlan: makeStore<unknown>(null),
    mockFormula: makeStore<unknown>(null),
    mockIsLoading: makeStore<boolean>(false),
    mockDefaultListId: makeStore<string | null>('list-1'),
    mockSessions: makeStore<readonly unknown[]>([]),
    // `accessories` is optional here (unlike the real `EquipmentItem`) because
    // most cases in this file never need one; `resolveEquipmentItem` treats a
    // missing array the same as an empty one.
    mockEquipment: makeStore<{
      items: readonly {
        id: string;
        name: string;
        accessories?: readonly { id: string; name: string; owned: boolean; included: boolean }[];
      }[];
    } | null>({
      items: [{ id: 'eq-pizzaiolo', name: 'Sage Pizzaiolo' }],
    }),
    // The equipment pictograms the strip prefers over the tool vocabulary (issue
    // #954), keyed by item id exactly as `equipmentIcons` is.
    mockEquipmentIcons: makeStore<Map<string, { thumbnail: string | null }>>(new Map()),
    // The REAL kitchenToolService is used — nothing about the lookup is
    // re-implemented here, because the lookup is what is under test. This is only
    // the seam its subscription reads from: `initKitchenToolSync` hands its
    // callback over, and the test pushes a vocabulary through it.
    toolSink: { push: null as null | ((tools: readonly unknown[]) => void) },
  };
});

vi.mock('svelte-spa-router', () => ({ push: vi.fn() }));
vi.mock('../src/lib/toastStore.js', () => ({ addToast: vi.fn() }));
vi.mock('../src/lib/auth.svelte.js', () => ({
  auth: { user: { uid: 'uid-1', email: 'cook@test' } },
}));
vi.mock('../src/lib/canonService.js', () => ({
  canonItems: mockCanonItems,
  isLoadingAisles: {
    subscribe(fn: (v: boolean) => void) {
      fn(false);
      return () => {};
    },
  },
}));
vi.mock('../src/lib/productFormService.js', () => {
  const loaded = <T>(v: T) => ({
    subscribe(fn: (x: T) => void) {
      fn(v);
      return () => {};
    },
  });
  return { productForms: loaded([]), isLoadingProductForms: loaded(false) };
});
vi.mock('../src/lib/guidedPlanService.js', () => ({
  guidedPlan: mockGuidedPlan,
  initGuidedPlanSync: vi.fn(() => () => {}),
}));
vi.mock('../src/lib/formulaService.js', () => ({
  formula: mockFormula,
  initFormulaSync: vi.fn(() => () => {}),
}));
vi.mock('../src/lib/shoppingListService.svelte.js', () => ({ defaultListId: mockDefaultListId }));
vi.mock('@salt/firebase-sync', () => ({
  saveRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  // The one seam the kitchen-tool vocabulary arrives through. Everything above it
  // — `resolveKitchenTool`, the renderable tri-state, the cache-bust nonce, the
  // derived store — is the real code, which is the point: this file proves the
  // strip against the SHARED lookup, not against a second copy of its rules.
  subscribeKitchenTools: vi.fn((onTools: (tools: readonly unknown[]) => void) => {
    toolSink.push = onTools;
    return () => {};
  }),
}));
vi.mock('../src/lib/chatService.js', () => ({
  sessions: mockSessions,
  createChatSession: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock('../src/lib/equipmentService.js', () => ({
  equipment: mockEquipment,
  equipmentIcons: mockEquipmentIcons,
}));
vi.mock('../src/lib/clipboardImage.js', () => ({
  clipboardImageReadSupported: () => false,
  readClipboardImage: vi.fn(),
  imageFromClipboardData: vi.fn(),
}));
vi.mock('../src/lib/recipeService.js', () => ({
  recipes: mockRecipes,
  isLoadingRecipes: mockIsLoading,
  removeRecipe: vi.fn(),
  canonicaliseIngredients: vi.fn(),
  matchIngredient: vi.fn(),
  persistRecipe: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  stashImportedDraft: vi.fn(),
  authorRecipeTraced: vi.fn(),
  regenerateRecipeImage: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  redoRecipeKit: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  reviseRecipeSceneBrief: vi.fn(),
  startOverRecipeSceneBrief: vi.fn(),
  setRecipeImageUpload: vi.fn().mockResolvedValue({ kind: 'ok', value: undefined }),
  buildRecipeAddPlan: vi.fn().mockReturnValue([]),
  buildMadeSubRows: vi.fn().mockReturnValue([]),
  commitRecipeAddPlan: vi.fn(),
  recipeAddPlanItemCount: vi.fn().mockReturnValue(0),
}));

import {
  initKitchenToolSync,
  __resetKitchenToolServiceForTest,
} from '../src/lib/kitchenToolService.js';
import RecipeViewPage from '../src/routes/recipes/RecipeViewPage.svelte';

// Push a vocabulary in through the real subscription seam.
function setTools(tools: readonly KitchenToolDoc[]): void {
  toolSink.push?.(tools);
}

const RECIPE_ID = 'entry-1';

function makeEntry(overrides: Partial<Recipe> = {}): Recipe {
  return {
    lastEditedBy: '',
    createdBy: '',
    id: RECIPE_ID,
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Champ',
    description: null,
    ingredients: [],
    steps: [{ id: 'step-1', text: 'Mash the potatoes.', note: null, timer: null }],
    metadata: {
      servings: 4,
      prepTimeMinutes: 10,
      cookTimeMinutes: 20,
      totalTimeMinutes: 30,
      tags: [],
    },
    source: null,
    notes: null,
    producesCanonId: null,
    componentRecipeIds: [],
    kit: [],
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function tool(over: Partial<KitchenToolDoc> & { id: string; label: string }): KitchenToolDoc {
  return {
    schemaVersion: 1,
    matchers: [],
    thumbnail: 'https://example.com/kit/pan.webp',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as KitchenToolDoc;
}

afterEach(() => {
  cleanup();
  __resetKitchenToolServiceForTest();
  toolSink.push = null;
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.innerHTML = '';
});

beforeEach(() => {
  vi.clearAllMocks();
  mockCanonItems._set([]);
  mockIsLoading._set(false);
  mockRecipes._set([]);
  mockGuidedPlan._set(null);
  mockFormula._set(null);
  mockEquipment._set({ items: [{ id: 'eq-pizzaiolo', name: 'Sage Pizzaiolo' }] });
  mockEquipmentIcons._set(new Map());
  // The app subscribes once, in App.svelte; this is that subscription, so the
  // strip reads the vocabulary exactly as it does in the running app.
  initKitchenToolSync();
});

function renderPage() {
  return render(RecipeViewPage, { props: { params: { id: RECIPE_ID } } });
}

/** Every line in the Equipment panel, head rows and accessory rows alike, in order. */
function kitLabels(): string[] {
  return screen
    .queryAllByTestId(/^recipe-kit-(row|accessory-row)$/)
    .map((el) => el.textContent?.trim() ?? '');
}

/** The tab strip's labels, with the `count` the trigger appends stripped off. */
function tabNames(): string[] {
  return screen
    .queryAllByRole('tab')
    .map((el) => (el.textContent ?? '').replace(/\d+\s*$/, '').trim());
}

describe('RecipeViewPage — the Equipment tab', () => {
  it('shows no Equipment tab or panel at all when the recipe has no kit', () => {
    // A panel headed "Equipment" over nothing reads as a recipe that failed rather
    // than one nobody has asked about yet — the same reasoning the body tab strip
    // already uses for a kind with no ingredients.
    mockRecipes._set([makeEntry()]);
    renderPage();

    expect(screen.queryByTestId('recipe-kit-list')).toBeNull();
    expect(tabNames()).toEqual(['Ingredients', 'Method']);
  });

  it('offers Equipment as a third tab, counting its rows', () => {
    mockRecipes._set([
      makeEntry({
        kit: [
          { label: 'large saucepan', stepIds: ['step-1'] },
          { label: 'colander', stepIds: ['step-1'] },
        ],
      }),
    ]);
    renderPage();

    expect(tabNames()).toEqual(['Ingredients', 'Method', 'Equipment']);
    // The count is the `TabsTrigger` prop (ui-spec-v10 §8.28.4), rendered inside
    // the button so it joins the tab's accessible name — not text this page
    // interpolates into the label itself.
    const equipmentTab = screen.getAllByRole('tab')[2]!;
    expect(equipmentTab.textContent).toContain('2');
  });

  it('lists every piece of kit, in stored order', () => {
    mockRecipes._set([
      makeEntry({
        kit: [
          { label: 'large saucepan', stepIds: ['step-1'] },
          { label: 'colander', stepIds: ['step-1'] },
          { label: 'potato masher', stepIds: ['step-1'] },
        ],
      }),
    ]);
    renderPage();

    expect(kitLabels()).toEqual(['large saucepan', 'colander', 'potato masher']);
  });

  it('draws the picture the LABEL resolves to, cache-busted', () => {
    setTools([
      tool({
        id: 'saucepan',
        label: 'large saucepan',
        thumbnail: 'https://example.com/kit/saucepan.webp',
        updatedAt: '2026-02-02T00:00:00.000Z',
      }),
    ]);
    mockRecipes._set([makeEntry({ kit: [{ label: 'large saucepan', stepIds: [] }] })]);
    renderPage();

    const img = screen.getByTestId('canon-icon-img');
    expect(img).toHaveAttribute(
      'src',
      'https://example.com/kit/saucepan.webp?v=2026-02-02T00:00:00.000Z',
    );
    // Nothing on the recipe named the tool by id — the words did all the work.
    expect(kitLabels()).toEqual(['large saucepan']);
  });

  it('renders an unresolved label as words with NO picture', () => {
    // The vocabulary knows a saucepan and nothing else. A tagine is still real kit
    // and still reads correctly; it simply has no drawing yet. Substituting the
    // saucepan's picture here would be a confident lie.
    setTools([tool({ id: 'saucepan', label: 'saucepan' })]);
    mockRecipes._set([makeEntry({ kit: [{ label: 'tagine', stepIds: [] }] })]);
    renderPage();

    expect(kitLabels()).toEqual(['tagine']);
    expect(screen.queryByTestId('canon-icon')).toBeNull();
  });

  it('renders words with no picture when the vocabulary has not loaded yet', () => {
    // A cold load paints before the tools land, and the strip must be readable in
    // that window rather than a row of empty tiles. The lookup is a derived STORE
    // precisely so the pictures fill in when they arrive.
    mockRecipes._set([makeEntry({ kit: [{ label: 'large saucepan', stepIds: [] }] })]);
    renderPage();

    expect(kitLabels()).toEqual(['large saucepan']);
    expect(screen.queryByTestId('canon-icon')).toBeNull();
  });

  it('renders words with no picture when a tool has no drawing (or the user hid it)', () => {
    // The other two non-drawing states of the icon tri-state, which is why the
    // shared lookup folds them together: turning icon generation off costs the
    // pictures and leaves the strip intact.
    setTools([
      tool({ id: 'saucepan', label: 'large saucepan', thumbnail: null }),
      tool({ id: 'grater', label: 'box grater', thumbnail: 'hidden' }),
    ]);
    mockRecipes._set([
      makeEntry({
        kit: [
          { label: 'large saucepan', stepIds: [] },
          { label: 'box grater', stepIds: [] },
        ],
      }),
    ]);
    renderPage();

    expect(kitLabels()).toEqual(['large saucepan', 'box grater']);
    expect(screen.queryByTestId('canon-icon')).toBeNull();
  });

  it('draws the pictogram at 40px, the in-list size (issue #955)', () => {
    // The defect this pins: the strip drew the tile at 18px inside a `fact` chip,
    // and the framing normalisation (`contentMax: 108`, ~52% of the box height for
    // a landscape tool) turned that into ~15 × 9 px of frying pan — smaller than
    // the words beside it. 40px is ui-spec-v04 §14.6.1's size for every in-list
    // pictogram, and the list this became in #1140 is exactly the surface that
    // size is for — the same tile the ingredients beside it draw.
    setTools([
      tool({
        id: 'frying-pan',
        label: 'large frying pan',
        thumbnail: 'https://example.com/kit/pan.webp',
      }),
    ]);
    mockRecipes._set([makeEntry({ kit: [{ label: 'large frying pan', stepIds: [] }] })]);
    renderPage();

    const strip = screen.getByTestId('recipe-kit-list');
    const tile = within(strip).getByTestId('canon-icon');
    expect(tile.getAttribute('style')).toContain('width: 40px');
    expect(tile.getAttribute('style')).toContain('height: 40px');
  });

  it('draws the OWNED item\u2019s picture, not the generic tool\u2019s (issue #954)', () => {
    // The ordering that carries the whole fix, exercised against the REAL
    // manifest shape: "Cocotte Slow Cook Pot" is an ACCESSORY of the Magimix
    // Cook Expert, not an item of its own -- that is how `equipmentManifest`
    // actually stores it (confirmed against staging). The kit flow writes the
    // owning item's leading word alongside the accessory's name, so the label is
    // "Magimix Cocotte Slow Cook Pot" -- which contains the token "pot", so
    // `resolveKitchenTool` would resolve it to the generic saucepan: a specific
    // label losing its own picture to a vague one, exactly what the strip exists
    // to prevent. Equipment is tried FIRST, and an accessory match resolves to
    // the OWNING item's picture (an accessory has no icon of its own --
    // `equipmentIcons` is keyed by item id).
    mockEquipment._set({
      items: [
        {
          id: 'eq-magimix',
          name: 'Magimix Cook Expert',
          accessories: [
            { id: 'acc-cocotte', name: 'Cocotte Slow Cook Pot', owned: true, included: false },
          ],
        },
        { id: 'eq-pizzaiolo', name: 'Sage Pizzaiolo' },
      ],
    });
    mockEquipmentIcons._set(
      new Map([['eq-magimix', { thumbnail: 'https://example.com/eq/magimix.webp' }]]),
    );
    setTools([
      tool({
        id: 'saucepan',
        label: 'pot',
        thumbnail: 'https://example.com/kit/saucepan.webp',
      }),
    ]);
    mockRecipes._set([
      makeEntry({ kit: [{ label: 'Magimix Cocotte Slow Cook Pot', stepIds: [] }] }),
    ]);
    renderPage();

    expect(screen.getByTestId('canon-icon-img')).toHaveAttribute(
      'src',
      'https://example.com/eq/magimix.webp',
    );
    expect(kitLabels()).toEqual(['Magimix Cocotte Slow Cook Pot']);
  });

  it('still draws the tool pictogram for a generic label', () => {
    // The other half of the contract: naming which appliance must not cost the
    // ordinary kit its pictures. "large frying pan" names nothing in the manifest
    // and falls straight through to the curated vocabulary.
    mockEquipment._set({
      items: [{ id: 'eq-magimix', name: 'Magimix Cook Expert' }],
    });
    mockEquipmentIcons._set(
      new Map([['eq-magimix', { thumbnail: 'https://example.com/eq/magimix.webp' }]]),
    );
    setTools([
      tool({
        id: 'frying-pan',
        label: 'large frying pan',
        thumbnail: 'https://example.com/kit/pan.webp',
        updatedAt: '2026-02-02T00:00:00.000Z',
      }),
    ]);
    mockRecipes._set([makeEntry({ kit: [{ label: 'large frying pan', stepIds: [] }] })]);
    renderPage();

    expect(screen.getByTestId('canon-icon-img')).toHaveAttribute(
      'src',
      'https://example.com/kit/pan.webp?v=2026-02-02T00:00:00.000Z',
    );
  });

  it('shows no tile -- never the tool vocabulary\u2019s picture -- when the owned item has no drawing yet (issue #954)', () => {
    // `equipmentIcons` generation is edge-triggered, so an item can be in the
    // manifest with nothing drawn for it: staging has 15 of its 20 equipment
    // icons at `thumbnail: null` today, including BOTH owned mandolines. Once the
    // label resolves to an owned item, that resolution is authoritative --
    // falling through to `resolveKitchenTool` would draw a DIFFERENT object's
    // picture (the generic mandoline) under this item's name, exactly the defect
    // #954 opened on. The correct degrade is words with no picture -- the same
    // graceful miss #882 established -- not a borrowed tool drawing. (This test
    // used to pin the wrong contract: it asserted the tool picture WAS shown.)
    mockEquipment._set({ items: [{ id: 'eq-oxo', name: 'OXO Mandoline' }] });
    mockEquipmentIcons._set(new Map([['eq-oxo', { thumbnail: null }]]));
    setTools([
      tool({
        id: 'mandoline',
        label: 'mandoline',
        thumbnail: 'https://example.com/kit/mandoline.webp',
        updatedAt: '2026-02-02T00:00:00.000Z',
      }),
    ]);
    mockRecipes._set([makeEntry({ kit: [{ label: 'OXO Mandoline', stepIds: [] }] })]);
    renderPage();

    expect(kitLabels()).toEqual(['OXO Mandoline']);
    expect(screen.queryByTestId('canon-icon')).toBeNull();
  });

  it('renders words with no picture when neither vocabulary knows the label', () => {
    // The #882 graceful-miss contract, unchanged by the second vocabulary: a label
    // nothing matches never borrows another item's picture.
    mockEquipment._set({ items: [{ id: 'eq-magimix', name: 'Magimix Cook Expert' }] });
    mockEquipmentIcons._set(
      new Map([['eq-magimix', { thumbnail: 'https://example.com/eq/magimix.webp' }]]),
    );
    setTools([tool({ id: 'saucepan', label: 'saucepan' })]);
    mockRecipes._set([makeEntry({ kit: [{ label: 'tagine', stepIds: [] }] })]);
    renderPage();

    expect(kitLabels()).toEqual(['tagine']);
    expect(screen.queryByTestId('canon-icon')).toBeNull();
  });

  it('renders each entry as a plain list row — read, not pressed', () => {
    // Carried across from the `PictogramPill` this replaced (ui-spec-v12 §8.30.6,
    // itself carrying ui-spec-v09 §8.23.8): the row is an `<li>` with no control in
    // it, so it is not reachable by Tab and is not announced as something to press.
    // The list states what the dish needs; it does not offer anything to do about it.
    mockRecipes._set([makeEntry({ kit: [{ label: 'colander', stepIds: [] }] })]);
    renderPage();

    const row = screen.getAllByTestId('recipe-kit-row')[0]!;
    expect(row.tagName).toBe('LI');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(row.querySelector('a, button, input, [tabindex]')).toBeNull();
  });

  it('reserves the icon gutter on a miss, so every name starts at one left edge', () => {
    // The list is read the way the ingredients beside it are read — you run your eye
    // down a straight column of names. The ingredients list buys that with a bare
    // `CanonIcon` tile on every row; kit cannot, because #882's contract is that an
    // unknown label draws NO picture rather than a placeholder that reads as a broken
    // image. So the gutter is a fixed 40px box that is simply empty on a miss: both
    // rows below start their text at the same x, and only one of them has a tile.
    setTools([tool({ id: 'saucepan', label: 'large saucepan' })]);
    mockRecipes._set([
      makeEntry({
        kit: [
          { label: 'large saucepan', stepIds: [] },
          { label: 'tagine', stepIds: [] },
        ],
      }),
    ]);
    renderPage();

    const [drawn, undrawn] = screen.getAllByTestId('recipe-kit-row');
    expect(within(drawn!).queryByTestId('canon-icon')).not.toBeNull();
    expect(within(undrawn!).queryByTestId('canon-icon')).toBeNull();
    for (const row of [drawn!, undrawn!]) {
      const gutter = row.firstElementChild!;
      const classes = gutter.className.split(/\s+/);
      expect(classes).toContain('h-10');
      expect(classes).toContain('w-10');
      expect(classes).toContain('shrink-0');
    }
  });

  it('falls back to Ingredients when the kit empties while Equipment is selected', async () => {
    // The trigger and the panel both disappear with the kit, and `bodyTab` is
    // plain `$state` — so without the reset the strip would be left with nothing
    // selected and the whole body blank. Rare (an editor save that clears the kit,
    // a Redo kit that comes back with nothing) and cheap to be right about.
    mockRecipes._set([makeEntry({ kit: [{ label: 'colander', stepIds: [] }] })]);
    renderPage();

    await fireEvent.click(screen.getAllByRole('tab')[2]!);
    await waitFor(() => {
      expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
    });

    mockRecipes._set([makeEntry({ kit: [] })]);

    await waitFor(() => {
      expect(tabNames()).toEqual(['Ingredients', 'Method']);
    });
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
  });
});

// ─── Accessories under their appliance (issue #1140) ───────────────────────────
// The grouping RULE is proved in `packages/domain`
// (`tests/recipe/groupKitByEquipment.test.ts`, including the two guards). What this
// block proves is that the page actually calls it and draws the answer — a rule the
// page forgets to call is worth nothing — and that an accessory row is what the
// design says it is: indented, and with no tile.

describe('RecipeViewPage — accessories under their appliance', () => {
  it('indents an accessory named beside its appliance, with no picture', () => {
    // Staging's real kit: `['sieve', 'Cosori 5L Rice Cooker', 'Rice Spoon']`.
    mockEquipment._set({
      items: [
        {
          id: 'eq-cosori',
          name: 'Cosori 5L Rice Cooker',
          accessories: [{ id: 'acc-spoon', name: 'Rice Spoon', owned: true, included: true }],
        },
      ],
    });
    mockEquipmentIcons._set(
      new Map([['eq-cosori', { thumbnail: 'https://example.com/eq/cosori.webp' }]]),
    );
    mockRecipes._set([
      makeEntry({
        kit: [
          { label: 'sieve', stepIds: [] },
          { label: 'Cosori 5L Rice Cooker', stepIds: [] },
          { label: 'Rice Spoon', stepIds: [] },
        ],
      }),
    ]);
    renderPage();

    expect(kitLabels()).toEqual(['sieve', 'Cosori 5L Rice Cooker', 'Rice Spoon']);

    const accessory = screen.getByTestId('recipe-kit-accessory-row');
    expect(accessory.textContent?.trim()).toBe('Rice Spoon');
    // No tile and no empty gutter — `equipmentIcons` is keyed by item id, so an
    // accessory has nothing to draw. The indent is what the row IS.
    expect(within(accessory).queryByTestId('canon-icon')).toBeNull();
    expect(accessory.className.split(/\s+/)).toContain('pl-12');
  });

  it('leaves an accessory named without its appliance as an ordinary top-level row', () => {
    // Staging's Baked Camembert: a sheet pan and an oven rack, no Anova anywhere.
    // Hauling out a steam oven the recipe never asked for is the wrong answer.
    mockEquipment._set({
      items: [
        {
          id: 'eq-anova',
          name: 'Anova Precision Oven',
          accessories: [
            { id: 'acc-pan', name: 'Oven Sheet Pan', owned: true, included: true },
            { id: 'acc-rack', name: 'Wire Oven Rack', owned: true, included: true },
          ],
        },
      ],
    });
    mockRecipes._set([
      makeEntry({
        kit: [
          { label: 'small frying pan', stepIds: [] },
          { label: 'Oven Sheet Pan', stepIds: [] },
          { label: 'Wire Oven Rack', stepIds: [] },
        ],
      }),
    ]);
    renderPage();

    expect(kitLabels()).toEqual(['small frying pan', 'Oven Sheet Pan', 'Wire Oven Rack']);
    expect(screen.queryByTestId('recipe-kit-accessory-row')).toBeNull();
    expect(screen.queryByText(/Anova/)).toBeNull();
  });

  it('stays flat while the manifest has not loaded', () => {
    // A cold load paints before the manifest lands, and the accessory→appliance link
    // lives entirely in the manifest. Flat is the correct reading of "nothing is
    // known to be owned yet" — and the list regroups itself when the store fills,
    // because it is `$derived` off it.
    mockEquipment._set(null);
    mockRecipes._set([
      makeEntry({
        kit: [
          { label: 'Cosori 5L Rice Cooker', stepIds: [] },
          { label: 'Rice Spoon', stepIds: [] },
        ],
      }),
    ]);
    renderPage();

    expect(kitLabels()).toEqual(['Cosori 5L Rice Cooker', 'Rice Spoon']);
    expect(screen.queryByTestId('recipe-kit-accessory-row')).toBeNull();
  });

  it('keeps the tab count equal to the number of lines once rows are grouped', () => {
    // `count={kit.length}` is only honest while every entry renders exactly once.
    // Three entries, one of them nested, is still a count of three.
    mockEquipment._set({
      items: [
        {
          id: 'eq-ninja',
          name: 'Ninja Foodi 3-in-1 Hand Blender, Mixer & Chopper CI100UK',
          accessories: [
            { id: 'acc-att', name: 'Hand Blender Attachment', owned: true, included: true },
          ],
        },
      ],
    });
    mockRecipes._set([
      makeEntry({
        kit: [
          { label: 'tall glass jar', stepIds: [] },
          { label: 'Ninja Foodi 3-in-1 Hand Blender, Mixer & Chopper CI100UK', stepIds: [] },
          { label: 'Hand Blender Attachment', stepIds: [] },
        ],
      }),
    ]);
    renderPage();

    expect(screen.getAllByTestId('recipe-kit-accessory-row')).toHaveLength(1);
    expect(kitLabels()).toHaveLength(3);
    expect(screen.getAllByRole('tab')[2]!.textContent).toContain('3');
  });
});

// ─── Per-step kit, in the Method column (issue #882) ────────────────────────────
// The contiguous-run rule is proved in `packages/domain` — this file proves it is
// what the READER actually sees, because a rule the page forgets to call is worth
// nothing. Both tab panels stay mounted while hidden (ui-spec-v10 §8.28.3), so the
// method's steps are queryable without switching tabs first.

function steps(...texts: string[]) {
  return texts.map((text, i) => ({
    id: `step-${i + 1}`,
    text,
    note: null,
    timer: null,
  }));
}

/** The kit labels drawn under each method step, in step order. */
function kitByStepRow(): string[][] {
  return screen.queryAllByTestId('recipe-view-step').map((li) => {
    const row = within(li).queryByTestId('recipe-view-step-kit');
    if (!row) return [];
    return within(row)
      .queryAllByTestId('recipe-view-step-kit-item')
      .map((item) => item.textContent?.trim() ?? '');
  });
}

describe('RecipeViewPage — kit under a method step', () => {
  it('draws a tool used across five consecutive steps ONCE, at the step it comes out', () => {
    // The whole reason the rule exists: without it the method is a column of the
    // same frying pan, and the eye learns to skip the column.
    mockRecipes._set([
      makeEntry({
        steps: steps('Heat the pan.', 'Brown.', 'Deglaze.', 'Simmer.', 'Rest.'),
        kit: [{ label: 'frying pan', stepIds: ['step-1', 'step-2', 'step-3', 'step-4', 'step-5'] }],
      }),
    ]);
    renderPage();

    expect(kitByStepRow()).toEqual([['frying pan'], [], [], [], []]);
  });

  it('draws a tool put down and picked up again TWICE', () => {
    mockRecipes._set([
      makeEntry({
        steps: steps('Mix.', 'Rest.', 'Chill.', 'Fold through.'),
        kit: [{ label: 'mixing bowl', stepIds: ['step-1', 'step-4'] }],
      }),
    ]);
    renderPage();

    expect(kitByStepRow()).toEqual([['mixing bowl'], [], [], ['mixing bowl']]);
  });

  it('shows the drawn pictogram with the name as its accessible content', () => {
    setTools([
      tool({
        id: 'saucepan',
        label: 'large saucepan',
        thumbnail: 'https://example.com/kit/saucepan.webp',
        updatedAt: '2026-02-02T00:00:00.000Z',
      }),
    ]);
    mockRecipes._set([
      makeEntry({
        steps: steps('Boil the potatoes.'),
        kit: [{ label: 'large saucepan', stepIds: ['step-1'] }],
      }),
    ]);
    renderPage();

    const step = screen.getAllByTestId('recipe-view-step')[0]!;
    const img = within(step).getByTestId('canon-icon-img');
    expect(img).toHaveAttribute(
      'src',
      'https://example.com/kit/saucepan.webp?v=2026-02-02T00:00:00.000Z',
    );
    // The tile is decorative; the words are what a screen reader gets.
    expect(kitByStepRow()).toEqual([['large saucepan']]);
  });

  it('renders an unresolved label as words with NO picture', () => {
    setTools([tool({ id: 'saucepan', label: 'saucepan' })]);
    mockRecipes._set([
      makeEntry({ steps: steps('Steam it.'), kit: [{ label: 'tagine', stepIds: ['step-1'] }] }),
    ]);
    renderPage();

    const step = screen.getAllByTestId('recipe-view-step')[0]!;
    expect(within(step).queryByTestId('canon-icon')).toBeNull();
    expect(kitByStepRow()).toEqual([['tagine']]);
  });

  it('draws NOTHING under a step for a kit entry naming no step', () => {
    // It still belongs on the "You'll need" strip — the strip lists what the dish
    // needs, and "used at no particular step" is not an answer the method can give.
    mockRecipes._set([
      makeEntry({ steps: steps('Serve.'), kit: [{ label: 'oven glove', stepIds: [] }] }),
    ]);
    renderPage();

    expect(kitByStepRow()).toEqual([[]]);
    expect(kitLabels()).toEqual(['oven glove']);
  });

  it('leaves no misattributed tool when a step has since been deleted', () => {
    // An ordinary editor save deletes a step and re-runs no inference, so the
    // document really does carry an id pointing at nothing. It goes quiet; it is
    // never re-hung on whichever step took that position.
    mockRecipes._set([
      makeEntry({
        steps: steps('Chop.', 'Fry.'),
        kit: [
          { label: 'stick blender', stepIds: ['step-deleted'] },
          { label: 'chopping board', stepIds: ['step-deleted', 'step-2'] },
        ],
      }),
    ]);
    renderPage();

    expect(kitByStepRow()).toEqual([[], ['chopping board']]);
  });
});
