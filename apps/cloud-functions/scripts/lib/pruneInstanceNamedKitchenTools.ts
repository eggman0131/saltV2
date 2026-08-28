// The merge + partition logic of ../prune-instance-named-kitchen-tools.ts,
// lifted into a module a test can import. The script itself self-executes on
// import — it reaches Firestore via `applicationDefault()` credentials at
// module load, requires `GOOGLE_CLOUD_PROJECT` or calls `process.exit`, and
// reaches the network before `main()` even runs — so this logic had no seam
// otherwise. Same reason scripts/lib/recipeTimesEstimated.mjs,
// scripts/lib/recipeKitRequest.mjs and scripts/lib/ttlMigrationPlan.mjs exist
// at the repo root for their own scripts (see their headers). This one stays
// under `apps/cloud-functions` rather than the repo root because, unlike
// those plain-node scripts, it depends on `@salt/domain` — it is part of this
// app's dependency graph, not a standalone node ESM file.
//
// PR #1068 review (blocking): a union merge of the live collection with the
// seed table cannot tell a curated seed row apart from a live document that
// merely shares its id, once Phase 4 has actually seeded — by then every one
// of the 64 table rows IS a live document, so `live.has(tool.id)` is true for
// all of them and a guard built on that alone protects nothing. `seedIds`
// restores the distinction the guard is supposed to make: a pair is deletable
// only when its doomed side is a live document that is NOT (also) a seed id.

import { instanceNamedKitchenTools } from '@salt/domain';
import type { InstanceNamedKitchenTool } from '@salt/domain';
import type { KitchenToolDoc } from '@salt/domain/schemas';

export interface SeedTool {
  readonly id: string;
  readonly label: string;
  readonly matchers: readonly string[];
}

/** A tool as the resolver reads it. Only `id`, `label` and `matchers` are consulted. */
export function asDoc(id: string, label: string, matchers: readonly string[]): KitchenToolDoc {
  return {
    id,
    schemaVersion: 1,
    label,
    matchers: [...matchers],
    thumbnail: null,
    createdAt: '',
    updatedAt: '',
  };
}

export interface PrunePlan {
  readonly union: readonly KitchenToolDoc[];
  readonly deletable: readonly InstanceNamedKitchenTool[];
  readonly tableOnly: readonly InstanceNamedKitchenTool[];
}

/**
 * Merge the live collection with the seed table — live wins on id, since a
 * document curated since the table was written is what the operator is
 * looking at — run the shared instance-named query over the union, then
 * split the result into pairs safe to delete and pairs that must not be
 * touched.
 *
 * A pair is deletable ONLY when its doomed side is both a live document AND
 * not a seed id. The second half of that conjunction is the fix: without it,
 * a seed row that has since been written to Firestore by the seeder (the
 * ordinary post-Phase-4 state) reads as "live" and the row is proposed for
 * deletion — exactly the failure the header comment on the caller promises
 * cannot happen.
 */
export function planKitchenToolPrune(
  liveTools: readonly KitchenToolDoc[],
  seedTools: readonly SeedTool[],
): PrunePlan {
  const live = new Map(liveTools.map((tool) => [tool.id, tool] as const));

  const union = [...live.values()];
  for (const tool of seedTools) {
    if (!live.has(tool.id)) union.push(asDoc(tool.id, tool.label, tool.matchers));
  }

  const pairs = instanceNamedKitchenTools(union);
  const seedIds = new Set(seedTools.map((tool) => tool.id));
  const deletable = pairs.filter(({ tool }) => live.has(tool.id) && !seedIds.has(tool.id));
  const tableOnly = pairs.filter(({ tool }) => !live.has(tool.id) || seedIds.has(tool.id));

  return { union, deletable, tableOnly };
}
