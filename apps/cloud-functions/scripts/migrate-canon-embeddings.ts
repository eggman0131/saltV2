// One-off operator script: relocate canon name embeddings off the
// client-subscribed `canonItems` doc into the server-only `canonEmbeddings/{id}`
// collection (issue #410).
//
// WHY THIS EXISTS — the ~3072-float `gemini-embedding-001` vector used to live
// inline on every `canonItems` doc. The browser subscribes to that collection
// wholesale and never reads `.embedding`, so every device paid to first-sync it
// and re-download it on every canon write. #410 moves vectors to a companion
// collection that clients can't read (firestore.rules denies it) and the CF match
// path reads via the Admin SDK. New writes already land in the new shape; this
// pass backfills the docs written before the change.
//
// WHAT IT DOES — for each canonItems doc carrying an inline `embedding` array:
//   1. write `canonEmbeddings/{id}` = { embedding, updatedAt }
//   2. remove the inline `embedding` field from the canon doc
// Both in one batched write per item so a doc is never left with the vector in
// neither place. Docs whose embedding is null/absent, and docs already migrated
// (companion exists), are skipped. Idempotent: re-running is a no-op once done.
//
// SAFETY — the change is back-compat WITHOUT this migration (the adapter falls
// back to any inline vector; the CF embedding branch regenerates a missing one),
// so a partial or deferred run never breaks matching — it only leaves some
// vectors still riding the client sync until completed. The canon-doc update uses
// `embedding: FieldValue.delete()` only, so `updatedAt` and every other field are
// untouched; but note the canonItems write DOES re-fire onCanonItemWritten (a
// no-op for the icon/embedding guards) and re-syncs that one doc to clients once.
//
// SAFE BY DEFAULT: dry run (prints what would move) unless `--apply` is passed.
//
// USAGE (from apps/cloud-functions)
//   Dry run against staging:
//     GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/migrate-canon-embeddings.ts
//   Apply:
//     GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/migrate-canon-embeddings.ts --apply
//   Against the Firestore emulator:
//     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=demo-salt \
//       pnpm exec tsx scripts/migrate-canon-embeddings.ts --apply

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const projectId = process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];

if (!projectId) {
  console.error('Set GOOGLE_CLOUD_PROJECT to the target Firebase project id.');
  process.exit(1);
}

const useEmulator = Boolean(process.env['FIRESTORE_EMULATOR_HOST']);
initializeApp(useEmulator ? { projectId } : { projectId, credential: applicationDefault() });

const db = getFirestore();

function isEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === 'number');
}

const canonSnap = await db.collection('canonItems').get();

let scanned = 0;
let migrated = 0;
let skippedNoVector = 0;
let skippedAlready = 0;
let failed = 0;

for (const doc of canonSnap.docs) {
  scanned += 1;
  const inline = doc.data()['embedding'];

  if (!isEmbedding(inline)) {
    skippedNoVector += 1;
    continue;
  }

  // Already relocated? Leave the companion as the source of truth and just make
  // sure the inline copy is gone.
  const companionRef = db.collection('canonEmbeddings').doc(doc.id);
  const companion = await companionRef.get();
  const alreadyRelocated = companion.exists;

  console.log(
    `${doc.id}  "${doc.data()['name'] ?? ''}"  vector[${inline.length}]` +
      (alreadyRelocated ? '  [companion exists — clearing inline only]' : '  → canonEmbeddings'),
  );

  // Count the intended action at decision time so the DRY RUN summary reflects
  // what would happen; an apply failure below rolls the count back into `failed`.
  if (alreadyRelocated) skippedAlready += 1;
  else migrated += 1;

  if (!apply) continue;

  try {
    const batch = db.batch();
    if (!alreadyRelocated) {
      batch.set(companionRef, { embedding: inline, updatedAt: new Date().toISOString() });
    }
    batch.update(doc.ref, { embedding: FieldValue.delete() });
    await batch.commit();
  } catch (err) {
    failed += 1;
    if (!alreadyRelocated) migrated -= 1;
    console.log(`    ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(
  `\n${apply ? 'APPLIED' : 'DRY RUN'} — scanned ${scanned}, ` +
    `${apply ? 'relocated' : 'would relocate'} ${migrated}, ` +
    `${skippedAlready} already relocated (inline cleared), ` +
    `${skippedNoVector} without an inline vector` +
    (failed > 0 ? `, ${failed} failed` : '') +
    ` in project ${projectId}${useEmulator ? ' [emulator]' : ''}` +
    (apply ? '.' : '. Re-run with --apply to write.'),
);
process.exit(0);
