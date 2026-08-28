import { describe, expect, it } from 'vitest';
import type { KitchenToolDoc } from '@salt/domain/schemas';

import { asDoc, planKitchenToolPrune } from '../scripts/lib/pruneInstanceNamedKitchenTools.js';
import type { SeedTool } from '../scripts/lib/pruneInstanceNamedKitchenTools.js';
import { TOOLS } from '../scripts/kitchen-tool-vocabulary.mjs';

// Regression coverage for the PR #1068 review's blocking finding: the prune
// script's "table-only rows are never deleted" guard evaporates the moment
// Phase 4 has actually seeded, because at that point `live.has(tool.id)` is
// true for every seed row too. Before this file, `planKitchenToolPrune`'s
// merge/partition logic (previously inline in the self-executing script) had
// neither a test nor a typecheck — `apps/cloud-functions/tsconfig.json`
// includes only `src/**`, and no test imported the script — so this is also
// the fix for the coverage gap that let the finding through, not just the
// finding itself.

const SEED: readonly SeedTool[] = TOOLS as readonly SeedTool[];
const SEED_IDS = new Set(SEED.map((tool) => tool.id));

/** The seed rows as the documents the seeder writes — i.e. the post-Phase-4 state. */
const SEEDED_DOCS: readonly KitchenToolDoc[] = SEED.map((tool) =>
  asDoc(tool.id, tool.label, tool.matchers),
);

describe('planKitchenToolPrune', () => {
  it('never proposes a seed-table row for deletion — the "Tin" interloper', () => {
    // Production holds the full seeded vocabulary plus one operator-created
    // `kitchenTools/tin` labelled "Tin" — creatable today, since
    // `createKitchenTool` refuses only an identical slug. The buggy version of
    // this function proposed cake-tin, loaf-tin, roasting-tin AND tin-opener
    // for deletion here, because all four are (also) live post-seed and the
    // old guard checked nothing else.
    const live = [...SEEDED_DOCS, asDoc('tin', 'Tin', [])];
    const plan = planKitchenToolPrune(live, SEED);

    const seedRowsProposed = plan.deletable
      .filter(({ tool }) => SEED_IDS.has(tool.id))
      .map(({ tool }) => tool.id)
      .sort();

    expect(seedRowsProposed).toEqual([]);
  });

  it('never proposes a seed-table row for deletion — the "Bowl" interloper', () => {
    // The sharpest case: `small-bowl` is the row this PR's own thesis says the
    // criterion can never flag ("a ramekin is a deliberate second drawing").
    // That guarantee holds only against the seed table in isolation — once a
    // live `Bowl` document exists, `small-bowl`'s label is contained in it
    // exactly like `mixing-bowl`'s is, and the old guard let both through.
    const live = [...SEEDED_DOCS, asDoc('bowl', 'Bowl', [])];
    const plan = planKitchenToolPrune(live, SEED);

    const seedRowsProposed = plan.deletable
      .filter(({ tool }) => SEED_IDS.has(tool.id))
      .map(({ tool }) => tool.id)
      .sort();

    expect(seedRowsProposed).toEqual([]);
  });

  it('still proposes a genuine live-document duplicate — large-mixing-bowl shadows mixing-bowl', () => {
    // Phase 4 step 2's own scenario, at the pure-function level: a live
    // document minted before issue #956 shipped (`large-mixing-bowl`, not a
    // seed id) shadows the seeded `mixing-bowl` row. This must stay deletable
    // — the fix narrows the guard to seed ids, it must not also protect a
    // live document that happens to shadow a seed row.
    const live = [asDoc('large-mixing-bowl', 'Large mixing bowl', [])];
    const plan = planKitchenToolPrune(live, SEED);

    expect(plan.deletable.map(({ tool, parent }) => [tool.id, parent.id])).toEqual([
      ['large-mixing-bowl', 'mixing-bowl'],
    ]);
  });

  it('proposes nothing once the collection is exactly the post-seed state', () => {
    // All 64 rows live, no interloper — the state Phase 4's DoD asks a re-run
    // to report clean against.
    const plan = planKitchenToolPrune(SEEDED_DOCS, SEED);

    expect(plan.deletable).toEqual([]);
    expect(plan.tableOnly).toEqual([]);
  });
});
