// One-off operator script: recover shopping-list items stuck at
// matchState 'pending' (the perpetual "OTHER" spinner).
//
// WHY THIS EXISTS — before the onShoppingListItemWrite fix, the match trigger
// could be SIGKILLed mid-flight (60s timeout / 256MiB OOM) before writing a
// terminal matchState, stranding the item at 'pending' forever: triggers don't
// auto-retry and the item gets no further write to re-fire on. The deployed fix
// (raised timeout + memory + a catch) prevents new strandings, but items
// already stuck won't self-heal — nothing ever re-fires their match.
//
// WHAT IT DOES — mimics the manual "delete and re-add" fix, batched: each stuck
// item is re-created under a fresh doc id (atomically, via a batched set+delete),
// which the now-fixed trigger sees as a new creation and re-matches. The new
// doc preserves every field (createdAt kept for stable ordering), with canonId
// reset to null and matchState reset to 'pending'. Atomic per item — a crash
// can never lose or duplicate data.
//
// USAGE
//   Dry run (default — lists what would change, writes nothing):
//     GOOGLE_CLOUD_PROJECT=<projectId> \
//       node apps/cloud-functions/scripts/recategorise-stuck-items.mjs
//   Apply:
//     GOOGLE_CLOUD_PROJECT=<projectId> \
//       node apps/cloud-functions/scripts/recategorise-stuck-items.mjs --apply
//   Against the Firestore emulator:
//     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=demo-salt \
//       node apps/cloud-functions/scripts/recategorise-stuck-items.mjs --apply
//
// FLAGS
//   --apply                 Perform the writes (omit for a dry run).
//   --max-age-minutes=N     Only touch items pending and untouched for at least
//                           N minutes (default 10), so in-flight matches — which
//                           now resolve within ~180s — are never disrupted.
//
// Re-runnable: once the trigger matches a re-created item it leaves 'pending',
// so a second run won't pick it up again.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const maxAgeArg = process.argv.find((a) => a.startsWith('--max-age-minutes='));
const maxAgeMinutes = maxAgeArg ? Number(maxAgeArg.split('=')[1]) : 10;

if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes < 0) {
  console.error(`Invalid --max-age-minutes value: ${maxAgeArg}`);
  process.exit(1);
}

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error('Set GOOGLE_CLOUD_PROJECT to the target Firebase project id.');
  process.exit(1);
}

// Against the emulator, FIRESTORE_EMULATOR_HOST short-circuits credentials.
// Against a real project, ADC (gcloud auth application-default login, or a
// service account on CI) provides them.
const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() });

const db = getFirestore();
const cutoffIso = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();

console.log(
  `${apply ? 'APPLYING' : 'DRY RUN'} — recategorise items stuck at matchState 'pending' ` +
    `older than ${maxAgeMinutes}m (updatedAt < ${cutoffIso}) in project ${projectId}` +
    (useEmulator ? ' [emulator]' : ''),
);

const lists = await db.collection('shoppingLists').get();

let stuck = 0;
let recreated = 0;

for (const listDoc of lists.docs) {
  const itemsRef = listDoc.ref.collection('items');
  // Read the whole subcollection and filter in memory — shopping lists are
  // family-shared and small, so this avoids needing a collection-group index.
  const items = await itemsRef.get();

  for (const itemDoc of items.docs) {
    const data = itemDoc.data();
    const isStuck =
      data.matchState === 'pending' &&
      data.canonId == null &&
      data.checked !== true &&
      // Items written before this field existed sort as '' < cutoff → eligible.
      (typeof data.updatedAt === 'string' ? data.updatedAt : '') < cutoffIso;

    if (!isStuck) continue;
    stuck++;

    const newRef = itemsRef.doc();
    const newData = {
      ...data,
      id: newRef.id,
      canonId: null,
      matchState: 'pending',
      updatedAt: new Date().toISOString(),
    };

    console.log(
      `  ${apply ? 'recreate' : 'would recreate'} "${data.rawText ?? ''}" ` +
        `(${listDoc.id}/${itemDoc.id} → ${newRef.id})`,
    );

    if (apply) {
      // Atomic: the new creation and the old deletion commit together, so a
      // crash can never strand a half-migrated item.
      const batch = db.batch();
      batch.set(newRef, newData);
      batch.delete(itemDoc.ref);
      await batch.commit();
      recreated++;
    }
  }
}

console.log(
  apply
    ? `Done — recreated ${recreated}/${stuck} stuck item(s). The trigger will now re-match them.`
    : `Found ${stuck} stuck item(s). Re-run with --apply to recreate them.`,
);
process.exit(0);
