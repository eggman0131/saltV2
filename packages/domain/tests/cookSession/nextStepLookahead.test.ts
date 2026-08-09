import { describe, it, expect } from 'vitest';
import { nextStepLookahead } from '@salt/domain';
import type { Recipe } from '@salt/domain';
import type { GuidedStepNoteDoc, StepDoc } from '@salt/domain/schemas';

// What the plan says about the step BELOW the one on screen (issue #769), in place
// of plain cook mode's faded first clause of the next step.
//
// The whole point of the shape is that a look-ahead is stored on the step it
// DESCRIBES and read from the step before, so the tests below are mostly about the
// off-by-one that arrangement makes possible, and about the four ways there is
// nothing to say — each of which has to come back as one null, because the caller's
// fallback to the plain fade is a single branch.

function step(id: string, text = `do ${id}`): StepDoc {
  return { id, text, timer: null, note: null };
}

function recipe(steps: StepDoc[]): Recipe {
  return {
    id: 'r1',
    schemaVersion: 1,
    kind: 'recipe',
    title: 'Weeknight ragù',
    description: null,
    ingredients: [],
    steps,
    metadata: {
      servings: null,
      totalTimeMinutes: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      tags: [],
    },
    source: null,
    notes: null,
    producesCanonId: null,
    image: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  };
}

function note(stepId: string, over: Partial<GuidedStepNoteDoc> = {}): GuidedStepNoteDoc {
  return {
    stepId,
    container: null,
    setup: null,
    cue: null,
    checkIns: [],
    lookahead: null,
    getAhead: null,
    ...over,
  };
}

const THREE = recipe([step('s1'), step('s2'), step('s3')]);

describe('nextStepLookahead', () => {
  it('reads the NEXT step’s note, not the current one’s', () => {
    const result = nextStepLookahead(
      THREE,
      [
        note('s1', { lookahead: 'this is the step you are on' }),
        note('s2', { lookahead: 'the sauce reduces by half' }),
      ],
      's1',
    );
    expect(result?.lookahead).toBe('the sauce reduces by half');
    expect(result?.stepId).toBe('s2');
  });

  it('numbers the next step as the cook sees it — 1-based, and its own position', () => {
    // Step 2 of 3 is on screen, so the preview is of step 3. A test worth having
    // because the index this is computed from is the CURRENT step's.
    const result = nextStepLookahead(THREE, [note('s3', { lookahead: 'it rests' })], 's2');
    expect(result?.number).toBe(3);
  });

  it('carries the get-ahead line, which is the reason the panel earns its space', () => {
    const result = nextStepLookahead(
      THREE,
      [note('s2', { lookahead: 'it goes in the oven', getAhead: 'preheat the oven to 200°C' })],
      's1',
    );
    expect(result?.getAhead).toBe('preheat the oven to 200°C');
    expect(result?.lookahead).toBe('it goes in the oven');
  });

  it('answers on a get-ahead ALONE — a bare "start the oven now" is the whole point', () => {
    const result = nextStepLookahead(
      THREE,
      [note('s2', { getAhead: 'take the steak out of the fridge' })],
      's1',
    );
    expect(result).not.toBeNull();
    expect(result?.lookahead).toBeNull();
    expect(result?.getAhead).toBe('take the steak out of the fridge');
  });

  it('follows the METHOD, not the ticking — a completed next step still previews', () => {
    // Completion is not an input here on purpose: this describes what is physically
    // below the step on screen, and ticking things off in an odd order moves the
    // cook, never the method.
    const result = nextStepLookahead(THREE, [note('s2', { lookahead: 'it simmers' })], 's1');
    expect(result?.stepId).toBe('s2');
  });

  describe('returns null wherever there is nothing to preview', () => {
    it('no current step', () => {
      expect(nextStepLookahead(THREE, [note('s1', { lookahead: 'x' })], null)).toBeNull();
    });

    it('a current step the recipe no longer has', () => {
      expect(nextStepLookahead(THREE, [note('s2', { lookahead: 'x' })], 'deleted')).toBeNull();
    });

    it('the last step — there is nothing below it', () => {
      expect(nextStepLookahead(THREE, [note('s3', { lookahead: 'x' })], 's3')).toBeNull();
    });

    it('a next step with no note at all', () => {
      expect(nextStepLookahead(THREE, [], 's1')).toBeNull();
    });

    it('a next step whose note says everything EXCEPT a look-ahead', () => {
      // The common case for a while: a plan written before #769 has containers,
      // setups and cues and neither of these two fields. It must read as the plain
      // fade rather than as an empty panel.
      const result = nextStepLookahead(
        THREE,
        [note('s2', { container: 'onion bowl', setup: 'medium-low', cue: 'a gentle sizzle' })],
        's1',
      );
      expect(result).toBeNull();
    });

    it('a recipe with no steps at all', () => {
      expect(nextStepLookahead(recipe([]), [note('s2', { lookahead: 'x' })], 's1')).toBeNull();
    });

    it('a look-ahead that is blank rather than absent', () => {
      // An empty panel covering the next step is strictly worse than the fade it
      // replaced, so blank has to mean the same as null here rather than one line
      // down in the markup.
      expect(nextStepLookahead(THREE, [note('s2', { lookahead: '   ' })], 's1')).toBeNull();
      expect(nextStepLookahead(THREE, [note('s2', { lookahead: '' })], 's1')).toBeNull();
    });

    it('a note that predates the fields entirely, carrying neither key', () => {
      // A parsed document always reads back `string | null`. A note arriving from
      // anywhere else — a hand-edited doc, a draft, a fixture — can be missing the
      // keys outright, and `undefined === null` is false.
      const legacy = { stepId: 's2', container: null, setup: null, cue: null, checkIns: [] };
      expect(nextStepLookahead(THREE, [legacy as GuidedStepNoteDoc], 's1')).toBeNull();
    });
  });

  it('drops a blank half of an otherwise real answer', () => {
    const result = nextStepLookahead(
      THREE,
      [note('s2', { lookahead: '  ', getAhead: 'boil the kettle' })],
      's1',
    );
    expect(result?.lookahead).toBeNull();
    expect(result?.getAhead).toBe('boil the kettle');
  });

  it('is pure — it reads the notes and mutates nothing', () => {
    const notes = [note('s2', { lookahead: 'it simmers', getAhead: 'boil the kettle' })];
    const before = JSON.parse(JSON.stringify(notes)) as unknown;
    nextStepLookahead(THREE, notes, 's1');
    expect(notes).toEqual(before);
  });
});
