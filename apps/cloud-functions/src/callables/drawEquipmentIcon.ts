import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import {
  DevSettingsSchema,
  DrawEquipmentIconInputSchema,
  EQUIPMENT_ICONS_COLLECTION,
} from '@salt/domain/schemas';
import { APP_CHECK_ENFORCEMENT } from '../tracedCallable.js';
import { generateEquipmentIconFlow } from '../flows/generateEquipmentIcon.js';
import { removeFlatBackground } from '../imaging/removeFlatBackground.js';
import { normalizeIconFraming } from '../imaging/normalizeIconFraming.js';
import { buildStorageDownloadUrl } from '../imaging/storageDownloadUrl.js';
import { reportFlowError } from '../observability/reportServerError.js';

// Draw (and hide) an equipment pictogram (issue #877).
//
// DRAWING HAPPENS INLINE IN A CALLABLE, not via a second Firestore trigger. The
// user pressed a button and is sitting there waiting, so the callable does the
// work and returns — `setObservationImageUpload` is the in-repo precedent for a
// callable that runs imaging inline and stamps the result back with a partial
// `.update()`. Routing this through a trigger on `equipmentIcons/{itemId}` would
// mean a second trigger and the write-nonce it would need to fire reliably, for
// no benefit to anyone.
//
// BOTH actions go through a callable because `equipmentIcons` is
// client-write-denied. Canon can afford a plain client write for hide
// (`hideCanonIcon`) because its sentinel lives on a document the client already
// writes; equipment has no such path, and opening a server-owned collection to
// client writes just to mirror canon's split would re-introduce a client write
// path onto a server-owned document for nothing.
//
// PARTIAL `.update()` throughout, deliberately, for the reason
// `setObservationImageUpload` records: a whole-document write from a function
// clobbers whatever somebody typed a moment ago. Here that would be the brief.

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

const ICON_STORAGE_PREFIX = 'equipment-icons';

/**
 * The user's sentinel for "I do not want a picture here". This is canon's
 * `CANON_ICON_HIDDEN` value, and the two families must agree on it because
 * `CanonIcon` is what reads it — it is the string the component treats as "render
 * the bare tile". Spelled here rather than imported so cloud-functions does not
 * pull the canon module in for one literal.
 */
const ICON_HIDDEN = 'hidden';

/**
 * The same kill switch the brief trigger reads (`canonIconGenerationEnabled`,
 * issue #238) — one switch for one pipeline. Same FAIL-OPEN posture: a missing,
 * malformed or unreadable settings doc leaves generation enabled.
 */
async function isIconGenerationEnabled(): Promise<boolean> {
  try {
    const snap = await getFirestore().collection('devSettings').doc('singleton').get();
    if (!snap.exists) return true;
    const parsed = DevSettingsSchema.safeParse(snap.data());
    if (!parsed.success) {
      logger.warn('drawEquipmentIcon: invalid devSettings doc, defaulting to enabled');
      return true;
    }
    return parsed.data.canonIconGenerationEnabled;
  } catch (err) {
    logger.warn('drawEquipmentIcon: devSettings read failed, defaulting to enabled', { err });
    return true;
  }
}

/**
 * Uploads the pictogram and returns its public download URL.
 *
 * `immutable` cacheControl, chosen rather than inherited: canon writes its icons
 * immutable and relies on `CanonIcon`'s `?v=` cache-bust (fed here from
 * `iconRequestedAt`), while recipe heroes use `max-age=3600` instead. Equipment
 * has a redraw path that reuses the SAME object path, so it needs the same pair
 * canon uses — immutable bytes plus a version nonce — not a short max-age.
 *
 * The Firebase download endpoint, not the raw GCS URL: only that form is governed
 * by `storage.rules`, which is what grants public read on `equipment-icons/`.
 */
async function uploadEquipmentIcon(itemId: string, webp: Buffer): Promise<string> {
  const bucket = getStorage().bucket();
  const path = `${ICON_STORAGE_PREFIX}/${itemId}.webp`;
  await bucket.file(path).save(webp, {
    contentType: 'image/webp',
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  });
  return buildStorageDownloadUrl(bucket.name, path);
}

// region/memory are pinned inline (not via setGlobalOptions) because this module
// is imported at the top of index.ts and its onCall is built before
// setGlobalOptions runs — the same reason the triggers pin theirs.
//
// The runtime posture is the canon trigger's, and it belongs HERE rather than on
// the brief trigger, because this is the function that runs sharp: parallel
// libvips decodes packed onto one Cloud Run instance blow the memory cap and the
// instance is OOM-killed, losing every in-flight icon. concurrency:1 serialises
// icon work per instance (Cloud Run scales out instead); 1 GiB gives the single
// decode room. 300 s covers the flow's own 60 s + 1 retry plus the imaging.
export const drawEquipmentIcon = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    region: 'europe-west2',
    secrets: [geminiApiKey, posthogApiKey],
    timeoutSeconds: 300,
    memory: '1GiB',
    concurrency: 1,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const parsed = DrawEquipmentIconInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const input = parsed.data;
    const ref = getFirestore().collection(EQUIPMENT_ICONS_COLLECTION).doc(input.itemId);

    if (input.action === 'hide') {
      try {
        // Partial update: the sentinel and nothing else. The brief survives, so
        // un-hiding is just pressing Draw again — there is nothing to restore.
        await ref.update({ thumbnail: ICON_HIDDEN });
      } catch (err) {
        await reportFlowError(err);
        throw err;
      }
      return { ok: true } as const;
    }

    if (!(await isIconGenerationEnabled())) {
      // Refuse honestly rather than returning ok on a draw that will never
      // happen. The client surfaces this as a toast.
      throw new HttpsError('failed-precondition', 'Icon generation is disabled.');
    }

    const snap = await ref.get();
    if (!snap.exists) {
      // The brief trigger authors this document. No document means no brief has
      // been written yet, and a draw with nothing to draw from is not a request
      // this callable should invent an answer to.
      throw new HttpsError('failed-precondition', 'No description to draw from yet.');
    }
    // The name the CURRENT brief was authored from. It is what the picture will be
    // stamped as drawn from, and it doubles as the flow's span label — the item's
    // name by definition, without a second read of the manifest.
    const briefSourceName = snap.get('briefSourceName') as string | undefined;
    if (!briefSourceName) {
      throw new HttpsError('failed-precondition', 'No description to draw from yet.');
    }

    try {
      // No outer withAiTimeout: the flow owns its budget (60 s + 1 retry). See
      // the note in the brief trigger — nesting two budgets is how the canon path
      // ended up with an outer race that can pre-empt the inner one.
      const { imageBase64 } = await generateEquipmentIconFlow({
        name: briefSourceName,
        brief: input.brief,
      });
      const webp = await normalizeIconFraming(
        await removeFlatBackground(Buffer.from(imageBase64, 'base64')),
        // The canon value, tuned for the 40px row tile.
        { contentMax: 108 },
      );
      const url = await uploadEquipmentIcon(input.itemId, webp);

      // The write-back, in a transaction for ONE reason: a rename can land while
      // the image is generating (~10 s), and the brief trigger will have
      // re-authored `subjectBrief`/`briefSourceName` under the new name by the
      // time we get here. Writing our stale brief over that fresh one would
      // strand a description that no longer matches its item AND that the trigger
      // will never re-author, because its guard already reads as satisfied.
      //
      // So: if nothing moved, stamp everything (including the user's edited brief,
      // which is the whole point of the review gate). If the name moved, keep the
      // picture — it is a real picture of a real appliance and worth having — but
      // leave the newer brief and its name alone. `sourceName` is deliberately not
      // stamped in that arm, so `equipmentIconAwaitingApproval` stays true and the
      // user is asked to read the new description, which is exactly right.
      await getFirestore().runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists) return; // deleted mid-draw — nothing to stamp
        const stamp = { thumbnail: url, iconRequestedAt: Date.now() };
        if (fresh.get('briefSourceName') === briefSourceName) {
          tx.update(ref, { ...stamp, subjectBrief: input.brief, sourceName: briefSourceName });
        } else {
          tx.update(ref, stamp);
        }
      });
    } catch (err) {
      // An unexpected AI/sharp/Storage/Firestore failure (the auth, validation and
      // precondition guards above threw HttpsError before reaching here, so a
      // signed-out caller or a bad payload is never reported as a defect).
      await reportFlowError(err);
      throw err;
    }
    return { ok: true } as const;
  },
);
