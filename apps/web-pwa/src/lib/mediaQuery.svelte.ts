/**
 * A live media query, read safely (issue #933).
 *
 * Three route components carried a byte-identical 25-line `$effect` around this
 * one query — `CatalogPage`, `MealPlanWeekPage` and `RecipeViewPage` — differing
 * only in the name of the boolean they assigned to. This is that sequence, once.
 *
 * It generalises the shape `lib/swipe.svelte.ts`'s `isCoarsePointer` already
 * uses, which `MealPlanWeekPage` itself described as "the house pattern for a
 * live media read"; the difference is that this one SUBSCRIBES, because a fold
 * or a rotate must move the layout while the page is open.
 *
 * `false` IS THE ANSWER WHENEVER THE QUESTION CANNOT BE ASKED, and every arm of
 * that matters:
 *
 *   - no `window` — SSR;
 *   - no `window.matchMedia` — jsdom ships none of its own;
 *   - `matchMedia` throws — an engine too old for range syntax rejects the query,
 *     and the whole point of the range form is that its failure is total rather
 *     than a `min-width`-shaped half-answer that says "yes, docked" for a page
 *     that is still one column;
 *   - a `MediaQueryList` with no `addEventListener` — a stub, or a very old
 *     engine. The one-shot read still stands; only the subscription is skipped.
 *     This is why the read happens BEFORE the listener capability check, and
 *     moving it below is a real regression that `RecipeViewPage.docked.test.ts`
 *     catches.
 *
 * The phone path is the honest default for all four: a component that thinks it
 * is docked when it is not suppresses a drawer and leaves no pane in its place.
 */

/**
 * The two-pane seam — the viewport at which a page may show a list and a detail
 * side by side (issue #663).
 *
 * ⚠ THIS IS ONE OF TWO SPELLINGS OF ONE SEAM, and the other is
 * `@custom-variant split` in `src/app.css`. A Tailwind variant cannot be read
 * from script and this string cannot be used as a variant, so the duplication is
 * forced; `app.css`'s comment names this constant and the two MUST move
 * together. The range syntax here is what Tailwind v4 compiles its
 * `min-width`/`min-height` form to, so they are the same query, not merely
 * equivalent ones.
 */
export const SPLIT_QUERY = '(width >= 700px) and (height >= 480px)';

/** A live media query. Read `.matches`; it updates while the page is open. */
export function createMediaQuery(query: string): { readonly matches: boolean } {
  let matches = $state(false);

  $effect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    matches = mql.matches;
    if (typeof mql.addEventListener !== 'function') return;
    const onChange = (event: MediaQueryListEvent): void => {
      matches = event.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  });

  return {
    get matches(): boolean {
      return matches;
    },
  };
}
