// One-off operator script: delete `kitchenTools` documents named after an
// INSTANCE of a tool the vocabulary already draws.
//
// WHY THIS EXISTS — `resolveKitchenTool` is token-aligned containment with
// longest-normalised-phrase-wins, so a document called `Large mixing bowl`
// SHADOWS a `Mixing bowl` seeded beside it for the label "large mixing bowl" —
// which is production's single most-asked-for piece of kit (11 mentions). The
// duplicate is not merely a wasted drawing; it captures the label the generic row
// exists to answer, and seeding cannot fix that. The document has to go.
//
// Production acquired one of these the way the admin queue invited: `New tool`
// was the first button on every row, and `createKitchenTool` guards only an
// IDENTICAL slug, so `large-mixing-bowl` beside `mixing-bowl` was accepted in
// silence. Issue #956 fixed the queue; this removes what it already minted.
//
// SAME PREDICATE AS THE TABLE'S OWN TEST. `instanceNamedKitchenTools` is a pure
// domain query, and `tests/kitchenToolVocabulary.test.ts` asserts it returns
// nothing for the seed table. Running the identical function here is what stops
// "duplicate" meaning one thing offline and another in production.
//
// IT READS THE SEED TABLE TOO, and this is the point of the script rather than an
// optimisation. The duplicate is only visible as a duplicate once the row it
// shadows exists: against production's four live documents alone, nothing
// contains anything. Merging the live collection with `TOOLS` shows the operator
// the collision BEFORE the seeder writes it, which is why this runs between the
// contact sheet and `--apply` rather than after.
//
// WHY IT IS SAFE TO REMOVE — no recipe, guided plan or cook session ever stores a
// tool id. `resolveKitchenTool` runs at DISPLAY time over whatever the collection
// currently holds, so deleting a document re-points every recipe that used its
// words onto the parent's picture with zero writes to any recipe. That is the
// whole design of #882 and it is what makes this a one-document delete instead of
// a migration.
//
// STORAGE IS NOT TOUCHED. `kit-icons/{id}.webp` is reclaimed by the existing
// weekly orphan sweep, which joins drawings to documents on exactly this id
// (`src/maintenance/storageSweepTargets.ts`). Hand-deleting the object here would
// duplicate that logic and risk removing one the sweep still considers live.
//
// TABLE-ONLY ROWS ARE NEVER DELETED. A pair whose doomed side came from `TOOLS`
// rather than Firestore is a defect in the seed table — the table's test would be
// red — and the fix is an edit to the table, not a write to production. Such a
// pair is reported and skipped.
//
// SAFE BY DEFAULT: dry run (prints every proposed deletion) unless `--apply`.
// No Gemini key, no image generation, no Storage call — the dangerous step of
// issue #956's Phase 4 is deliberately the cheap one.
//
// USAGE (from apps/cloud-functions) — needs ADC only:
//   GOOGLE_CLOUD_PROJECT=s2-prod-e46bd pnpm exec tsx scripts/prune-instance-named-kitchen-tools.ts
//   GOOGLE_CLOUD_PROJECT=s2-prod-e46bd pnpm exec tsx scripts/prune-instance-named-kitchen-tools.ts --apply

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { instanceNamedKitchenTools } from '@salt/domain';
import type { KitchenToolDoc } from '@salt/domain/schemas';

import { TOOLS } from './kitchen-tool-vocabulary.mjs';

const projectId = process.env['GOOGLE_CLOUD_PROJECT'];
if (!projectId) {
  console.error('GOOGLE_CLOUD_PROJECT is required (e.g. s2-prod-e46bd)');
  process.exit(1);
}
const apply = process.argv.includes('--apply');

initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore();

interface SeedTool {
  readonly id: string;
  readonly label: string;
  readonly matchers: readonly string[];
}

/** A tool as the resolver reads it. Only `id`, `label` and `matchers` are consulted. */
function asDoc(id: string, label: string, matchers: readonly string[]): KitchenToolDoc {
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

async function main(): Promise<void> {
  const snap = await db.collection('kitchenTools').get();
  const live = new Map<string, KitchenToolDoc>();
  for (const doc of snap.docs) {
    const label = (doc.get('label') as string | undefined) ?? doc.id;
    const matchers = (doc.get('matchers') as string[] | undefined) ?? [];
    live.set(doc.id, asDoc(doc.id, label, matchers));
  }

  // The live collection wins on id: a document that has been curated since the
  // table was written is the one the operator is looking at, and reporting the
  // seed row's matchers instead would name phrases production does not hold.
  const union = [...live.values()];
  for (const tool of TOOLS as readonly SeedTool[]) {
    if (!live.has(tool.id)) union.push(asDoc(tool.id, tool.label, tool.matchers));
  }

  const pairs = instanceNamedKitchenTools(union);
  const deletable = pairs.filter(({ tool }) => live.has(tool.id));
  const tableOnly = pairs.filter(({ tool }) => !live.has(tool.id));

  console.log(
    `\n${projectId}: ${live.size} live kitchenTools, ${TOOLS.length} seed rows, ` +
      `${union.length} distinct tools once merged\n`,
  );

  if (pairs.length === 0) {
    console.log('No instance-named tools. Nothing to prune.\n');
    return;
  }

  for (const { tool, parent } of deletable) {
    const seeded = live.has(parent.id) ? 'live' : 'seeded by the vocabulary';
    console.log(`  DELETE  ${tool.id}  "${tool.label}"`);
    console.log(`          shadows ${parent.id} "${parent.label}" (${seeded})`);
    // The labels that move are the reason the delete is worth doing, so they are
    // printed rather than left for the operator to reason out.
    const moving = [tool.label, ...tool.matchers];
    console.log(`          labels it currently captures: ${moving.join(', ')}`);
    if (tool.matchers.length > 0) {
      // A curated matcher is a phrase somebody typed. Deleting the document drops
      // it, and containment does not always cover it — say so rather than let it
      // vanish quietly.
      console.log(`          NOTE: its matchers are not migrated — fold any that still earn a`);
      console.log(`          place into ${parent.id} by hand before applying.`);
    }
  }

  for (const { tool, parent } of tableOnly) {
    console.log(`  SKIP    ${tool.id}  "${tool.label}" — a SEED TABLE row, not a live document`);
    console.log(
      `          it shadows ${parent.id}; fix kitchen-tool-vocabulary.mjs, not production`,
    );
  }

  console.log(
    `\n${deletable.length} live document(s) to delete` +
      (tableOnly.length > 0 ? `, ${tableOnly.length} seed-table row(s) skipped` : ''),
  );

  if (!apply) {
    console.log(
      `\ndry run — nothing written. Re-run with --apply to delete ${deletable.length}.\n`,
    );
    return;
  }

  // One at a time, logged, rather than a batch: this is a handful of documents on
  // production and the transcript is the artefact.
  for (const { tool } of deletable) {
    await db.collection('kitchenTools').doc(tool.id).delete();
    console.log(`  deleted kitchenTools/${tool.id}`);
  }
  console.log(
    `\n${deletable.length} document(s) deleted. ` +
      `kit-icons/*.webp is reclaimed by the weekly orphan sweep — do not hand-delete it.\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
