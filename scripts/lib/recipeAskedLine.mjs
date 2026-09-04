// The one-line summary the `--apply` write loop prints after a successful PATCH
// (issue #1254 review, blocking 1). Extracted for the same reason
// scripts/lib/recipeTimesVerdict.mjs and its siblings were: the script reaches
// `gcloud` and the network at top level, so nothing inside its write loop has a
// seam a test can call directly — a bug there is invisible to anything short of
// running the loop for real.
//
// That is exactly how the bug shipped. #1248 deleted the `triple()` helper and
// the `times` field it read, but left one caller behind: the success log line
// inside the write loop's `try`, called AFTER the PATCH succeeded and AFTER
// `asked` was incremented. Every `--apply` write hit a `ReferenceError` on this
// line, which the loop's own `catch` swallowed — counting the write as BOTH
// `asked` (already incremented) and `FAILED` (the exception), and reporting a
// clean production sweep as `asked N … failed N`, exit code 1. A source-text
// grep for the retired field name could not catch this: the call site never
// named `times`, only referenced a variable of that name that no longer existed.
// This module gives the line a name a test can call, so an undefined reference
// throws in the test the same way it threw in production, red before the fix
// and green after — no grep required.

/**
 * The line printed for one recipe once its `timesRequestedAt` PATCH has
 * succeeded. Takes only `id` and `title` — the two fields the write loop's `r`
 * still carries; the retired `times` field this line used to print is gone
 * (see the header on backfill-recipe-times.mjs's write loop).
 */
export function recipeAskedLine(recipe) {
  return `  asked   ${recipe.id}  ${recipe.title}`;
}
