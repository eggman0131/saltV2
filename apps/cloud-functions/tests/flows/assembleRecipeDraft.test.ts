import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecipeDoc } from '@salt/domain/schemas';

// The one assembler both authoring paths share (the librarian chat and the URL
// import). Everything that used to be duplicated between them — step-ordinal
// resolution, id minting, the non-fatal parse/canon failure modes — is asserted
// here once, against the module directly rather than through either flow.

const mockUUID = vi.fn();
const mockParseFlow = vi.fn();
const mockCanonFlow = vi.fn();

vi.mock('../../src/flows/parseRecipeIngredients.js', () => ({
  parseRecipeIngredientsFlow: mockParseFlow,
}));

vi.mock('../../src/flows/canonicaliseRecipeIngredients.js', () => ({
  canonicaliseRecipeIngredientsFlow: mockCanonFlow,
}));

vi.stubGlobal('crypto', { randomUUID: mockUUID });

const { assembleRecipeDraft } = await import('../../src/flows/assembleRecipeDraft.js');

beforeEach(() => {
  vi.clearAllMocks();
  let counter = 0;
  mockUUID.mockImplementation(() => `id-${++counter}`);
  mockParseFlow.mockResolvedValue([]);
  mockCanonFlow.mockResolvedValue([]);
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function rawOutput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Garlic Pasta',
    description: null,
    servings: 2,
    totalTimeMinutes: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    tags: [],
    ingredientGroups: [
      {
        name: null,
        ingredients: [
          { rawText: '200g pasta', isOptional: false, firstUsedInStepOrdinal: 0 },
          { rawText: '2 cloves garlic, crushed', isOptional: true, firstUsedInStepOrdinal: 1 },
        ],
      },
    ],
    steps: [
      { text: 'Boil the pasta.', timerMinutes: 10, timerLabel: 'Boil', note: null },
      { text: 'Crush the garlic.', timerMinutes: null, timerLabel: null, note: 'Use a press.' },
    ],
    notes: null,
    ...overrides,
  };
}

// Mirrors parseRecipeIngredientsFlow's output shape: groups of items each
// carrying a full `parsed` object keyed by rawText.
function parseResultFor(rawTexts: string[]) {
  return [
    {
      id: 'parse-group-1',
      name: null,
      items: rawTexts.map((rawText, i) => ({
        id: `parse-item-${i}`,
        rawText,
        parsed: {
          quantity: { type: 'single', value: 1 },
          unit: null,
          item: rawText.split(' ').at(-1)!,
          preparation: [],
          notes: null,
          displayText: null,
        },
        canonId: null,
        matchState: 'pending' as const,
        isOptional: false,
        firstUsedInStepId: null,
      })),
    },
  ];
}

const MANUAL = { type: 'manual' } as const;

// ─── ingredient → step ordinal resolution ────────────────────────────────────

describe('assembleRecipeDraft — step ordinal resolution', () => {
  it('resolves each ingredient ordinal to the id of the step at that index', async () => {
    const doc = await assembleRecipeDraft(rawOutput(), { source: MANUAL });

    const [pasta, garlic] = doc.ingredients[0]!.items;
    expect(pasta!.firstUsedInStepId).toBe(doc.steps[0]!.id);
    expect(garlic!.firstUsedInStepId).toBe(doc.steps[1]!.id);
  });

  it('leaves firstUsedInStepId null for a null ordinal', async () => {
    const raw = rawOutput();
    raw.ingredientGroups[0]!.ingredients[0]!.firstUsedInStepOrdinal = null;

    const doc = await assembleRecipeDraft(raw, { source: MANUAL });

    expect(doc.ingredients[0]!.items[0]!.firstUsedInStepId).toBeNull();
  });

  it('leaves firstUsedInStepId null for an out-of-range or negative ordinal', async () => {
    const raw = rawOutput();
    // Only two steps exist, so 7 is past the end and -1 is before the start.
    raw.ingredientGroups[0]!.ingredients[0]!.firstUsedInStepOrdinal = 7;
    raw.ingredientGroups[0]!.ingredients[1]!.firstUsedInStepOrdinal = -1;

    const doc = await assembleRecipeDraft(raw, { source: MANUAL });

    expect(doc.ingredients[0]!.items[0]!.firstUsedInStepId).toBeNull();
    expect(doc.ingredients[0]!.items[1]!.firstUsedInStepId).toBeNull();
  });
});

// ─── group / id minting ───────────────────────────────────────────────────────

describe('assembleRecipeDraft — id minting', () => {
  it('mints a distinct id for every step, group, ingredient, and the recipe itself', async () => {
    const doc = await assembleRecipeDraft(rawOutput(), { source: MANUAL });

    const ids = [
      doc.id,
      ...doc.steps.map((s) => s.id),
      ...doc.ingredients.map((g) => g.id),
      ...doc.ingredients.flatMap((g) => g.items.map((i) => i.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    // 2 steps + 1 group + 2 ingredients + 1 recipe.
    expect(mockUUID).toHaveBeenCalledTimes(6);
  });

  it('preserves group names and per-group membership', async () => {
    const raw = rawOutput({
      ingredientGroups: [
        {
          name: 'For the sauce',
          ingredients: [{ rawText: '400g tomatoes', isOptional: false, firstUsedInStepOrdinal: 0 }],
        },
        {
          name: null,
          ingredients: [{ rawText: '200g pasta', isOptional: false, firstUsedInStepOrdinal: 1 }],
        },
      ],
    });

    const doc = await assembleRecipeDraft(raw, { source: MANUAL });

    expect(doc.ingredients).toHaveLength(2);
    expect(doc.ingredients[0]!.name).toBe('For the sauce');
    expect(doc.ingredients[0]!.items.map((i) => i.rawText)).toEqual(['400g tomatoes']);
    expect(doc.ingredients[1]!.name).toBeNull();
    expect(doc.ingredients[1]!.items.map((i) => i.rawText)).toEqual(['200g pasta']);
  });

  it('carries step text, timer, label and note onto the assembled steps', async () => {
    const doc = await assembleRecipeDraft(rawOutput(), { source: MANUAL });

    expect(doc.steps[0]!.text).toBe('Boil the pasta.');
    expect(doc.steps[0]!.timer).toEqual({ durationMinutes: 10, description: 'Boil' });
    // No timerMinutes ⇒ no timer object at all.
    expect(doc.steps[1]!.timer).toBeNull();
    expect(doc.steps[1]!.note).toBe('Use a press.');
  });
});

// ─── non-fatal sub-flow failures ─────────────────────────────────────────────

describe('assembleRecipeDraft — non-fatal sub-flow failures', () => {
  it('assembles with parsed: null on every ingredient when the parse flow throws', async () => {
    mockParseFlow.mockRejectedValue(new Error('parse failed'));
    mockCanonFlow.mockResolvedValue([
      { kind: 'ok', value: { decision: 'matched', item: { id: 'canon-pasta' } } },
      { kind: 'ok', value: { decision: 'matched', item: { id: 'canon-garlic' } } },
    ]);

    const doc = await assembleRecipeDraft(rawOutput(), { source: MANUAL });
    const items = doc.ingredients[0]!.items;

    expect(items.every((i) => i.parsed === null)).toBe(true);
    // Canon still ran — a parse failure must not take the match down with it.
    expect(items[0]!.canonId).toBe('canon-pasta');
    expect(items[0]!.matchState).toBe('matched');
  });

  it('falls back to rawText as the canon rawName when the parse flow throws', async () => {
    mockParseFlow.mockRejectedValue(new Error('parse failed'));

    await assembleRecipeDraft(rawOutput(), { source: MANUAL });

    const items = mockCanonFlow.mock.calls[0]![0].items as { rawName: string; rawText: string }[];
    expect(items.map((i) => i.rawName)).toEqual(['200g pasta', '2 cloves garlic, crushed']);
  });

  it('lands every ingredient as pending when the canon flow throws', async () => {
    mockParseFlow.mockResolvedValue(parseResultFor(['200g pasta', '2 cloves garlic, crushed']));
    mockCanonFlow.mockRejectedValue(new Error('canon failed'));

    const doc = await assembleRecipeDraft(rawOutput(), { source: MANUAL });
    const items = doc.ingredients[0]!.items;

    expect(items.every((i) => i.matchState === 'pending')).toBe(true);
    expect(items.every((i) => i.canonId === null)).toBe(true);
    // The parse result still threaded through — the two failures are independent.
    expect(items[0]!.parsed).not.toBeNull();
  });

  it('marks an ingredient failed when canon returns a non-ok result for it', async () => {
    mockCanonFlow.mockResolvedValue([
      { kind: 'err', error: { kind: 'AiError' } },
      { kind: 'ok', value: { decision: 'created', item: { id: 'canon-garlic' } } },
    ]);

    const doc = await assembleRecipeDraft(rawOutput(), { source: MANUAL });
    const items = doc.ingredients[0]!.items;

    expect(items[0]!.matchState).toBe('failed');
    expect(items[0]!.canonId).toBeNull();
    expect(items[1]!.matchState).toBe('matched');
    expect(items[1]!.canonId).toBe('canon-garlic');
  });

  it('calls neither sub-flow when there are no ingredients at all', async () => {
    const doc = await assembleRecipeDraft(rawOutput({ ingredientGroups: [] }), {
      source: MANUAL,
    });

    expect(mockParseFlow).not.toHaveBeenCalled();
    expect(mockCanonFlow).not.toHaveBeenCalled();
    expect(doc.ingredients).toEqual([]);
  });
});

// ─── canon keying is by rawText ──────────────────────────────────────────────

describe('assembleRecipeDraft — canon keying', () => {
  it('canonicalises a repeated ingredient line once and applies the result to both', async () => {
    const raw = rawOutput({
      ingredientGroups: [
        {
          name: 'For the sauce',
          ingredients: [
            { rawText: '2 cloves garlic', isOptional: false, firstUsedInStepOrdinal: 0 },
          ],
        },
        {
          name: 'To serve',
          ingredients: [
            { rawText: '2 cloves garlic', isOptional: false, firstUsedInStepOrdinal: 1 },
          ],
        },
      ],
    });
    mockCanonFlow.mockResolvedValue([
      { kind: 'ok', value: { decision: 'matched', item: { id: 'canon-garlic' } } },
    ]);

    const doc = await assembleRecipeDraft(raw, { source: MANUAL });

    // One canon item sent, not two — deduped on rawText.
    const sent = mockCanonFlow.mock.calls[0]![0].items as unknown[];
    expect(sent).toHaveLength(1);
    // …and both occurrences still carry the match.
    expect(doc.ingredients[0]!.items[0]!.canonId).toBe('canon-garlic');
    expect(doc.ingredients[1]!.items[0]!.canonId).toBe('canon-garlic');
    // Distinct ingredient ids, though — they are two separate lines on the doc.
    expect(doc.ingredients[0]!.items[0]!.id).not.toBe(doc.ingredients[1]!.items[0]!.id);
  });
});

// ─── edit mode ───────────────────────────────────────────────────────────────

describe('assembleRecipeDraft — edit mode', () => {
  function baseRecipe(): RecipeDoc {
    return {
      id: 'r1',
      schemaVersion: 1,
      kind: 'cocktail',
      title: 'Old Fashioned',
      description: null,
      ingredients: [
        {
          id: 'g1',
          name: null,
          items: [
            {
              id: 'i1',
              rawText: '200g pasta',
              parsed: {
                quantity: { type: 'single', value: 200 },
                unit: 'g',
                item: 'pasta',
                preparation: [],
                notes: null,
                displayText: null,
              },
              canonId: 'canon-pasta',
              matchState: 'matched',
              isOptional: false,
              firstUsedInStepId: 'old-step',
            },
          ],
        },
      ],
      steps: [{ id: 'old-step', text: 'Boil the pasta.', timer: null, note: null }],
      metadata: {
        servings: 4,
        totalTimeMinutes: 15,
        prepTimeMinutes: null,
        cookTimeMinutes: null,
        tags: [],
      },
      source: { type: 'manual' },
      notes: null,
      producesCanonId: 'canon-sauce',
      image: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
  }

  it('reuses id, parsed data and canon match for a byte-identical rawText, and skips both sub-flows for it', async () => {
    mockCanonFlow.mockResolvedValue([
      { kind: 'ok', value: { decision: 'created', item: { id: 'canon-garlic' } } },
    ]);

    const doc = await assembleRecipeDraft(rawOutput(), {
      source: MANUAL,
      baseRecipe: baseRecipe(),
    });

    // Only the genuinely new line reached the expensive flows.
    expect(mockParseFlow).toHaveBeenCalledWith({ rawText: '2 cloves garlic, crushed' });
    const sent = mockCanonFlow.mock.calls[0]![0].items as { rawText: string }[];
    expect(sent.map((i) => i.rawText)).toEqual(['2 cloves garlic, crushed']);

    const pasta = doc.ingredients[0]!.items[0]!;
    expect(pasta.id).toBe('i1');
    expect(pasta.canonId).toBe('canon-pasta');
    expect(pasta.matchState).toBe('matched');
    expect(pasta.parsed!.item).toBe('pasta');
  });

  it('re-resolves the step ordinal on a carried-over ingredient rather than keeping the old step id', async () => {
    const doc = await assembleRecipeDraft(rawOutput(), {
      source: MANUAL,
      baseRecipe: baseRecipe(),
    });

    const pasta = doc.ingredients[0]!.items[0]!;
    expect(pasta.firstUsedInStepId).toBe(doc.steps[0]!.id);
    expect(pasta.firstUsedInStepId).not.toBe('old-step');
  });

  it('takes isOptional from the fresh output, not the base ingredient', async () => {
    const raw = rawOutput();
    raw.ingredientGroups[0]!.ingredients[0]!.isOptional = true;

    const doc = await assembleRecipeDraft(raw, {
      source: MANUAL,
      baseRecipe: baseRecipe(),
    });

    expect(doc.ingredients[0]!.items[0]!.isOptional).toBe(true);
  });

  it('carries the base recipe kind and producesCanonId through the amend', async () => {
    const doc = await assembleRecipeDraft(rawOutput(), {
      source: MANUAL,
      baseRecipe: baseRecipe(),
    });

    expect(doc.kind).toBe('cocktail');
    expect(doc.producesCanonId).toBe('canon-sauce');
  });

  it('defaults to a fresh recipe with no makes-link when there is no base', async () => {
    const doc = await assembleRecipeDraft(rawOutput(), { source: MANUAL });

    expect(doc.kind).toBe('recipe');
    expect(doc.producesCanonId).toBeNull();
  });
});

// ─── document-level fields ───────────────────────────────────────────────────

describe('assembleRecipeDraft — document fields', () => {
  it('stamps the source it was given', async () => {
    const manual = await assembleRecipeDraft(rawOutput(), { source: MANUAL });
    expect(manual.source).toEqual({ type: 'manual' });

    const imported = await assembleRecipeDraft(rawOutput(), {
      source: { type: 'url', url: 'https://example.com/pasta' },
    });
    expect(imported.source).toEqual({ type: 'url', url: 'https://example.com/pasta' });
  });

  it('omits needs_approval entirely unless asked for it (absent means reviewed)', async () => {
    const doc = await assembleRecipeDraft(rawOutput(), { source: MANUAL });

    expect('needs_approval' in doc).toBe(false);
  });

  it('sets needs_approval: true when asked', async () => {
    const doc = await assembleRecipeDraft(rawOutput(), {
      source: MANUAL,
      needsApproval: true,
    });

    expect(doc.needs_approval).toBe(true);
  });

  it('normalises tags', async () => {
    const doc = await assembleRecipeDraft(rawOutput({ tags: ['Comfort Food, quick', 'QUICK'] }), {
      source: MANUAL,
    });

    expect(doc.metadata.tags).toEqual(['comfort-food', 'quick']);
  });
});

// ─── total-time derivation (URL import) ──────────────────────────────────────

describe('assembleRecipeDraft — total time', () => {
  it('derives a total from prep + cook when asked and the source states no total', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: null, prepTimeMinutes: 5, cookTimeMinutes: 15 }),
      { source: MANUAL, deriveTotalTime: true },
    );

    expect(doc.metadata.totalTimeMinutes).toBe(20);
  });

  it('prefers a stated total over the derived one', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: 30, prepTimeMinutes: 5, cookTimeMinutes: 15 }),
      { source: MANUAL, deriveTotalTime: true },
    );

    expect(doc.metadata.totalTimeMinutes).toBe(30);
  });

  it('leaves the total null when only one part is known', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: null, prepTimeMinutes: 5, cookTimeMinutes: null }),
      { source: MANUAL, deriveTotalTime: true },
    );

    expect(doc.metadata.totalTimeMinutes).toBeNull();
  });

  it('never derives a total on the authoring path — a chat that stated no total gets none', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: null, prepTimeMinutes: 5, cookTimeMinutes: 15 }),
      { source: MANUAL },
    );

    expect(doc.metadata.totalTimeMinutes).toBeNull();
    expect(doc.metadata.prepTimeMinutes).toBe(5);
    expect(doc.metadata.cookTimeMinutes).toBe(15);
  });
});

// ─── zero-time folding (issue #739) ──────────────────────────────────────────

describe('assembleRecipeDraft — no-cook recipes', () => {
  it('folds cookTimeMinutes: 0 to null so the card renders nothing, not "Cook 0 min"', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: 15, prepTimeMinutes: 15, cookTimeMinutes: 0 }),
      { source: MANUAL, deriveTotalTime: true },
    );

    expect(doc.metadata.cookTimeMinutes).toBeNull();
  });

  it('folds prepTimeMinutes: 0 to null as well', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: 30, prepTimeMinutes: 0, cookTimeMinutes: 30 }),
      { source: MANUAL, deriveTotalTime: true },
    );

    expect(doc.metadata.prepTimeMinutes).toBeNull();
  });

  it('derives the total BEFORE folding — prep 15 + cook 0 is a 15-minute salad, not an unknown', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: null, prepTimeMinutes: 15, cookTimeMinutes: 0 }),
      { source: MANUAL, deriveTotalTime: true },
    );

    expect(doc.metadata.totalTimeMinutes).toBe(15);
    expect(doc.metadata.prepTimeMinutes).toBe(15);
    expect(doc.metadata.cookTimeMinutes).toBeNull();
  });

  it('folds a derived total of 0 — no prep and no cook states no time at all', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: null, prepTimeMinutes: 0, cookTimeMinutes: 0 }),
      { source: MANUAL, deriveTotalTime: true },
    );

    expect(doc.metadata.totalTimeMinutes).toBeNull();
    expect(doc.metadata.prepTimeMinutes).toBeNull();
    expect(doc.metadata.cookTimeMinutes).toBeNull();
  });

  it('folds on the authoring path too — one rule, both ways a recipe is written', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: 10, prepTimeMinutes: 10, cookTimeMinutes: 0 }),
      { source: MANUAL },
    );

    expect(doc.metadata.cookTimeMinutes).toBeNull();
    expect(doc.metadata.totalTimeMinutes).toBe(10);
  });

  it('leaves every non-zero time untouched', async () => {
    const doc = await assembleRecipeDraft(
      rawOutput({ totalTimeMinutes: 45, prepTimeMinutes: 15, cookTimeMinutes: 30 }),
      { source: MANUAL, deriveTotalTime: true },
    );

    expect(doc.metadata).toMatchObject({
      totalTimeMinutes: 45,
      prepTimeMinutes: 15,
      cookTimeMinutes: 30,
    });
  });
});
