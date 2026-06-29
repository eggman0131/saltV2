import { getFirestore, FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { normaliseName } from '@salt/domain';
import { CanonItemSchema, DevSettingsSchema, type CanonItemDoc } from '@salt/domain/schemas';
import { flushServerObservability } from '@salt/observability/server';
import { embedTextFlow } from '../flows/embedText.js';
import { generateCanonIconFlow } from '../flows/generateCanonIcon.js';
import { removeFlatBackground } from '../imaging/removeFlatBackground.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { aiFakeEnabled } from '../ai/fakeModel.js';
import { reportServerError } from '../observability/reportServerError.js';
import { whenCfTelemetryReady } from '../observability/telemetryReady.js';
import { runTriggerWithTraceContext } from './triggerTraceContext.js';

// Defined here (not imported from index.ts) to avoid a circular import; the
// Firebase CLI aggregates same-named defineSecret calls across files at deploy
// time. The trigger reaches Gemini for both the embedding and the icon, so the
// key must be bound to its runtime.
const geminiApiKey = defineSecret('GEMINI_API_KEY');
// Bound so server error reporting (posthog-node) can read POSTHOG_API_KEY at
// runtime — this trigger now reports embedding/icon/devSettings-read failures.
// Optional like elsewhere: when unset, reporting no-ops and the logger still
// emits.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

const ICON_STORAGE_PREFIX = 'canon-icons';

/**
 * Embedding branch (existing behaviour, unchanged): generate the name embedding
 * if absent. Idempotency guard: skip when an embedding is already present.
 */
async function maybeGenerateEmbedding(id: string, item: CanonItemDoc): Promise<void> {
  if (item.embedding) return;

  const normalised = normaliseName(item.name);
  if (!normalised) return;

  try {
    const { values } = await withAiTimeout('embedText', () => embedTextFlow({ text: normalised }));
    await getFirestore().collection('canonItems').doc(id).update({ embedding: values });
  } catch (err) {
    logger.error('onCanonItemWritten: embedding failed', { id, err });
    // Additive: an embedding flow failure (AI/Genkit) is unexpected → report it
    // to PostHog alongside the logger. Best-effort, never throws. The handler's
    // finally flushes before the function returns.
    reportServerError(err);
  }
}

/**
 * Edge-trigger decision for the icon branch. The trigger fires on EVERY write to
 * the doc, so generation must start only on the write that *transitions* the item
 * into "needs an icon" — never merely because the thumbnail currently happens to
 * be null. Otherwise an unrelated write landing while a generation is still in
 * flight (most commonly the embedding `.update()` this same trigger issues on
 * create) re-enters and starts a *duplicate* generation, because `thumbnail`
 * stays null until the first one finishes.
 *
 * Generate when:
 *   - create (no prior doc) with a null thumbnail
 *   - thumbnail just went non-null → null (manual regenerate, or user cleared)
 *   - the `iconRequestedAt` nonce changed — covers a forced regenerate of an item
 *     whose thumbnail was *already* null (see regenerateCanonIcon)
 * Skip when the thumbnail was already null before this write and stayed null: the
 * write that first set it null already owns the in-flight generation.
 *
 * `thumbnail !== null` (a real URL, or the CANON_ICON_HIDDEN "hidden" sentinel)
 * always skips: already generated, or the user opted out forever.
 */
function iconNeedsGeneration(before: DocumentSnapshot | undefined, after: CanonItemDoc): boolean {
  if (after.thumbnail !== null) return false; // real URL or "hidden" sentinel → skip
  if (!before?.exists) return true; // create → generate
  const prev = before.data();
  if ((prev?.['thumbnail'] ?? null) !== null) return true; // just cleared → generate
  // Already null and still null: only an explicit regenerate (nonce bump) re-fires;
  // any other field change (embedding, rename, aisle…) must not start a duplicate.
  return prev?.['iconRequestedAt'] !== after.iconRequestedAt;
}

/**
 * Icon branch (issue #148): generate the Tier-1 pictogram when this write
 * transitions the item into "needs an icon" (see iconNeedsGeneration). Independent
 * of the embedding guard, so each `.update()` only touches its own field and the
 * trigger self-terminates once both are set.
 *
 * Trade-off of edge-triggering: a generation that *fails* leaves `thumbnail` null
 * but no longer self-heals on the next unrelated write — the regenerate callable
 * (which bumps `iconRequestedAt`) is the retry path.
 */
async function maybeGenerateIcon(
  id: string,
  item: CanonItemDoc,
  before: DocumentSnapshot | undefined,
): Promise<void> {
  if (!iconNeedsGeneration(before, item)) return;

  // E2E (FUNCTIONS_AI_FAKE): skip icon generation entirely. The real image model
  // and the Storage upload (which authenticates via the GCE metadata server) are
  // not emulator-safe and hang the trigger; no e2e spec asserts a generated icon.
  // Unreachable in production (the flag is never set there).
  if (aiFakeEnabled()) return;

  const name = item.name.trim();
  if (!name) return;

  // Per-environment kill-switch (issue #238). Checked only once the cheap
  // in-memory guards pass (i.e. we would otherwise generate). Turning it off
  // stops EVERY generation path — create, the update self-heal, and the manual
  // regenerate callable (which routes through this trigger). Re-enabling does
  // not backfill: items written while off keep thumbnail null and regenerate
  // only when next written.
  if (!(await isCanonIconGenerationEnabled())) return;

  // Optional one-shot user steer written by the regenerate callable.
  const hint = item.iconHint?.trim();

  try {
    const { imageBase64 } = await withAiTimeout('generateCanonIcon', () =>
      generateCanonIconFlow({ name, ...(hint ? { hint } : {}) }),
    );
    const raw = Buffer.from(imageBase64, 'base64');
    const webp = await removeFlatBackground(raw);
    const url = await uploadCanonIcon(id, webp);
    // Set the icon and clear the one-shot hint in the same write.
    await getFirestore()
      .collection('canonItems')
      .doc(id)
      .update({ thumbnail: url, iconHint: FieldValue.delete() });
  } catch (err) {
    // Leave thumbnail null so a later write retries; never block the trigger.
    logger.error('onCanonItemWritten: icon generation failed', { id, err });
    // Additive: icon generation chains an AI flow, image processing and a Storage
    // upload — a throw here is unexpected. Report it to PostHog alongside the
    // logger. Best-effort, never throws; the handler's finally flushes.
    reportServerError(err);
  }
}

/**
 * Reads the per-environment canon-icon kill-switch (issue #238) from
 * `devSettings/singleton`. Fails OPEN: a missing doc, an unexpected shape, or a
 * read error all default to ENABLED, so an environment that never configured the
 * switch keeps the greenfield behaviour and a transient read glitch never
 * silently halts generation.
 */
async function isCanonIconGenerationEnabled(): Promise<boolean> {
  try {
    const snap = await getFirestore().collection('devSettings').doc('singleton').get();
    if (!snap.exists) return true;
    const parsed = DevSettingsSchema.safeParse(snap.data());
    if (!parsed.success) {
      // Expected validation fallback (a doc that doesn't match the schema, e.g.
      // a partially-written settings doc): NOT reported — this is a
      // ValidationError-class "expected" outcome, suppressed per policy. The
      // fail-open default + the warn log are the contract.
      logger.warn('onCanonItemWritten: invalid devSettings doc, defaulting to enabled');
      return true;
    }
    return parsed.data.canonIconGenerationEnabled;
  } catch (err) {
    logger.warn('onCanonItemWritten: devSettings read failed, defaulting to enabled', { err });
    // A read THROW (vs a shape mismatch above) is a StorageError-class failure.
    // Non-critical (we fail open), but genuinely unexpected, so report it
    // additively — best-effort, never throws.
    reportServerError(err, 'StorageError');
    return true;
  }
}

/**
 * Uploads the icon to Storage and returns its public download URL.
 *
 * We deliberately use the Firebase Storage download endpoint
 * (`/v0/b/<bucket>/o/<path>?alt=media`) rather than the raw GCS URL
 * (`storage.googleapis.com/<bucket>/<path>`): only the former is governed by
 * `storage.rules` (which grant public read on `canon-icons/`), so no object
 * ACL / `makePublic()` is needed — that path is the raw-GCS IAM model and
 * throws on buckets with uniform bucket-level access (the default). The same
 * URL shape works against the Storage emulator (just a different host).
 */
async function uploadCanonIcon(id: string, webp: Buffer): Promise<string> {
  const bucket = getStorage().bucket();
  const path = `${ICON_STORAGE_PREFIX}/${id}.webp`;
  await bucket.file(path).save(webp, {
    contentType: 'image/webp',
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  });
  return buildIconDownloadUrl(bucket.name, path);
}

/** Public Firebase Storage download URL (rules-governed, no token needed). */
function buildIconDownloadUrl(bucketName: string, path: string): string {
  const encoded = encodeURIComponent(path);
  // The Firebase emulator suite sets STORAGE_EMULATOR_HOST for the Admin SDK;
  // when present, point the URL at the emulator instead of production.
  const emulatorHost = process.env['STORAGE_EMULATOR_HOST'];
  if (emulatorHost) {
    const host = emulatorHost.replace(/^https?:\/\//, '');
    return `http://${host}/v0/b/${bucketName}/o/${encoded}?alt=media`;
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encoded}?alt=media`;
}

export const onCanonItemWritten = onDocumentWritten(
  {
    document: 'canonItems/{id}',
    region: 'europe-west2',
    secrets: [geminiApiKey, posthogApiKey],
    // Image generation (~5–8s+) plus sharp processing need more headroom than
    // the default text-only triggers.
    timeoutSeconds: 300,
    // A batch of new canon items (e.g. a recipe creating 34) fires this trigger
    // many times at once. Cloud Run packs concurrent invocations onto one
    // instance, and each icon decode holds a libvips/sharp image buffer — a few
    // in parallel blow past the memory cap and the instance is OOM-killed,
    // losing every in-flight icon. concurrency:1 serialises icon work per
    // instance (Cloud Run scales out instances instead), bounding memory
    // regardless of batch size; 1GiB gives the single decode comfortable room —
    // an upward override of the 512MiB floor, pinned inline (this trigger module
    // loads before index.ts's setGlobalOptions, same reason region is inline).
    concurrency: 1,
    memory: '1GiB',
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const parsed = CanonItemSchema.safeParse(after.data());
    if (!parsed.success) {
      logger.error('onCanonItemWritten: invalid doc shape, skipping', {
        id: event.params.id,
        error: parsed.error.message,
      });
      return;
    }

    const id = event.params.id;
    // Distributed-trace correlation (issue #362, Phase 5). The
    // onShoppingListItemWrite trigger stamped its browser-rooted W3C traceparent
    // onto this canon doc as traceContext when it wrote the match; continuing it
    // here nests the icon + embedding work under the SAME trace ("Add item …" →
    // canon-match → icon) instead of re-rooting. Env-gated and degrades safely
    // (absent/malformed → normal root trace, never throws — Rule 10). Reading
    // traceContext is a no-op for the icon/embedding idempotency guards (they key
    // off thumbnail/iconRequestedAt/embedding), so a bare traceContext-only
    // re-fire of this trigger cannot loop into duplicate generation.
    const traceContext = parsed.data.traceContext;
    // Wait for the OTel pipeline (propagator + context manager) to be live before
    // continuing the supplied trace, so a cold-started invocation does not silently
    // drop traceContext and re-root the icon/embedding flows (issue #370). This
    // trigger fires less often than onShoppingListItemWrite, so it cold-starts more
    // and lost this race far more often. Resolves immediately once warm.
    await whenCfTelemetryReady();
    try {
      // Two independently-guarded side-effects. allSettled so a failure in one
      // branch never rejects the handler (which would retry both). The icon branch
      // is edge-triggered on before→after, so it needs the prior snapshot.
      await runTriggerWithTraceContext(traceContext, () =>
        Promise.allSettled([
          maybeGenerateEmbedding(id, parsed.data),
          maybeGenerateIcon(id, parsed.data, event.data?.before),
        ]),
      );
    } finally {
      // The branch catches above report best-effort to posthog-node, which
      // batches; flush before the function freezes so a report is not stranded.
      // Non-throwing + no-op when uninitialised, so it is always safe to call.
      await flushServerObservability();
    }
  },
);
