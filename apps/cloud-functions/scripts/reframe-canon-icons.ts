// One-off operator script: re-frame the canon icons already in Storage so they
// match what the pipeline now produces.
//
// WHY THIS EXISTS — icon generation gained a framing-normalisation step
// (`normalizeIconFraming`, `contentMax: 108`; see docs/canon-icons.md). New icons
// land framed; every icon generated before it keeps the model's loose framing,
// where the subject fills 55–72% of the 128px frame and each icon sits at its own
// apparent size. This pass brings the existing set up to date.
//
// IT DOES NOT REGENERATE ANYTHING. No AI call, no Gemini key, no cost beyond
// Storage traffic. Each object is downloaded, trimmed to its alpha bounding box,
// rescaled and re-centred, then written back to the SAME path. Stroke weight and
// palette are intrinsic to the art and untouched.
//
// WHAT IT DOES — for each `canon-icons/{id}.webp` object:
//   1. download the current bytes
//   2. `normalizeIconFraming(bytes, { contentMax: 108 })`
//   3. overwrite the same object (same public URL, still public-read)
//   4. set `iconRequestedAt` on `canonItems/{id}` to now
//
// Step 4 is load-bearing, not bookkeeping. Storage reuses the byte-identical
// download URL, so browsers would serve the stale image indefinitely;
// `iconRequestedAt` is what `CanonIcon`'s `version` prop turns into the `&v=`
// cache-bust (ui-spec-v04 §14.4). Writing it also re-fires
// `onCanonItemWritten` — a no-op for both its guards, since `thumbnail` and the
// embedding companion are already set, so no regeneration is triggered.
//
// Idempotent: a second run finds each subject already at `contentMax` and is a
// no-op on framing (re-encode only). Skips objects whose canon doc is missing
// (an orphaned icon), and objects that are not `.webp`.
//
// SAFETY — re-framing is a display change, not a schema change: `thumbnail` keeps
// the same URL and old clients render the new bytes fine, so a partial or
// abandoned run is harmless (a mixed set, exactly today's state). The canon write
// touches `iconRequestedAt` only, so `updatedAt` and every other field are
// preserved — but note it does re-sync that doc to clients once.
//
// SAFE BY DEFAULT: dry run (measures and prints what would change) unless
// `--apply` is passed.
//
// USAGE (from apps/cloud-functions)
//   Dry run against staging:
//     GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/reframe-canon-icons.ts
//   Apply:
//     GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/reframe-canon-icons.ts --apply
//   A single icon (repeatable), e.g. to eyeball one before the full set:
//     GOOGLE_CLOUD_PROJECT=s2-stage-ccb22 pnpm exec tsx scripts/reframe-canon-icons.ts --apply <canonId>

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';

import { normalizeIconFraming } from '../src/imaging/normalizeIconFraming.js';

// Must match the pipeline's canon framing (onCanonItemWritten).
const CONTENT_MAX = 108;
const PREFIX = 'canon-icons/';

const apply = process.argv.includes('--apply');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const projectId = process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];

if (!projectId) {
  console.error('Set GOOGLE_CLOUD_PROJECT to the target Firebase project id.');
  process.exit(1);
}

// The default bucket is derived from FIREBASE_CONFIG inside the CF runtime, which
// a standalone script has no access to — `getStorage().bucket()` would throw
// "Bucket name not specified". Every Salt project uses the `<project>.firebasestorage.app`
// default; STORAGE_BUCKET overrides it if that ever stops holding.
const storageBucket = process.env['STORAGE_BUCKET'] ?? `${projectId}.firebasestorage.app`;

initializeApp({ projectId, credential: applicationDefault(), storageBucket });

const db = getFirestore();
const bucket = getStorage().bucket();

/** The subject's longer side as a percentage of the frame — what we're fixing. */
async function measureFill(buf: Buffer): Promise<number | null> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3]! > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null; // blank icon
  return Math.round((Math.max(maxX - minX + 1, maxY - minY + 1) / width) * 100);
}

async function main(): Promise<void> {
  console.log(
    `reframe-canon-icons: project=${projectId} bucket=${bucket.name} contentMax=${CONTENT_MAX} ${
      apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'
    }`,
  );

  const [files] = await bucket.getFiles({ prefix: PREFIX });
  const targets = files.filter((f) => {
    if (!f.name.endsWith('.webp')) return false;
    const id = f.name.slice(PREFIX.length, -'.webp'.length);
    return only.length === 0 || only.includes(id);
  });

  if (only.length) {
    const found = new Set(targets.map((f) => f.name.slice(PREFIX.length, -'.webp'.length)));
    const missing = only.filter((id) => !found.has(id));
    if (missing.length) {
      console.error(`  no such icon object(s): ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  let changed = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of targets) {
    const id = file.name.slice(PREFIX.length, -'.webp'.length);
    try {
      // An icon whose canon doc is gone is an orphan: re-framing it would be
      // pointless work, and there is no doc to carry the cache-bust.
      const doc = await db.collection('canonItems').doc(id).get();
      if (!doc.exists) {
        console.log(`  – ${id}: no canonItems doc (orphaned object), skipped`);
        skipped++;
        continue;
      }

      const [before] = await file.download();
      const fillBefore = await measureFill(before);
      if (fillBefore === null) {
        console.log(`  – ${id}: blank icon (no opaque pixels), skipped`);
        skipped++;
        continue;
      }

      const after = await normalizeIconFraming(before, { contentMax: CONTENT_MAX });
      const fillAfter = await measureFill(after);
      const label = `${id}: ${fillBefore}% → ${fillAfter}% fill (${before.length} → ${after.length} bytes)`;

      if (!apply) {
        console.log(`  · ${label}`);
        changed++;
        continue;
      }

      await file.save(after, { contentType: 'image/webp', resumable: false });
      await file.makePublic();
      // Cache-bust: same URL, new bytes (see the header note on step 4).
      //
      // `Date.now()`, NOT serverTimestamp(): `CanonItemSchema.iconRequestedAt` is
      // `z.number().optional()`, and the client skips docs that fail safeParse on
      // list reads — a Timestamp here would make every re-framed item silently
      // vanish from the shopping list. Matches what regenerateCanonIcon writes.
      await db.collection('canonItems').doc(id).update({ iconRequestedAt: Date.now() });
      console.log(`  ✓ ${label}`);
      changed++;
    } catch (err) {
      // One bad object must not abandon the rest — the pass is idempotent, so a
      // re-run picks up whatever failed.
      console.error(`  ✗ ${id}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(
    `reframe-canon-icons: ${apply ? 'reframed' : 'would reframe'} ${changed}, skipped ${skipped}, failed ${failed} (of ${targets.length} object(s))`,
  );
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
