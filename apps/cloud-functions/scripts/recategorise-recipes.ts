// One-off operator script: regenerate recipe category tags (issue: tighten
// recipe categories).
//
// WHY THIS EXISTS — recipes authored before the tag rules were tightened carry a
// soup of low-value tags: ingredient names ("chicken", "garlic"), and
// marketing/hyper-specific junk that no heuristic can separate from real
// categories ("mary-berry-favourites", "proper-pub-grub", "rainy-day-food").
// Rather than try to filter that, this pass DELETES every recipe's tags and
// regenerates a clean set from the recipe's own content via the categoriseRecipe
// flow — the same category-tag rules newly-authored recipes now follow — so old
// and new recipes end up consistently categorised.
//
// SAFE BY DEFAULT: dry run (prints old → new per recipe) unless `--apply` is
// passed. Writes only `metadata.tags` via a partial update, so `updatedAt` is
// left untouched (the recipe list is not mass-reordered) and no recipe trigger
// fires (there is none on the recipes collection). Re-running regenerates again
// (not strictly idempotent — the model may vary — but temperature is 0).
//
// REQUIRES a Gemini API key (GEMINI_API_KEY / GOOGLE_API_KEY) for the flow, plus
// Firestore access. Run through tsx with the CF secrets file so the key is
// loaded exactly as `pnpm dev` loads it.
//
// USAGE (from apps/cloud-functions)
//   Dry run against staging:
//     GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 \
//       pnpm exec tsx --env-file=.secret.local scripts/recategorise-recipes.ts
//   Apply:
//     GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 \
//       pnpm exec tsx --env-file=.secret.local scripts/recategorise-recipes.ts --apply
//   Against the Firestore emulator (uses the fake key path is N/A — needs a real
//   model key even on the emulator):
//     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=demo-salt \
//       pnpm exec tsx --env-file=.secret.local scripts/recategorise-recipes.ts

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { categoriseRecipeFlow } from '../src/flows/categoriseRecipe.js';

const apply = process.argv.includes('--apply');
const projectId = process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];

if (!projectId) {
  console.error('Set GOOGLE_CLOUD_PROJECT to the target Firebase project id.');
  process.exit(1);
}

const useEmulator = Boolean(process.env['FIRESTORE_EMULATOR_HOST']);
initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() });

type IngredientItem = { rawText?: unknown };
type IngredientGroup = { items?: IngredientItem[] };
type Step = { text?: unknown };

function asStringList(values: unknown[]): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

const db = getFirestore();
const snap = await db.collection('recipes').get();

let scanned = 0;
let changed = 0;
let failed = 0;

for (const doc of snap.docs) {
  scanned += 1;
  const recipe = doc.data();
  const title = typeof recipe['title'] === 'string' ? recipe['title'] : '';
  if (!title) {
    console.log(`${doc.id}  (skipped — no title)`);
    continue;
  }

  const groups = Array.isArray(recipe['ingredients'])
    ? (recipe['ingredients'] as IngredientGroup[])
    : [];
  const ingredients = asStringList(groups.flatMap((g) => (g?.items ?? []).map((i) => i?.rawText)));
  const steps = asStringList(
    (Array.isArray(recipe['steps']) ? (recipe['steps'] as Step[]) : []).map((s) => s?.text),
  );
  const description =
    typeof recipe['description'] === 'string' ? (recipe['description'] as string) : null;
  const oldTags = Array.isArray(recipe['metadata']?.['tags'])
    ? (recipe['metadata']['tags'] as string[])
    : [];

  let newTags: string[];
  try {
    const result = await categoriseRecipeFlow({ title, description, ingredients, steps });
    newTags = result.tags;
  } catch (err) {
    failed += 1;
    console.log(
      `${doc.id}  "${title}"\n    ERROR: ${err instanceof Error ? err.message : String(err)}`,
    );
    continue;
  }

  const same = oldTags.length === newTags.length && oldTags.every((t, i) => t === newTags[i]);
  console.log(
    `${doc.id}  "${title}"\n` +
      `    old (${oldTags.length}): ${oldTags.join(', ') || '(none)'}\n` +
      `    new (${newTags.length}): ${newTags.join(', ') || '(none)'}${same ? '  [unchanged]' : ''}`,
  );

  if (same) continue;
  changed += 1;
  if (apply) {
    await doc.ref.update({ 'metadata.tags': newTags });
  }
}

console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — ${changed}/${scanned} recipe(s) recategorised` +
    (failed > 0 ? `, ${failed} failed` : '') +
    ` in project ${projectId}${useEmulator ? ' [emulator]' : ''}` +
    (apply ? '.' : '. Re-run with --apply to write.'),
);
process.exit(0);
