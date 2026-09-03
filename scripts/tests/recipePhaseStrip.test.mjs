// scripts/backfill-recipe-times.mjs's second pass (issue #1210) selects on
// "has a phase strip", and `--verify` declares the library done on the same
// rule. That rule is a hand-copy of `recipePhaseTotals().hasPhases`
// (`packages/domain/src/recipe/queries/recipePhaseTotals.ts:33-42`) living in a
// file no typechecker reads, so CLAUDE.md rule 12 says pin it.
//
// The three rows that matter, and what each one costs if it drifts:
//
//   - ABSENT reads as no strip. Miss this and every pre-#1122 recipe — the whole
//     reason the pass exists — is skipped, and `--verify` exits 0 on a library
//     with no timelines in it.
//   - EMPTY reads as no strip. `reconcileRecipePhases` stores `phases: []` when
//     the model's answer omits a strip, stamped `timesEstimatedAt` in the same
//     write, so this is the exact state the second pass must still select.
//   - SUMS TO ZERO reads as a strip. Miss this and the pass re-asks a strip a
//     cook zeroed by hand and overwrites it — the #1202 phase-editor risk the
//     issue rejected `--redo` over.

import { describe, it, expect } from 'vitest';

import { decodeRecipePhases, hasPhaseStrip } from '../lib/recipePhaseStrip.mjs';

/** Firestore REST's encoding of one phase. */
const phaseValue = (label, handsOn, handsOff) => ({
  mapValue: {
    fields: {
      label: { stringValue: label },
      handsOnMinutes: { integerValue: String(handsOn) },
      handsOffMinutes: { integerValue: String(handsOff) },
    },
  },
});

describe('decodeRecipePhases', () => {
  it('reads an absent field as null — no key, not an empty strip', () => {
    expect(decodeRecipePhases(undefined)).toBeNull();
    expect(decodeRecipePhases(null)).toBeNull();
    // A `metadata` map with no `phases` key at all: the pre-#1122 document.
    expect(decodeRecipePhases({}.phases)).toBeNull();
  });

  it('reads a stored EMPTY array as [] — Firestore omits `values` entirely', () => {
    // This is the encoding, not a simplification: REST sends `{arrayValue:{}}`
    // for an empty array, with no `values` key. Decoding that as null would be
    // indistinguishable from "no key", and reading it as anything but an empty
    // list would make the reconcile outcome invisible.
    expect(decodeRecipePhases({ arrayValue: {} })).toEqual([]);
    expect(decodeRecipePhases({ arrayValue: { values: [] } })).toEqual([]);
  });

  it('decodes a populated strip into plain phases', () => {
    expect(
      decodeRecipePhases({
        arrayValue: { values: [phaseValue('Prep', 10, 0), phaseValue('Bake', 2, 35)] },
      }),
    ).toEqual([
      { label: 'Prep', handsOnMinutes: 10, handsOffMinutes: 0 },
      { label: 'Bake', handsOnMinutes: 2, handsOffMinutes: 35 },
    ]);
  });

  it('reads a non-integer minute out of doubleValue, and an absent one as 0', () => {
    expect(
      decodeRecipePhases({
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: { label: { stringValue: 'Rest' }, handsOffMinutes: { doubleValue: 7.5 } },
              },
            },
          ],
        },
      }),
    ).toEqual([{ label: 'Rest', handsOnMinutes: 0, handsOffMinutes: 7.5 }]);
  });
});

describe('hasPhaseStrip', () => {
  it('an ABSENT strip is no strip', () => {
    expect(hasPhaseStrip(decodeRecipePhases(undefined))).toBe(false);
  });

  it('an EMPTY strip is no strip — a fresh stamp over [] is a real stored state', () => {
    expect(hasPhaseStrip(decodeRecipePhases({ arrayValue: {} }))).toBe(false);
    expect(hasPhaseStrip([])).toBe(false);
  });

  it('a populated strip is a strip', () => {
    expect(
      hasPhaseStrip(decodeRecipePhases({ arrayValue: { values: [phaseValue('Cook', 5, 20)] } })),
    ).toBe(true);
  });

  it('a strip whose minutes SUM TO ZERO is still a strip', () => {
    // `hasPhases` is deliberately not `elapsedMinutes > 0`. Three named blocks a
    // cook zeroed by hand are a stated timing; re-asking would overwrite it.
    const zeroed = decodeRecipePhases({
      arrayValue: {
        values: [phaseValue('Mise en place', 0, 0), phaseValue('Assemble', 0, 0)],
      },
    });
    expect(zeroed.every((p) => p.handsOnMinutes + p.handsOffMinutes === 0)).toBe(true);
    expect(hasPhaseStrip(zeroed)).toBe(true);
  });

  it('anything that is not a list is no strip', () => {
    expect(hasPhaseStrip(null)).toBe(false);
    expect(hasPhaseStrip(undefined)).toBe(false);
    expect(hasPhaseStrip({ length: 3 })).toBe(false);
  });
});
