import { getFirestore, FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { ProductFormSchema, DevSettingsSchema, type ProductFormDoc } from '@salt/domain/schemas';
import { generateCanonIconFlow } from '../flows/generateCanonIcon.js';
import { removeFlatBackground } from '../imaging/removeFlatBackground.js';
import { normalizeIconFraming } from '../imaging/normalizeIconFraming.js';
import { buildStorageDownloadUrl } from '../imaging/storageDownloadUrl.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { aiFakeEnabled } from '../ai/fakeModel.js';
import { reportServerError } from '../observability/reportServerError.js';
import { withFirestoreTrigger, traceContextFromWrittenDoc } from './triggerEntrypoint.js';

// Product-form pictogram generation (issue #871).
//
// The SAME Tier-1 pictogram pipeline as canon items (issue #148, docs/canon-icons.md),
// pointed at a second collection: same seed image, same locked STYLE/UK prompt,
// same background removal and framing normalisation. A form gets its own icon
// rather than borrowing its parent's because a form exists precisely when the
// thing you buy looks different from the parent — lime juice is not a lime.
//
// ONE branch, not two. `onCanonItemWritten` carries an embedding branch beside
// its icon branch; there is no equivalent here, because `resolveProductForm`
// matches on label/matcher TEXT, not on a vector — so there is nothing to embed.
//
// No `traceContext` plumbing either: `ProductFormSchema` carries no such field,
// and forms are written by an admin editing the catalog rather than at the end
// of a browser-rooted shopping-list trace. This trigger roots its own trace.
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// Mirrors canon's `canon-icons`. A distinct prefix (rather than sharing one) is
// what lets the weekly orphan sweep join each prefix against its OWN collection
// — see the SWEEPS table in maintenance/sweepOrphanedStorage.ts, which this
// prefix is registered in.
const ICON_STORAGE_PREFIX = 'product-form-icons';

/**
 * Edge-trigger decision, identical in shape to the canon trigger's. The trigger
 * fires on EVERY write to the doc, so generation must start only on the write
 * that *transitions* the form into "needs an icon" — never merely because the
 * thumbnail currently happens to be null. Otherwise an unrelated write landing
 * while a generation is still in flight re-enters and starts a *duplicate*
 * generation, because `thumbnail` stays null until the first one finishes. That
 * hazard is real here: confirming a pending form, retitling it, or changing its
 * parent all rewrite the doc, and the admin catalog saves field-by-field on blur.
 *
 * Generate when:
 *   - create (no prior doc) with a null thumbnail
 *   - thumbnail just went non-null → null (manual regenerate, or user cleared)
 *   - the `iconRequestedAt` nonce changed — covers a forced regenerate of a form
 *     whose thumbnail was *already* null (see regenerateProductFormIcon)
 *
 * `thumbnail !== null` (a real URL, or the CANON_ICON_HIDDEN "hidden" sentinel)
 * always skips: already generated, or the user opted out forever.
 */
export function iconNeedsGeneration(
  before: DocumentSnapshot | undefined,
  after: ProductFormDoc,
): boolean {
  if (after.thumbnail !== null) return false; // real URL or "hidden" sentinel → skip
  if (!before?.exists) return true; // create → generate
  const prev = before.data();
  // A form written before issue #871 has NO thumbnail key at all. `?? null`
  // reads that absence as "already null", so the schema default arriving on the
  // parsed `after` is not mistaken for a just-cleared icon — otherwise the first
  // unrelated edit to every legacy form would fire a generation at once.
  if ((prev?.['thumbnail'] ?? null) !== null) return true; // just cleared → generate
  // Already null and still null: only an explicit regenerate (nonce bump)
  // re-fires; any other field change (label, matchers, parent, confirm) must not
  // start a duplicate.
  return prev?.['iconRequestedAt'] !== after.iconRequestedAt;
}

/**
 * Reads the per-environment icon kill-switch (issue #238) from
 * `devSettings/singleton`. DELIBERATELY the same `canonIconGenerationEnabled`
 * flag the canon trigger reads, not a second switch: same pipeline, same model,
 * same cost profile, so a second flag would only be a second thing to remember
 * to flip alongside the first (issue #871, Open Questions).
 *
 * Fails OPEN, exactly as canon's does: a missing doc, an unexpected shape, or a
 * read error all default to ENABLED, so an environment that never configured the
 * switch keeps the default behaviour and a transient read glitch never silently
 * halts generation.
 */
async function isIconGenerationEnabled(): Promise<boolean> {
  try {
    const snap = await getFirestore().collection('devSettings').doc('singleton').get();
    if (!snap.exists) return true;
    const parsed = DevSettingsSchema.safeParse(snap.data());
    if (!parsed.success) {
      // Expected validation fallback (e.g. a partially-written settings doc):
      // NOT reported — a ValidationError-class outcome, suppressed per policy.
      logger.warn('onProductFormWritten: invalid devSettings doc, defaulting to enabled');
      return true;
    }
    return parsed.data.canonIconGenerationEnabled;
  } catch (err) {
    logger.warn('onProductFormWritten: devSettings read failed, defaulting to enabled', { err });
    // A read THROW (vs the shape mismatch above) is a StorageError-class failure.
    // Non-critical (we fail open) but genuinely unexpected, so report additively.
    reportServerError(err, 'StorageError');
    return true;
  }
}

/**
 * Uploads the icon to Storage and returns its public download URL.
 *
 * The Firebase Storage download endpoint, not the raw GCS URL, for the same
 * reason as canon's: only the former is governed by `storage.rules` (which grant
 * public read on `product-form-icons/`), so no object ACL / `makePublic()` is
 * needed — that path is the raw-GCS IAM model and throws on buckets with uniform
 * bucket-level access (the default).
 */
async function uploadIcon(id: string, webp: Buffer): Promise<string> {
  const bucket = getStorage().bucket();
  const path = `${ICON_STORAGE_PREFIX}/${id}.webp`;
  await bucket.file(path).save(webp, {
    contentType: 'image/webp',
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  });
  return buildStorageDownloadUrl(bucket.name, path);
}

/**
 * Icon branch: generate the pictogram when this write transitions the form into
 * "needs an icon" (see iconNeedsGeneration).
 *
 * Trade-off of edge-triggering, inherited from canon: a generation that *fails*
 * leaves `thumbnail` null but no longer self-heals on the next unrelated write —
 * the regenerate callable (which bumps `iconRequestedAt`) is the retry path.
 */
async function maybeGenerateIcon(
  id: string,
  form: ProductFormDoc,
  before: DocumentSnapshot | undefined,
): Promise<void> {
  if (!iconNeedsGeneration(before, form)) return;

  // E2E (FUNCTIONS_AI_FAKE): skip icon generation entirely, as canon's does. The
  // real image model and the Storage upload (which authenticates via the GCE
  // metadata server) are not emulator-safe and hang the trigger; no e2e spec
  // asserts a generated icon. Unreachable in production.
  if (aiFakeEnabled()) return;

  // The form's LABEL is what the picture is of — "lime juice", "egg yolk". It is
  // already the human-facing name of the thing bought, so it needs no decoration
  // with the parent's name: prompting "lime juice" draws juice, prompting "lime
  // (lime juice)" invites the model to draw both.
  const name = form.label.trim();
  if (!name) return;

  // Per-environment kill-switch, checked only once the cheap in-memory guards
  // pass (i.e. we would otherwise generate).
  if (!(await isIconGenerationEnabled())) return;

  // Optional one-shot user steer written by the regenerate callable.
  const hint = form.iconHint?.trim();

  try {
    // No outer withAiTimeout (issue #915) — the flow owns its budget (60s + 1
    // retry). See the note at the canon trigger's identical call.
    const { imageBase64 } = await generateCanonIconFlow({ name, ...(hint ? { hint } : {}) });
    const raw = Buffer.from(imageBase64, 'base64');
    // Identical processing to canon's, deliberately including `contentMax: 108`:
    // a form icon sits in the SAME 40px catalog row tile as a canon icon, right
    // above one in the same list, so any different framing would read as two
    // icon sets rather than one.
    const webp = await normalizeIconFraming(await removeFlatBackground(raw), { contentMax: 108 });
    const url = await uploadIcon(id, webp);
    // Set the icon and clear the one-shot hint in the same write.
    await getFirestore()
      .collection('productForms')
      .doc(id)
      .update({ thumbnail: url, iconHint: FieldValue.delete() });
  } catch (err) {
    // Leave thumbnail null so a later regenerate retries; never block the trigger.
    logger.error('onProductFormWritten: icon generation failed', { id, err });
    // Icon generation chains an AI flow, image processing and a Storage upload —
    // a throw here is unexpected. Report additively; best-effort, never throws.
    reportServerError(err);
  }
}

export const onProductFormWritten = onDocumentWritten(
  {
    document: 'productForms/{id}',
    region: 'europe-west2',
    secrets: [geminiApiKey, posthogApiKey],
    // Image generation (~5–8s+) plus sharp processing need more headroom than
    // the default text-only triggers.
    timeoutSeconds: 300,
    // Same reasoning as onCanonItemWritten: each icon decode holds a
    // libvips/sharp image buffer, and a batch of AI-seeded form proposals fires
    // this trigger many times at once. concurrency:1 serialises icon work per
    // instance (Cloud Run scales out instead), bounding memory regardless of
    // batch size; 1GiB gives the single decode room. Pinned inline — this module
    // loads before index.ts's setGlobalOptions, same reason region is inline.
    concurrency: 1,
    memory: '1GiB',
  },
  withFirestoreTrigger<{ id: string }>(async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const parsed = ProductFormSchema.safeParse(after.data());
    if (!parsed.success) {
      // Trigger boundary: log and return — there is no caller to surface a
      // Failure to (Zod conventions, root CLAUDE.md).
      logger.error('onProductFormWritten: invalid doc shape, skipping', {
        id: event.params.id,
        error: parsed.error.message,
      });
      return;
    }

    await maybeGenerateIcon(event.params.id, parsed.data, event.data?.before);
  }, traceContextFromWrittenDoc),
);
