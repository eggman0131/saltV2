import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { flushServerObservability } from '@salt/observability/server';
import { reportServerError } from '../observability/reportServerError.js';

// Weekly sweep of Storage objects whose Firestore doc is gone (issue #620).
//
// WHY THIS EXISTS — nothing else in this codebase deletes a Storage object.
// `canon-icons/{canonId}.webp` and `recipe-images/{recipeId}.webp` are both keyed
// off a deterministic doc id, so deleting the doc (or splitting a canon item)
// strands the object: no doc, no reference, nothing that would ever remove it.
// Staging reached 165 orphans out of 168 objects before anyone noticed.
//
// A GCS lifecycle rule cannot express this — orphan-ness depends on Firestore,
// not on object age — so the join has to be code.
//
// COST SHAPE — per prefix: one bucket list, plus one id-only collection scan
// (`.select()` fetches no field data). No per-object `get`. At Salt's scale this
// is a few hundred names a week.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

/** Object age below which an orphan is left alone. See selectOrphanedObjects. */
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Upper bound on deletions per run — blast-radius cap, not a pagination limit. */
const MAX_DELETIONS_PER_RUN = 500;

const SWEEPS = [
  { prefix: 'canon-icons/', collection: 'canonItems' },
  { prefix: 'recipe-images/', collection: 'recipes' },
] as const;

/** A candidate object, reduced to just what the decision needs. */
export interface SweepCandidate {
  /** Full object path, e.g. `canon-icons/abc.webp`. */
  path: string;
  /** The doc id the path encodes — the object's basename without extension. */
  id: string;
  /** Object creation time in epoch ms (GCS `timeCreated`). */
  createdAt: number;
}

/**
 * Pure selection: which candidates are orphans old enough to delete.
 *
 * Two guards, both deliberate:
 *
 *  - **Age grace.** A doc is always written before the trigger generates its
 *    object, so an object appearing between the bucket list and the id scan is
 *    already near-impossible. The grace closes that window for good AND absorbs
 *    the more realistic hazard: a partial or failed Firestore scan making live
 *    ids look absent. A young orphan simply waits for next week.
 *  - **Cap.** If the join is ever wrong, it is wrong at most `limit` objects at a
 *    time, with six days to notice before the next run.
 */
export function selectOrphanedObjects({
  candidates,
  liveIds,
  now,
  graceMs = GRACE_MS,
  limit = MAX_DELETIONS_PER_RUN,
}: {
  candidates: readonly SweepCandidate[];
  liveIds: ReadonlySet<string>;
  now: number;
  graceMs?: number;
  limit?: number;
}): SweepCandidate[] {
  return candidates
    .filter((c) => !liveIds.has(c.id) && now - c.createdAt >= graceMs)
    .slice(0, limit);
}

/** `canon-icons/abc123.webp` → `abc123`. Returns null for a nested or bare path. */
export function idFromObjectPath(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  // Nested paths are not something this codebase writes; if one ever appears,
  // it is not ours to reason about, so leave it alone.
  if (name.includes('/')) return null;
  const dot = name.lastIndexOf('.');
  const id = dot === -1 ? name : name.slice(0, dot);
  return id.length > 0 ? id : null;
}

async function sweepPrefix(prefix: string, collection: string, now: number): Promise<void> {
  const bucket = getStorage().bucket();
  const db = getFirestore();

  // getFiles auto-paginates. `.select()` with no fields returns id-only docs —
  // the whole point is to avoid pulling canon/recipe payloads across the wire.
  const [files, liveSnap] = await Promise.all([
    bucket.getFiles({ prefix }),
    db.collection(collection).select().get(),
  ]);

  const liveIds = new Set(liveSnap.docs.map((d) => d.id));

  const candidates = files[0].flatMap((file) => {
    const id = idFromObjectPath(file.name, prefix);
    if (id === null) return [];
    // timeCreated is set on every new generation, so an overwrite (e.g. the
    // reframe script) restarts the grace. That only ever delays a deletion.
    const createdAt = Date.parse(String(file.metadata.timeCreated ?? ''));
    if (Number.isNaN(createdAt)) return [];
    return [{ path: file.name, id, createdAt }];
  });

  const doomed = selectOrphanedObjects({ candidates, liveIds, now });

  for (const orphan of doomed) {
    await bucket.file(orphan.path).delete();
    logger.info('sweepOrphanedStorage: deleted orphan', {
      path: orphan.path,
      ageDays: Math.floor((now - orphan.createdAt) / 86_400_000),
    });
  }

  logger.info('sweepOrphanedStorage: swept prefix', {
    prefix,
    objects: candidates.length,
    liveDocs: liveIds.size,
    deleted: doomed.length,
    // Surfaces the cap actually biting, rather than a silent truncation.
    capped: doomed.length === MAX_DELETIONS_PER_RUN,
  });
}

export const sweepOrphanedStorage = onSchedule(
  {
    // Sunday 03:00 — well clear of any waking usage.
    schedule: '0 3 * * 0',
    timeZone: 'Europe/London',
    region: 'europe-west2',
    memory: '512MiB',
    secrets: [posthogApiKey],
    // The sweep is idempotent and weekly; a retry storm on a broken run buys
    // nothing that next Sunday would not.
    retryCount: 0,
    // Listing two prefixes plus two collection scans, then serial deletes.
    timeoutSeconds: 540,
  },
  async () => {
    const now = Date.now();
    try {
      // Serial, not parallel: the two prefixes are independent and there is no
      // deadline pressure, so this keeps memory and Storage QPS flat.
      for (const { prefix, collection } of SWEEPS) {
        await sweepPrefix(prefix, collection, now);
      }
    } catch (err) {
      // Never throw out of a scheduled handler: it is a StorageError/SyncError
      // class of failure with no caller to surface to, and Scheduler would just
      // replay a deterministic failure. Report it and let next week try again.
      logger.error('sweepOrphanedStorage: sweep failed', { error: String(err) });
      // StorageError: a Firestore scan or Storage list/delete failing is exactly
      // the unexpected-infrastructure class the reporting policy says to surface.
      reportServerError(err, 'StorageError');
    } finally {
      await flushServerObservability();
    }
  },
);
