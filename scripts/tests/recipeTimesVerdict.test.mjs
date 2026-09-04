// The defect in issue #1248: `--verify` failed on a condition no run could
// clear. Its exit code required `total >= prep + cook` over three fields #1233
// stopped writing and #1211 deleted, so any environment holding a pre-#1211
// document with an impossible triple (Paneer Makhanwala: prep 10, cook 35,
// total 35) exited 1 no matter how complete the sweep was — and
// docs/runbooks/recipe-times-backfill.md tells an operator to treat exit 0 as
// the gate for moving on to the next environment.
//
// Two claims are pinned here, because one of them alone would not be enough:
//
//   1. the verdict itself ignores everything but the stamp and the strip — the
//      positive property, checked on a recipe that carries the impossible
//      triple; and
//   2. THIS FILE — backfill-recipe-times.mjs itself — no longer names the three
//      retired keys anywhere in its own text. Claim 1 lives in a module the
//      script imports, so on its own it cannot see a second gate re-added
//      beside the call (`broken.length === 0 && ok`) — which is exactly the
//      shape the bug had. Claim 2 closes that one path.
//
// Claim 2's boundary (CLAUDE.md hard rule 12: state it rather than pretend the
// absolute holds): this is a grep of one file's text, not a property of the
// dependency graph. A gate re-added behind a NEW `scripts/lib/` module — the
// very style #1248 and #1254 both use — would leave this script naming none of
// the three keys and this test green, because the arithmetic would live in the
// imported module's text, not this one's. Nothing here defends against that;
// only reading the diff on a script/lib change does. What this closes is
// narrower and still real: the exact regression shape #1248 shipped, an
// operator re-typing the retired field names directly into this file.
//
// Neither claim reaches the trigger or the schema, and neither is meant to:
// packages/domain and apps/cloud-functions are out of scope for #1248, and the
// back-compat property that a stored legacy triple keeps PARSING is pinned
// separately at packages/domain/tests/recipe/recipe.schema.test.ts:146-176.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { recipeTimesVerdict } from '../lib/recipeTimesVerdict.mjs';

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'backfill-recipe-times.mjs',
);

describe('recipeTimesVerdict', () => {
  it('passes a stamped, stripped recipe that still stores an impossible legacy triple', () => {
    // The #952 symptom document, as it still sits in dev, staging and prod: the
    // sweep has done everything it can to it, and the retired numbers remain.
    // Before #1248 this row alone forced exit 1 on the whole project.
    const paneerMakhanwala = {
      id: '3e2352d8-7a35-4b0a-8754-7b9b172156fb',
      title: 'Paneer Makhanwala with Fragrant Rice and Kachumber Salad',
      estimated: true,
      hasStrip: true,
      // Deliberately present: a caller that decoded these would still get a
      // clean verdict. Re-adding an arithmetic term turns this test red.
      metadata: { prepTimeMinutes: 10, cookTimeMinutes: 35, totalTimeMinutes: 35 },
    };

    const verdict = recipeTimesVerdict([paneerMakhanwala]);

    expect(verdict.ok).toBe(true);
    expect(verdict.pending).toEqual([]);
    expect(verdict.noStrip).toEqual([]);
  });

  it('fails, and lists the recipe, when the stamp is missing', () => {
    const unstamped = { id: 'a', title: 'A', estimated: false, hasStrip: true };

    const verdict = recipeTimesVerdict([unstamped]);

    expect(verdict.ok).toBe(false);
    expect(verdict.pending).toEqual([unstamped]);
    expect(verdict.noStrip).toEqual([]);
  });

  it('fails, and lists the recipe, when the phase strip is missing', () => {
    const stripless = { id: 'b', title: 'B', estimated: true, hasStrip: false };

    const verdict = recipeTimesVerdict([stripless]);

    expect(verdict.ok).toBe(false);
    expect(verdict.pending).toEqual([]);
    expect(verdict.noStrip).toEqual([stripless]);
  });

  it('is clean on an empty library — no cookable recipe is nothing outstanding', () => {
    expect(recipeTimesVerdict([])).toEqual({ pending: [], noStrip: [], ok: true });
  });

  it('reports both lists at once, counting a recipe in each it fails', () => {
    const both = { id: 'c', title: 'C', estimated: false, hasStrip: false };
    const fine = { id: 'd', title: 'D', estimated: true, hasStrip: true };

    const verdict = recipeTimesVerdict([both, fine]);

    expect(verdict.ok).toBe(false);
    expect(verdict.pending).toEqual([both]);
    expect(verdict.noStrip).toEqual([both]);
  });
});

describe('backfill-recipe-times.mjs itself no longer reads the retired time fields', () => {
  // Claim 2 above, and its boundary: this reads ONE file's text, not the
  // dependency graph, so it cannot see the same key re-arriving via a new
  // scripts/lib/ module's own source. See the header comment for what that
  // does and does not close.
  it.each(['prepTimeMinutes', 'cookTimeMinutes', 'totalTimeMinutes'])(
    'names %s nowhere in backfill-recipe-times.mjs',
    (field) => {
      // `.includes(...)` rather than `.not.toContain(field)`: the latter dumps
      // the whole 470-line script into the failure output.
      expect(readFileSync(SCRIPT, 'utf8').includes(field)).toBe(false);
    },
  );
});
