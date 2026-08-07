// Shared "derive expectations, never hardcode them" helper (issue #722).
//
// Journeys that exercise matching need real ingredient names, and they must be
// names the environment already knows — a probe that invents names would create
// a new canon entry on every run against a prod-restored environment.

import { assert, type ProbeContext } from '../harness/runner.js';

export interface CanonSeed {
  readonly id: string;
  readonly name: string;
}

/**
 * Canon is a few hundred items; read enough of it that the single-word
 * preference below has something to choose from.
 */
const SAMPLE_SIZE = 300;

/**
 * Single-word names are preferred because the shopping-list trigger only calls
 * the entry-parse AI for compound (3+ word) raw text — so a one-word seed keeps
 * the rollup assertion measuring *matching* rather than parsing. It is a
 * preference, not a requirement: a sparsely populated environment falls back to
 * whatever names exist.
 */
export async function deriveCanonSeeds(ctx: ProbeContext, count: number): Promise<CanonSeed[]> {
  const snapshot = await ctx.admin.firestore.collection('canonItems').limit(SAMPLE_SIZE).get();

  const single: CanonSeed[] = [];
  const compound: CanonSeed[] = [];

  for (const doc of snapshot.docs) {
    const name = doc.get('name') as unknown;
    if (typeof name !== 'string' || name.trim() === '') continue;
    (name.trim().includes(' ') ? compound : single).push({ id: doc.id, name: name.trim() });
  }

  const seeds = [...single, ...compound].slice(0, count);
  assert(
    seeds.length === count,
    `need ${count} canon items to derive from, found ${seeds.length} in a ${SAMPLE_SIZE}-doc sample — is this environment's canon populated?`,
  );
  return seeds;
}
