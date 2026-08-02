import { getFunctions, httpsCallable } from 'firebase/functions';
import { failure, success, type DomainError, type ReadResult } from '@salt/shared-types';
import type { IngredientGroup } from '@salt/domain';
import { PHOTO_IMPORT_TIMEOUT_SECONDS } from '@salt/domain/schemas';
import type {
  DescribeRecipeSceneInput,
  DescribeRecipeSceneOutput,
  ExtractRecipeFromUrlInput,
  ExtractRecipeFromPhotoInput,
  PhotoImportFailureCode,
  RecipeDoc,
  UrlImportFailureCode,
} from '@salt/domain/schemas';

export async function callParseRecipeIngredients(
  rawText: string,
): Promise<ReadResult<IngredientGroup[], DomainError>> {
  try {
    const fn = httpsCallable<{ rawText: string }, IngredientGroup[]>(
      getFunctions(undefined, 'europe-west2'),
      'parseRecipeIngredients',
    );
    const res = await fn({ rawText });
    return success(res.data);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'functions/unauthenticated') {
      return failure({ kind: 'AuthError', reason: 'unauthenticated' });
    }
    if (code === 'functions/permission-denied') {
      return failure({ kind: 'AuthError', reason: 'forbidden' });
    }
    return failure({ kind: 'NetworkError', reason: 'transient' });
  }
}

// Map the callable's HttpsError code → the URL-import failure vocabulary. The
// CF entrypoint deliberately maps each UrlImportError code to a distinct gRPC
// code (see apps/cloud-functions/src/index.ts:mapUrlImportFailure), so the
// reverse mapping here is exact. The error channel carries the failure code
// directly (not a DomainError) because the import failures are import-specific
// and the web copy map keys off them. Adapters never throw — every failure
// crosses as a Failure.
function classifyUrlImportError(err: unknown): UrlImportFailureCode {
  const code = (err as { code?: string }).code ?? '';
  switch (code) {
    case 'functions/invalid-argument':
      // Covers both invalid-url and blocked-url. The CF copy distinguishes
      // them via the message; the client treats both as "can't import this
      // address" — we surface blocked-url (the stricter, no-detail message)
      // only when the message indicates a blocked link, else invalid-url.
      return /can't be imported/i.test(String((err as { message?: string }).message ?? ''))
        ? 'blocked-url'
        : 'invalid-url';
    case 'functions/unavailable':
      return 'fetch-failed';
    case 'functions/failed-precondition':
      return 'not-a-recipe';
    case 'functions/deadline-exceeded':
    case 'functions/internal':
      return 'ai-failed';
    default:
      // Network/transport hiccup before the function ran — treat as unreachable.
      return 'fetch-failed';
  }
}

// Clears a recipe's hero image server-side (issue #148, Tier-2), re-firing the
// onRecipeWritten trigger so the image branch regenerates. Used for both the
// "regenerate" and "generate for the first time" actions (both set image → null),
// and it un-hides in the same write. Mirrors callRegenerateCanonIcon.
//
// `brief` is the art direction for the next generation — the user's (possibly
// edited) scene paragraph. Omitted or blank means "no brief", which the callable
// writes as a cleared `imageBrief` and the trigger reads as "author one" — the
// path a recipe with no brief yet takes. Optional → back-compat.
export async function callRegenerateRecipeImage(
  recipeId: string,
  brief?: string,
): Promise<ReadResult<void, DomainError>> {
  try {
    const fn = httpsCallable<{ recipeId: string; brief?: string }, { ok: true }>(
      getFunctions(undefined, 'europe-west2'),
      'regenerateRecipeImage',
    );
    await fn(brief && brief.trim() ? { recipeId, brief: brief.trim() } : { recipeId });
    return success(undefined);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'functions/unauthenticated') {
      return failure({ kind: 'AuthError', reason: 'unauthenticated' });
    }
    if (code === 'functions/permission-denied') {
      return failure({ kind: 'AuthError', reason: 'forbidden' });
    }
    return failure({ kind: 'NetworkError', reason: 'transient' });
  }
}

// Uploads a user-supplied hero photo for a recipe (issue #455, Phase 2). The
// cropped 3:2 bytes ride as a base64 string; the callable re-encodes them and
// writes `recipe-images/{id}.webp`, then stamps `recipe.image = { url, source:
// 'upload' }`. Mirrors callRegenerateRecipeImage: a callable (never a client
// Storage write — storage.rules stay write:false), try → success(undefined), catch
// maps unauthenticated/permission-denied → AuthError else NetworkError. NEVER
// throws (Rule 10). The optional `contentType` is an informational hint only.
export async function callSetRecipeImageUpload(
  recipeId: string,
  imageBase64: string,
  contentType?: string,
): Promise<ReadResult<void, DomainError>> {
  try {
    const fn = httpsCallable<
      { recipeId: string; imageBase64: string; contentType?: string },
      { ok: true }
    >(getFunctions(undefined, 'europe-west2'), 'setRecipeImageUpload');
    await fn(contentType ? { recipeId, imageBase64, contentType } : { recipeId, imageBase64 });
    return success(undefined);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'functions/unauthenticated') {
      return failure({ kind: 'AuthError', reason: 'unauthenticated' });
    }
    if (code === 'functions/permission-denied') {
      return failure({ kind: 'AuthError', reason: 'forbidden' });
    }
    return failure({ kind: 'NetworkError', reason: 'transient' });
  }
}

// Scene brief on demand (issue #522, Phase 3). Sends the recipe — plus, on a
// revision, the current brief and the user's steer — and receives the
// art-direction paragraph back. Persists NOTHING: the brief returns to the dialog
// for the user to read and edit, and only reaches Firestore if they then press
// Regenerate (callRegenerateRecipeImage stamps it onto `imageBrief`).
//
// `traceparent` (issue #362) rides on the payload exactly as in
// callExtractRecipeFromUrl — the Firebase callable SDK cannot carry a custom
// `traceparent` HTTP header, so the browser-supplied W3C trace id goes as a named
// field the CF entrypoint strips before the flow runs. firebase-sync only forwards
// the string (Rule 4: no observability import). Optional → back-compat.
//
// NEVER throws (Rule 10): a failure crosses as a Failure so the caller can leave
// the user's existing brief untouched and say so.
export async function callDescribeRecipeScene(
  input: DescribeRecipeSceneInput,
  traceparent?: string,
): Promise<ReadResult<DescribeRecipeSceneOutput, DomainError>> {
  try {
    const fn = httpsCallable<
      DescribeRecipeSceneInput & { traceparent?: string },
      DescribeRecipeSceneOutput
    >(getFunctions(undefined, 'europe-west2'), 'describeRecipeScene');
    const res = await fn(traceparent ? { ...input, traceparent } : input);
    return success(res.data);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'functions/unauthenticated') {
      return failure({ kind: 'AuthError', reason: 'unauthenticated' });
    }
    if (code === 'functions/permission-denied') {
      return failure({ kind: 'AuthError', reason: 'forbidden' });
    }
    return failure({ kind: 'NetworkError', reason: 'transient' });
  }
}

// SSRF-hardened URL import. Sends a URL, receives a fully-assembled, metric +
// British recipe draft (source.type='url'). On failure returns the specific
// UrlImportFailureCode so the caller can show the right copy.
// `traceparent` (issue #362) is an OPTIONAL, named transport field forwarded on
// the payload — the Firebase callable SDK cannot carry a custom `traceparent`
// HTTP header, so the browser-supplied W3C trace id rides here and the CF
// entrypoint strips it before running the flow. firebase-sync only forwards the
// string (Rule 4: no observability import). Optional → back-compat.
export async function callExtractRecipeFromUrl(
  input: ExtractRecipeFromUrlInput,
  traceparent?: string,
): Promise<ReadResult<RecipeDoc, UrlImportFailureCode>> {
  try {
    const fn = httpsCallable<ExtractRecipeFromUrlInput & { traceparent?: string }, RecipeDoc>(
      getFunctions(undefined, 'europe-west2'),
      'extractRecipeFromUrl',
    );
    const res = await fn(traceparent ? { ...input, traceparent } : input);
    return success(res.data);
  } catch (err) {
    return failure(classifyUrlImportError(err));
  }
}

// Map the callable's HttpsError code → the PHOTO-import failure vocabulary
// (issue #649). Its own closed set, not the URL one: invalid-url / blocked-url /
// fetch-failed are meaningless when the input is a photograph. The CF entrypoint
// maps each PhotoImportError code to a distinct gRPC code (see
// apps/cloud-functions/src/index.ts:mapPhotoImportFailure), so the reverse
// mapping here is exact.
function classifyPhotoImportError(err: unknown): PhotoImportFailureCode {
  const code = (err as { code?: string }).code ?? '';
  switch (code) {
    case 'functions/invalid-argument':
      // A payload the wire schema refused: no images, more than four, an
      // unsupported content type, or empty bytes.
      return 'invalid-photos';
    case 'functions/failed-precondition':
      // Blurry/dark photo OR a page with no recipe on it — the server genuinely
      // cannot tell these apart, so one code carries both.
      return 'unreadable-photos';
    default:
      // The recipe reader failed, or the call never reached it (transport,
      // deadline, cancellation). Either way the honest user-facing outcome is
      // "that didn't work, try again" rather than a claim about their photos.
      return 'import-failed';
  }
}

// Import a recipe from photographs of a cookbook page (issue #649). Sends 1–4
// page images as base64, receives a fully-assembled, metric + British recipe
// draft (source.type='book') that the server has ALREADY persisted with
// needs_approval. On failure returns the specific PhotoImportFailureCode so the
// caller can show the right copy. NEVER throws (Rule 10).
//
// The explicit `timeout` is load-bearing, not decoration: the Firebase callable
// client defaults to 70s, so without it a slow multi-page extraction would fail
// on the client while the function was still working. PHOTO_IMPORT_TIMEOUT_SECONDS
// is the SAME constant the CF passes as its `timeoutSeconds`, so the two cannot
// drift apart.
//
// `traceparent` (issue #362) is an OPTIONAL, named transport field forwarded on
// the payload — the callable SDK cannot carry a custom `traceparent` HTTP header,
// so the browser-supplied W3C trace id rides here and the CF entrypoint strips it
// before running the flow. firebase-sync only forwards the string (Rule 4: no
// observability import).
export async function callExtractRecipeFromPhoto(
  input: ExtractRecipeFromPhotoInput,
  traceparent?: string,
): Promise<ReadResult<RecipeDoc, PhotoImportFailureCode>> {
  try {
    const fn = httpsCallable<ExtractRecipeFromPhotoInput & { traceparent?: string }, RecipeDoc>(
      getFunctions(undefined, 'europe-west2'),
      'extractRecipeFromPhoto',
      { timeout: PHOTO_IMPORT_TIMEOUT_SECONDS * 1000 },
    );
    const res = await fn(traceparent ? { ...input, traceparent } : input);
    return success(res.data);
  } catch (err) {
    return failure(classifyPhotoImportError(err));
  }
}
