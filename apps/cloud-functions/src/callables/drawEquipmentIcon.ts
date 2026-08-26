import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { DrawEquipmentIconInputSchema, EQUIPMENT_ICONS_COLLECTION } from '@salt/domain/schemas';
import { makeCallable } from '../tracedCallable.js';
import { generateEquipmentIconFlow } from '../flows/generateEquipmentIcon.js';
import { removeFlatBackground } from '../imaging/removeFlatBackground.js';
import { normalizeIconFraming } from '../imaging/normalizeIconFraming.js';
import { ICON_CONTENT_MAX, uploadIcon } from '../imaging/iconStorage.js';
import { isIconGenerationEnabled } from '../triggers/iconWriteTrigger.js';

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
export const drawEquipmentIcon = makeCallable({
  options: {
    region: 'europe-west2',
    secrets: [geminiApiKey, posthogApiKey],
    timeoutSeconds: 300,
    memory: '1GiB',
    concurrency: 1,
  },
  handler: async (request) => {
    const parsed = DrawEquipmentIconInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const input = parsed.data;
    const ref = getFirestore().collection(EQUIPMENT_ICONS_COLLECTION).doc(input.itemId);

    if (input.action === 'hide') {
      // Partial update: the sentinel and nothing else. The brief survives, so
      // un-hiding is just pressing Draw again — there is nothing to restore.
      await ref.update({ thumbnail: ICON_HIDDEN });
      return { ok: true } as const;
    }

    // The same kill switch the brief trigger reads (`canonIconGenerationEnabled`,
    // issue #238) — one switch for one pipeline, via the one shared reader.
    if (!(await isIconGenerationEnabled('drawEquipmentIcon'))) {
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

    // No outer withAiTimeout: the flow owns its budget (60 s + 1 retry). See
    // the note in the brief trigger — nesting two budgets is how the canon path
    // ended up with an outer race that can pre-empt the inner one.
    const { imageBase64 } = await generateEquipmentIconFlow({
      name: briefSourceName,
      brief: input.brief,
    });
    const webp = await normalizeIconFraming(
      await removeFlatBackground(Buffer.from(imageBase64, 'base64')),
      { contentMax: ICON_CONTENT_MAX },
    );
    const url = await uploadIcon(ICON_STORAGE_PREFIX, input.itemId, webp);

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
    return { ok: true } as const;
  },
});
