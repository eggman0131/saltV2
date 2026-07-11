import { getFirestore, FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { RecipeSchema, DevSettingsSchema, type RecipeDoc } from '@salt/domain/schemas';
import { flushServerObservability } from '@salt/observability/server';
import { generateRecipeImageFlow } from '../flows/generateRecipeImage.js';
import { encodeHeroImage } from '../imaging/encodeHeroImage.js';
import { buildStorageDownloadUrl } from '../imaging/storageDownloadUrl.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { aiFakeEnabled } from '../ai/fakeModel.js';
import { reportServerError } from '../observability/reportServerError.js';
import { whenCfTelemetryReady } from '../observability/telemetryReady.js';

// Tier-2 recipe hero-image generation (issue #148). The counterpart to
// onCanonItemWritten's icon branch: when a recipe is created (or its image is
// explicitly cleared / a regenerate is requested), generate one photorealistic
// "arty" hero from the title + description, store it in Firebase Storage, and
// write the public URL back to `recipe.image`. There is no embedding branch here
// — a recipe's only server-generated side-effect is its hero image.

// Defined here (not imported from index.ts) to avoid a circular import; the
// Firebase CLI aggregates same-named defineSecret calls across files at deploy
// time. The trigger reaches Gemini for the image, so the key must be bound to it.
const geminiApiKey = defineSecret('GEMINI_API_KEY');
// Bound so server error reporting (posthog-node) can read POSTHOG_API_KEY at
// runtime. Optional like elsewhere: when unset, reporting no-ops and the logger
// still emits.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

const IMAGE_STORAGE_PREFIX = 'recipe-images';

/**
 * Edge-trigger decision for the hero-image branch, mirroring
 * onCanonItemWritten.iconNeedsGeneration. The trigger fires on EVERY write to the
 * recipe doc — and recipes are re-saved often (canonicalise, per-row rematch,
 * edits, "apply changes"), each a whole-document `setDoc` — so generation must
 * start only on the write that *transitions* the recipe into "needs an image",
 * never merely because `image` currently happens to be null. Otherwise an edit
 * landing while a generation is in flight would start a duplicate.
 *
 * Generate when:
 *   - create (no prior doc) with a null image and not opted out
 *   - image just went non-null → null (regenerate, or user cleared)
 *   - the `imageRequestedAt` nonce changed — covers a forced regenerate of a
 *     recipe whose image was *already* null (see regenerateRecipeImage)
 * Skip when:
 *   - `image` is already set (a real `{ url, source }` — ai OR upload: a manual
 *     upload is never clobbered) → already have one
 *   - image was already null before this write and stayed null with no nonce bump:
 *     the write that first set it null already owns the in-flight generation.
 *
 * `imageHidden` is retired (Phase 1): it is no longer honored here — the AI
 * trigger auto-generates a hero regardless of that (now inert, back-compat-only)
 * field. Hero visibility is a pure client concern (an image URL either exists or
 * it doesn't).
 *
 * LWW note: a client `setDoc` that lands AFTER the trigger's `image` write and
 * still carries `image: null` will clobber the hero back to null (the documented
 * whole-document LWW contract) and re-fire this branch, which regenerates — so it
 * self-heals at the cost of an extra generation in that narrow race. The client
 * store preserves `image` across its own saves (it re-spreads the subscribed
 * copy), so the window is only saves that beat the subscription echo.
 */
function imageNeedsGeneration(before: DocumentSnapshot | undefined, after: RecipeDoc): boolean {
  if (after.image !== null) return false; // already have an image (ai or upload)
  if (!before?.exists) return true; // create → generate
  const prev = before.data();
  if ((prev?.['image'] ?? null) !== null) return true; // just cleared → generate
  // Already null and still null: only an explicit regenerate (nonce bump) re-fires;
  // any other field change (edit, canonicalise, rematch…) must not start a
  // duplicate.
  return prev?.['imageRequestedAt'] !== after.imageRequestedAt;
}

/**
 * Hero-image branch. Generates the photoreal hero when this write transitions the
 * recipe into "needs an image" (see imageNeedsGeneration).
 *
 * Trade-off of edge-triggering (same as the canon icon branch): a generation that
 * *fails* leaves `image` null but no longer self-heals on the next unrelated
 * write — the regenerate callable (which bumps `imageRequestedAt`) is the retry
 * path.
 */
async function maybeGenerateImage(
  id: string,
  recipe: RecipeDoc,
  before: DocumentSnapshot | undefined,
): Promise<void> {
  if (!imageNeedsGeneration(before, recipe)) return;

  // E2E (FUNCTIONS_AI_FAKE): skip image generation entirely. The real image model
  // and the Storage upload (which authenticates via the GCE metadata server) are
  // not emulator-safe and hang the trigger; no e2e spec asserts a generated hero.
  // Unreachable in production (the flag is never set there).
  if (aiFakeEnabled()) return;

  const title = recipe.title.trim();
  if (!title) return; // a blank draft has nothing to depict yet

  // Per-environment kill-switch (issue #238), checked only once the cheap
  // in-memory guard passes. Turning it off stops every generation path — create,
  // the cleared-image self-heal, and the manual regenerate callable (which routes
  // through this trigger). Re-enabling does not backfill.
  if (!(await isRecipeImageGenerationEnabled())) return;

  // Optional one-shot user steer written by the regenerate callable.
  const hint = recipe.imageHint?.trim();

  try {
    const { imageBase64 } = await withAiTimeout('generateRecipeImage', () =>
      generateRecipeImageFlow({
        title,
        description: recipe.description,
        ...(hint ? { hint } : {}),
        // Feed the recipe's own tags to the model as a dish-type cue for reading
        // mood/season/cuisine (issue #148, Phase 2). Always present on a parsed
        // RecipeDoc (string[], possibly empty); the flow drops empties and adds no
        // clause when there are none. Nothing new is persisted.
        tags: recipe.metadata.tags,
      }),
    );
    const raw = Buffer.from(imageBase64, 'base64');
    const webp = await encodeHeroImage(raw);
    const url = await uploadRecipeImage(id, webp);
    // Set the hero and clear the one-shot hint in the same write. `source: 'ai'`
    // marks it generated so a later trigger pass skips it (and so the UI can tell
    // it apart from a future user upload).
    await getFirestore()
      .collection('recipes')
      .doc(id)
      .update({ image: { url, source: 'ai' }, imageHint: FieldValue.delete() });
  } catch (err) {
    // Leave image null so a later regenerate retries; never block the trigger.
    logger.error('onRecipeWritten: image generation failed', { id, err });
    // Additive: image generation chains an AI flow, image processing and a Storage
    // upload — a throw here is unexpected. Report it to PostHog alongside the
    // logger. Best-effort, never throws; the handler's finally flushes.
    reportServerError(err);
  }
}

/**
 * Reads the per-environment recipe-image kill-switch (issue #238) from
 * `devSettings/singleton`. Fails OPEN: a missing doc, an unexpected shape, or a
 * read error all default to ENABLED, so an environment that never configured the
 * switch keeps generation on and a transient read glitch never silently halts it.
 */
async function isRecipeImageGenerationEnabled(): Promise<boolean> {
  try {
    const snap = await getFirestore().collection('devSettings').doc('singleton').get();
    if (!snap.exists) return true;
    const parsed = DevSettingsSchema.safeParse(snap.data());
    if (!parsed.success) {
      // Expected validation fallback (a doc that doesn't match the schema):
      // NOT reported — a ValidationError-class "expected" outcome, suppressed per
      // policy. The fail-open default + the warn log are the contract.
      logger.warn('onRecipeWritten: invalid devSettings doc, defaulting to enabled');
      return true;
    }
    return parsed.data.recipeImageGenerationEnabled;
  } catch (err) {
    logger.warn('onRecipeWritten: devSettings read failed, defaulting to enabled', { err });
    // A read THROW (vs a shape mismatch above) is a StorageError-class failure.
    // Non-critical (we fail open), but genuinely unexpected, so report it
    // additively — best-effort, never throws.
    reportServerError(err, 'StorageError');
    return true;
  }
}

/** Uploads the hero to Storage and returns its public download URL. */
async function uploadRecipeImage(id: string, webp: Buffer): Promise<string> {
  const bucket = getStorage().bucket();
  const path = `${IMAGE_STORAGE_PREFIX}/${id}.webp`;
  await bucket.file(path).save(webp, {
    contentType: 'image/webp',
    // A regenerate reuses the same object path, so the URL is stable but its
    // BYTES change — do NOT mark it immutable. A short max-age caches within a
    // session while letting a regenerated hero appear without a hard reload.
    metadata: { cacheControl: 'public, max-age=3600' },
  });
  return buildStorageDownloadUrl(bucket.name, path);
}

export const onRecipeWritten = onDocumentWritten(
  {
    document: 'recipes/{id}',
    region: 'europe-west2',
    secrets: [geminiApiKey, posthogApiKey],
    // Image generation (~5–8s+) plus sharp encoding need more headroom than the
    // default text-only triggers.
    timeoutSeconds: 300,
    // Serialise image work per instance (Cloud Run scales out instances instead)
    // so a burst of recipe writes can't pack multiple libvips/sharp decodes onto
    // one instance and OOM it — same rationale as onCanonItemWritten. 1GiB gives
    // the single decode comfortable room. Pinned inline because this module loads
    // before index.ts's setGlobalOptions (same reason region is inline).
    concurrency: 1,
    memory: '1GiB',
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const parsed = RecipeSchema.safeParse(after.data());
    if (!parsed.success) {
      logger.error('onRecipeWritten: invalid doc shape, skipping', {
        id: event.params.id,
        error: parsed.error.message,
      });
      return;
    }

    const id = event.params.id;
    // Wait for the OTel pipeline to be live before running so the flow's AI spans
    // are captured by the span processors (issue #370); resolves immediately once
    // warm, and settles (never rejects) on a telemetry-init failure.
    await whenCfTelemetryReady();
    try {
      await maybeGenerateImage(id, parsed.data, event.data?.before);
    } finally {
      // The branch catch above reports best-effort to posthog-node, which
      // batches; flush before the function freezes so a report is not stranded.
      // Non-throwing + no-op when uninitialised, so it is always safe to call.
      await flushServerObservability();
    }
  },
);
