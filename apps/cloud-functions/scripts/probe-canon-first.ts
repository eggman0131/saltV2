// Read-only measurement: could canon matching run BEFORE product-form resolution?
//
// WHY THIS EXISTS — `canonicaliseRecipeIngredients` resolves product forms first
// and only then matches canon. Reversing that (issue #865, change 3) is only
// safe if a derivative does NOT match a canon item on its own, because a canon
// match short-circuits and the form — with its yield — is never consulted.
//
// The measurement is every string a product form claims: its label and all its
// matchers. For each, `findClosestMatch` is run against the canon list and the
// answer recorded. A `match` is a string canon-first would swallow.
//
// TWO PASSES, and the difference between them is the point:
//
//   as-stored   the canon list exactly as it is in the database.
//   cleaned     the same list with every synonym a form claims removed — i.e.
//               after scripts/clean-derived-synonyms.ts has run.
//
// If cleaning moves a string from `match` to `none`, the synonym was the only
// thing making canon-first unsafe for it. If it still matches after cleaning,
// the cleanup cannot fix that one.
//
// SCOPE, and it is narrow: this measures strings a form ALREADY claims. It says
// nothing about a derivative with no form yet, because there is no stored phrase
// to test. That population has to be judged, not counted — the test is whether
// the ingredient changes what you BUY (an egg yolk means buying eggs), not
// whether it names part of something. "Celery stalk" against a canon called
// Celery is not a missing form; it is celery.
//
// WHY EVERY MATCHER AND NOT A SAMPLE — an earlier probe of this question used
// hand-picked strings ("lemon zest", "lime juice") and came back clean, because
// Lemon has no synonyms and the stored string is "fresh lime juice", not "lime
// juice". Choosing the inputs is choosing the answer. This enumerates them.
//
// Stages 1-4 only, which is what `findClosestMatch` covers — no embeddings, no
// AI. That is the right scope: it is the deterministic layer a reordering would
// consult first, and the only one that can short-circuit without a model call.
//
// USAGE (from apps/cloud-functions) — read-only, no secrets, no AI key:
//   GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/probe-canon-first.ts

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { findClosestMatch, resolveProductForm } from '@salt/domain';
import type { CanonItem, ProductForm } from '@salt/domain';

const projectId = process.env['GOOGLE_CLOUD_PROJECT'];
if (!projectId) {
  console.error('GOOGLE_CLOUD_PROJECT is required (e.g. s2-stage-ccb22)');
  process.exit(1);
}
initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore();

async function main(): Promise<void> {
  const [canonSnap, formSnap] = await Promise.all([
    db.collection('canonItems').get(),
    db.collection('productForms').get(),
  ]);

  const items: CanonItem[] = canonSnap.docs.map(
    (d) =>
      ({
        id: d.id,
        name: String(d.get('name') ?? ''),
        synonyms: (d.get('synonyms') as string[] | undefined) ?? [],
        aisleId: d.get('aisleId') ?? null,
        thumbnail: d.get('thumbnail') ?? null,
        embedding: null,
        needs_approval: d.get('needs_approval') === true,
        shoppingBehavior: d.get('shoppingBehavior') ?? 'needed',
        schemaVersion: 5,
        updatedAt: '',
      }) as CanonItem,
  );

  const forms: ProductForm[] = formSnap.docs.map(
    (d) =>
      ({
        id: d.id,
        label: String(d.get('label') ?? ''),
        matchers: (d.get('matchers') as string[] | undefined) ?? [],
        parentCanonId: String(d.get('parentCanonId') ?? ''),
      }) as ProductForm,
  );

  const nameById = new Map(items.map((i) => [i.id, i.name]));

  // The cleaned list: every synonym a product form claims, removed.
  const cleaned: CanonItem[] = items.map((i) => ({
    ...i,
    synonyms: i.synonyms.filter((s) => resolveProductForm(s, forms) === null),
  }));
  const removed = items.reduce(
    (n, i, k) => n + (i.synonyms.length - cleaned[k]!.synonyms.length),
    0,
  );

  // Every string a form claims, deduped — label and matchers compete on equal
  // terms in resolveProductForm, so both are inputs a reordering would meet.
  const claims = new Map<string, ProductForm>();
  for (const f of forms) {
    for (const phrase of [f.label, ...f.matchers]) {
      if (phrase.trim().length > 0) claims.set(phrase, f);
    }
  }

  console.log(
    `\n${projectId}: ${items.length} canon items, ${forms.length} forms, ` +
      `${claims.size} claimed strings, ${removed} synonyms removed in the cleaned pass\n`,
  );

  const header = `${'CLAIMED STRING'.padEnd(34)}  ${'AS-STORED'.padEnd(22)}  CLEANED`;
  console.log(header);
  console.log('─'.repeat(header.length));

  let swallowedBefore = 0;
  let swallowedAfter = 0;

  for (const [phrase, form] of [...claims].sort((a, b) => a[0].localeCompare(b[0]))) {
    const before = describe(findClosestMatch(items, phrase, undefined), nameById);
    const after = describe(findClosestMatch(cleaned, phrase, undefined), nameById);
    if (before.startsWith('match')) swallowedBefore++;
    if (after.startsWith('match')) swallowedAfter++;
    const flag = after.startsWith('match') ? '  ← canon-first would swallow this' : '';
    console.log(
      `${phrase.padEnd(34)}  ${before.padEnd(22)}  ${after}${flag}` +
        `${before === after ? '' : ''}   [form: ${form.label}]`,
    );
  }

  console.log(
    `\nas-stored: ${swallowedBefore} of ${claims.size} claimed strings match a canon item outright.`,
  );
  console.log(
    `cleaned:   ${swallowedAfter} of ${claims.size} still do — a synonym cleanup cannot fix ` +
      `these, so each one is a string canon-first would have to handle some other way.\n`,
  );
}

function describe(
  result: ReturnType<typeof findClosestMatch>,
  nameById: Map<string, string>,
): string {
  if (result.kind === 'match') {
    return `match -> ${nameById.get(result.candidate.item.id) ?? result.candidate.item.name}`;
  }
  return result.kind;
}

await main();
process.exit(0);
