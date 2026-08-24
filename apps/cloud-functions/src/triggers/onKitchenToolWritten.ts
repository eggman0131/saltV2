import { getFirestore, FieldValue, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import {
  KitchenToolSchema,
  KITCHEN_TOOLS_COLLECTION,
  DevSettingsSchema,
  type KitchenToolDoc,
} from '@salt/domain/schemas';
import { generateKitchenToolIconFlow } from '../flows/generateKitchenToolIcon.js';
import { removeFlatBackground } from '../imaging/removeFlatBackground.js';
import { normalizeIconFraming } from '../imaging/normalizeIconFraming.js';
import { buildStorageDownloadUrl } from '../imaging/storageDownloadUrl.js';
import { withAiTimeout } from '../adapters/withAiTimeout.js';
import { aiFakeEnabled } from '../ai/fakeModel.js';
import { reportServerError } from '../observability/reportServerError.js';
import { withFirestoreTrigger, traceContextFromWrittenDoc } from './triggerEntrypoint.js';

// Kitchen-tool pictogram generation (issue #882).
//
// The SAME Tier-1 pictogram pipeline as canon items (issue #148,
// docs/canon-icons.md) and product forms (#871), pointed at a fourth collection:
// same seed image, same locked `STYLE`, same background removal and framing
// normalisation, same tri-state `thumbnail`, same kill switch. Only the prompt
// differs, and only in the two ways a hand tool needs it to (see
// kitchenToolIconPrompt.ts).
//
// ONE branch, not two. `onCanonItemWritten` carries an embedding branch beside
// its icon branch; there is no equivalent here, because `resolveKitchenTool`
// matches on label/matcher TEXT and never on a vector — so there is nothing to
// embed. The vocabulary is closed by choice: a name that matches nothing gets no
// picture, and that is the whole cost of a miss.
//
// No `traceContext` plumbing either: `KitchenToolSchema` carries no such field,
// and a tool is written by the seeding script or by an admin curating the list,
// never at the end of a browser-rooted trace. This trigger roots its own.
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

// Mirrors canon's `canon-icons` and forms' `product-form-icons`. A distinct
// prefix (rather than sharing one) is what lets the weekly orphan sweep join each
// prefix against its OWN collection — see the SWEEPS table in
// maintenance/sweepOrphanedStorage.ts, which this prefix is registered in.
const ICON_STORAGE_PREFIX = 'kit-icons';

/**
 * Edge-trigger decision, identical in shape to the canon and product-form
 * triggers'. The trigger fires on EVERY write to the doc, so generation must
 * start only on the write that *transitions* the tool into "needs an icon" —
 * never merely because the thumbnail currently happens to be null. Otherwise an
 * unrelated write landing while a generation is still in flight re-enters and
 * starts a *duplicate* generation, because `thumbnail` stays null until the first
 * one finishes. That hazard is real here: adding a matcher to a tool whose
 * picture is still being drawn rewrites the doc.
 *
 * Generate when:
 *   - create (no prior doc) with a null thumbnail
 *   - thumbnail just went non-null → null (manual regenerate, or user cleared)
 *   - the `iconRequestedAt` nonce changed — covers a forced regenerate of a tool
 *     whose thumbnail was *already* null
 *
 * `thumbnail !== null` (a real URL, or the CANON_ICON_HIDDEN "hidden" sentinel)
 * always skips: already generated, or the user opted out forever. That is also
 * what makes the seeding script safe — it writes each document with its thumbnail
 * ALREADY set, so this trigger sees the create and skips rather than redrawing
 * every tool a second time at the seeder's expense.
 */
export function iconNeedsGeneration(
  before: DocumentSnapshot | undefined,
  after: KitchenToolDoc,
): boolean {
  if (after.thumbnail !== null) return false; // real URL or "hidden" sentinel → skip
  if (!before?.exists) return true; // create → generate
  const prev = before.data();
  // `?? null` reads a missing key as "already null", so the schema default
  // arriving on the parsed `after` is never mistaken for a just-cleared icon.
  if ((prev?.['thumbnail'] ?? null) !== null) return true; // just cleared → generate
  // Already null and still null: only an explicit regenerate (nonce bump)
  // re-fires; editing a label or a matcher must not start a duplicate.
  return prev?.['iconRequestedAt'] !== after.iconRequestedAt;
}

/**
 * Reads the per-environment icon kill-switch (issue #238) from
 * `devSettings/singleton`. DELIBERATELY the same `canonIconGenerationEnabled`
 * flag the canon and product-form triggers read, not a fourth switch: same
 * pipeline, same model, same cost profile, so another flag would only be another
 * thing to remember to flip alongside the first three (the decision already taken
 * in #871 and #877).
 *
 * Fails OPEN, exactly as those do: a missing doc, an unexpected shape, or a read
 * error all default to ENABLED, so an environment that never configured the
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
      logger.warn('onKitchenToolWritten: invalid devSettings doc, defaulting to enabled');
      return true;
    }
    return parsed.data.canonIconGenerationEnabled;
  } catch (err) {
    logger.warn('onKitchenToolWritten: devSettings read failed, defaulting to enabled', { err });
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
 * public read on `kit-icons/`), so no object ACL / `makePublic()` is needed —
 * that path is the raw-GCS IAM model and throws on buckets with uniform
 * bucket-level access (the default).
 *
 * A regeneration reuses the same object path; the `iconRequestedAt` nonce on the
 * document is what busts the browser cache in front of it.
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
 * Icon branch: generate the pictogram when this write transitions the tool into
 * "needs an icon" (see iconNeedsGeneration).
 *
 * Trade-off of edge-triggering, inherited from canon: a generation that *fails*
 * leaves `thumbnail` null but no longer self-heals on the next unrelated write —
 * bumping `iconRequestedAt` is the retry path.
 */
async function maybeGenerateIcon(
  id: string,
  tool: KitchenToolDoc,
  before: DocumentSnapshot | undefined,
): Promise<void> {
  if (!iconNeedsGeneration(before, tool)) return;

  // E2E (FUNCTIONS_AI_FAKE): skip icon generation entirely, as canon's does. The
  // real image model and the Storage upload (which authenticates via the GCE
  // metadata server) are not emulator-safe and hang the trigger; no e2e spec
  // asserts a generated icon. Unreachable in production.
  if (aiFakeEnabled()) return;

  // The tool's LABEL is what the picture is of — "Mixing bowl", "Balloon whisk".
  // The matchers are alternative phrasings a cook might type, never subjects: a
  // prompt naming all of them would ask for several tools in one frame.
  const label = tool.label.trim();
  if (!label) return;

  // Per-environment kill-switch, checked only once the cheap in-memory guards
  // pass (i.e. we would otherwise generate).
  if (!(await isIconGenerationEnabled())) return;

  // Optional one-shot steer from whoever judged the last drawing wrong.
  const hint = tool.iconHint?.trim();

  try {
    // No outer withAiTimeout (issue #915) — the flow owns its budget (60s + 1
    // retry). See the note at the canon trigger's identical call.
    const { imageBase64 } = await generateKitchenToolIconFlow({
      label,
      ...(hint ? { hint } : {}),
    });
    const raw = Buffer.from(imageBase64, 'base64');
    // Identical processing to canon's, deliberately including `contentMax: 108`:
    // a tool icon sits in the same tile as a canon icon — on a guided mise card
    // whose rows below it are ingredient pictograms — so any different framing
    // would read as two icon sets rather than one.
    const webp = await normalizeIconFraming(await removeFlatBackground(raw), { contentMax: 108 });
    const url = await uploadIcon(id, webp);
    // Set the icon and clear the one-shot hint in the same write. A PARTIAL
    // update, never a full-document set: a curator may well have been editing
    // the matchers while the picture was being drawn, and LWW at document level
    // would throw their edit away.
    await getFirestore()
      .collection(KITCHEN_TOOLS_COLLECTION)
      .doc(id)
      .update({ thumbnail: url, iconHint: FieldValue.delete() });
  } catch (err) {
    // Leave thumbnail null so a later regenerate retries; never block the trigger.
    logger.error('onKitchenToolWritten: icon generation failed', { id, err });
    // Icon generation chains an AI flow, image processing and a Storage upload —
    // a throw here is unexpected. Report additively; best-effort, never throws.
    reportServerError(err);
  }
}

export const onKitchenToolWritten = onDocumentWritten(
  {
    document: `${KITCHEN_TOOLS_COLLECTION}/{id}`,
    region: 'europe-west2',
    secrets: [geminiApiKey, posthogApiKey],
    // Image generation (~5–8s+) plus sharp processing need more headroom than
    // the default text-only triggers.
    timeoutSeconds: 300,
    // Same reasoning as onCanonItemWritten: each icon decode holds a
    // libvips/sharp image buffer, and seeding the vocabulary fires this trigger
    // dozens of times in quick succession. concurrency:1 serialises icon work per
    // instance (Cloud Run scales out instead), bounding memory regardless of how
    // many tools land at once; 1GiB gives the single decode room. Pinned inline —
    // this module loads before index.ts's setGlobalOptions, same reason region is.
    concurrency: 1,
    memory: '1GiB',
  },
  withFirestoreTrigger<{ id: string }>(async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const parsed = KitchenToolSchema.safeParse(after.data());
    if (!parsed.success) {
      // Trigger boundary: log and return — there is no caller to surface a
      // Failure to (Zod conventions, root CLAUDE.md).
      logger.error('onKitchenToolWritten: invalid doc shape, skipping', {
        id: event.params.id,
        error: parsed.error.message,
      });
      return;
    }

    await maybeGenerateIcon(event.params.id, parsed.data, event.data?.before);
  }, traceContextFromWrittenDoc),
);
