import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { SetObservationImageUploadInput } from '@salt/domain/schemas';

// The observation photo (issue #812, phase 4 of epic #778). The browser reads a
// local photo, base64-encodes it, and hands it to an AUTH-GATED CALLABLE which
// re-encodes it, writes `batch-images/{batchId}/{observationId}.webp` with the
// Admin SDK, and stamps the URL onto the observation.
//
// Why a callable rather than a client Storage write, mirroring
// callSetRecipeImageUpload: storage.rules stay `write: if false` everywhere — this
// feature introduces no client-writable Storage path — so the client never touches
// the bucket, and firebase-sync stays free of the Storage SDK.
//
// THE OBSERVATION MUST ALREADY EXIST. The callable finishes with a PARTIAL update
// (so attaching a photo cannot clobber the note it belongs to), and a partial update
// of an absent document fails. Call `addBatchObservation` first, then this.
//
// NEVER throws (Rule 10): a failure crosses as a Failure so the log can keep the
// entry the user already wrote and say only that the photo did not attach.
export async function callSetObservationImageUpload(
  batchId: string,
  observationId: string,
  imageBase64: string,
  contentType?: SetObservationImageUploadInput['contentType'],
): Promise<ReadResult<void, DomainError>> {
  try {
    const fn = httpsCallable<SetObservationImageUploadInput, { ok: true }>(
      getFunctions(undefined, 'europe-west2'),
      'setObservationImageUpload',
    );
    await fn({
      batchId,
      observationId,
      imageBase64,
      ...(contentType ? { contentType } : {}),
    });
    return success(undefined);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'functions/unauthenticated') {
      return failure({ kind: 'AuthError', reason: 'unauthenticated' });
    }
    if (code === 'functions/permission-denied') {
      return failure({ kind: 'AuthError', reason: 'forbidden' });
    }
    // Everything else — a photo sharp would not decode, a bucket that would not
    // take it, a dropped connection — is transient from where the log is standing:
    // the offer is "try again", and none of them is a different thing for the user
    // to do.
    return failure({ kind: 'NetworkError', reason: 'transient' });
  }
}
