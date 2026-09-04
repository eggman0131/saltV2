import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins the OBSERVE-ONLY contract of the RecipeSchema check in
// assembleRecipeDraft (issue #932, Phase 5).
//
// The whole safety argument for Phase 5 is "the parse result is never acted
// on". That is a claim about behaviour, so it is asserted here rather than only
// in a comment: a draft that FAILS RecipeSchema must still be returned, byte for
// byte, and the failure must reach the reporter. If a later change ever makes
// the parse reject, throw, or repair the draft, these go red — which is the
// point, because Phase 6 (making the flows' output schemas real) is a
// deliberate behaviour change that must be taken knowingly, not inherited.

const mockUUID = vi.fn();
const mockParseFlow = vi.fn();
const mockCanonFlow = vi.fn();

vi.mock('../../src/flows/parseRecipeIngredients.js', () => ({
  parseRecipeIngredientsFlow: mockParseFlow,
}));
vi.mock('../../src/flows/canonicaliseRecipeIngredients.js', () => ({
  canonicaliseRecipeIngredientsFlow: mockCanonFlow,
}));

const mockReport = vi.fn();
vi.mock('../../src/observability/reportServerError.js', () => ({
  reportServerError: mockReport,
}));

vi.stubGlobal('crypto', { randomUUID: mockUUID });

const { assembleRecipeDraft } = await import('../../src/flows/assembleRecipeDraft.js');

beforeEach(() => {
  vi.clearAllMocks();
  let counter = 0;
  mockUUID.mockImplementation(() => `id-${++counter}`);
  mockParseFlow.mockImplementation(({ rawText }: { rawText: string }) =>
    Promise.resolve(parseResultFor(rawText.split('\n'))),
  );
  mockCanonFlow.mockResolvedValue([]);
});

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

function rawOutput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Garlic Pasta',
    description: null,
    servings: 2,
    tags: [],
    ingredientGroups: [
      {
        name: null,
        ingredients: [{ rawText: '200g pasta', isOptional: false, firstUsedInStepOrdinal: 0 }],
      },
    ],
    steps: [{ text: 'Boil the pasta.', timerMinutes: 10, timerLabel: 'Boil', note: null }],
    notes: null,
    ...overrides,
  };
}

const SOURCE = { type: 'manual' as const };

describe('assembleRecipeDraft RecipeSchema observation', () => {
  it('says nothing when the assembled draft satisfies RecipeSchema', async () => {
    const draft = await assembleRecipeDraft(rawOutput() as never, { source: SOURCE });

    expect(draft.title).toBe('Garlic Pasta');
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('reports a draft that does NOT satisfy RecipeSchema', async () => {
    // `title` must be a string. A model returning a number produces a draft the
    // schema rejects — today silently, all the way to the recipes collection.
    await assembleRecipeDraft(rawOutput({ title: 42 }) as never, { source: SOURCE });

    expect(mockReport).toHaveBeenCalledTimes(1);
    const reported = mockReport.mock.calls[0]?.[0] as Error;
    expect(reported.message).toContain('title');
  });

  it('OBSERVE ONLY: returns the failing draft unchanged, and does not throw', async () => {
    const draft = await assembleRecipeDraft(rawOutput({ title: 42 }) as never, { source: SOURCE });

    // The draft comes back exactly as assembled — not rejected, not repaired,
    // not defaulted. This is the clause Phase 6 is allowed to change and
    // nothing before it may.
    expect(draft).not.toBeNull();
    expect(draft.title).toBe(42 as unknown as string);
    expect(draft.steps).toHaveLength(1);
  });

  it('scrubs values: the report carries issue PATHS, never recipe text', async () => {
    await assembleRecipeDraft(
      rawOutput({ title: 42, notes: 'Nana never told anyone about the anchovies' }) as never,
      { source: SOURCE },
    );

    const reported = mockReport.mock.calls[0]?.[0] as Error;
    expect(reported.message).not.toContain('anchovies');
    expect(reported.message).not.toContain('42');
  });
});
