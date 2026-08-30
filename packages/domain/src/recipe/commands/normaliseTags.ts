// The one tag normalisation (issue #1054).
//
// Every path that puts a tag on a recipe applies it: the authoring flows in
// `cloud-functions` normalise what the model emits, and the recipe editor in
// `web-pwa` normalises what a person types. The two apps cannot import each
// other (CLAUDE.md Rule 6), so until now each had its own copy — and they had
// drifted: only the server split on commas, so `vegetarian, quick` entered from
// the editor as the single tag `vegetarian,-quick` and then appeared as a
// suggestion on every future draft.
//
// Pure, no I/O, no clock (Rule 1).

/**
 * Normalise raw tags so stored tags stay uniform: split comma-joined tags
 * (`"vegetarian, quick"` → two), lowercase, trim, kebab-case, drop empties,
 * dedupe.
 *
 * Order is preserved, first occurrence wins. An already-normalised tag survives
 * unchanged, so re-normalising is idempotent — which is what lets the editor run
 * a suggestion chip's own tag back through it.
 */
export function normaliseTags(tags: readonly string[]): string[] {
  return [
    ...new Set(
      tags
        .flatMap((t) => t.split(','))
        .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
        .filter((t) => t.length > 0),
    ),
  ];
}
