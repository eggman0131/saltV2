import { getStorage } from 'firebase-admin/storage';
import { buildStorageDownloadUrl } from './storageDownloadUrl.js';

// The Storage half of the Tier-1 pictogram pipeline (issue #989): where a
// finished icon is written and how big its subject is drawn.
//
// Lives here rather than beside a trigger because neither is trigger-specific:
// `src/imaging/` already owns every other piece of this concern
// (`removeFlatBackground`, `normalizeIconFraming`, `storageDownloadUrl`), and the
// callable draw/upload paths need exactly the same two things. A callable
// reaching into `src/triggers/` for an upload helper would be wrong in spirit and
// would make an obvious import look like an awkward one.

/**
 * The framing target for every Tier-1 pictogram: 84% of the 128px frame.
 *
 * Tuned for the ~40px row tile, and deliberately larger than
 * `normalizeIconFraming`'s own 92px default, which is the weather set's
 * watermark value — those are watermarks, these are scanned in a list. Not
 * pushed higher because the match-reveal sage lift reads through the margin that
 * remains (ui-spec-v04 §14.5.3). Named once here rather than written out per
 * family: a form icon sits in the same tile as a canon icon, right above one in
 * the same list, so any difference between them would read as two icon sets.
 */
export const ICON_CONTENT_MAX = 108;

/**
 * Uploads a pictogram to Storage and returns its public download URL.
 *
 * We deliberately use the Firebase Storage download endpoint
 * (`/v0/b/<bucket>/o/<path>?alt=media`) rather than the raw GCS URL
 * (`storage.googleapis.com/<bucket>/<path>`): only the former is governed by
 * `storage.rules` (which grant public read on each icon prefix), so no object
 * ACL / `makePublic()` is needed — that path is the raw-GCS IAM model and throws
 * on buckets with uniform bucket-level access (the default). The same URL shape
 * works against the Storage emulator (just a different host).
 *
 * `prefix` stays per family rather than shared, and that is load-bearing: the
 * weekly orphan sweep joins each prefix against its OWN collection (the SWEEPS
 * table in maintenance/storageSweepTargets.ts), and one prefix serving several
 * collections could not tell a live object from a stranded one.
 *
 * A regeneration reuses the same object path; the `iconRequestedAt` nonce on the
 * document is what busts the browser cache in front of it.
 */
export async function uploadIcon(prefix: string, id: string, webp: Buffer): Promise<string> {
  const bucket = getStorage().bucket();
  const path = `${prefix}/${id}.webp`;
  await bucket.file(path).save(webp, {
    contentType: 'image/webp',
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  });
  return buildStorageDownloadUrl(bucket.name, path);
}
