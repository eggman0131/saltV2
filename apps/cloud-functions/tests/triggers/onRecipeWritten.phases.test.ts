import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecipeDoc } from '@salt/domain/schemas';

// Blocking finding 1 (issue #1122 review, PR #1201): the re-estimate branch used
// to write `metadata.phases: finalTimes.phases` UNCONDITIONALLY. `phases` is
// `.optional()` on the AI output precisely because a model can forget it, and the
// flow turns absent into `[]` — so a recipe that already had a strip (Phase 1
// authored, Phase 3 backfilled, or hand-corrected), asked again, and answered
// with three good numbers but no strip had that strip DESTROYED, with
// `timesEstimatedAt` stamped in the same write so the backfill script would
// never revisit it. Fixed by merging the response against the stored strip
// through `reconcileRecipePhases` — the same function `assembleRecipeDraft`
// calls, so the two write paths answer "the model returned nothing" identically
// (see reconcileRecipePhases.test.ts in packages/domain for the merge rule
// itself). onRecipeWritten.timesFloor.test.ts covers the sibling total-flooring
// guard; this file is the phases-and-summary guard.

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => '' }) }));
vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockEstimateTimes = vi.fn();
vi.mock('../../src/flows/estimateRecipeTimes.js', () => ({
  estimateRecipeTimesFlow: mockEstimateTimes,
}));

// The sibling branches are not this suite's subject; the fixtures below are
// shaped (image already set, kit already inferred) so neither one fires, but
// stub their flows anyway so a slipped fixture cannot wander into a real call.
vi.mock('../../src/flows/generateRecipeImage.js', () => ({
  generateRecipeImageFlow: vi.fn(async () => ({ imageBase64: 'QUJD', contentType: 'image/png' })),
}));
vi.mock('../../src/flows/describeRecipeScene.js', () => ({
  describeRecipeSceneFlow: vi.fn(async () => ({ brief: 'irrelevant' })),
}));
vi.mock('../../src/imaging/encodeHeroImage.js', () => ({
  encodeHeroImage: vi.fn(async () => Buffer.from([1, 2, 3])),
}));
vi.mock('../../src/flows/componentContext.js', () => ({
  readComponentContext: vi.fn(async () => []),
}));
vi.mock('../../src/flows/identifyRecipeKit.js', () => ({
  identifyRecipeKitFlow: vi.fn(async () => ({ kit: [] })),
}));

const mockUpdate = vi.fn().mockResolvedValue(undefined);
let mockDevSettings: Record<string, unknown> | null = null;
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => 'DELETE' },
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: () => ({
        update: mockUpdate,
        get: () =>
          Promise.resolve(
            name === 'devSettings' && mockDevSettings !== null
              ? { exists: true, data: () => mockDevSettings }
              : { exists: false, data: () => undefined },
          ),
      }),
    }),
  }),
}));
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({ name: 'demo-salt.appspot.com', file: () => ({ save: vi.fn() }) }),
  }),
}));
vi.mock('@salt/observability/server', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  flushServerObservability: vi.fn().mockResolvedValue(undefined),
  createServerObservabilityErrorReportingAdapter: vi.fn(() => ({ report: vi.fn() })),
}));

const { onRecipeWritten } = await import('../../src/triggers/onRecipeWritten.js');

function recipe(overrides: Partial<RecipeDoc> = {}): RecipeDoc {
  return {
    id: 'r1',
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Slow Roast Shoulder',
    description: 'Low and slow, then rested.',
    ingredients: [],
    steps: [{ id: 's1', text: 'Rub, then roast for 6 hours.', timer: null, note: null }],
    metadata: {
      servings: null,
      prepTimeMinutes: 20,
      cookTimeMinutes: 360,
      totalTimeMinutes: 380,
      tags: [],
    },
    source: null,
    notes: null,
    // Set so the sibling hero-image branch cannot fire.
    image: { url: 'https://example.test/roast.png', source: 'ai' },
    // Set so the sibling kit branch cannot fire.
    kit: [],
    kitInferredAt: 1_690_000_000_000,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  } as unknown as RecipeDoc;
}

function makeEvent(after: RecipeDoc, before: RecipeDoc | Record<string, unknown> | null) {
  return {
    params: { id: after.id },
    data: {
      before: before
        ? { exists: true, data: () => before }
        : { exists: false, data: () => undefined },
      after: { exists: true, data: () => after },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDevSettings = null;
  delete process.env['FUNCTIONS_AI_FAKE'];
});

describe('onRecipeWritten — time branch protects a stored strip from an answer with none', () => {
  it('keeps a stored strip when the re-estimate omitted phases', async () => {
    const storedPhases = [
      { label: 'Rub', handsOnMinutes: 10, handsOffMinutes: 0 },
      { label: 'Roast', handsOnMinutes: 5, handsOffMinutes: 355 },
    ];
    mockEstimateTimes.mockResolvedValue({
      prepTimeMinutes: 20,
      cookTimeMinutes: 360,
      totalTimeMinutes: 380,
      // No `phases` / `timingSummary` — the model forgot the strip.
    });

    const before = { timesRequestedAt: undefined };
    const after = recipe({
      timesRequestedAt: 1_700_000_000_000,
      metadata: {
        servings: null,
        prepTimeMinutes: 20,
        cookTimeMinutes: 360,
        totalTimeMinutes: 380,
        tags: [],
        phases: storedPhases,
        timingSummary: 'About 15 minutes of you, over six and a bit hours.',
      },
    });
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(makeEvent(after, before));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'metadata.phases': storedPhases,
        'metadata.timingSummary': 'About 15 minutes of you, over six and a bit hours.',
      }),
    );
  });

  it('replaces the stored strip when the re-estimate DID answer', async () => {
    const freshPhases = [{ label: 'Roast', handsOnMinutes: 5, handsOffMinutes: 355 }];
    mockEstimateTimes.mockResolvedValue({
      prepTimeMinutes: 20,
      cookTimeMinutes: 360,
      totalTimeMinutes: 380,
      phases: freshPhases,
      timingSummary: 'Five minutes of you.',
    });

    const before = { timesRequestedAt: undefined };
    const after = recipe({
      timesRequestedAt: 1_700_000_000_000,
      metadata: {
        servings: null,
        prepTimeMinutes: 20,
        cookTimeMinutes: 360,
        totalTimeMinutes: 380,
        tags: [],
        phases: [{ label: 'Rub', handsOnMinutes: 10, handsOffMinutes: 0 }],
        timingSummary: 'Stale summary.',
      },
    });
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(makeEvent(after, before));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'metadata.phases': freshPhases,
        'metadata.timingSummary': 'Five minutes of you.',
      }),
    );
  });

  // The pairing half of the fix (issue #1122 review, blocking 2, exercised on
  // THIS write path too): a fresh strip with no returned summary must not
  // inherit the stale one sitting beside it in the stored document.
  it('does not pair a fresh strip with the stale stored summary', async () => {
    const freshPhases = [{ label: 'Roast', handsOnMinutes: 5, handsOffMinutes: 355 }];
    mockEstimateTimes.mockResolvedValue({
      prepTimeMinutes: 20,
      cookTimeMinutes: 360,
      totalTimeMinutes: 380,
      phases: freshPhases,
      // No `timingSummary` returned alongside the fresh strip.
    });

    const before = { timesRequestedAt: undefined };
    const after = recipe({
      timesRequestedAt: 1_700_000_000_000,
      metadata: {
        servings: null,
        prepTimeMinutes: 20,
        cookTimeMinutes: 360,
        totalTimeMinutes: 380,
        tags: [],
        phases: [{ label: 'Rub', handsOnMinutes: 10, handsOffMinutes: 0 }],
        timingSummary: 'Stale summary describing the OLD strip.',
      },
    });
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(makeEvent(after, before));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'metadata.phases': freshPhases,
        'metadata.timingSummary': null,
      }),
    );
  });

  it('stores an empty strip when neither the answer nor the stored recipe has one', async () => {
    mockEstimateTimes.mockResolvedValue({
      prepTimeMinutes: 20,
      cookTimeMinutes: 360,
      totalTimeMinutes: 380,
    });

    const before = { timesRequestedAt: undefined };
    const after = recipe({ timesRequestedAt: 1_700_000_000_000 });
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(makeEvent(after, before));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ 'metadata.phases': [], 'metadata.timingSummary': null }),
    );
  });
});
