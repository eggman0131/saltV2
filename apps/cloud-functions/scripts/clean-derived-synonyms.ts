// One-off operator script: remove synonyms that are really DERIVATIONS.
//
// WHY THIS EXISTS — a synonym asserts identity ("this text is another name for
// this canon item"); a product form asserts derivation ("this text is a thing you
// get FROM that item, at this yield"). Nothing used to stop the second being
// written into the field that means the first, so production holds both claims
// about the same string: `lime zest` sits in Lime's synonym list beside a form
// saying zest is scraped from a lime. The synonym then wins — `findClosestMatch`
// answers at stage 3, exact synonym, before any form is consulted — so the yield
// is silently lost and the list buys one lime for a tablespoon of zest.
//
// PR #866 stops new ones being written (`appendCanonSynonym` now refuses a name a
// form already claims). This removes the ones already stored. The two halves use
// the SAME predicate deliberately: this script deletes exactly what the guard
// would now refuse, so the corpus ends up in the state the code would have
// produced had the guard always existed.
//
// WHY IT IS SAFE TO REMOVE — the synonym is not what makes the ingredient
// resolve. `resolveProductForm` runs BEFORE canon matching in
// `canonicaliseRecipeIngredients`, so a line the form claims binds to the form's
// parent whether or not the synonym exists. Removing it does not orphan the
// ingredient; it stops the ingredient taking a shortcut that skips the yield.
//
// TWO CATEGORIES, REPORTED SEPARATELY, because they are not equally obvious:
//
//   same-parent    the form's parent IS this canon item. `lime zest` on Lime,
//                  claimed by `Lime zest -> Lime`. Removing changes nothing about
//                  where the ingredient lands, only how it gets there — via the
//                  form, carrying the yield. Uncontroversial.
//
//   cross-parent   the form's parent is a DIFFERENT canon item. These are whole
//                  ingredient lines stored as a name — e.g. "white wine vinegar
//                  or ... lemon juice" on White Wine Vinegar, claimed by
//                  `Lemon juice -> Lemon`. Removing one DOES change where that
//                  text resolves (to Lemon, via the form). Read these before
//                  applying; they are junk either way, but they are a judgement.
//
// SAFE BY DEFAULT: dry run (prints every proposed removal) unless `--apply`.
// `--same-parent-only` applies just the uncontroversial category.
//
// The write is a PARTIAL update of `synonyms` (and `pendingChanges` where a
// `synonym_added` entry named a removed synonym), for the reason set-canon-units.ts
// sets out: canon is last-write-wins per WHOLE document and `onCanonItemWritten`
// writes back to it, so a full-document write from here could clobber a concurrent
// trigger write. It deliberately does NOT move `updatedAt` — withdrawing a claim
// the item never should have carried is not a change to the item.
//
// `needs_approval` IS LEFT ALONE, even when the removed synonym is the only
// reason it was ever set. The flag means "a human should look at this", and a
// human has not yet. Clearing it here would silently retire a review that never
// happened; leave it, and the canon page shows the item with the bogus synonym
// already gone.
//
// TRIGGER SAFETY: `onCanonItemWritten` fires once per updated item and both its
// branches no-op — `iconNeedsGeneration` returns false for an item that has a
// thumbnail (and for one that was null before and stays null with no
// `iconRequestedAt` bump), and `maybeGenerateEmbedding` returns early because the
// `canonEmbeddings/{id}` doc already exists. No icon regenerated, no embedding
// recomputed, no AI called.
//
// USAGE (from apps/cloud-functions) — no secrets, no AI key:
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/clean-derived-synonyms.ts
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/clean-derived-synonyms.ts --apply
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/clean-derived-synonyms.ts --apply --same-parent-only

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { resolveProductForm } from '@salt/domain';
import type { ProductForm } from '@salt/domain';

const projectId = process.env['GOOGLE_CLOUD_PROJECT'];
if (!projectId) {
  console.error('GOOGLE_CLOUD_PROJECT is required (e.g. s2-stage-ccb22)');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sameParentOnly = process.argv.includes('--same-parent-only');

initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore();

interface Removal {
  readonly canonId: string;
  readonly canonName: string;
  readonly synonym: string;
  readonly formLabel: string;
  readonly formParentName: string;
  readonly sameParent: boolean;
}

async function main(): Promise<void> {
  const [canonSnap, formSnap] = await Promise.all([
    db.collection('canonItems').get(),
    db.collection('productForms').get(),
  ]);

  const canonNameById = new Map<string, string>(
    canonSnap.docs.map((d) => [d.id, String(d.get('name') ?? '')]),
  );

  // Only the fields resolveProductForm reads. Parsing the full schema would be
  // stricter than this needs to be and would skip a form over an unrelated field.
  const forms: ProductForm[] = formSnap.docs.map(
    (d) =>
      ({
        id: d.id,
        label: String(d.get('label') ?? ''),
        matchers: (d.get('matchers') as string[] | undefined) ?? [],
        parentCanonId: String(d.get('parentCanonId') ?? ''),
      }) as ProductForm,
  );

  const removals: Removal[] = [];
  let synonymCount = 0;

  for (const doc of canonSnap.docs) {
    const canonName = String(doc.get('name') ?? '');
    const synonyms = (doc.get('synonyms') as string[] | undefined) ?? [];
    synonymCount += synonyms.length;
    for (const synonym of synonyms) {
      const form = resolveProductForm(synonym, forms);
      if (!form) continue;
      removals.push({
        canonId: doc.id,
        canonName,
        synonym,
        formLabel: form.label,
        formParentName: canonNameById.get(form.parentCanonId) ?? '(missing parent)',
        sameParent: form.parentCanonId === doc.id,
      });
    }
  }

  const same = removals.filter((r) => r.sameParent);
  const cross = removals.filter((r) => !r.sameParent);

  console.log(
    `\n${projectId}: ${canonSnap.size} canon items, ${synonymCount} synonyms, ${forms.length} product forms\n`,
  );

  report('SAME-PARENT — the form already points at this item', same);
  report('CROSS-PARENT — removing these moves where the text resolves', cross);

  const selected = sameParentOnly ? same : removals;
  console.log(
    `${removals.length} of ${synonymCount} synonyms are claimed by a product form ` +
      `(${same.length} same-parent, ${cross.length} cross-parent)`,
  );
  if (!apply) {
    console.log(`\ndry run — nothing written. Re-run with --apply to remove ${selected.length}.\n`);
    return;
  }

  const byCanon = new Map<string, Removal[]>();
  for (const r of selected) byCanon.set(r.canonId, [...(byCanon.get(r.canonId) ?? []), r]);

  for (const [canonId, rs] of byCanon) {
    const doc = canonSnap.docs.find((d) => d.id === canonId)!;
    const doomed = new Set(rs.map((r) => r.synonym));
    const synonyms = ((doc.get('synonyms') as string[] | undefined) ?? []).filter(
      (s) => !doomed.has(s),
    );

    // Withdraw the review-queue entry too. A `synonym_added` row naming a synonym
    // that no longer exists is an unanswerable question for whoever opens the
    // queue — approve what, exactly?
    const pending = doc.get('pendingChanges') as { kind: string; synonym?: string }[] | undefined;
    const nextPending = pending?.filter(
      (c) => !(c.kind === 'synonym_added' && c.synonym !== undefined && doomed.has(c.synonym)),
    );

    await doc.ref.update({
      synonyms,
      ...(nextPending !== undefined && nextPending.length !== (pending?.length ?? 0)
        ? { pendingChanges: nextPending }
        : {}),
    });
  }

  console.log(`\nAPPLIED — removed ${selected.length} synonyms across ${byCanon.size} items.\n`);
}

function report(title: string, rs: readonly Removal[]): void {
  console.log(`── ${title} — ${rs.length} ──`);
  if (rs.length === 0) {
    console.log('   (none)\n');
    return;
  }
  const w = Math.max(...rs.map((r) => r.synonym.length));
  for (const r of rs) {
    console.log(
      `   "${r.synonym}"${' '.repeat(w - r.synonym.length)}  on ${r.canonName}` +
        `   claimed by "${r.formLabel}" -> ${r.formParentName}`,
    );
  }
  console.log('');
}

await main();
process.exit(0);
