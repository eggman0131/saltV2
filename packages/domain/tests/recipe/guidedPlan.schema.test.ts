import { describe, it, expect } from 'vitest';
import {
  GuidedPlanSchema,
  GenerateGuidedPlanAIOutputSchema,
  GenerateGuidedPlanInputSchema,
} from '@salt/domain/schemas';
import {
  GuidedCheckInSchema,
  GuidedPrepEntrySchema,
  GuidedStepNoteSchema,
} from '../../src/schemas/guidedPlan.js';

// The guided plan document (issue #751, Phase 1). Two properties carry most of
// the weight here: every absent content field reads back as a CONCRETE value
// (`.default(null)` / `.default([])`, the producesCanonId idiom) so no consumer
// ever has to think about `undefined`, and `needs_approval` is `.optional()` so
// ABSENT MEANS REVIEWED — a plan written entirely by hand is never flagged.

const PLAN = {
  id: 'recipe-1',
  schemaVersion: 1,
  recipeId: 'recipe-1',
  recipeUpdatedAtAtSave: '2026-08-01T09:00:00.000Z',
  prep: [
    {
      id: 'prep-1',
      text: 'Dice the carrots, onion and celery into 5mm pieces',
      container: 'small bowl',
      ingredientIds: ['ing-1', 'ing-2', 'ing-3'],
    },
  ],
  stepNotes: [
    {
      stepId: 'step-1',
      container: 'small bowl',
      setup: 'small hob burner, medium-low',
      cue: 'a very gentle sizzle, not a crackle',
      checkIns: [{ atMinutes: 5, text: 'give it a stir' }],
      lookahead: 'the sauce reduces by half',
      getAhead: 'preheat the oven to 200°C',
    },
  ],
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
} as const;

describe('GuidedPlanSchema', () => {
  it('round-trips a full plan verbatim', () => {
    expect(GuidedPlanSchema.parse(PLAN)).toEqual(PLAN);
  });

  it('defaults the two collections so a bare plan reads as empty, not undefined', () => {
    const parsed = GuidedPlanSchema.parse({
      id: 'recipe-2',
      schemaVersion: 1,
      recipeId: 'recipe-2',
      recipeUpdatedAtAtSave: '2026-08-01T09:00:00.000Z',
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-01T09:00:00.000Z',
    });
    expect(parsed.prep).toEqual([]);
    expect(parsed.stepNotes).toEqual([]);
  });

  it('treats an absent needs_approval as reviewed — never as false-on-the-wire', () => {
    // Same used-but-flagged contract as RecipeSchema: the flag is dropped by a
    // save rather than written `false`, so absence is the reviewed state.
    const parsed = GuidedPlanSchema.parse(PLAN);
    expect(parsed.needs_approval).toBeUndefined();
    expect('needs_approval' in parsed).toBe(false);
    expect(GuidedPlanSchema.parse({ ...PLAN, needs_approval: true }).needs_approval).toBe(true);
  });

  it('pins schemaVersion to 1', () => {
    expect(GuidedPlanSchema.safeParse({ ...PLAN, schemaVersion: 2 }).success).toBe(false);
  });

  it('has NO ownerUid — a plan is family-shared, not a fourth per-user collection', () => {
    const parsed = GuidedPlanSchema.parse(PLAN);
    expect('ownerUid' in parsed).toBe(false);
  });
});

describe('GuidedPrepEntrySchema', () => {
  it('defaults container to null and ingredientIds to []', () => {
    // "Open the tin of tomatoes" — a job with nothing to set aside.
    const parsed = GuidedPrepEntrySchema.parse({ id: 'p1', text: 'Open the tin of tomatoes' });
    expect(parsed.container).toBeNull();
    expect(parsed.ingredientIds).toEqual([]);
  });
});

describe('GuidedStepNoteSchema', () => {
  it('defaults every addition to null and check-ins to []', () => {
    const parsed = GuidedStepNoteSchema.parse({ stepId: 'step-9' });
    expect(parsed.container).toBeNull();
    expect(parsed.setup).toBeNull();
    expect(parsed.cue).toBeNull();
    expect(parsed.checkIns).toEqual([]);
    expect(parsed.lookahead).toBeNull();
    expect(parsed.getAhead).toBeNull();
  });

  it('BACK-COMPAT: a note written before the look-ahead fields reads as null, not undefined', () => {
    // Issue #769 added `lookahead`/`getAhead` to a document that was already in
    // Firestore. Every plan written before it is in exactly this state, and the
    // cook page's fallback ("no look-ahead → the plain fade") is a null check —
    // so an `undefined` leaking through would be a different branch entirely.
    const parsed = GuidedStepNoteSchema.parse({
      stepId: 'step-1',
      container: 'small bowl',
      setup: null,
      cue: null,
      checkIns: [],
    });
    expect(parsed.lookahead).toBeNull();
    expect(parsed.getAhead).toBeNull();
    expect(parsed.container).toBe('small bowl');
  });
});

describe('GuidedCheckInSchema', () => {
  it('requires a positive atMinutes', () => {
    expect(GuidedCheckInSchema.safeParse({ atMinutes: 0, text: 'stir' }).success).toBe(false);
    expect(GuidedCheckInSchema.safeParse({ atMinutes: -3, text: 'stir' }).success).toBe(false);
    expect(GuidedCheckInSchema.safeParse({ atMinutes: 5, text: 'stir' }).success).toBe(true);
  });

  it('cannot see the step timer, so the upper bound is NOT its job', () => {
    // The schema holds no recipe, so "before the timer runs out" is unanswerable
    // here — that cross-check lives in the editor, where the recipe is in hand.
    expect(GuidedCheckInSchema.safeParse({ atMinutes: 9999, text: 'stir' }).success).toBe(true);
  });
});

describe('generateGuidedPlan flow schemas', () => {
  it('takes only a recipe id — the flow reads the recipe server-side', () => {
    expect(GenerateGuidedPlanInputSchema.safeParse({ recipeId: 'recipe-1' }).success).toBe(true);
    expect(GenerateGuidedPlanInputSchema.safeParse({ recipeId: '' }).success).toBe(false);
  });

  it('returns CONTENT only — no ids, no control fields', () => {
    const parsed = GenerateGuidedPlanAIOutputSchema.parse({
      prep: [{ text: 'Weigh 400g passata', container: 'jug', ingredientIds: ['ing-4'] }],
      stepNotes: [
        {
          stepId: 'step-1',
          container: null,
          setup: null,
          cue: null,
          checkIns: [],
          lookahead: 'the sauce reduces by half',
          getAhead: null,
        },
      ],
    });
    expect(parsed.prep[0]).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('needs_approval');
    expect(parsed).not.toHaveProperty('recipeUpdatedAtAtSave');
  });

  it('demands every content field explicitly — the model is never let off by a default', () => {
    // The AI schemas deliberately carry no `.default()`: it is handed to Gemini as
    // a structured-output schema, and the doc defaults are a READ contract for
    // documents already in Firestore, not a licence for the model to omit fields.
    expect(
      GenerateGuidedPlanAIOutputSchema.safeParse({
        prep: [{ text: 'Weigh 400g passata' }],
        stepNotes: [],
      }).success,
    ).toBe(false);
  });
});
