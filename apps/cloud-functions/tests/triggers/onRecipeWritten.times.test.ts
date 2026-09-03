import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecipeDoc } from '@salt/domain/schemas';

// The re-estimate branch of `onRecipeWritten`: what it writes, and the four
// conditions on which it writes nothing.
//
// It used to carry `floorTotalAtStoredWait` — the guard that stopped a sweep
// overwriting a stored `totalTimeMinutes` whose excess over prep + cook recorded
// a real unattended wait. That guard, and the three fields it protected, went in
// #1213: an unattended wait is now a phase's hands-off minutes, which the model
// is asked for explicitly and cannot lose to arithmetic. What protects a stored
// strip from a model answer that omits one is `reconcileRecipePhases`, pinned in
// onRecipeWritten.phases.test.ts.

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
// Routed BY COLLECTION, not undifferentiated. The recipe document and the
// `devSettings/singleton` kill-switch are read through the same
// `getFirestore()`, so a mock that answers every `doc()` identically cannot
// express "the switch is off" — which is why that early return went untested.
// `null` means the doc is absent, and the switch fails open (see
// `isRecipeImageGenerationEnabled`): that is the state every other test here
// runs in.
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

// The reviewer's own worked example: Overnight No Knead Focaccia. Its prove is
// prose ("cover and leave overnight") with no `step.timer`, so 762 has no
// arithmetic route back from the flow's inputs.
function focaccia(overrides: Partial<RecipeDoc> = {}): RecipeDoc {
  return {
    id: 'focaccia',
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Overnight No Knead Focaccia',
    description: 'A wet dough, proved overnight, baked hot and fast.',
    ingredients: [],
    steps: [
      { id: 's1', text: 'Mix and cover; leave overnight to prove.', timer: null, note: null },
    ],
    metadata: {
      servings: null,
      prepTimeMinutes: 30,
      cookTimeMinutes: 12,
      totalTimeMinutes: 762,
      tags: [],
    },
    source: null,
    notes: null,
    // Set so the sibling hero-image branch cannot fire.
    image: { url: 'https://example.test/focaccia.png', source: 'ai' },
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

describe('onRecipeWritten — what the time branch writes', () => {
  it('writes TWO metadata leaves and the stamp, and nothing else', async () => {
    mockEstimateTimes.mockResolvedValue({
      phases: [
        { label: 'Mix', handsOnMinutes: 30, handsOffMinutes: 0 },
        { label: 'Prove overnight', handsOnMinutes: 0, handsOffMinutes: 720 },
      ],
      timingSummary: 'Half an hour of you, spread over 12 hours.',
    });

    const before = { timesRequestedAt: undefined };
    const after = focaccia({ timesRequestedAt: 1_700_000_000_000 });
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(makeEvent(after, before));

    // EXACT, not `objectContaining`. The safety property this branch rests on is
    // that the write is two `metadata.*` LEAF paths plus the stamp — never a
    // document `set`, and never a whole `metadata` map, because recipes are
    // last-write-wins per WHOLE document and this branch is driven by a sweep of
    // the entire library. `objectContaining` passes a payload that keeps the two
    // leaves and adds a third key beside them, which is most of the way back to
    // the clobber the shape was chosen to avoid. Only the clock is loosened.
    expect(mockUpdate).toHaveBeenCalledWith({
      'metadata.phases': [
        { label: 'Mix', handsOnMinutes: 30, handsOffMinutes: 0 },
        { label: 'Prove overnight', handsOnMinutes: 0, handsOffMinutes: 720 },
      ],
      'metadata.timingSummary': 'Half an hour of you, spread over 12 hours.',
      timesEstimatedAt: expect.any(Number),
    });
  });

  // The retired numbers are declared on the flow's output schema until #1211
  // removes them, so a stale build returning them must not put them back on the
  // document. `toHaveBeenCalledWith` above is exact, so this is belt and braces
  // over the one path where a value could leak in from outside.
  it('writes no prep, cook or total path even if the flow still returns them', async () => {
    mockEstimateTimes.mockResolvedValue({
      prepTimeMinutes: 30,
      cookTimeMinutes: 12,
      totalTimeMinutes: 45,
      phases: [],
      timingSummary: null,
    });

    const after = focaccia({ timesRequestedAt: 1_700_000_000_000 });
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(
      makeEvent(after, { timesRequestedAt: undefined }),
    );

    expect(Object.keys(mockUpdate.mock.calls[0]![0] as object)).toEqual([
      'metadata.phases',
      'metadata.timingSummary',
      'timesEstimatedAt',
    ]);
  });
});

// The four conditions on which `maybeEstimateTimes` returns having done nothing
// and said nothing. Each is deliberate and each is silent, so nothing but a test
// distinguishes "this guard held" from "this branch quietly stopped working" —
// and the branch is only ever exercised by a library-wide sweep, where a guard
// that stopped holding costs one AI call per recipe before anyone notices.
//
// The assertion is on the FLOW, not on the write: not calling the model is the
// property, and the sibling image/kit branches share `mockUpdate`.
describe('onRecipeWritten — time branch early returns are silent, so they are pinned here', () => {
  const requested = { timesRequestedAt: 1_700_000_000_000 };

  it('does not estimate for an entry that is not cookable', async () => {
    // Asked through the pure capability predicate, exactly as the branch does —
    // an outing is a restaurant, and a restaurant has no prep time.
    const after = focaccia({ ...requested, kind: 'outing' } as Partial<RecipeDoc>);
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(
      makeEvent(after, { timesRequestedAt: undefined }),
    );

    expect(mockEstimateTimes).not.toHaveBeenCalled();
  });

  it('does not estimate a recipe with no steps', async () => {
    // No method is no evidence: a number invented from a title alone is worse
    // than the optimistic one it would replace.
    const after = focaccia({ ...requested, steps: [] });
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(
      makeEvent(after, { timesRequestedAt: undefined }),
    );

    expect(mockEstimateTimes).not.toHaveBeenCalled();
  });

  it('does not estimate under the e2e AI fake flag', async () => {
    process.env['FUNCTIONS_AI_FAKE'] = '1';

    const after = focaccia(requested);
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(
      makeEvent(after, { timesRequestedAt: undefined }),
    );

    expect(mockEstimateTimes).not.toHaveBeenCalled();
  });

  it('does not estimate when the recipe-content kill-switch is off', async () => {
    // The last of the four, and the only one that costs a Firestore read — so a
    // fixture that trips an earlier guard would pass this test for the wrong
    // reason. `focaccia(requested)` is the same fixture the writing tests above
    // use, which is what makes the switch the only thing that changed.
    mockDevSettings = { recipeImageGenerationEnabled: false };

    const after = focaccia(requested);
    await (onRecipeWritten as unknown as (e: unknown) => Promise<void>)(
      makeEvent(after, { timesRequestedAt: undefined }),
    );

    expect(mockEstimateTimes).not.toHaveBeenCalled();
  });
});
