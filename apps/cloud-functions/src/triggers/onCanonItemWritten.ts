import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { normaliseName } from '@salt/domain';
import { CanonItemSchema, DevSettingsSchema, type CanonItemDoc } from '@salt/domain/schemas';
import { embedTextFlow } from '../flows/embedText.js';
import { generateCanonIconFlow } from '../flows/generateCanonIcon.js';
import { removeFlatBackground } from '../imaging/removeFlatBackground.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { aiFakeEnabled } from '../ai/fakeModel.js';

// Defined here (not imported from index.ts) to avoid a circular import; the
// Firebase CLI aggregates same-named defineSecret calls across files at deploy
// time. The trigger reaches Gemini for both the embedding and the icon, so the
// key must be bound to its runtime.
const geminiApiKey = defineSecret('GEMINI_API_KEY');

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
  }
}

/**
 * Icon branch (issue #148): generate the Tier-1 pictogram if there is no valid
 * icon yet. Idempotency / opt-out guard: `thumbnail` must be exactly `null`.
 *   - a real URL  → already generated, skip
 *   - CANON_ICON_HIDDEN ("hidden") → user opted out, skip forever
 *   - null        → generate
 * Independent of the embedding guard, so each `.update()` only touches its own
 * field and the trigger self-terminates once both are set.
 */
async function maybeGenerateIcon(id: string, item: CanonItemDoc): Promise<void> {
  if (item.thumbnail !== null) return; // real URL or "hidden" sentinel → skip

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
      logger.warn('onCanonItemWritten: invalid devSettings doc, defaulting to enabled');
      return true;
    }
    return parsed.data.canonIconGenerationEnabled;
  } catch (err) {
    logger.warn('onCanonItemWritten: devSettings read failed, defaulting to enabled', { err });
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
    secrets: [geminiApiKey],
    // Image generation (~5–8s+) plus sharp processing need more headroom than
    // the default text-only triggers.
    timeoutSeconds: 300,
    // A batch of new canon items (e.g. a recipe creating 34) fires this trigger
    // many times at once. Cloud Run packs concurrent invocations onto one
    // instance, and each icon decode holds a libvips/sharp image buffer — a few
    // in parallel blow past the memory cap and the instance is OOM-killed,
    // losing every in-flight icon. concurrency:1 serialises icon work per
    // instance (Cloud Run scales out instances instead), bounding memory
    // regardless of batch size; 1GiB gives the single decode comfortable room.
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
    // Two independently-guarded side-effects. allSettled so a failure in one
    // branch never rejects the handler (which would retry both).
    await Promise.allSettled([
      maybeGenerateEmbedding(id, parsed.data),
      maybeGenerateIcon(id, parsed.data),
    ]);
  },
);
