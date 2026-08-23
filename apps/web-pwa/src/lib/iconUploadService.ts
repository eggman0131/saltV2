import { callSetIconUpload } from '@salt/firebase-sync';
import { createObservabilityErrorReportingAdapter } from '@salt/observability';
import type { IconUploadFamily, SetIconUploadInput } from '@salt/domain/schemas';
import type { DomainError, ReadResult } from '@salt/shared-types';
import { reportIfFailed } from './errorReporting.js';

// Your own picture in place of a generated pictogram (issue #892).
//
// ONE service for all four families, for the reason imagePromptService gives:
// canonService / kitchenToolService / equipmentService own a collection, its
// subscription and its mutations, and this owns none of that — it is a single
// callable whose only per-family variation is an argument already in the
// signature. Separate from imagePromptService because they are separate concerns
// wearing the same button row: one reads words, one writes a picture.

let reporter: ReturnType<typeof createObservabilityErrorReportingAdapter> | null = null;
function getErrorReporter() {
  reporter ??= createObservabilityErrorReportingAdapter();
  return reporter;
}

/**
 * Sends one cropped photograph to be framed and stored as this item's pictogram.
 *
 * The image bytes are NEVER attached to a report — free-form user content stays
 * out of reported context by policy, and a base64 photograph is the largest
 * possible way to violate that. `reportIfFailed` passes only the `DomainError`.
 */
export async function uploadIcon(
  family: IconUploadFamily,
  id: string,
  imageBase64: string,
  contentType?: SetIconUploadInput['contentType'],
): Promise<ReadResult<void, DomainError>> {
  return reportIfFailed(
    getErrorReporter(),
    await callSetIconUpload(family, id, imageBase64, contentType),
  );
}
