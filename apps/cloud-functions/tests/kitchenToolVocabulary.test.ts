import { describe, expect, it } from 'vitest';
import { resolveKitchenTool, normaliseName } from '@salt/domain';
import type { KitchenToolDoc } from '@salt/domain/schemas';

import { TOOLS } from '../scripts/kitchen-tool-vocabulary.mjs';
import { PRODUCTION_KIT_LABELS } from './support/productionKitLabels.js';

// Does the curated vocabulary actually name what our recipes ask for? (Issue
// #956.)
//
// The seed table is a hand-written list, and before this test the only way to
// know whether a row was pulling its weight was to read it and guess. That is how
// the vocabulary drifted: forty tools that named the objects a kitchen obviously
// has, against a library that had since asked for a rice cooker, a mandoline and
// a chinois — and, eleven times, a "large mixing bowl".
//
// So the table is measured, not reviewed, and it is measured THROUGH THE REAL
// RESOLVER. A second, test-flavoured notion of "does this match?" would let the
// table pass here and miss in the app, which is the one failure this file exists
// to make impossible. `resolveKitchenTool` is imported, never reimplemented.
//
// What it does NOT do is reach for Firestore. The labels are a committed snapshot
// (see the fixture's header) precisely so a red here means somebody changed the
// table, never that production moved overnight.

interface SeedTool {
  readonly id: string;
  readonly label: string;
  readonly matchers: readonly string[];
}

const SEED: readonly SeedTool[] = TOOLS as readonly SeedTool[];

/** The seed rows as the documents the seeder writes, which is what the resolver reads. */
const VOCABULARY: readonly KitchenToolDoc[] = SEED.map((tool) => ({
  id: tool.id,
  schemaVersion: 1,
  label: tool.label,
  matchers: [...tool.matchers],
  thumbnail: null,
  createdAt: '',
  updatedAt: '',
}));

// Labels the vocabulary is deliberately not drawing. EMPTY, and that is the
// point: every one of production's observed kit labels lands on a picture. A
// future label that genuinely should not be drawn goes here WITH A REASON beside
// it, so "we gave up on this one" can never be spelled the same way as "this
// still works".
const DELIBERATELY_UNRESOLVED: readonly string[] = [];

describe('the seeded kitchen-tool vocabulary', () => {
  it('names every kit label production has asked for', () => {
    const unresolved = PRODUCTION_KIT_LABELS.filter(
      ([label]) =>
        !DELIBERATELY_UNRESOLVED.includes(label) && resolveKitchenTool(label, VOCABULARY) === null,
    );
    // Reported as label+count rather than a bare boolean: a failure here is a
    // curation decision, and the person making it needs to see whether the gap is
    // one mention or eleven.
    expect(unresolved.map(([label, n]) => `${label} (x${n})`)).toEqual([]);
  });

  it('draws one object per real tool, not one per adjective', () => {
    const drawn = new Set(
      PRODUCTION_KIT_LABELS.map(([label]) => resolveKitchenTool(label, VOCABULARY)?.id),
    );
    // 88 spellings, 46 objects. The ceiling is what the defect was about: curating
    // this queue one row at a time would have minted a document and an AI-drawn
    // pictogram per SPELLING. Loosen it only with a measurement, never to make a
    // red go away.
    expect(drawn.size).toBeLessThanOrEqual(50);
    expect(drawn.size).toBeLessThan(PRODUCTION_KIT_LABELS.length / 1.5);
  });

  it('keeps the whole drawn vocabulary near the number of real kitchen objects', () => {
    // Every row is one Gemini image and one document. 64 = the 40 judged for #882
    // (twelve of them still speculative, kept on purpose) plus the 24 real objects
    // behind the 38 labels the original table could not name.
    expect(SEED.length).toBeLessThanOrEqual(65);
  });

  it('folds the whole bowl cluster onto one pictogram, minus the deliberate second bowl', () => {
    // The headline case, and the one prod's `large-mixing-bowl` document breaks by
    // shadowing: every adjective in front of "bowl" is the same drawing.
    for (const label of [
      'large mixing bowl',
      'mixing bowl',
      'medium mixing bowl',
      'large bowl',
      'serving bowl',
      'large serving bowl',
      'heatproof bowl',
      'large heatproof bowl',
      'pasta bowl',
      'bowl',
    ]) {
      expect(resolveKitchenTool(label, VOCABULARY)?.id, label).toBe('mixing-bowl');
    }
    // `Small bowl` is a second bowl ON PURPOSE — a ramekin is not a mixing bowl —
    // and longest-phrase-wins is what keeps it reachable.
    expect(resolveKitchenTool('small bowl', VOCABULARY)?.id).toBe('small-bowl');
  });

  it('keeps appliances that merely share a head noun apart', () => {
    // The reason the parent suggestion is advisory and the resolver has no
    // head-noun fallback: these four are not four sizes of one machine.
    expect(resolveKitchenTool('rice cooker', VOCABULARY)?.id).toBe('rice-cooker');
    expect(resolveKitchenTool('pressure cooker', VOCABULARY)?.id).toBe('pressure-cooker');
    expect(resolveKitchenTool('slow cooker', VOCABULARY)?.id).toBe('slow-cooker');
    expect(resolveKitchenTool('sous-vide precision cooker', VOCABULARY)?.id).toBe(
      'sous-vide-circulator',
    );
    expect(resolveKitchenTool('electric hand mixer', VOCABULARY)?.id).toBe('hand-mixer');
    expect(resolveKitchenTool('stand mixer', VOCABULARY)?.id).toBe('stand-mixer');
  });

  it('gives every tool a distinct id', () => {
    const ids = SEED.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never spells one phrase twice, in a tool or across two', () => {
    // Two tools answering to the same normalised phrase is a coin toss decided by
    // table order, and a matcher repeating its own tool's label is dead weight the
    // admin page's `normaliseMatchers` would strip on the first edit — leaving the
    // seeded document and the edited one disagreeing about what the tool is called.
    const owner = new Map<string, string>();
    const collisions: string[] = [];
    for (const tool of SEED) {
      for (const phrase of [tool.label, ...tool.matchers]) {
        const key = normaliseName(phrase);
        expect(key, `${tool.id}: "${phrase}" normalises away entirely`).not.toBe('');
        const held = owner.get(key);
        if (held) collisions.push(`"${key}" on both ${held} and ${tool.id}`);
        else owner.set(key, tool.id);
      }
    }
    expect(collisions).toEqual([]);
  });
});
