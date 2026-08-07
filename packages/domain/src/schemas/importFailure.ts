import type { DomainError } from '@salt/shared-types';
import type { UrlImportFailureCode } from './extractRecipeFromUrl.js';
import type { PhotoImportFailureCode } from './extractRecipeFromPhoto.js';

// The failure channel both recipe-import paths cross on (issue #740).
//
// WHY A UNION, not a wider code list. Import used to carry a bespoke CLOSED
// vocabulary (`URL_IMPORT_FAILURE_CODES` / `PHOTO_IMPORT_FAILURE_CODES`) and
// nothing else, so a failure that is not about the recipe — a dead session, a
// transport hiccup — had nowhere to land but the mappers' `default:` branch. It
// landed on `fetch-failed` / `import-failed`, which told the user the recipe
// site (or their photographs) was at fault when they were simply signed out.
//
// The second-order effect is what makes this a policy bug rather than a copy
// bug: a bespoke code carries no `DomainError` category, so the reporting gate
// at `ErrorReportingPort` — which is gated BY CATEGORY, per
// docs/salt-architecture.md §7.6 — could never see it. A signed-out import was
// invisible to error tracking.
//
// So: outcomes that are genuinely ABOUT THE IMPORT keep their bespoke codes and
// their existing copy; everything else crosses as an ordinary `DomainError`, the
// same spelling the other fifteen callable sites in `firebase-sync` already use.
// The category gate then works with no bespoke wiring.
//
// Generic in the code set on purpose: the URL and photo vocabularies stay two
// SEPARATE closed taxonomies (an `invalid-url` is meaningless for a photograph,
// and #649 deliberately split them) — this shares only the union's SHAPE, never
// the codes.
export type ImportFailure<Code extends string> =
  { readonly kind: 'ImportError'; readonly code: Code } | DomainError;

export type UrlImportFailure = ImportFailure<UrlImportFailureCode>;

export type PhotoImportFailure = ImportFailure<PhotoImportFailureCode>;

// Narrowing helper so call sites (copy maps, reporting gates, span attributes)
// read the same way on both paths and never re-spell the discriminant.
export function isImportError<Code extends string>(
  failure: ImportFailure<Code>,
): failure is { readonly kind: 'ImportError'; readonly code: Code } {
  return failure.kind === 'ImportError';
}
