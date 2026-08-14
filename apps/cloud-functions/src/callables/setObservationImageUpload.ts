import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { SetObservationImageUploadInputSchema } from '@salt/domain/schemas';
import { APP_CHECK_ENFORCEMENT } from '../tracedCallable.js';
import { encodeHeroImage } from '../imaging/encodeHeroImage.js';
import { buildStorageDownloadUrl } from '../imaging/storageDownloadUrl.js';
import { reportFlowError } from '../observability/reportServerError.js';

// Bound so an unexpected Firestore/Storage write failure here can be reported
// (posthog-node). Optional like elsewhere — reporting no-ops when unset. This is
// NOT an AI call — nothing looks at the photograph, it is a record — so like
// setRecipeImageUpload only the posthog secret is bound: no GEMINI_API_KEY, no
// withAiTimeout, no AI-OTLP export in this process.
const posthogApiKey = defineSecret('POSTHOG_API_KEY');

const IMAGE_STORAGE_PREFIX = 'batch-images';

// A photograph on the observation log (issue #812, phase 4 of epic #778). The crock
// on day nine, the crumb of loaf eleven, the bloom on the coppa. The browser reads a
// local photo and the bytes arrive here as base64; we re-encode through the SAME
// encodeHeroImage the recipe hero and the AI path use (bounded 1280², WebP q80 —
// `fit: 'inside'` never crops and never upscales, and `.rotate()` honours the EXIF
// orientation a phone camera writes), save the object, and stamp the URL onto the
// observation.
//
// TWO SEGMENTS IN THE PATH: `batch-images/{batchId}/{observationId}.webp`. The
// object is nested because the observation is — one log entry, of one run — and
// storage.rules matches both segments explicitly (a `{file}` wildcard matches
// exactly one segment, so a one-segment match would never fire on this path). The
// id pair is also the stable key: re-attaching a photo to the same entry overwrites
// the same object rather than orphaning the last one.
//
// Why a callable rather than a client Storage write (mirroring setRecipeImageUpload):
// storage.rules stay `write: if false` everywhere and this feature introduces NO
// client-writable Storage path; the Admin SDK write is auth-gated here.
//
// A PARTIAL `.update()`, deliberately. An observation carries a note and readings
// somebody typed a moment ago; a whole-document write from this function would
// clobber them under LWW if the two crossed. It also means the OBSERVATION MUST
// ALREADY EXIST — a partial update of an absent document fails — which is the
// intended ordering: the client writes the entry, then attaches the photo, so a
// failed upload costs the photo and never the reading.
//
// region/memory are pinned inline (not via setGlobalOptions) because this module is
// imported at the top of index.ts and its onCall is built before setGlobalOptions
// runs — same reason setRecipeImageUpload pins them.
export const setObservationImageUpload = onCall(
  {
    ...APP_CHECK_ENFORCEMENT,
    region: 'europe-west2',
    secrets: [posthogApiKey],
    // sharp decode/encode of a full-resolution phone photo needs headroom above the
    // 256MiB default — same 512MiB floor the rest of the image path uses.
    memory: '512MiB',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const parsed = SetObservationImageUploadInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid request payload.');
    }
    const { batchId, observationId, imageBase64 } = parsed.data;

    try {
      // Decode → re-encode to the bounded WebP (sharp auto-detects the input
      // format, so the optional contentType hint is not needed here).
      const raw = Buffer.from(imageBase64, 'base64');
      const webp = await encodeHeroImage(raw);

      const bucket = getStorage().bucket();
      const path = `${IMAGE_STORAGE_PREFIX}/${batchId}/${observationId}.webp`;
      await bucket.file(path).save(webp, {
        contentType: 'image/webp',
        // Same short max-age as the hero paths: the object path is stable per
        // observation but its bytes change if the photo is retaken, so it must not
        // be immutable.
        metadata: { cacheControl: 'public, max-age=3600' },
      });
      const url = buildStorageDownloadUrl(bucket.name, path);

      // Partial update: the photo and nothing else. `source: 'upload'` marks it
      // user-supplied, matching `recipe.image` — nothing generates an observation
      // photo, and if anything ever does, that field is where it says so.
      await getFirestore()
        .collection('batches')
        .doc(batchId)
        .collection('observations')
        .doc(observationId)
        .update({ image: { url, source: 'upload' } });
    } catch (err) {
      // An unexpected sharp/Storage/Firestore failure (StorageError-class) — report
      // it additively, flush, then re-throw so the callable's error path is
      // unchanged. The auth/validation guards above throw HttpsError before this,
      // so a signed-out caller or a bad payload is never reported as a defect.
      await reportFlowError(err);
      throw err;
    }
    return { ok: true } as const;
  },
);
