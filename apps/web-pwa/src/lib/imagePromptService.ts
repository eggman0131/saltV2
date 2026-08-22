import { callGetImagePrompt } from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import type { GetImagePromptResult, ImagePromptFamily } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { reportIfFailed } from './errorReporting.js';

// The prompt behind any generated picture (issue #892).
//
// ONE service for all five families rather than a near-identical wrapper in each
// of canonService / kitchenToolService / equipmentService / recipeService. Those
// services exist because each owns a collection, its subscription and its
// mutations; this owns none of that. It is a single read-only callable whose only
// per-family variation is a string already carried in the argument, so four copies
// of one line would be four places for the reporting posture to drift and nothing
// gained. The dialog is shared too, and it calls this directly.

let reporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  reporter ??= createObservabilityErrorReportingAdapter();
  return reporter;
}

/**
 * Fetches the complete prompt behind one generated picture, with the model it
 * resolves to and the style seed it is conditioned on.
 *
 * Reads only: nothing is written and no image is generated. A missing document
 * comes back as `NotFound` and is suppressed by the reporting policy (§7.6) — the
 * item was deleted under a page that was already open, which is a race rather
 * than a defect. A malformed response is a `StorageError` and IS reported.
 */
export async function getImagePrompt(
  family: ImagePromptFamily,
  id: string,
): Promise<ReadResult<GetImagePromptResult, DomainError>> {
  return reportIfFailed(getErrorReporter(), await callGetImagePrompt(family, id));
}
